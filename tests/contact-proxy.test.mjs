import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { waitForApiReady } from '../apps/web/app/lib/api-readiness.ts';

const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const ts = require('typescript');
const routeUrl = new URL('../apps/web/app/api/[...path]/route.ts', import.meta.url);
const compiledRoute = ts.transpileModule(readFileSync(routeUrl, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: fileURLToPath(routeUrl),
}).outputText;
const origin = 'https://www.ablestsolutions.com';
const upstreamOrigin = 'https://api-contact-fixture.example';
const inquiry = {
  name: 'Synthetic Visitor', email: 'visitor@example.com', service: 'Custom software',
  message: 'A fixture inquiry that must never be emailed.', website: '',
  requestId: '580cb580-c756-4c25-a9f9-66ebcfb2f314',
};
const healthy = () => Response.json({ status: 'ok', service: 'ablest-api' });
const shortTiming = { budgetMs: 1000, probeTimeoutMs: 100, retryDelayMs: 1 };

function fixture(t, readiness = (url, signal) => waitForApiReady(url, signal, shortTiming)) {
  const previous = { API_URL: process.env.API_URL, WEB_ORIGIN: process.env.WEB_ORIGIN };
  process.env.API_URL = upstreamOrigin;
  process.env.WEB_ORIGIN = origin;
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const readinessCalls = [];
  const exports = {};
  // Transpile the actual route in memory. Only its readiness import is injected;
  // the Next framework and a server process are unnecessary for Web Request APIs.
  const dependencies = name => {
    assert.equal(name, '../../lib/api-readiness', `Unexpected route dependency: ${name}`);
    return { waitForApiReady: async (...args) => { readinessCalls.push(args); return readiness(...args); } };
  };
  new Function('require', 'exports', compiledRoute)(dependencies, exports);
  return { route: exports, readinessCalls };
}

function request(path = 'contact', options = {}) {
  const method = options.method || 'POST';
  return new Request(`${origin}/api/${path}`, {
    method,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(inquiry) }),
    ...options,
    headers: { Origin: origin, 'Content-Type': 'application/json', ...options.headers },
  });
}

const context = path => ({ params: Promise.resolve({ path: path.split('/') }) });

test('contact waits through startup failures and sends exactly one unchanged inquiry once the API is healthy', async t => {
  const { route, readinessCalls } = fixture(t);
  const startup = [
    () => { throw new TypeError('synthetic connection failure'); },
    () => new Response('<html>Render is starting</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('invalid JSON', { headers: { 'Content-Type': 'application/json' } }),
    () => Response.json({ status: 'ok', service: 'different-service' }),
    () => Response.json({ status: 'starting', service: 'ablest-api' }),
    () => Response.json({ status: 'ok', service: 'ablest-api' }, { status: 503 }),
    healthy,
  ];
  const probes = [], sends = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === `${upstreamOrigin}/v1/health`) {
      probes.push(options);
      assert.equal(options.method, 'GET');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.body, undefined);
      const headers = new Headers(options.headers);
      assert.equal(headers.get('cookie'), null);
      assert.equal(headers.get('authorization'), null);
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(startup.length > 0, 'Readiness must stop after its healthy response');
      return startup.shift()();
    }
    assert.equal(url, `${upstreamOrigin}/v1/contact`);
    assert.equal(startup.length, 0, 'Contact must wait until readiness has been confirmed');
    sends.push(options);
    return Response.json({ accepted: true });
  });
  const response = await route.POST(request('contact', { headers: { Cookie: 'fixture-session=value' } }), context('contact'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(readinessCalls.length, 1);
  assert.equal(probes.length, 7);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].method, 'POST');
  assert.equal(sends[0].cache, 'no-store');
  assert.deepEqual(JSON.parse(new TextDecoder().decode(sends[0].body)), inquiry);
  assert.equal(new Headers(sends[0].headers).get('origin'), origin);
  assert.equal(new Headers(sends[0].headers).get('cookie'), 'fixture-session=value');
});

test('readiness budget exhaustion returns an error without dispatching the inquiry', async t => {
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', duration => duration === 100 ? deadline.signal : new AbortController().signal);
  const { route } = fixture(t, (url, signal) => waitForApiReady(url, signal, { budgetMs: 100, probeTimeoutMs: 10, retryDelayMs: 1 }));
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    assert.equal(url, `${upstreamOrigin}/v1/health`);
    deadline.abort(new DOMException('Synthetic readiness budget exhausted', 'TimeoutError'));
    return new Response('<html>Still starting</html>', { status: 503, headers: { 'Content-Type': 'text/html' } });
  });
  const response = await route.POST(request(), context('contact'));
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /start|unavailable|retry|try again/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
});

test('a 32-second cold start can finish in one pending health request', async t => {
  let now = 0;
  const timers = [];
  t.mock.method(AbortSignal, 'timeout', duration => {
    const controller = new AbortController();
    timers.push({ due: now + duration, controller });
    return controller.signal;
  });
  const network = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, `${upstreamOrigin}/v1/health`);
    now += 32000;
    for (const timer of timers) {
      if (timer.due <= now) timer.controller.abort(new DOMException('Synthetic elapsed timeout', 'TimeoutError'));
    }
    options.signal.throwIfAborted();
    return healthy();
  });
  assert.equal(await waitForApiReady(upstreamOrigin, new AbortController().signal), true);
  assert.equal(network.mock.callCount(), 1);
});

test('a timed-out startup probe can recover without sending an inquiry before readiness', async t => {
  const probe = new AbortController();
  let timeoutCalls = 0;
  t.mock.method(AbortSignal, 'timeout', () => ++timeoutCalls === 2 ? probe.signal : new AbortController().signal);
  const { route } = fixture(t);
  const methods = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    methods.push(options.method);
    if (methods.length === 1) {
      assert.equal(url, `${upstreamOrigin}/v1/health`);
      probe.abort(new DOMException('Synthetic probe timed out', 'TimeoutError'));
      options.signal.throwIfAborted();
    }
    if (url.endsWith('/v1/health')) return healthy();
    assert.equal(url, `${upstreamOrigin}/v1/contact`);
    return Response.json({ accepted: true });
  });
  const response = await route.POST(request(), context('contact'));
  assert.equal(response.status, 200);
  assert.deepEqual(methods, ['GET', 'GET', 'POST']);
});

test('an aborted contact request cancels readiness and never sends the inquiry', async t => {
  const controller = new AbortController();
  const cancellation = new Error('synthetic visitor cancellation');
  const { route } = fixture(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    assert.equal(url, `${upstreamOrigin}/v1/health`);
    controller.abort(cancellation);
    assert.equal(options.signal.aborted, true);
    options.signal.throwIfAborted();
  });
  const response = await route.POST(request('contact', { signal: controller.signal }), context('contact'));
  assert.equal(response.status, 503);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(await response.json()), /synthetic visitor/);
  await assert.rejects(waitForApiReady(upstreamOrigin, controller.signal, shortTiming), error => error === cancellation);
  assert.equal(calls.length, 1, 'Already aborted readiness must not probe');
});

test('cancellation between successful readiness and contact dispatch prevents the POST', async t => {
  const controller = new AbortController();
  const { route, readinessCalls } = fixture(t, async () => {
    controller.abort(new DOMException('Synthetic cancellation after readiness', 'AbortError'));
    return true;
  });
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('A cancelled inquiry must not dispatch'); });
  const response = await route.POST(request('contact', { signal: controller.signal }), context('contact'));
  assert.equal(response.status, 503);
  assert.equal(readinessCalls.length, 1);
  assert.equal(network.mock.callCount(), 0);
});

test('cancelling an in-flight contact POST propagates its signal without retrying', async t => {
  const controller = new AbortController();
  const { route } = fixture(t);
  const methods = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    methods.push(options.method);
    if (url.endsWith('/v1/health')) return healthy();
    assert.equal(url, `${upstreamOrigin}/v1/contact`);
    assert.equal(options.signal.aborted, false);
    controller.abort(new DOMException('Synthetic cancellation during dispatch', 'AbortError'));
    assert.equal(options.signal.aborted, true);
    options.signal.throwIfAborted();
  });
  const response = await route.POST(request('contact', { signal: controller.signal }), context('contact'));
  assert.equal(response.status, 503);
  assert.deepEqual(methods, ['GET', 'POST']);
  assert.match((await response.json()).message, /could not confirm/i);
});

test('an uncertain or unsuccessful contact POST is never retried', async t => {
  const failures = [
    () => { throw new TypeError('synthetic failure after possible acceptance'); },
    () => new Response('<html>Startup page</html>', { status: 503, headers: { 'Content-Type': 'text/html' } }),
    () => Response.json({ message: 'Mail provider unavailable' }, { status: 503 }),
    () => Response.json({ message: 'Please wait before submitting again' }, { status: 429, headers: { 'Retry-After': '900' } }),
  ];
  for (const failure of failures) {
    await t.test('single dispatch with no mutation retry', async child => {
      const { route, readinessCalls } = fixture(child);
      const calls = [];
      child.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/v1/health')) return healthy();
        assert.equal(url, `${upstreamOrigin}/v1/contact`);
        return failure();
      });
      const response = await route.POST(request(), context('contact'));
      assert.ok([429, 503].includes(response.status));
      if (response.status === 429) assert.equal(response.headers.get('retry-after'), '900');
      const body = await response.json();
      assert.equal(body.accepted, undefined);
      assert.doesNotMatch(JSON.stringify(body), /synthetic failure/);
      assert.equal(readinessCalls.length, 1);
      assert.deepEqual(calls.map(call => call.options.method), ['GET', 'POST']);
    });
  }
});

test('contact origin, method, path, and both body-size checks run before any readiness traffic', async t => {
  const { route, readinessCalls } = fixture(t, async () => { throw new Error('Readiness must not run for rejected input'); });
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No network for rejected input'); });
  const tooLarge = new Uint8Array(24 * 1024 + 1).fill(65);
  const scenarios = [
    { path: 'contact', req: request('contact', { headers: { Origin: 'https://foreign.example' } }), status: 403 },
    { path: 'contact', req: request('contact', { headers: { Origin: '' } }), status: 403 },
    { path: 'contact', req: request('contact', { method: 'GET' }), status: 405 },
    { path: 'contact', req: request('contact', { body: '{}', headers: { 'Content-Length': String(tooLarge.length) } }), status: 413 },
    { path: 'contact', req: request('contact', { body: tooLarge }), status: 413 },
    { path: 'contact/other', req: request('contact/other'), status: 404 },
  ];
  for (const { path, req, status } of scenarios) {
    const response = await route[req.method](req, context(path));
    assert.equal(response.status, status);
  }
  assert.equal(readinessCalls.length, 0);
  assert.equal(network.mock.callCount(), 0);
});

test('authentication waits through startup and forwards credentials and cookies exactly once', async t => {
  const { route, readinessCalls } = fixture(t);
  const calls = [];
  let probes = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.endsWith('/v1/health')) {
      probes++;
      assert.equal(options.method, 'GET');
      assert.equal(options.body, undefined);
      assert.equal(new Headers(options.headers).get('cookie'), null);
      return probes % 2 ? new Response('Starting', { headers: { 'Content-Type': 'text/html' } }) : healthy();
    }
    calls.push({ url, options });
    assert.equal(new Headers(options.headers).get('cookie'), 'fixture_session=value');
    if (url.endsWith('/login')) {
      return Response.json({ authenticated: true }, { headers: { 'Set-Cookie': 'fixture_session=rotated; HttpOnly; Secure; SameSite=Strict' } });
    }
    return Response.json({ message: 'Sign in required' }, { status: 401 });
  });
  const paths = [['auth/session', 'GET'], ['auth/login', 'POST'], ['auth/register', 'POST'], ['admin/login', 'POST'], ['account', 'PATCH']];
  for (const [path, method] of paths) {
    const payload = JSON.stringify({ email: 'fixture@example.com', password: 'synthetic-password' });
    const response = await route[method](request(path, { method, ...(method === 'GET' ? {} : { body: payload }), headers: { Cookie: 'fixture_session=value' } }), context(path));
    assert.equal(response.status, path.endsWith('/login') ? 200 : 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (path.endsWith('/login')) assert.match(response.headers.get('set-cookie'), /fixture_session=rotated; HttpOnly; Secure/);
    if (method !== 'GET') assert.equal(new TextDecoder().decode(calls.at(-1).options.body), payload);
  }
  assert.equal(readinessCalls.length, 4);
  assert.equal(probes, 8);
  assert.deepEqual(calls.map(call => call.url), paths.map(([path]) => `${upstreamOrigin}/v1/${path}`));
});

test('authentication readiness failures do not forward credentials or retry a login', async t => {
  let available = false;
  const { route } = fixture(t, async () => available);
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No request while unavailable'); });
  const unavailable = await route.POST(request('auth/login'), context('auth/login'));
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).message, /account service/i);
  assert.equal(network.mock.callCount(), 0);

  available = true;
  const ambiguous = await route.POST(request('auth/login'), context('auth/login'));
  assert.equal(ambiguous.status, 503);
  assert.equal(network.mock.callCount(), 1, 'A login with an uncertain outcome must never be replayed');
});
