const ORIGIN = "https://ablest-web.onrender.com";
const CANONICAL = "https://ablestsolutions.com";
const CANONICAL_HOST = "ablestsolutions.com";
const ORIGIN_HOST = "ablest-web.onrender.com";

function noStore(headers) {
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("CDN-Cache-Control", "no-store");
  headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  headers.set("Surrogate-Control", "no-store");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  return headers;
}

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: noStore(new Headers({ "Content-Type": "text/plain; charset=utf-8" })),
  });
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    if (incoming.hostname !== CANONICAL_HOST && incoming.hostname !== `www.${CANONICAL_HOST}`) {
      return errorResponse("Unknown host.", 421);
    }

    // Assign paths rather than resolving them: a path beginning // must never change the host.
    const canonical = new URL(CANONICAL);
    canonical.pathname = incoming.pathname;
    canonical.search = incoming.search;
    if (incoming.origin !== CANONICAL) {
      return new Response(null, {
        status: 308,
        headers: noStore(new Headers({ Location: canonical.href })),
      });
    }

    const target = new URL(ORIGIN);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const upstreamRequest = new Request(target.href, request);
    upstreamRequest.headers.delete("Host");
    upstreamRequest.headers.delete("Forwarded");
    upstreamRequest.headers.set("X-Forwarded-Host", CANONICAL_HOST);
    upstreamRequest.headers.set("X-Forwarded-Proto", "https");
    upstreamRequest.headers.set("X-Forwarded-Port", "443");

    try {
      const upstream = await fetch(upstreamRequest, {
        // Never follow an origin redirect with account cookies or Authorization attached.
        redirect: "manual",
        cache: "no-store",
        cf: { cacheTtl: 0, cacheEverything: false },
      });
      const headers = noStore(new Headers(upstream.headers));
      const location = headers.get("Location");
      if (location) {
        try {
          const redirect = new URL(location, target);
          if (redirect.hostname === ORIGIN_HOST && ["http:", "https:"].includes(redirect.protocol)) {
            redirect.protocol = "https:";
            redirect.host = CANONICAL_HOST;
            redirect.username = "";
            redirect.password = "";
            headers.set("Location", redirect.href);
          }
        } catch {
          // Preserve an invalid origin Location rather than guessing its destination.
        }
      }

      // Pass the original stream through without buffering uploads, images, or HTML.
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch {
      return errorResponse("Service temporarily unavailable.", 502);
    }
  },
};
