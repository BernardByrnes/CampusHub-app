# CampusHub production app

CampusHub is being rebuilt as one full-stack Next.js application. This
repository is the production application foundation; it is intentionally
separate from the canonical static prototype at
`C:\Users\NANCY\CampusHub`.

## Architecture

- Next.js App Router with TypeScript and Tailwind CSS
- Server Components by default
- Thin Route Handlers and Server Actions
- Application services in `src/application`
- Domain types and policies in `src/domain`
- Server-only context, database, and repositories in `src/server`
- PostgreSQL through Drizzle ORM and `pg`
- Zod for untrusted boundary and environment validation

Security-sensitive code must stay on the server. Client-supplied tenant,
membership, assurance, XP, and authorization values are never authoritative.
The future authentication/membership resolver owns `RequestContext`; no auth
provider has been selected yet.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local
```

Set a real PostgreSQL connection string in `.env.local` before using
database-backed code or `db:migrate`. No database connection is claimed by
this bootstrap phase.

```powershell
npm run dev
```

The liveness endpoint is `GET /api/health` and returns exactly:

```json
{"status":"ok"}
```

## Commands

```text
npm run dev          Start the development server
npm run build        Create a production build
npm run start        Serve a production build
npm run lint         Run ESLint
npm run typecheck    Run strict TypeScript checking
npm run test         Run Vitest once
npm run test:unit    Run Vitest once
npm run db:generate  Generate reviewed Drizzle migrations
npm run db:migrate   Apply Drizzle migrations to PostgreSQL
npm run db:check     Check Drizzle migration consistency
```

There is no `db:push` production workflow. There are no business tables or
fake starter migrations in 8V-B.0. Playwright E2E setup is reserved for a
later phase; domain/application tests belong in Vitest.

## Prototype relationship

`C:\Users\NANCY\CampusHub` remains the frozen UX, product-behavior, and
regression reference at checkpoint
`31d64a959849165fc4b3842e116d7be5252b4fe4`. Production code does not import
prototype files at runtime, and this phase does not port the static UI.

## Authority blockers

- A1 Poll response privacy/linkability: **PENDING 8V-A APPROVAL**. This repo
  must not create selected-response persistence, Poll ballots, or Poll result
  tables until approved.
- A10 Makerere daily XP cap: **PENDING 8V-A APPROVAL**. This repo must not
  invent a numeric cap or implement capped allocation.
- Authentication provider and hosting provider: **DEFERRED**.

All non-stack product rules in the frozen Product Specification and Blueprint
remain authoritative. Their older Django/DRF stack references require a
controlled canonical document re-freeze; they are not edited in this phase.

See [`docs/adr/0001-nextjs-full-stack-postgresql.md`](docs/adr/0001-nextjs-full-stack-postgresql.md)
for the production architecture decision and risks.
