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
The future authentication/session resolver owns the authenticated identity that
enters `RequestContext`; no auth provider has been selected yet.

## Tenant and Membership authority

The 8V-B.1 foundation stores only the authoritative Tenant and Membership
identity/policy fields. Tenant IDs and Membership IDs are generated UUIDs;
tenant slugs are lower-case URL-safe keys and are not authorization by
themselves. Tenant timezones are validated IANA identifiers and are the future
authority for tenant-day boundaries, never the browser timezone.

Tenant lifecycle values are the frozen set `pilot`, `active`, `grace`,
`suspended`, and `archived`. Membership lifecycle values are the frozen set
`unverified`, `pending_review`, `verified`, `stale`, `on_leave`, `alumni`,
`transferred_out`, `participation_suspended`, `suspended`, and `closed`.
Lifecycle values are authoritative facts, not global authorization decisions.
The trusted-context resolver accepts every recognized value and preserves it
for operation-specific policies to evaluate later. Those policies must decide
read access, participation, publishing, polls, voice, notifications, jobs,
administration, and export independently. For example, a future read policy
may allow a suspended tenant to see existing published content read-only;
`stale` and `participation_suspended` membership facts may retain read access
while participation is blocked; and archived access or export remains a
separate policy decision. The frozen default permits normal participation for
`on_leave`, while later resource-specific current-enrolment rules may refine
that decision.

The provider-neutral Membership seam stores an opaque `identitySubjectId` and
does not create a User table, credentials, sessions, JWTs, or an auth-provider
foreign key. A trusted RequestContext is produced only after server-side
identity, tenant, Membership, lifecycle, and assurance validation. A tenant
hint can select a lookup, but a client tenant ID, membership ID, lifecycle, or
assurance value can never grant authority. The resolver returns either the
complete trusted fact snapshot `{ identitySubjectId, tenantId, tenantStatus,
membershipId, assuranceLevel, membershipStatus }` or a safe code-only
resolution failure. This snapshot is not an authorization grant and is never
partial; operation-specific policies evaluate its facts before permitting an
operation.

Assurance is the exact closed ladder `L0 — Registered`, `L1 — Weak
Affiliation`, `L2 — Roster Match`, and `L3 — Strong Institutional Proof`.
Comparisons use the single domain helper `assuranceAtLeast`; malformed values
fail closed. Institutional email alone cannot confer L3: the tenant must
attest identity binding, current enrolment, and reliable revocation.

PostgreSQL native enums, required-field checks, the unique tenant slug index,
the tenant-plus-identity Membership uniqueness index, and an explicit
`ON DELETE RESTRICT` Membership foreign key are defined in the reviewed
`drizzle/0000_young_adam_warlock.sql` migration. No destructive reset command
is provided.

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

The real PostgreSQL integration suite is opt-in and requires a real
PostgreSQL `DATABASE_URL` in the ignored `.env.local` file. On PowerShell, run
it with:

```powershell
$env:CAMPUSHUB_DB_INTEGRATION = "1"
npm run test:integration
Remove-Item Env:CAMPUSHUB_DB_INTEGRATION
```

The suite uses synthetic records with targeted cleanup and never resets a
schema or database. Normal `npm test` runs unit tests only.

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

There is no `db:push` production workflow. The current migration contains only
the Tenant and Membership foundation; Poll response, XP, Streak, and content
tables remain out of scope. Playwright E2E setup is reserved for a later
phase; domain/application tests belong in Vitest.

`npm audit --omit=dev` currently reports zero production vulnerabilities. The
full audit still reports four moderate, development-only `esbuild` findings
through the existing Drizzle Kit 0.31.10 toolchain (`@esbuild-kit`). The
available forced remediation would downgrade Drizzle Kit to 0.18.1 and is a
breaking change, so it remains recorded debt; no `npm audit fix --force` was
run.

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
