# Ablests Digital Solution

English business website for custom development, InTouch CRM, IterateView, and upcoming surveillance services.

Uses the same application foundation as InTouch and IterateView: TypeScript, Next.js 16 / React 19, NestJS 12 / Node.js 24, and pnpm workspaces. Local project content and admin access use Node's SQLite database. It does not connect to either product's Supabase project or reuse their credentials.

## Run

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Website: http://127.0.0.1:3200

API health: http://127.0.0.1:4200/v1/health

```powershell
pnpm check
pnpm test
```

Both applications must run for the portfolio and admin features. The web build produces a Next.js server application; the API build produces `apps/api/dist`. API source edits restart and recompile the development server. Tests use a separate temporary database and never modify your real content.

## Private admin

Open http://127.0.0.1:3200/admin once to initialize the owner account with `wilugo91@gmail.com` and a password of 12–128 characters. Afterwards use the same **Sign in** page as clients. The Admin link appears only for authenticated accounts whose server-stored role is `admin`. Clients reaching `/admin` are sent to their own profile; signed-out users are sent to sign-in. Every admin API also checks the role, so hiding navigation is not the access control. Existing owner credentials and sessions migrate automatically.

Client registration is available from **Sign in → Create an account**. Registrations always receive the `client` role and cannot claim the configured administrator email or choose a role. The private area contains only the client's profile: name, email, company, and phone. Updates always target the session's user ID; another client's ID cannot be supplied. Administrators can view registered client profiles through the Client profiles section. No client projects, documents, or CRM records are exposed.

Sessions last eight hours and use HttpOnly, SameSite cookies. Passwords use salted scrypt hashes; sign-in attempts are limited to ten per email per fifteen minutes. Client accounts are local to this application, with no ChatGPT login. Email verification and client password recovery delivery are not configured.

InTouch and IterateView are preloaded. You can add, edit, delete, publish, or hide projects. Each project supports up to twelve JPEG/PNG/WebP images, up to 8 MB and 25 megapixels each. Uploads are decoded and converted to WebP, and support editable descriptions and cover selection. Save changes before leaving an editor. Published projects appear immediately on page refresh; draft projects and their images are inaccessible to signed-out visitors.

Projects, images, client profiles, and credentials persist in the ignored `.data/content.sqlite` file. Stop the API before backing up the entire `.data` directory; do not commit it. If the admin password is lost, stop the API and run `pnpm admin:reset --confirm`, then restart and set a new password at `/admin`. Resetting admin access preserves projects, images, and client profiles, and revokes all existing sessions. `ADMIN_EMAIL` selects the owner email during first setup; an existing owner's email is preserved.

## Inquiries

The contact form prepares a mailto email to wilugo91@gmail.com. Visitors review and send it in their own email application. There is no server submission, delivery confirmation, or database storage. Change the recipient in `apps/web/app/page.tsx` when the business email is available.

## Product status

InTouch and IterateView are labeled in development. Surveillance installation and companion software are labeled coming soon. Product links prepare an inquiry; they do not link to the private local applications.

## Deployment

This version runs locally as requested. The earlier Sites publication is a separate static version and does not include this admin area. Do not publish the old `dist` or `apps/web/out` folders as the new application.

Commercial hosting needs both the Next.js and NestJS servers, HTTPS, an explicitly configured `WEB_ORIGIN` in both apps, and durable storage for the API's `DATA_DIR` (or migration to a separate Ablests Supabase project). Complete owner setup before exposing the API. The API currently binds only to loopback. Database files and passwords must remain outside public assets.
