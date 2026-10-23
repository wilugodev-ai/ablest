# Ablest Google Cloud migration preparation

Prepared October 23, 2026. Separate project `ablest-20261023` is created and linked to the same billing account as Touchlumo under the user's free-allowance/possible-overage authorization. Both images built successfully and both Cloud Run services are deployed. Google domain ownership is verified and apex/www mappings are created. Hostinger DNS now resolves to all nine Google records. Trusted HTTPS now passes on both hostnames: www homepage and login return HTTP 200, and the apex redirects to www with HTTP 308. Password sign-in and inquiry inbox delivery remain owner checks. See [exact DNS records and cutover](domain-google-cloud.md).

Google preview: https://ablest-web-j2uk5d5lkq-uc.a.run.app

API: https://ablest-api-j2uk5d5lkq-uc.a.run.app

Images: `us-central1-docker.pkg.dev/ablest-20261023/ablest/api:20261023-110315` and `us-central1-docker.pkg.dev/ablest-20261023/ablest/web:20261023-131103-sticky-menu`.

Read-only hosted checks passed for database health (`backend=neon`), both published projects, homepage/login HTTP 200, signed-out session state, anonymous admin HTTP 401 and foreign-origin write HTTP 403. These checks do not establish successful password sign-in or email inbox delivery. The portfolio startup fix is included in the Google image.

The intended architecture follows `C:\intouch`: separate website and API Cloud Run services in `us-central1`, request-based billing, 1 CPU and 512 MiB per service, zero minimum instances and a maximum of one instance per service after rollout. A separate Ablest project was selected. The current Neon database continues to hold accounts, passwords, sessions, portfolio and images. The API runs the same existing idempotent schema on startup. No local SQLite import is needed.

## Cost gate

The user selected Google's free allowance and explicitly accepted possible overage charges on October 23, 2026. A separate project does not create a separate Cloud Run free allowance: usage is aggregated across the billing account, including Touchlumo. Request-based usage, builds, image/source storage, secrets, logs and outbound traffic must all be considered. Budgets are alerts, not hard spending limits. Zero minimum instances also allows cold starts.

Sources: [Cloud Run pricing](https://cloud.google.com/run/pricing), [Google Free Program](https://docs.cloud.google.com/free/docs/free-cloud-features).

## Prepared files

- `deploy/cloud-run/Dockerfile`: separate API and standalone Next.js targets; includes PostgreSQL schema and website static/public assets; runs as the unprivileged node user.
- `.gcloudignore` and `.dockerignore`: allowlist application source, schema and manifests, excluding local credentials, data and Git history.
- `deploy/cloud-run/deploy.ps1`: validates Google's upload list, requires project billing and pinned Secret Manager references, builds through Cloud Build and verifies health/database/projects after deployment. It creates application-specific build/runtime identities; runtime secret access is scoped to the two configured secrets. The temporary rollout maximum is two, restored to one in a finally block.

Prepare locally:

```powershell
cd C:\ablest
.\deploy\cloud-run\deploy.ps1 -PrepareOnly
```

After cost authorization, project creation/billing and secret provisioning:

```powershell
.\deploy\cloud-run\deploy.ps1 -ProjectId YOUR_ABLEST_PROJECT_ID -DatabaseSecret ablest-database-url:1 -MailSecret ablest-resend-api-key:1
```

The selected project ID is `ablest-20261023`. This script does not create the project or link billing. Use `-BuildOnly` to prepare images before secrets are available. Use `-ExistingApiImage` and `-ExistingWebImage` to reuse successfully built images after an interrupted deployment.

## Runtime secrets

The approved existing database connection was transferred from ignored `apps/api/.env.hosted` into `ablest-database-url:1`. The user-supplied existing sending key was transferred privately into `ablest-resend-api-key:1`. Secret payloads were not printed, committed or uploaded with source. Temporary transfer files were removed. Do not test by sending real inquiries without authorization.

The deployer accepts pinned references, not payloads. Runtime access is scoped to the individual secrets. Existing administrator credentials remain stored in Neon. No new owner setup token is needed for the populated database.

## Preview and domain cutover

1. Deploy both services and verify Google URLs: homepage, login, published projects and images, database health, secure session handling, authorized account/admin access and rejected anonymous access.
2. The initial canonical origin remains `https://www.ablestsolutions.com`. Google preview GETs work; writes use the canonical origin and must be checked with that exact origin before cutover. For browser sign-in testing on the Google URL, redeploy both services with `-WebOrigin` set to the Google website origin, then restore the canonical origin for launch.
3. Verify ownership of `ablestsolutions.com` with the deployment account, prepare mappings for both apex and www, and retrieve Google's exact required DNS records. InTouch selected direct mapping, but Google labels it Preview and does not recommend it for production due to latency limitations. See [domain mapping options](https://docs.cloud.google.com/run/docs/mapping-custom-domains).
4. Save public DNS before changes. Preserve Hostinger nameservers and all mail/DKIM/TXT records. Switch only conflicting website records after preview checks. Verify Google certificates and both hostnames. The Google standalone build includes an apex-to-www redirect; verify it after mapping because Render currently supplies this behavior.
5. Confirm the portfolio, sign-in, administrator access and inquiry configuration on the custom domain. Keep Render services available for rollback until the migration is verified. Only retire them under a separate explicit instruction.

The deployment script does not change DNS or retire Render.
