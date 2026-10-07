import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { NeonController } = require('./dist/neon.js');
const sharp = require('sharp');
const schema = readFileSync(new URL('../postgres/schema.sql', import.meta.url), 'utf8');
const origin = 'https://www.ablestsolutions.com';
const setupToken = 'synthetic-neon-setup-token-testing-only-1234567890';
const ownerCredentials = { email: 'owner@example.com', password: 'owner-password-testing-12345', setupToken };
const digest = value => createHash('sha256').update(value).digest('hex');
const hasStatus = status => error => error.getStatus?.() === status;

function reply() {
  return {
    headers: new Map(),
    body: undefined,
    setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
    send(value) { this.body = Buffer.from(value); },
  };
}

function cookieFrom(response) {
  const header = response.headers.get('set-cookie');
  assert.match(header, /^ablest_admin=[a-f0-9]{64};/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Secure/);
  return header.split(';')[0];
}

function publicProfile(user) {
  assert.deepEqual(Object.keys(user).sort(), ['company', 'email', 'id', 'name', 'phone', 'role']);
  assert.equal(Object.hasOwn(user, 'salt'), false);
  assert.equal(Object.hasOwn(user, 'hash'), false);
}

async function fixture() {
  const environment = {
    DATABASE_URL: 'postgresql://synthetic_user:synthetic_password@ep-testing-pooler.us-east-1.aws.neon.tech/ablest?sslmode=require',
    WEB_ORIGIN: origin,
    ADMIN_EMAIL: ownerCredentials.email,
    ADMIN_SETUP_TOKEN: setupToken,
  };
  const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const pg = new PGlite();
  let api;
  function restore() {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  try {
    await pg.exec(schema);
    await pg.exec(schema);
    api = new NeonController();
    // The constructor creates a lazy pool. Close it before replacing every
    // query with the temporary, in-memory PostgreSQL fixture.
    await api.pool.end();
    api.pool = { query: (text, values) => pg.query(text, values), end: async () => {} };
    return {
      pg,
      api,
      async close() {
        try { await api.onModuleDestroy(); await pg.close(); }
        finally { restore(); }
      },
    };
  } catch (error) {
    try { if (api) await api.onModuleDestroy(); await pg.close(); }
    finally { restore(); }
    throw error;
  }
}

test('Neon schema and real controller preserve hosted accounts, sessions, content, and private images', async t => {
  const { pg, api, close } = await fixture();
  let ownerCookie, aliceCookie, bobCookie, alice, bob, draft, firstImage, coverImage;
  const projectInput = {
    title: "A client's project",
    subtitle: 'Synthetic fixture',
    category: 'Testing',
    description: 'A private draft created only in memory.',
    features: ['  One feature  ', 'Quoted "text", with comma', "Apostrophe's item"],
    status: 'In development',
    url: 'https://example.com/project',
    published: false,
  };
  const expectedFeatures = projectInput.features.map(value => value.trim());
  const png = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#b9f36b' } }).png().toBuffer();
  const file = { buffer: png, mimetype: 'image/png' };

  try {
    await t.test('schema is repeatable, seeds once, and denies direct unprivileged access', async () => {
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_projects')).rows[0].n), 2);
      assert.deepEqual(await api.health(), { status: 'ok', backend: 'neon' });
      const seeded = await api.projects();
      assert.deepEqual(seeded.map(project => project.title), ['InTouch', 'IterateView']);
      assert.equal(seeded.every(project => Array.isArray(project.features) && Array.isArray(project.images)), true);
      await pg.query("INSERT INTO ablest_meta(key,value) VALUES('fixture-setting','preserved')");
      await pg.exec(schema);
      assert.equal((await pg.query("SELECT value FROM ablest_meta WHERE key='fixture-setting'")).rows[0].value, 'preserved');
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_projects')).rows[0].n), 2);

      await pg.exec('CREATE ROLE neon_fixture_browser; SET ROLE neon_fixture_browser;');
      try {
        for (const table of ['ablest_users', 'ablest_sessions', 'ablest_projects', 'ablest_images']) {
          await assert.rejects(pg.query(`SELECT * FROM ${table}`), /permission denied/);
        }
        await assert.rejects(pg.query("SELECT ablest_throttle('forged')"), /permission denied/);
        await assert.rejects(pg.query('SELECT ablest_edit_image($1,$2,$3)', [randomUUID(), 'Forged', false]), /permission denied/);
      } finally { await pg.exec('RESET ROLE'); }
    });

    await t.test('owner bootstrap requires its setup code and permits only one racing administrator', async () => {
      assert.deepEqual(await api.adminSession(''), { initialized: false, authenticated: false, user: null, setupTokenRequired: true });
      await assert.rejects(api.setup(ownerCredentials, 'https://other.example', reply()), hasStatus(403));
      await assert.rejects(api.setup({ email: ownerCredentials.email, password: ownerCredentials.password }, origin, reply()), hasStatus(403));
      await assert.rejects(api.setup({ ...ownerCredentials, setupToken: 'incorrect-test-code' }, origin, reply()), hasStatus(403));
      await assert.rejects(api.setup({ ...ownerCredentials, email: 'intruder@example.com' }, origin, reply()), hasStatus(401));
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_users')).rows[0].n), 0);
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_sessions')).rows[0].n), 0);

      // Both calls must observe the real database before either inserts. This
      // exercises the unique constraint instead of relying on a timing race.
      const originalQuery = api.pool.query;
      let initializedQueries = 0, release;
      const barrier = new Promise(resolve => { release = resolve; });
      api.pool.query = async (text, values) => {
        const result = await originalQuery(text, values);
        if (text === "SELECT id FROM ablest_users WHERE role='admin' LIMIT 1") {
          if (++initializedQueries === 2) release();
          await barrier;
        }
        return result;
      };
      const responses = [reply(), reply()];
      let results;
      try {
        results = await Promise.allSettled(responses.map(response => api.setup(ownerCredentials, origin, response)));
      } finally { api.pool.query = originalQuery; }
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const rejected = results.find(result => result.status === 'rejected');
      assert.equal(rejected.reason.getStatus(), 409);
      const winner = results.findIndex(result => result.status === 'fulfilled');
      const owner = results[winner].value;
      assert.equal(owner.user.role, 'admin');
      publicProfile(owner.user);
      ownerCookie = cookieFrom(responses[winner]);
      const stored = (await pg.query("SELECT * FROM ablest_users WHERE role='admin'")).rows;
      assert.equal(stored.length, 1);
      assert.notEqual(stored[0].hash, ownerCredentials.password);
      assert.match(stored[0].salt, /^[a-f0-9]{64}$/);
      assert.match(stored[0].hash, /^[a-f0-9]{128}$/);
      const sessions = (await pg.query('SELECT hash,expires FROM ablest_sessions')).rows;
      assert.equal(sessions.length, 1);
      assert.equal(sessions[0].hash, digest(ownerCookie.slice('ablest_admin='.length)));
      assert.ok(Number(sessions[0].expires) > Date.now() + 7 * 60 * 60 * 1000);
      await assert.rejects(api.setup(ownerCredentials, origin, reply()), hasStatus(409));
      await assert.rejects(pg.query("INSERT INTO ablest_users(email,name,role,salt,hash) VALUES('other-owner@example.com','Other','admin','salt','hash')"), /ablest_single_admin/);
    });

    await t.test('client registration and profile updates isolate users and reject identity or role injection', async () => {
      await assert.rejects(api.profile(''), hasStatus(401));
      await assert.rejects(api.register({ email: ownerCredentials.email, password: ownerCredentials.password, name: 'Reserved' }, origin, '', reply()), hasStatus(409));
      await assert.rejects(api.register({ email: 'forged@example.com', password: 'forged-password-12345', name: 'Forged', role: 'admin' }, origin, '', reply()), hasStatus(400));
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_users')).rows[0].n), 1);

      const aliceResponse = reply();
      const aliceResult = await api.register({ email: 'ALICE@example.com', password: 'alice-password-12345', name: "Alice O'Neil" }, origin, '', aliceResponse);
      alice = aliceResult.user;
      aliceCookie = cookieFrom(aliceResponse);
      assert.equal(alice.email, 'alice@example.com');
      assert.equal(alice.role, 'client');
      publicProfile(alice);
      const bobResponse = reply();
      bob = (await api.register({ email: 'bob@example.com', password: 'bob-password-1234567', name: 'Bob' }, origin, '', bobResponse)).user;
      bobCookie = cookieFrom(bobResponse);
      publicProfile(bob);
      assert.notEqual(alice.id, bob.id);

      const details = { name: 'Alice Updated', company: "Company'; UPDATE ablest_users SET role='admin'; --", phone: '123' };
      for (const forbidden of [{ role: 'admin' }, { id: bob.id }, { email: 'replacement@example.com' }]) {
        await assert.rejects(api.updateProfile({ ...details, ...forbidden }, aliceCookie, origin), hasStatus(400));
      }
      await assert.rejects(api.updateProfile(details, aliceCookie, 'https://other.example'), hasStatus(403));
      const updated = await api.updateProfile(details, aliceCookie, origin);
      assert.equal(updated.id, alice.id);
      assert.equal(updated.company, details.company);
      assert.equal(updated.role, 'client');
      publicProfile(updated);
      assert.equal((await api.profile(bobCookie)).name, 'Bob');
      assert.equal((await api.profile(bobCookie)).company, '');
      assert.equal((await api.profile(ownerCookie)).role, 'admin');
      await pg.exec(schema);
      assert.equal((await api.profile(aliceCookie)).company, details.company);
      assert.equal((await api.adminSession(aliceCookie)).authenticated, false);
      await assert.rejects(api.adminProjects(aliceCookie), hasStatus(403));
      await assert.rejects(api.clients(aliceCookie), hasStatus(403));
      await assert.rejects(api.adminLogin({ email: alice.email, password: 'alice-password-12345' }, origin, '', reply()), hasStatus(401));
      const clients = await api.clients(ownerCookie);
      assert.deepEqual(clients.map(user => user.id).sort(), [alice.id, bob.id].sort());
      clients.forEach(publicProfile);
    });

    await t.test('project JSON, image decoding, cover ordering, and publication preserve draft privacy', async () => {
      await assert.rejects(api.create(projectInput, aliceCookie, origin), hasStatus(403));
      draft = await api.create(projectInput, ownerCookie, origin);
      assert.deepEqual(draft.features, expectedFeatures);
      assert.equal(draft.published, false);
      assert.deepEqual(draft.images, []);
      assert.equal((await api.projects()).some(project => project.id === draft.id), false);
      assert.equal((await api.adminProjects(ownerCookie)).some(project => project.id === draft.id), true);
      await assert.rejects(api.upload(draft.id, file, 'Forbidden', aliceCookie, origin), hasStatus(403));
      await assert.rejects(api.upload(draft.id, { buffer: Buffer.from('not an image'), mimetype: 'image/png' }, 'Invalid', ownerCookie, origin), hasStatus(400));
      await assert.rejects(api.upload(draft.id, file, '', ownerCookie, origin), hasStatus(400));
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_images WHERE project_id=$1', [draft.id])).rows[0].n), 0);

      firstImage = await api.upload(draft.id, file, '  First image  ', ownerCookie, origin);
      coverImage = await api.upload(draft.id, file, 'Second image', ownerCookie, origin);
      assert.deepEqual(Object.keys(firstImage).sort(), ['alt', 'id', 'position']);
      assert.equal(firstImage.alt, 'First image');
      await assert.rejects(api.image(firstImage.id, '', reply()), hasStatus(404));
      await assert.rejects(api.image(firstImage.id, aliceCookie, reply()), hasStatus(404));
      const privateImage = reply();
      await api.image(firstImage.id, ownerCookie, privateImage);
      assert.equal(privateImage.headers.get('content-type'), 'image/webp');
      assert.equal(privateImage.headers.get('cache-control'), 'no-store');
      assert.equal(privateImage.headers.get('x-content-type-options'), 'nosniff');
      assert.equal((await sharp(privateImage.body).metadata()).format, 'webp');
      await assert.rejects(api.editImage(coverImage.id, { alt: 'Forged cover', cover: true }, aliceCookie, origin), hasStatus(403));
      await api.editImage(coverImage.id, { alt: 'Cover image', cover: true }, ownerCookie, origin);
      let listed = (await api.adminProjects(ownerCookie)).find(project => project.id === draft.id);
      assert.equal(listed.images[0].id, coverImage.id);
      assert.equal(listed.images[0].alt, 'Cover image');
      assert.equal(listed.images.every(image => !Object.hasOwn(image, 'data')), true);

      const updatedInput = { ...projectInput, features: ['Revised "JSON" feature', 'Second item'], published: true };
      const edited = await api.edit(draft.id, updatedInput, ownerCookie, origin);
      assert.deepEqual(edited.features, updatedInput.features);
      assert.deepEqual((await pg.query('SELECT features FROM ablest_projects WHERE id=$1', [draft.id])).rows[0].features, updatedInput.features);
      listed = (await api.projects()).find(project => project.id === draft.id);
      assert.deepEqual(listed.features, updatedInput.features);
      const publicImage = reply();
      await api.image(firstImage.id, '', publicImage);
      assert.deepEqual(publicImage.body, privateImage.body);

      // Unpublishing between metadata and byte retrieval must still prevent
      // an anonymous response from receiving the image.
      const originalQuery = api.pool.query;
      api.pool.query = async (text, values) => {
        const result = await originalQuery(text, values);
        if (text.startsWith('SELECT p.published FROM ablest_images')) {
          await pg.query('UPDATE ablest_projects SET published=false WHERE id=$1', [draft.id]);
        }
        return result;
      };
      const interruptedImage = reply();
      try { await assert.rejects(api.image(firstImage.id, '', interruptedImage), hasStatus(404)); }
      finally { api.pool.query = originalQuery; }
      assert.equal(interruptedImage.body, undefined);
      assert.equal((await api.projects()).some(project => project.id === draft.id), false);
      await assert.rejects(api.image(firstImage.id, bobCookie, reply()), hasStatus(404));
    });

    await t.test('database functions enforce image and project limits and deletion cascades', async () => {
      for (let count = 2; count < 11; count++) {
        await api.upload(draft.id, file, `Synthetic image ${count}`, ownerCookie, origin);
      }
      const uploads = await Promise.allSettled([
        api.upload(draft.id, file, 'Final permitted image', ownerCookie, origin),
        api.upload(draft.id, file, 'Concurrent overflow', ownerCookie, origin),
      ]);
      assert.equal(uploads.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(uploads.find(result => result.status === 'rejected').reason.getStatus(), 400);
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_images WHERE project_id=$1', [draft.id])).rows[0].n), 12);
      await assert.rejects(api.upload(draft.id, file, 'Overflow', ownerCookie, origin), hasStatus(400));

      const seedId = (await pg.query('SELECT id FROM ablest_projects WHERE id<>$1 LIMIT 1', [draft.id])).rows[0].id;
      await assert.rejects(pg.query('SELECT ablest_add_image($1,$2,$3,$4)', [randomUUID(), seedId, 'Oversized binary', Buffer.alloc(2097153)]), /check constraint/);
      await assert.rejects(pg.query('SELECT ablest_add_image($1,$2,$3,$4)', [randomUUID(), randomUUID(), 'Missing project', png]), /project_missing/);
      await assert.rejects(api.deleteImage(firstImage.id, aliceCookie, origin), hasStatus(403));
      await api.deleteImage(firstImage.id, ownerCookie, origin);
      await assert.rejects(api.image(firstImage.id, ownerCookie, reply()), hasStatus(404));
      await assert.rejects(api.deleteImage(firstImage.id, ownerCookie, origin), hasStatus(404));
      await api.upload(draft.id, file, 'Replacement after deletion', ownerCookie, origin);

      const count = Number((await pg.query('SELECT count(*) AS n FROM ablest_projects')).rows[0].n);
      await pg.query(`INSERT INTO ablest_projects(title,subtitle,category,description,features,status,url,published,position)
        SELECT 'Limit fixture '||n,'','Testing','Synthetic project limit fixture','[]'::jsonb,'In development','',false,1000+n
        FROM generate_series(1,$1::integer) AS fixture(n)`, [99 - count]);
      const creations = await Promise.allSettled([
        api.create({ ...projectInput, title: 'Final permitted project' }, ownerCookie, origin),
        api.create({ ...projectInput, title: 'Concurrent project overflow' }, ownerCookie, origin),
      ]);
      assert.equal(creations.filter(result => result.status === 'fulfilled').length, 1);
      assert.equal(creations.find(result => result.status === 'rejected').reason.getStatus(), 400);
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_projects')).rows[0].n), 100);
      await assert.rejects(api.create(projectInput, ownerCookie, origin), hasStatus(400));

      await assert.rejects(api.deleteProject(draft.id, aliceCookie, origin), hasStatus(403));
      await api.deleteProject(draft.id, ownerCookie, origin);
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_images WHERE project_id=$1', [draft.id])).rows[0].n), 0);
      await assert.rejects(api.image(coverImage.id, ownerCookie, reply()), hasStatus(404));
      await assert.rejects(api.edit(draft.id, projectInput, ownerCookie, origin), hasStatus(404));
      await assert.rejects(api.upload(draft.id, file, 'Deleted project', ownerCookie, origin), hasStatus(404));
      await assert.rejects(api.deleteProject(draft.id, ownerCookie, origin), hasStatus(404));
      assert.equal((await api.create(projectInput, ownerCookie, origin)).title, projectInput.title);
    });

    await t.test('SQL throttle survives calls and resets after its window', async () => {
      const key = 'login:throttle-fixture@example.com';
      for (let attempt = 0; attempt < 10; attempt++) {
        assert.equal((await pg.query('SELECT ablest_throttle($1) AS allowed', [key])).rows[0].allowed, true);
      }
      assert.equal((await pg.query('SELECT ablest_throttle($1) AS allowed', [key])).rows[0].allowed, false);
      await assert.rejects(api.signIn({ email: 'throttle-fixture@example.com', password: 'synthetic-password-12345' }, origin, '', reply()), hasStatus(429));
      await pg.query('UPDATE ablest_attempts SET start=$1 WHERE key=$2', [Date.now() - 16 * 60 * 1000, key]);
      assert.equal((await pg.query('SELECT ablest_throttle($1) AS allowed', [key])).rows[0].allowed, true);
      assert.equal(Number((await pg.query('SELECT count FROM ablest_attempts WHERE key=$1', [key])).rows[0].count), 1);
    });

    await t.test('session expiry, login rotation, and logout preserve separate accounts', async () => {
      await pg.query('UPDATE ablest_sessions SET expires=$1 WHERE user_id=$2', [Date.now() - 1000, alice.id]);
      assert.deepEqual(await api.session(aliceCookie), { authenticated: false, user: null });
      await assert.rejects(api.profile(aliceCookie), hasStatus(401));
      await assert.rejects(api.signIn({ email: 'alice@example.com', password: 'incorrect-password-12345' }, origin, '', reply()), hasStatus(401));
      const loginResponse = reply();
      const signedIn = await api.signIn({ email: 'ALICE@example.com', password: 'alice-password-12345' }, origin, aliceCookie, loginResponse);
      assert.equal(signedIn.user.id, alice.id);
      publicProfile(signedIn.user);
      aliceCookie = cookieFrom(loginResponse);
      assert.equal((await pg.query('SELECT key FROM ablest_attempts WHERE key=$1', ['login:alice@example.com'])).rows.length, 0);
      const oldCookie = aliceCookie;
      const rotatedResponse = reply();
      await api.signIn({ email: 'alice@example.com', password: 'alice-password-12345' }, origin, oldCookie, rotatedResponse);
      aliceCookie = cookieFrom(rotatedResponse);
      assert.notEqual(aliceCookie, oldCookie);
      assert.equal((await api.session(oldCookie)).authenticated, false);
      assert.equal((await api.session(aliceCookie)).authenticated, true);
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_sessions WHERE user_id=$1', [alice.id])).rows[0].n), 1);
      await assert.rejects(api.signOut('https://other.example', aliceCookie, reply()), hasStatus(403));
      const logoutResponse = reply();
      assert.deepEqual(await api.signOut(origin, aliceCookie, logoutResponse), { authenticated: false, user: null });
      assert.match(logoutResponse.headers.get('set-cookie'), /Max-Age=0/);
      await assert.rejects(api.profile(aliceCookie), hasStatus(401));
      assert.equal((await api.profile(bobCookie)).id, bob.id);
      assert.equal((await api.profile(ownerCookie)).role, 'admin');
      await pg.query('DELETE FROM ablest_users WHERE id=$1', [bob.id]);
      assert.equal((await api.session(bobCookie)).authenticated, false);
      assert.equal(Number((await pg.query('SELECT count(*) AS n FROM ablest_sessions WHERE user_id=$1', [bob.id])).rows[0].n), 0);
    });
  } finally { await close(); }
});

test('missing Neon credentials fail startup without creating or falling back to SQLite', () => {
  const temporaryRoot = realpathSync(tmpdir());
  const folder = mkdtempSync(join(temporaryRoot, 'ablest-neon-test-'));
  const verified = realpathSync(folder);
  const data = join(folder, 'no-sqlite');
  try {
    const result = spawnSync(process.execPath, ['dist/main.js'], {
      cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)),
      env: { ...process.env, DATA_BACKEND: 'neon', DATA_DIR: data, DATABASE_URL: '' },
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Neon mode requires the server-only DATABASE_URL/);
    assert.equal(existsSync(data), false);
    assert.equal(existsSync(join(folder, 'content.sqlite')), false);
  } finally {
    // Remove only the exact generated temporary directory, never a content store.
    if (realpathSync(folder) !== verified || dirname(folder) !== temporaryRoot || !basename(folder).startsWith('ablest-neon-test-')) {
      throw new Error('Unexpected test cleanup target.');
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
