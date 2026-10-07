# Ablests on Render Free + Supabase

Two free Render services run the Next.js website and NestJS API. A new, separate Supabase project stores live account records, password hashes, sessions, project content, and private images. The existing SQLite database remains independent for local development.

Deployment is prepared, but no live services, Supabase project, or DNS changes have been created. Commit and push the deployment changes yourself when ready.

## 1. Create a separate Ablests Supabase project

Use a new project for Ablests. Do not select, modify, or reuse the InTouch or IterateView projects.

1. Create the project in Supabase. A US East region matches the Render services. Keep the free plan if available in your account.
2. Apply [202610070001_content.sql](../supabase/migrations/202610070001_content.sql) in that project's SQL Editor. It creates backend-only tables, enables row-level security, revokes direct browser access, and creates the private `ablest-project-images` bucket. It seeds the InTouch and IterateView portfolio entries once.
3. Copy the project's HTTPS URL and a new `sb_secret_...` key from its API Keys settings to the Render API environment. The secret stays only on the API, never in the website environment, browser, Git, or a `NEXT_PUBLIC_*` variable.

Ablests keeps its existing email/password authentication in NestJS, using salted scrypt hashes and HttpOnly session cookies. Supabase stores those records; this implementation does not use Supabase Auth accounts. Email verification and password recovery delivery remain unconfigured. The API derives the user ID from the verified session and validates administrator roles before admin operations. Direct anonymous/authenticated Supabase table access is denied.

## 2. Create the Render Blueprint

1. Commit and push the changes to `wilugodev-ai/ablest` on GitHub.
2. In Render, select **New → Blueprint**, choose this repository and `main`, and use `render.yaml`.
3. Confirm **both services are Free**, with no persistent disk or Render database. Builds run from the repository root, using Node 24.19.0 and Corepack/pnpm 12.5.1.
4. Supply the API's `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the new Ablests project. The API uses `DATA_BACKEND=supabase` and binds to `0.0.0.0` on Render's assigned `PORT`.
5. After Render assigns the API's actual public HTTPS address, set the web service's `API_URL` to it, without `/v1`. Free services cannot use Render's private network. Do not assume an exact hostname. If required during creation, use `https://api-not-configured.invalid` temporarily, replace it with the actual API URL, and redeploy the web service. The portal will not function until this is done.
6. Check the API's `/v1/health/database`. It verifies the seeded database schema and private image bucket. A failed check prevents the API deployment from being marked healthy.

The web and API `WEB_ORIGIN` values are `https://www.ablestsolutions.com`. The web `SITE_URL` is the same address. Forms on the temporary `onrender.com` URL are rejected while this origin is configured. To test before DNS is connected, temporarily set both origins to the actual web Render URL, then restore the domain origin and redeploy.

## 3. Connect ablestsolutions.com in Hostinger

1. In the Render **web service**, open **Settings → Custom Domains** and add `www.ablestsolutions.com`. Render also adds the root domain and redirects it to www.
2. In Hostinger, open **Domains → DNS** and choose `ablestsolutions.com`. The domain was using `ns1.dns-parking.com` and `ns2.dns-parking.com` when checked on October 7, 2026. Keep those nameservers.
3. Apply the exact records displayed by Render. Its currently documented records for this type of provider are:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | Render's load-balancer IP, currently `216.24.57.1` |
| CNAME | `www` | The actual web service's `onrender.com` hostname, without https:// or a path |

The old root A record was `2.57.91.91`, and www pointed to `ablestsolutions.com`. Replace only the conflicting website records. Remove conflicting website AAAA records if present. Preserve MX, SPF, DKIM, DMARC, and unrelated services. If CAA records exist, follow Render's certificate authority requirements.

4. Back in Render, verify both domains and wait for DNS propagation and the HTTPS certificate. Render manages certificate issuance and renewal.

## 4. Initialize your hosted administrator

The Blueprint generates `ADMIN_SETUP_TOKEN` in the API environment. Keep it private. Open `https://www.ablestsolutions.com/admin`, enter `wilugo91@gmail.com`, your chosen password, and the **Owner setup code** from that environment setting. An incorrect, missing, or unconfigured code cannot create the hosted administrator.

Then use **Sign in** on the website. The Admin option appears only when an administrator is authenticated. Client registration always creates the Client role; clients see only their own name, email, company, and phone. You retain the existing project and image controls.

The live database starts separately from local development. Local accounts/images are not copied or synchronized automatically. Changes in Supabase do not change `.data/content.sqlite`, and changes in the local database do not change the live site.

## 5. Verify the live site

Test client signup, profile save/reload, sign-out, administrator sign-in, project edits, and image upload. Use two disposable client accounts to verify data isolation and denied admin access. Redeploy the API and confirm data persists. Run live checks only against this new Ablests project; the repository's automated tests use temporary local fixtures.

Render Free can sleep after inactivity and shares 750 instance-hours per workspace per month. The web bridge waits up to 75 seconds for startup and turns platform HTML errors into a readable retry message. Writes are not automatically retried. Supabase retains data across Render restarts.

## References

- [Render Free limitations](https://render.com/docs/free)
- [Blueprint YAML fields](https://render.com/docs/blueprint-spec)
- [Render port binding](https://render.com/docs/web-services#port-binding)
- [Render custom domains](https://render.com/docs/custom-domains)
- [Render DNS records](https://render.com/docs/configure-other-dns)
- [Hostinger DNS management](https://www.hostinger.com/support/1583249-how-to-manage-dns-records-at-hostinger/)
- [Supabase server-only API keys](https://supabase.com/docs/guides/getting-started/api-keys)
- [Supabase private Storage access](https://supabase.com/docs/guides/storage/security/access-control)
