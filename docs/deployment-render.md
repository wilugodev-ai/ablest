# Ablests on Render Free + Neon

The Next.js website and NestJS API run as two Free Render services. The hosted database is a separate Neon PostgreSQL project. User profiles, passwords, roles, sessions, website projects, image descriptions, and optimized image bytes persist in Neon. Local development keeps the independent SQLite database.

## Current database

The Ablests project was created in the **Ablests Digital Solution** Free Neon organization, in **AWS US East 1**, on October 7, 2026. Its project ID is `nameless-frost-31224887`. InTouch and IterateView's Supabase projects were not modified.

The local administrator and two website projects were imported into this database. Password hashes, roles, and all existing profile/project settings were preserved. Active sessions were not copied: sign in normally using your existing local administrator email/password. Local SQLite was not changed and is not synchronized with Neon.

The private pooled connection is saved in the ignored `apps/api/.env.hosted` file. Use the value of `DATABASE_URL` from that file for the Render API service; it includes a password and must stay out of Git, browser code, and `NEXT_PUBLIC_*` variables.

## 1. Create or update the Render Blueprint

1. Push the latest Neon deployment commit to `wilugodev-ai/ablest` on `main`.
2. In Render, select **New → Blueprint**, connect that repository, and use `render.yaml`. If you started the old Supabase Blueprint form, return to repository selection/reload it so it reads the updated file.
3. Confirm `ablest-api` and `ablest-web` both use **Free**. No Render database or disk is required. Builds run from the repository root, using Node 24.19.0 and pnpm 12.5.1 through Corepack.
4. Supply these fields:

| Service | Variable | Value |
| --- | --- | --- |
| API | `DATABASE_URL` | Private pooled connection from `apps/api/.env.hosted` |
| Web | `API_URL` | The API's actual public HTTPS URL, without `/v1` |

If the API URL is unavailable during initial creation, use `https://api-not-configured.invalid` temporarily. After Render creates the API, copy its real public URL into the web environment and redeploy the web service. The portal will not work until that value is correct.

The API's `DATA_BACKEND=neon` selects the hosted database. It applies `postgres/schema.sql` transactionally at startup; repeated deployment does not recreate accounts or overwrite content. `/v1/health/database` checks database readiness. Hosted mode never opens or falls back to local SQLite.

Both `WEB_ORIGIN` settings and the web `SITE_URL` use `https://www.ablestsolutions.com`. Forms on the temporary Render address are rejected while that canonical origin is configured. To test before DNS is ready, temporarily set both origins to the actual web Render address, then restore them to the custom domain and redeploy.

## 2. Connect the Hostinger domain

1. On the Render **web service**, open **Settings → Custom Domains** and add `www.ablestsolutions.com`. Render also adds the root domain and redirects it to www.
2. In Hostinger, open **Domains → DNS**, choose `ablestsolutions.com`, and use the exact records displayed by Render. Keep the existing Hostinger nameservers.

| Type | Name | Value |
| --- | --- | --- |
| A | `@` | Render's currently documented load-balancer IP, `216.24.57.1` |
| CNAME | `www` | The actual web service's `onrender.com` hostname, without https:// or a path |

The root previously pointed to `2.57.91.91`, and www was a CNAME to `ablestsolutions.com`. Replace conflicting website A/CNAME records and remove conflicting website AAAA records. Preserve email MX/SPF/DKIM/DMARC records and unrelated services. Follow Render's requirements if CAA records exist.

3. Return to Render and verify both domains. Wait for DNS propagation and HTTPS certificate issuance before using the production login. Render manages certificate renewal.

## 3. User and administrator configuration

The imported administrator uses the same email/password as locally. Sign in from the website: **Admin** appears only for the verified administrator role. New registrations always receive the Client role, and clients can view/update only their own name, email, company, and phone.

Passwords remain salted scrypt hashes. Session tokens are hashed in the database and use HttpOnly/SameSite cookies; hosted HTTPS cookies are Secure. Sessions last eight hours. Login throttling persists in Neon across API restarts. No ChatGPT login is used.

If deploying a completely new empty database instead, Render generates a private `ADMIN_SETUP_TOKEN`. Visit `/admin` once, enter the configured `ADMIN_EMAIL`, password, and this Owner setup code. The code cannot replace an existing administrator or promote a client account. It is not needed after the current local administrator import.

Portfolio images are normalized to WebP and stored as PostgreSQL binary data. Inputs remain limited to 8 MB and 25 megapixels; the stored hosted image is limited to 2 MB. Project/image limits are enforced atomically. Draft images are available only to administrators; published images are served through the API. Deleting a project removes its images in the same database operation. Images count toward Neon database storage.

Email verification and client password recovery delivery are not configured. The profile-only client area does not include CRM records, documents, or private client projects.

## Local development and reviewed imports

`pnpm dev` uses SQLite by default and does not load `.env.hosted`. Do not copy the hosted settings over `apps/api/.env` just to run local development.

For a future fresh Neon database, `pnpm neon:import-local --confirm` is the one-time transfer command. It reads the local database without writing to it, preserves passwords/roles and project/image settings, excludes sessions, locks the target during transfer, and refuses to overwrite an already-imported or populated target. It does not create ongoing synchronization.

## Verification and limits

Validate public pages, registration/profile persistence, admin-only navigation, image upload, hidden drafts, and sign-out. Test with two disposable clients to confirm profile isolation. Redeploy the API and confirm settings persist. The repository's automated PostgreSQL tests use in-memory fixtures rather than your live database.

Render Free services can sleep and share free running hours across the workspace. The web bridge waits up to 75 seconds for startup and converts platform HTML errors into a readable retry message; writes are not automatically retried. Neon Free has database/compute/network limits; review the current project's quota in its Console. Stored images consume that database quota. Upgrading a provider plan requires your choice.

## References

- [Neon Free limits](https://neon.com/docs/introduction/plans)
- [Neon connections for Render/Node](https://neon.com/docs/connect/choose-connection)
- [Render Free limits](https://render.com/docs/free)
- [Render Blueprints](https://render.com/docs/infrastructure-as-code)
- [Render custom domains](https://render.com/docs/custom-domains)
- [Render DNS records](https://render.com/docs/configure-other-dns)
- [Hostinger DNS management](https://www.hostinger.com/support/1583249-how-to-manage-dns-records-at-hostinger/)
