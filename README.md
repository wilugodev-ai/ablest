# Ablests Digital Solution

English business website for custom development, InTouch CRM, IterateView, and upcoming surveillance services.

Uses the same foundation as InTouch and IterateView: TypeScript, Next.js 16 / React 19, NestJS 12 / Node.js 24, and pnpm workspaces. Supabase PostgreSQL/Auth is reserved for future persistent features; no database, account system, or product credentials are required or reused for this marketing site.

## Run

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Website: http://127.0.0.1:3200

API health: http://127.0.0.1:4200/v1/health

```powershell
pnpm check
```

The web build produces a static export in `apps/web/out`. The NestJS API is independently deployable and currently provides a health endpoint. API source edits restart and recompile the development server.

## Inquiries

The contact form prepares a mailto email to wilugo91@gmail.com. Visitors review and send it in their own email application. There is no server submission, delivery confirmation, or database storage. Change the recipient in `apps/web/app/page.tsx` when the business email is available.

## Product status

InTouch and IterateView are labeled in development. Surveillance installation and companion software are labeled coming soon. Product links prepare an inquiry; they do not link to the private local applications.

## Deployment

Deploy `apps/web/out` to a static host after building. The API is not required to serve the website. If persistent inquiries are added, create a separate Ablests Supabase project, configure its own environment, and implement delivery before exposing a submission endpoint.
