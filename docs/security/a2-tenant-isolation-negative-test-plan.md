# 8V-B.A2 Tenant Isolation Negative-Test Plan

## Review status

This is the implementation and evidence packet for independent security
review. It is not an approval record. The proposed ADR status is
`PROPOSED — READY FOR INDEPENDENT RE-REVIEW`.

## Scope

The plan covers Tenant root resolution, Membership identity and ID reads,
Publication create/direct reads, Publication ACTIVE/ARCHIVE collections,
request context binding, repository predicates, structural schema ownership,
operation-level governance, migration history/head governance, and the future
sensitive surfaces reserved for jobs, exports, search, cache, media,
notifications, analytics, and backup/restore.

Statuses mean:

- `PASS`: executable current evidence exists and the expected fail-closed
  behavior is asserted.
- `NOT_IMPLEMENTED`: the governed surface is deliberately absent from the
  current product and has no runtime implementation.
- `BLOCKED`: evidence cannot be obtained because a required prerequisite is
  unavailable; no such blocker is accepted for this A2 packet.
- `FUTURE_OBLIGATION`: a future implementation must satisfy the stated
  isolation contract before it is allowed into production.

## Executable governance gate

`tests/tenant-isolation-meta.test.ts` performs structural discovery of Drizzle
tables, filesystem discovery of every non-test implementation file under the
complete governed production roots/extensions, TypeScript AST operation
discovery, and recursive migration discovery. It validates:

1. every discovered Tenant-owned model is registered;
2. every governed implementation path is registered;
3. every discovered public operation and route handler is registered;
4. every scoped registry entry has an executable probe ID;
5. stable registry IDs are unique;
6. the legal category/scope matrix is enforced;
7. declared implementation paths exist;
8. migration history and head match every discovered SQL migration; and
9. the focused simulation suite fails for missing registry entries, missing
   probes, duplicate IDs, illegal classifications, missing paths, existing
   future surfaces, undeclared operations, migration drift, and undeclared
   discovered models.

The registry is metadata only. The meta-test does not grant authorization or
perform a PostgreSQL query.

## Current evidence map

| Probe/evidence | Surface and negative case | Expected result | Status |
| --- | --- | --- | --- |
| `tenant.root.contract` | Tenant root table contract | Root table is `tenants`; child ownership is discovered separately. | `PASS` |
| `membership.persistence` | Membership model missing Tenant ownership | Structural test requires `tenant_id` and a foreign key. | `PASS` |
| `membership.context` | Forged Tenant hint or mismatched trusted Tenant/Membership facts | Context resolution is Tenant-bound; mismatched facts are rejected. | `PASS` |
| `membership.identity-tenant` | Same identity has Memberships in two Tenants | Explicit Tenant selects only the matching Membership. | `PASS` |
| `membership.id-tenant` | Membership ID from another Tenant or malformed ID | Return null and avoid SQL for malformed identifiers. | `PASS` |
| `publication.persistence` | Publication model missing Tenant ownership | Structural test requires `tenant_id` and a foreign key. | `PASS` |
| `publication.create` | Trusted Tenant A context attempts a Tenant B or malformed create | Mismatch/malformed scope fails before repository access; matching scope reaches the canonical repository seam. | `PASS` |
| `publication.direct` | Guessed, foreign, hidden, deleted, or nonexistent Publication ID | Safe `NOT_FOUND` equivalence after scoped lookup/policy. | `PASS` |
| `publication.collection` | Foreign candidate returned by a collection seam | Query is requested-Tenant-bound and foreign candidate is excluded. | `PASS` |
| `publication.cursor.cross-tenant` | Cursor created in another Tenant reused in collection request | Cursor is position-only; requested Tenant remains the query scope. | `PASS` |
| `context.integration` | Real repository context binding and nonexistent/no-Membership equivalence | PostgreSQL integration assertions preserve Tenant binding and safe outcomes. | `PASS` |
| `publication.integration` | Real direct and collection reads across two Tenants | PostgreSQL predicates and policy deny cross-Tenant access. | `PASS` |
| `publication.create.integration` | Real trusted create in Tenant A, attempted Tenant B request, malformed Tenant, and foreign FK | Only matching Tenant A scope creates; invalid scope does not reach PostgreSQL and no cross-Tenant row is created. | `PASS` |
| registry meta-test simulations | Missing declaration, probe, path, unique ID, or model metadata | Test suite fails with a specific governance error. | `PASS` |

The focused cursor evidence is in
`src/application/content/list-publications.test.ts`; the existing real
PostgreSQL collection evidence remains in
`tests/integration/postgresql-foundation.test.ts`.

## Current registry inventory

### Tenant root

- `tenant.persistence.root` — `src/server/db/schema/tenant.ts` — `tenants`.
- `tenant.repository.find-by-id` and `tenant.repository.find-by-slug` —
  `src/server/repositories/tenant-repository.ts`.

### Tenant-scoped models and services

- `membership.persistence` — `src/server/db/schema/membership.ts`.
- `membership.context.reader-contract` — `src/application/context/context-readers.ts`.
- `membership.context.identity-tenant` — `src/application/context/resolve-request-context.ts`.
- `membership.context.server-boundary` — `src/server/context/request-context.ts`.
- `membership.context.server-wiring` — `src/server/context/create-request-context-resolver.ts`.
- `membership.repository.identity-tenant` and `membership.repository.tenant-id` —
  `src/server/repositories/membership-repository.ts`.
- `publication.persistence` — `src/server/db/schema/publication.ts`.
- `publication.authorization.resolvers` —
  `src/application/content/publication-read-resolvers.ts`.
- `publication.repository.direct` and `publication.repository.collection` —
  `src/server/repositories/publication-repository.ts`.
- `publication.direct-read` — `src/application/content/read-publication.ts`.
- `publication.collection` — `src/application/content/list-publications.ts`.
- `publication.create` — `src/application/content/create-publication.ts`.

### Global exemptions

- `global.health.route` — `src/app/api/health/route.ts`.
- `global.health.service` — `src/application/system/get-health.ts`.
- `global.database.client` — `src/server/db/client.ts`.
- `global.env.reader` and `global.env.schema` — `src/server/config/`.
- `global.schema.barrel` — `src/server/db/schema/index.ts`.
- `global.tenancy.registry` — `src/server/tenancy/tenant-surface-registry.ts`.
- `global.migrations` — explicitly declared `drizzle/**/*.sql` history with
  head `drizzle/0004_right_whizzer.sql`.

These exemptions are limited to infrastructure/liveness/schema metadata and
do not authorize global resource queries.

## Future governed categories

The following directories/categories are reserved and governed but intentionally
not implemented in A2:

| Category | Required future negative contract | Status |
| --- | --- | --- |
| jobs | Durable and runtime Tenant context is mandatory. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| exports | Request, artifact, and download remain Tenant-bound. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| search | Documents and queries use a Tenant partition. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| cache | Keys and invalidation include Tenant namespace. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| media | Paths, objects, signatures, and downloads include Tenant namespace and authorization. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| notifications | Identity, preference, event, and delivery operations retain Tenant context. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| analytics | Behavioral events and aggregates stay Tenant-local. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| backup | Provider/application backups inherit confidentiality and isolation; restore validates ownership/FKs, is privileged/audited, and never promotes Tenant A into Tenant B. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` — A7/NFR-8 handoff. |

Security-event recording is also a future obligation. Before the first
externally exposed Tenant-scoped route or server action, cross-Tenant attempts
must emit redacted durable events. A2 documents the need and hands taxonomy,
retention, redaction, and delivery to A6/NFR-9; it does not invent an
implementation.

## Threat/failure obligations

| Failure | Fail-closed expectation | Current status |
| --- | --- | --- |
| Guessed foreign UUID | No resource returned; no existence oracle. | `PASS` |
| Membership ID from another Tenant | Joint Tenant + ID scope returns null/not-found. | `PASS` |
| Same identity with two Memberships | Explicit Tenant chooses exactly one Membership. | `PASS` |
| Forged Tenant hint | Tenant resolution and Membership binding reject mismatch. | `PASS` |
| Stale/mismatched trusted facts | Reject before query or normalize to safe denial/not-found. | `PASS` |
| Missing predicate on a global resource query | Architecture/registry gate fails before merge. | `PASS` |
| Cache key missing Tenant | Treat as miss; never return Tenant-owned value. | `FUTURE_OBLIGATION` |
| Job missing Tenant context | Reject before execution. | `FUTURE_OBLIGATION` |
| Export missing Tenant | Reject generation or download. | `FUTURE_OBLIGATION` |
| Search partition missing Tenant | Reject query/document or return no Tenant-owned result. | `FUTURE_OBLIGATION` |
| Media path missing Tenant | Reject path/signature/download. | `FUTURE_OBLIGATION` |
| Notification crosses Tenant | Do not create or deliver the event. | `FUTURE_OBLIGATION` |
| Analytics crosses Tenant | Keep events and aggregates Tenant-local. | `FUTURE_OBLIGATION` |
| Backup/restore crosses Tenant or skips integrity checks | Keep backup artifacts confidential, require privileged audit, validate ownership/FKs, and never promote A data into B. | `FUTURE_OBLIGATION` / `NOT_IMPLEMENTED` |
| Cross-Tenant attempt at an externally exposed Tenant-scoped route/server action | Emit a redacted durable security event. | `FUTURE_OBLIGATION` — A6/NFR-9 handoff. |
| Cursor reused across Tenant | Apply requested Tenant scope independently of cursor payload. | `PASS` |
| Malformed identifier | Reject before PostgreSQL. | `PASS` |
| Deleted/nonexistent resource | Match wrong-Tenant safe not-found outcome. | `PASS` |

## Required review decisions

Independent security review must inspect the registry inventory, schema
discovery assumptions, negative probes, no-RLS decision, global exemptions,
future obligations, and security-event boundary. Any finding must be remediated
before A2 can be treated as complete. A4 is separately approved with
nonblocking future obligations in ADR 0005. B.2.4 remains blocked and must not
begin from this packet alone.
