import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { ContactController } = require('./dist/contact.js');
const { ContactLimiter } = require('./dist/contact-limiter.js');
const origin = 'https://www.ablestsolutions.com';
const recipient = 'ablestdigitalsolutions@gmail.com';
const syntheticKey = 're_synthetic_contact_test_key_never_valid';
const schema = readFileSync(new URL('../postgres/schema.sql', import.meta.url), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const hasStatus = status => error => error.getStatus?.() === status;
const input = overrides => ({
  name: 'Fixture Visitor', email: 'visitor@example.com', service: 'Custom software',
  message: 'Please discuss a synthetic website inquiry.', website: '', requestId: randomUUID(),
  ...overrides,
});
const reply = () => ({
  headers: new Map(),
  setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
});

function environment(values) {
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function controllerFixture(t) {
  const restore = environment({
    DATA_BACKEND: 'neon', WEB_ORIGIN: origin, RESEND_API_KEY: syntheticKey,
    CONTACT_FROM_EMAIL: 'website@mail.example.com', CONTACT_TO_EMAIL: undefined,
  });
  const api = new ContactController();
  const checks = [], calls = [], warnings = [];
  let limitResult = true;
  let provider = async () => new Response(JSON.stringify({ id: randomUUID() }), { status: 200 });
  // No real pool is opened and no live transport can be reached by these tests.
  api.limiter = { check: async email => { checks.push(email); return limitResult; }, close: async () => {} };
  api.logger = { warn: text => warnings.push(text) };
  t.mock.method(globalThis, 'fetch', async (...args) => {
    calls.push(args);
    return provider(...args);
  });
  t.after(async () => { await api.onModuleDestroy(); restore(); });
  return {
    api, checks, calls, warnings,
    setProvider(next) { provider = next; },
    setLimit(next) { limitResult = next; },
  };
}

test('contact rejects foreign origins, invalid input, injected fields, and bots before dispatch', async t => {
  const fixture = controllerFixture(t);
  for (const rejectedOrigin of [undefined, '', 'null', 'https://attacker.example', `${origin}.attacker.example`, 'http://www.ablestsolutions.com']) {
    const response = reply();
    await assert.rejects(fixture.api.send(input(), rejectedOrigin, response), hasStatus(403));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const invalid = [
    null, [], 'invalid', input({ name: '' }), input({ name: 'x'.repeat(101) }),
    input({ name: 'Visitor\r\nBcc: other@example.com' }), input({ name: 'Visitor\u0000' }),
    input({ email: 'invalid' }), input({ email: 'a@example.com\r\nBcc: other@example.com' }),
    input({ email: ['visitor@example.com'] }), input({ email: `${'a'.repeat(190)}@example.com` }),
    input({ service: 'Injected service' }), input({ message: ' ' }), input({ message: 'x'.repeat(4001) }),
    input({ message: 'Message\u0000injection' }), input({ website: 'https://spam.example' }),
    input({ website: undefined }), input({ requestId: 'not-a-uuid' }), input({ requestId: '1'.repeat(37) }),
    input({ to: ['attacker@example.com'] }), input({ from: 'attacker@example.com' }),
    input({ headers: { Bcc: 'attacker@example.com' } }), input({ reply_to: 'attacker@example.com' }),
  ];
  for (const body of invalid) await assert.rejects(fixture.api.send(body, origin, reply()), hasStatus(400));
  assert.equal(fixture.checks.length, 0);
  assert.equal(fixture.calls.length, 0);
});

test('contact fails closed when its sending configuration or durable limiter is unavailable', async t => {
  const fixture = controllerFixture(t);
  for (const changes of [
    { RESEND_API_KEY: undefined }, { RESEND_API_KEY: ' ' }, { CONTACT_FROM_EMAIL: undefined },
    { CONTACT_FROM_EMAIL: 'invalid' }, { CONTACT_FROM_EMAIL: 'a@example.com\r\nBcc: leaked@example.com' },
    { CONTACT_TO_EMAIL: 'invalid' },
  ]) {
    const restore = environment(changes);
    try { await assert.rejects(fixture.api.send(input(), origin, reply()), hasStatus(503)); }
    finally { restore(); }
  }
  assert.equal(fixture.checks.length, 0);
  assert.equal(fixture.calls.length, 0);

  fixture.setLimit(false);
  const limited = reply();
  await assert.rejects(fixture.api.send(input(), origin, limited), hasStatus(429));
  assert.equal(limited.headers.get('retry-after'), '900');
  assert.equal(fixture.calls.length, 0);
  fixture.api.limiter.check = async () => { throw new Error('synthetic secret database failure'); };
  await assert.rejects(fixture.api.send(input(), origin, reply()), error => {
    assert.equal(error.getStatus(), 503);
    assert.doesNotMatch(JSON.stringify(error.getResponse()), /secret database/);
    return true;
  });
  assert.equal(fixture.calls.length, 0);
});

test('contact fixes delivery addresses, uses visitor Reply-To, and safely reuses idempotency keys', async t => {
  const fixture = controllerFixture(t);
  const body = input({ name: '  Visitor <script>alert(1)</script>  ', email: ' VISITOR@EXAMPLE.COM ', message: 'First line\r\nSecond line' });
  const response = reply();
  assert.deepEqual(await fixture.api.send(body, origin, response), { accepted: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(fixture.checks, ['visitor@example.com']);
  assert.equal(fixture.calls.length, 1);
  const [url, options] = fixture.calls[0];
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(options.method, 'POST');
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, `Bearer ${syntheticKey}`);
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.ok(options.signal instanceof AbortSignal);
  const payload = JSON.parse(options.body);
  assert.deepEqual(Object.keys(payload).sort(), ['from', 'reply_to', 'subject', 'text', 'to']);
  assert.equal(payload.from, 'Ablests Digital Solution <website@mail.example.com>');
  assert.deepEqual(payload.to, [recipient]);
  assert.equal(payload.reply_to, 'visitor@example.com');
  assert.equal(payload.subject, 'Ablests inquiry: Custom software');
  assert.match(payload.text, /Name: Visitor <script>alert\(1\)<\/script>/);
  assert.match(payload.text, /First line\nSecond line$/);
  // User markup is sent as plain text; it never becomes an HTML template.
  assert.equal(Object.hasOwn(payload, 'html'), false);
  const idempotency = options.headers['Idempotency-Key'];
  assert.ok(idempotency.length <= 256);
  assert.match(idempotency, new RegExp(body.requestId));
  await fixture.api.send(body, origin, reply());
  assert.equal(fixture.calls[1][1].headers['Idempotency-Key'], idempotency);
  assert.equal(fixture.calls[1][1].body, options.body);
  await fixture.api.send({ ...body, message: 'A changed inquiry' }, origin, reply());
  assert.notEqual(fixture.calls[2][1].headers['Idempotency-Key'], idempotency);
});

test('contact reports provider rejection and uncertain acceptance without leaking provider details', async t => {
  const fixture = controllerFixture(t);
  const privateProviderText = 'provider-secret-fixture do not expose';
  for (const status of [401, 403, 429, 500, 503]) {
    fixture.setProvider(async () => new Response(JSON.stringify({ id: randomUUID(), message: privateProviderText }), { status }));
    await assert.rejects(fixture.api.send(input(), origin, reply()), error => {
      assert.equal(error.getStatus(), 503);
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /provider-secret-fixture|re_synthetic/);
      return true;
    });
  }
  for (const result of [null, {}, [], { id: '' }, { id: '   ' }, { id: 123 }, { accepted: true }]) {
    fixture.setProvider(async () => new Response(JSON.stringify(result), { status: 200 }));
    await assert.rejects(fixture.api.send(input(), origin, reply()), hasStatus(503));
  }
  fixture.setProvider(async () => new Response('invalid JSON provider-secret-fixture', { status: 200 }));
  await assert.rejects(fixture.api.send(input(), origin, reply()), hasStatus(503));
  for (const failure of [new Error(privateProviderText), new DOMException(privateProviderText, 'TimeoutError')]) {
    fixture.setProvider(async () => { throw failure; });
    await assert.rejects(fixture.api.send(input(), origin, reply()), hasStatus(503));
  }
  assert.doesNotMatch(fixture.warnings.join('\n'), /provider-secret-fixture|re_synthetic|visitor@example.com/);
  const timeoutSpy = t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort(new DOMException('synthetic timeout', 'TimeoutError')));
  fixture.setProvider(async (_url, options) => { options.signal.throwIfAborted(); });
  await assert.rejects(fixture.api.send(input(), origin, reply()), hasStatus(503));
  assert.equal(timeoutSpy.mock.calls[0].arguments[0], 15000);
});

test('contact limiter persists and atomically enforces sender and global bounds in PostgreSQL', async t => {
  const restore = environment({ DATA_BACKEND: 'neon' });
  const pg = new PGlite();
  const limiters = [];
  const createLimiter = () => {
    const limiter = new ContactLimiter();
    limiter.pool = { query: (text, values) => pg.query(text, values), end: async () => {} };
    limiters.push(limiter);
    return limiter;
  };
  try {
    await pg.exec(schema);
    await pg.query('INSERT INTO ablest_attempts(key,count,start) VALUES($1,$2,$3)', ['login:unrelated@example.com', 7, Date.now() - 60 * 60 * 1000]);
    await t.test('a new limiter instance retains previous sender attempts and resets expired contact attempts only', async () => {
      const first = createLimiter();
      const email = 'persistent-contact@example.com';
      assert.equal(await first.check(email), true);
      assert.equal(await first.check(email), true);
      assert.equal(await first.check(email), true);
      await first.close();
      assert.equal(await createLimiter().check(email), false);
      const rows = (await pg.query("SELECT key,count FROM ablest_attempts WHERE key LIKE 'contact:%' ORDER BY key")).rows;
      assert.deepEqual(rows.map(row => row.key), ['contact:global', `contact:sender:${hash(email)}`]);
      assert.equal(Number(rows[1].count), 4);
      assert.equal(rows.some(row => row.key.includes(email)), false);
      await pg.query("UPDATE ablest_attempts SET start=$1 WHERE key LIKE 'contact:%'", [Date.now() - 16 * 60 * 1000]);
      assert.equal(await createLimiter().check(email), true);
      assert.equal(Number((await pg.query('SELECT count FROM ablest_attempts WHERE key=$1', [`contact:sender:${hash(email)}`])).rows[0].count), 1);
      assert.equal(Number((await pg.query('SELECT count FROM ablest_attempts WHERE key=$1', ['login:unrelated@example.com'])).rows[0].count), 7);
    });
    await t.test('racing senders cannot exceed three attempts for one sender', async () => {
      await pg.query("DELETE FROM ablest_attempts WHERE key LIKE 'contact:%'");
      const results = await Promise.all(Array.from({ length: 8 }, () => createLimiter().check('racing-contact@example.com')));
      assert.equal(results.filter(Boolean).length, 3);
      assert.equal(Number((await pg.query('SELECT count FROM ablest_attempts WHERE key=$1', [`contact:sender:${hash('racing-contact@example.com')}`])).rows[0].count), 4);
    });
    await t.test('racing unique senders cannot exceed the global limit or create unbounded sender records', async () => {
      await pg.query("DELETE FROM ablest_attempts WHERE key LIKE 'contact:%'");
      const results = await Promise.all(Array.from({ length: 24 }, (_, index) => createLimiter().check(`unique-${index}@example.com`)));
      assert.equal(results.filter(Boolean).length, 10);
      assert.equal(Number((await pg.query("SELECT count FROM ablest_attempts WHERE key='contact:global'")).rows[0].count), 11);
      assert.equal(Number((await pg.query("SELECT count(*) AS n FROM ablest_attempts WHERE key LIKE 'contact:sender:%'")).rows[0].n), 10);
      assert.equal(await createLimiter().check('new-after-limit@example.com'), false);
    });
  } finally {
    await Promise.all(limiters.map(limiter => limiter.close()));
    await pg.close();
    restore();
  }
});

test('local contact limits survive separate processes without touching the real SQLite store', () => {
  const temporaryRoot = realpathSync(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'ablest-contact-test-'));
  const verified = realpathSync(directory);
  const packagePath = fileURLToPath(new URL('../apps/api/package.json', import.meta.url));
  const script = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    const require = createRequire(process.argv[1]);
    const { ContactLimiter } = require('./dist/contact-limiter.js');
    const limiter = new ContactLimiter();
    const first = process.argv[2] === 'first';
    const email = 'local-contact@example.com';
    if (first) {
      for (let count = 0; count < 3; count++) assert.equal(await limiter.check(email), true);
    }
    assert.equal(await limiter.check(email), false);
    const { db } = require('./dist/store.js');
    if (!first) {
      db.prepare("UPDATE login_attempts SET start=? WHERE key LIKE 'contact:%'").run(Date.now() - 16 * 60 * 1000);
      assert.equal(await limiter.check(email), true);
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM login_attempts WHERE key LIKE '%local-contact@example.com%'").get().n, 0);
    await limiter.close();
    db.close();
    process.stdout.write('fixture-ok');
  `;
  try {
    for (const phase of ['first', 'restart']) {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, packagePath, phase], {
        cwd: directory,
        env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, DATA_BACKEND: 'sqlite', DATA_DIR: directory },
        encoding: 'utf8', timeout: 15000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, 'fixture-ok');
    }
  } finally {
    // Delete only the exact generated fixture directory, never the app's data.
    if (realpathSync(directory) !== verified || dirname(directory) !== temporaryRoot || !basename(directory).startsWith('ablest-contact-test-')) {
      throw new Error('Unexpected contact test cleanup target.');
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
