# Ablest domain router

This Worker serves `https://ablestsolutions.com` from the existing `https://ablest-web.onrender.com` website. Requests to `www.ablestsolutions.com` and HTTP redirect to the HTTPS apex with status 308. Render does not need a custom domain; the Worker always connects to its existing Render hostname.

Only the apex and `www` hostnames are accepted. The Worker preserves request methods, streams, queries, `Origin`, cookies, and authorization headers. It replaces untrusted forwarding host/protocol headers, handles redirects without following them, and rewrites Render redirect locations to the canonical domain. Every response and upstream fetch bypasses caching, including API, login, account, and admin traffic. There are no Worker secrets or bindings.

Run the isolated checks from the repository root:

```powershell
node --check edge/worker.mjs
node --test --test-isolation=none tests/edge.test.mjs
```

The configuration deliberately has no domain routes and disables both `workers.dev` and preview URLs. It is ready for deployment configuration after the Cloudflare account and zone are available. Use Wrangler 4.69.0 or newer for the explicit `cache.enabled` setting. Attach both apex and `www` as Worker custom domains after the zone is active; retain the redirect in this Worker. Do not change the website's `WEB_ORIGIN` from its working Render origin until the canonical domain is ready, then set it to `https://ablestsolutions.com` and verify account and admin flows through that domain.

Cloudflare references: [custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [fetch and cache bypass](https://developers.cloudflare.com/workers/runtime-apis/fetch/), and [Worker cache configuration](https://developers.cloudflare.com/workers/cache/configuration/).
