# Connect the Hostinger domain directly to Render

Use the same setup as IterateView: Hostinger keeps domain registration and DNS; the existing Render website serves `https://www.ablestsolutions.com`, and `https://ablestsolutions.com` redirects to www. The existing Neon database stores accounts and content.

## Current status

- The website runs at `https://ablest-web.onrender.com` (`srv-db3e0q5g1s2s73a2hb90`).
- Render has no Ablest custom-domain entries yet. Hostinger DNS changes are pending.
- Both services currently use `https://ablest-web.onrender.com` for `WEB_ORIGIN`, so login works at the temporary address.
- The prepared Cloudflare Worker is unused and has not been deployed. This setup requires no Cloudflare account or nameserver change.

## Render domain allowance

Render's published Hobby plan includes two custom domains across the workspace; additional domains cost $0.25/month each. IterateView currently has an apex entry redirecting to its www entry. The documentation does not explicitly establish how the automatically paired redirect counts toward billing, so these records alone do not prove a charge for Ablest.

The owner requested no additional Render domain fee. Check the workspace's Billing/custom-domain allowance or an explicit cost notice before saving a new domain. A successful API request alone would not establish that the addition is free. No account-specific charge has been confirmed or authorized. The manifest omits automatic domain creation until this is resolved.

## 1. Add the existing domain to the Ablest website

In Render, open **ablest-web > Settings > Custom Domains > Add Custom Domain**, then enter `www.ablestsolutions.com`. Use the Ablest service. Once the allowance is confirmed, save it. Render automatically adds `ablestsolutions.com` and redirects it to www.

## 2. Set the website records at Hostinger

In Hostinger, open **Domains > ablestsolutions.com > DNS / Nameservers > DNS records**. Keep the existing Hostinger nameservers. Use Render's displayed DNS targets; the documented targets for this service are:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | `216.24.57.1` |
| CNAME | `www` | `ablest-web.onrender.com` |

Replace conflicting website A/CNAME records instead of leaving the parking records alongside them. Remove AAAA records only for the two website hostnames if present. Preserve mail MX/SPF/DKIM/DMARC, verification TXT records, and unrelated services. If CAA records restrict certificate issuers, follow Render's certificate-authority requirements.

## 3. Verify and activate the address

Return to Render and verify both domain entries. Wait for verified DNS and issued HTTPS certificates. Then set `WEB_ORIGIN` on both Ablest services and `SITE_URL` on the web service to `https://www.ablestsolutions.com`, and redeploy both services. Keep the working Render login origin until DNS and HTTPS are ready.

Verify the homepage, project data/images, client signup and private profile, admin access restrictions, and sign-out on the custom address. Sign in again on the new hostname using the existing credentials. The current Render services are individually managed, so editing `render.yaml` alone does not update their environment settings.

## Sources

- [Render custom domains and allowance](https://render.com/docs/custom-domains)
- [Render DNS targets](https://render.com/docs/configure-other-dns)
- [Hostinger DNS management](https://www.hostinger.com/support/1583249-how-to-manage-dns-records-at-hostinger/)
