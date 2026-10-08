# Connect the existing Hostinger domain without a Render domain fee

The public address will be `https://ablestsolutions.com`. Domain registration and renewal stay with Hostinger. Cloudflare's Free DNS/Workers services route this address to the already deployed Render website. The Neon database and the application's own client/admin login remain unchanged.

## What is prepared

`edge/worker.mjs` proxies only to `https://ablest-web.onrender.com`. It accepts only `ablestsolutions.com` and `www.ablestsolutions.com`, redirects www and HTTP to the HTTPS apex, preserves methods/uploads/cookies, rewrites Render redirects back to the custom domain, and disables caching. The route has no database credentials, Worker secrets, or storage bindings.

`edge/wrangler.jsonc` has no live routes until the owned Cloudflare zone is connected. Public workers.dev and preview URLs are disabled. Ten isolated checks cover proxy behavior, private responses, redirects, and host restrictions, and the Wrangler dry-run build passed.

No Render custom-domain entries should be created. `render.yaml` contains no `domains` declaration for Ablests. Existing IterateView domains must be preserved.

## 1. Connect a Free Cloudflare account

Authorize Wrangler in the browser using an existing Cloudflare account or a new Free account. The project's CLI auth/cache configuration uses ignored `.sites-runtime` directories. The DNS zone plan and Workers subscription must both remain Free.

Add `ablestsolutions.com` as an existing website/zone in the Cloudflare Dashboard and choose the **Free** plan. This step does not transfer domain registration. The Worker requires an active Cloudflare DNS zone; the assigned nameservers are specific to your zone and must be copied exactly.

## 2. Preserve the existing DNS records

Before changing nameservers, review/export the complete DNS zone in Hostinger and copy its records into Cloudflare. Preserve mail MX/SPF/DKIM/DMARC, verification TXT records, and unrelated subdomains. Public DNS scans can miss custom records, so compare against Hostinger's full list.

The previous Hostinger nameservers were `ns1.dns-parking.com` and `ns2.dns-parking.com`. The parked root A record was `2.57.91.91`, and www was a CNAME to the root. The parked website records will be replaced with Worker routing only after the rest of the zone is preserved.

## 3. Change only the domain's nameserver delegation

In Hostinger, open the domain's **DNS / Nameservers** settings and choose custom nameservers. Replace its current two nameservers with the exact two assigned by Cloudflare. Keep the domain registered at Hostinger. If authorized Hostinger API access is available, the supported portfolio nameservers endpoint can make the same change.

Wait for Cloudflare to show the zone as **Active**. The API/website at their onrender addresses remain available during this transition. Do not guess the assigned nameservers or change unrelated domains.

## 4. Deploy the route and attach the owned hostnames

Deploy the Worker using the connected Free Cloudflare account. Once the zone is active, configure its custom domains as `ablestsolutions.com` and `www.ablestsolutions.com`. Replace only conflicting website A/CNAME records in the Cloudflare zone as needed; an existing CNAME on a hostname can block a Worker custom-domain attachment. Cloudflare manages its DNS mapping and HTTPS certificates.

The Worker canonicalizes both addresses to `https://ablestsolutions.com`. Keep its origin fixed to the existing Render website; do not point it back to its own custom hostname or add arbitrary origin parameters.

## 5. Activate login on the custom address

After routing and HTTPS are ready, set both Render services' `WEB_ORIGIN` and the web service's `SITE_URL` to `https://ablestsolutions.com`, then redeploy them. Until that point, preserve the working `https://ablest-web.onrender.com` login origin. Changing the origin prematurely would block authenticated forms on the working Render address.

Verify the homepage, project data/images, client signup/profile save/reload, administrator sign-in and admin-only navigation, and sign-out through the custom address. Cookies are host-specific, so sign in again on the new hostname; passwords and user settings remain in Neon.

The Free Worker allowance currently includes 100,000 requests/day; exceeding the Free cap returns a limit error instead of automatically upgrading the plan. Regular Hostinger domain renewal and existing provider usage limits still apply. No paid Cloudflare or Render domain plan is needed for this route.

## Sources

- [Cloudflare custom Worker domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Free Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Free Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare nameserver setup](https://developers.cloudflare.com/dns/zone-setups/full-setup/setup/)
- [Hostinger nameserver management](https://www.hostinger.com/support/1696789-how-to-change-nameservers-at-hostinger/)
