# Ablest domain cutover to Google

Google project: `ablest-20261023`, region `us-central1`, website service `ablest-web`.
The deployment account has verified ownership of `ablestsolutions.com`.
Mappings for the apex and www were created October 23, 2026. Hostinger DNS has
been updated and public resolution matches all nine Google records. Trusted HTTPS now passes on both hostnames; www homepage/login return HTTP 200 and the apex redirects to www with HTTP 308.
The selected route matches InTouch's direct Cloud Run domain
mapping, which Google labels Preview; see [Google domain mapping guidance](https://docs.cloud.google.com/run/docs/mapping-custom-domains).

The records below were retrieved from the live Google mappings, not inferred.
Current public DNS was saved to ignored `.data/cloud-run/domain-dns-before.json`.
The original apex A is `216.24.57.1` and www points to Render. Keep Render services
available until Google HTTPS and application checks pass.

## Hostinger records

Keep Hostinger nameservers. Replace only conflicting website A/AAAA records at
`@` and the existing `www` CNAME. Add all records Google supplied:

| Type | Name | Content |
| --- | --- | --- |
| CNAME | www | ghs.googlehosted.com |
| A | @ | 216.239.32.21 |
| A | @ | 216.239.34.21 |
| A | @ | 216.239.36.21 |
| A | @ | 216.239.38.21 |
| AAAA | @ | 2001:4860:4802:32::15 |
| AAAA | @ | 2001:4860:4802:34::15 |
| AAAA | @ | 2001:4860:4802:36::15 |
| AAAA | @ | 2001:4860:4802:38::15 |

Use TTL 300 if available. Preserve Google ownership TXT and all mail, Resend DKIM,
SPF/MX, and unrelated records. Do not change the Resend sending subdomain.

## Verify after DNS changes

1. Compare public and authoritative DNS with the exact records above.
2. Wait for both Google mappings to report Ready and CertificateProvisioned.
3. Verify trusted HTTPS on both hostnames and the apex redirect to www, including
   paths and queries. The standalone Google website includes that redirect.
4. Verify homepage, portfolio, sign-in and administrator access on www. The
   configured API/web origin remains `https://www.ablestsolutions.com`.
5. The inquiry sending key is configured through Secret Manager. Actual email
   receipt still requires an owner-submitted inquiry; no test email is sent by
   migration checks.

Google preview: https://ablest-web-j2uk5d5lkq-uc.a.run.app

For rollback, restore only the previous website records from the DNS snapshot.
No database rollback is needed because both hosting environments use the same
existing Neon database. Do not delete the Render services during cutover.
