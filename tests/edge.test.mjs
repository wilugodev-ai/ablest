import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker from "../edge/worker.mjs";

const CANONICAL = "https://ablestsolutions.com";
const ORIGIN = "https://ablest-web.onrender.com";

function mockFetch(t, implementation) {
  return t.mock.method(globalThis, "fetch", implementation);
}

function assertNoStore(response) {
  assert.match(response.headers.get("cache-control"), /(?:^|[ ,])no-store(?:[ ,]|$)/);
  assert.equal(response.headers.get("cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("cloudflare-cdn-cache-control"), "no-store");
  assert.equal(response.headers.get("surrogate-control"), "no-store");
}

test("forwards only to the fixed origin, preserving method, upload, query, cookies and Origin", async (t) => {
  const upload = new Uint8Array([0, 1, 127, 128, 255]);
  const request = new Request(`${CANONICAL}/api/profile/image?size=full&next=%2Fadmin`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/octet-stream",
      Cookie: "ablest_session=account-secret; preference=dark",
      Authorization: "Bearer credential",
      Origin: CANONICAL,
      Host: "evil.example",
      Forwarded: "host=evil.example;proto=http",
      "X-Forwarded-Host": "evil.example, ablestsolutions.com",
      "X-Forwarded-Proto": "http",
      "X-Forwarded-Port": "80",
    },
    body: upload,
  });
  const calls = mockFetch(t, async (upstream, options) => {
    assert.equal(upstream.url, `${ORIGIN}/api/profile/image?size=full&next=%2Fadmin`);
    assert.equal(upstream.method, "PUT");
    assert.equal(upstream.headers.get("cookie"), request.headers.get("cookie"));
    assert.equal(upstream.headers.get("authorization"), "Bearer credential");
    assert.equal(upstream.headers.get("origin"), CANONICAL);
    assert.equal(upstream.headers.get("content-type"), "application/octet-stream");
    assert.equal(upstream.headers.get("host"), null);
    assert.equal(upstream.headers.get("forwarded"), null);
    assert.equal(upstream.headers.get("x-forwarded-host"), "ablestsolutions.com");
    assert.equal(upstream.headers.get("x-forwarded-proto"), "https");
    assert.equal(upstream.headers.get("x-forwarded-port"), "443");
    assert.equal(options.redirect, "manual");
    assert.equal(options.cache, "no-store");
    assert.deepEqual(options.cf, { cacheTtl: 0, cacheEverything: false });
    assert.deepEqual(new Uint8Array(await upstream.arrayBuffer()), upload);
    return new Response('{"saved":true}', { status: 201, statusText: "Created" });
  });

  const response = await worker.fetch(request, { ORIGIN: "https://evil.example" });
  assert.equal(response.status, 201);
  assert.equal(response.statusText, "Created");
  assert.equal(await response.text(), '{"saved":true}');
  assert.equal(calls.mock.callCount(), 1);
  assert.equal(request.headers.get("x-forwarded-host"), "evil.example, ablestsolutions.com");
  assertNoStore(response);
});

test("Origin is passed unchanged so application origin checks cannot be bypassed", async (t) => {
  mockFetch(t, async (upstream) => {
    assert.equal(upstream.headers.get("origin"), "https://evil.example");
    return new Response("Forbidden", { status: 403 });
  });
  const response = await worker.fetch(new Request(`${CANONICAL}/api/auth/login`, {
    method: "POST", headers: { Origin: "https://evil.example" }, body: "credentials",
  }));
  assert.equal(response.status, 403);
});

test("www and HTTP redirect to the canonical apex without fetching or dropping path/query", async (t) => {
  const calls = mockFetch(t, () => { throw new Error("Must not fetch a redirect"); });
  for (const origin of ["https://www.ablestsolutions.com", "http://www.ablestsolutions.com", "http://ablestsolutions.com", "https://ablestsolutions.com:8443"]) {
    const response = await worker.fetch(new Request(`${origin}/api/auth/login?next=%2Fadmin&x=a%20b`, {
      method: "POST", body: "credentials",
    }));
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), `${CANONICAL}/api/auth/login?next=%2Fadmin&x=a%20b`);
    assertNoStore(response);
  }
  assert.equal(calls.mock.callCount(), 0);
});

test("hostile-looking paths and target parameters cannot turn the Worker into an open proxy", async (t) => {
  const calls = mockFetch(t, async (upstream) => {
    const url = new URL(upstream.url);
    assert.equal(url.origin, ORIGIN);
    assert.equal(url.pathname, "//evil.example/%2Fprivate");
    assert.equal(url.search, "?url=https%3A%2F%2Fevil.example&origin=https%3A%2F%2Fother.example");
    return new Response("ok");
  });
  const response = await worker.fetch(new Request(`${CANONICAL}//evil.example/%2Fprivate?url=https%3A%2F%2Fevil.example&origin=https%3A%2F%2Fother.example`));
  assert.equal(response.status, 200);
  assert.equal(calls.mock.callCount(), 1);
});

test("rewrites absolute, protocol-relative and relative Render redirect locations", async (t) => {
  const redirects = [
    [`${ORIGIN}/account?next=%2Fadmin#profile`, `${CANONICAL}/account?next=%2Fadmin#profile`],
    ["http://ablest-web.onrender.com/login", `${CANONICAL}/login`],
    ["//ablest-web.onrender.com/admin", `${CANONICAL}/admin`],
    ["../login?next=%2Faccount", `${CANONICAL}/account/login?next=%2Faccount`],
    ["/account", `${CANONICAL}/account`],
    ["https://example.com/auth", "https://example.com/auth"],
    ["https://ablest-web.onrender.com.evil.example/login", "https://ablest-web.onrender.com.evil.example/login"],
    ["http://[", "http://["],
  ];
  let location;
  const calls = mockFetch(t, async (_upstream, options) => {
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: location } });
  });
  for (const [source, expected] of redirects) {
    location = source;
    const response = await worker.fetch(new Request(`${CANONICAL}/account/settings/`));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), expected);
  }
  assert.equal(calls.mock.callCount(), redirects.length);
});

test("streams response bodies and preserves multiple session cookies and content headers", async (t) => {
  const headers = new Headers({ "Content-Type": "application/octet-stream", "Content-Encoding": "gzip" });
  headers.append("Set-Cookie", "ablest_session=new-session; Path=/; HttpOnly; Secure; SameSite=Lax");
  headers.append("Set-Cookie", "preference=dark; Path=/; Secure");
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });
  const upstream = new Response(stream, { headers });
  mockFetch(t, async () => upstream);
  const response = await worker.fetch(new Request(`${CANONICAL}/api/profile/image`));
  assert.equal(upstream.bodyUsed, false);
  assert.equal(response.body, upstream.body);
  assert.deepEqual(response.headers.getSetCookie(), headers.getSetCookie());
  assert.equal(response.headers.get("content-type"), "application/octet-stream");
  assert.equal(response.headers.get("content-encoding"), "gzip");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]));
  assertNoStore(response);
});

test("API, admin, login, and authenticated responses cannot inherit public cache instructions", async (t) => {
  const calls = mockFetch(t, async (_upstream, options) => {
    assert.equal(options.cache, "no-store");
    return new Response("private content", {
      headers: {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=600",
        "CDN-Cache-Control": "public, max-age=86400",
        "Cloudflare-CDN-Cache-Control": "public, max-age=86400",
        "Surrogate-Control": "max-age=86400",
        "Set-Cookie": "ablest_session=private; HttpOnly; Secure; Path=/",
      },
    });
  });
  for (const [path, headers] of [
    ["/api/profile", {}], ["/admin", {}], ["/admin/accounts", {}],
    ["/account/login", {}], ["/account", { Cookie: "ablest_session=secret" }],
    ["/", { Authorization: "Bearer secret" }],
  ]) {
    const response = await worker.fetch(new Request(`${CANONICAL}${path}`, { headers }));
    assertNoStore(response);
    assert.match(response.headers.get("cache-control"), /private/);
    assert.equal(response.headers.get("pragma"), "no-cache");
    assert.equal(response.headers.get("expires"), "0");
    assert.match(response.headers.get("set-cookie"), /ablest_session=private/);
  }
  assert.equal(calls.mock.callCount(), 6);
});

test("unsupported hosts and Workers preview hosts are rejected before a subrequest", async (t) => {
  const calls = mockFetch(t, () => { throw new Error("Must not fetch an unsupported host"); });
  for (const host of ["evil.example", "ablestsolutions.com.evil.example", "ablest-web.onrender.com", "ablest-domain-router.example.workers.dev"]) {
    const response = await worker.fetch(new Request(`https://${host}/api/profile`, { headers: { "X-Forwarded-Host": "ablestsolutions.com" } }));
    assert.equal(response.status, 421);
    assert.equal(await response.text(), "Unknown host.");
    assertNoStore(response);
  }
  assert.equal(calls.mock.callCount(), 0);
});

test("upstream network errors return a generic response without disclosing internals", async (t) => {
  const calls = mockFetch(t, async () => { throw new Error("ECONNREFUSED ablest-web.onrender.com internal-secret-password"); });
  const response = await worker.fetch(new Request(`${CANONICAL}/account`));
  assert.equal(response.status, 502);
  const message = await response.text();
  assert.equal(message, "Service temporarily unavailable.");
  assert.doesNotMatch(message, /onrender|ECONNREFUSED|secret|password|stack/i);
  assertNoStore(response);
  assert.equal(calls.mock.callCount(), 1);
});

test("deployment config has no live routes, public preview URLs, or cache", async () => {
  const text = await readFile(new URL("../edge/wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(config.name, "ablest-domain-router");
  assert.equal(config.main, "worker.mjs");
  assert.equal(config.compatibility_date, "2026-10-07");
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.deepEqual(config.routes, []);
  assert.equal(config.cache.enabled, false);
  assert.equal(config.account_id, undefined);
});
