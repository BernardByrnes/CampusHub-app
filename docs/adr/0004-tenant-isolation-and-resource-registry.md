# ADR 0004: Tenant Isolation and Resource Registry

- Status: **APPROVED WITH NONBLOCKING OBLIGATIONS**
- Date: 2026-09-03
- Decision owner: independent security review completed
- Scope: 8V-B.A2 tenant-isolation governance and resource-registry gate

## Decision

CampusHub treats the active Tenant as a mandatory security boundary for every
Tenant-owned resource. A resource read, collection read, background operation,
export, search operation, cache access, media access, notification, analytics,
backup, and restore operation must carry a trusted Tenant context or fail
closed. This ADR is the approved A2 governance contract with nonblocking
obligations; it does not grant authorization by itself.

The registry at `src/server/tenancy/tenant-surface-registry.ts` is metadata only.
It records ownership, implementation location, isolation strategy, and required
negative-test coverage. Authorization remains in the domain policies and
application services. The registry must never become an alternate permission
engine.

## A. Tenant isolation invariant

No Tenant-scoped resource is reachable, returned, inferred, or acted upon from
another Tenant context. A wrong-Tenant, deleted, and nonexistent resource use
the same externally safe not-found behavior where the surface returns a
resource. Internal diagnostics must not turn that equivalence into an oracle.

## B. Active Tenant context

The active Tenant is resolved before a Tenant-owned operation. The server-owned
identity, explicit Tenant hint, Tenant lifecycle facts, and Membership facts are
bound together by `RequestContextService`. A client-supplied Tenant hint is an
input to resolution, not trusted authorization.

## C. Repository scoping

Repositories expose Tenant-bound operations. Publication and Membership reads
must include the Tenant predicate in the same database query as the resource
identifier. Collection queries must include Tenant scope, lifecycle/surface
constraints, and their keyset cursor in one bounded query contract. An ordinary
unscoped resource-by-ID method is prohibited.

## D. Application trust binding

Application services validate the requested Tenant, viewer Tenant, trusted
Tenant facts, cursor, and resource facts before querying or returning data.
Hydrated resources are mapped into the canonical authorization contract before
policy evaluation. Mismatched or stale facts fail closed.

## E. Wrong-Tenant not-found equivalence

Direct reads normalize a resource that is absent because it belongs to another
Tenant to `NOT_FOUND`, matching a truly nonexistent or deleted resource.
Collections exclude wrong-Tenant candidates and do not disclose their count,
identity, lifecycle, or existence.

## F. Authorization-after-scope defense in depth

Tenant scoping is necessary but not sufficient. After scoped retrieval,
canonical exposure, lifecycle, audience, viewer, and Tenant facts still pass
through the existing resource-read policy. A policy denial is never replaced by
an ad hoc route or repository shortcut.

## G. Database ownership and foreign keys

The current Tenant-owned tables are `memberships` and `publications`; both
declare non-null `tenant_id` ownership and foreign-key ownership to `tenants.id`.
`tenants` is the Tenant root. Structural discovery in the A2 meta-test derives
this declaration from the Drizzle schema and fails if a Tenant-owned model is
not registered. No schema migration is introduced by A2.

## H. Future jobs Tenant context

Every future job that reads or mutates Tenant-owned data must receive an
explicit Tenant context in its durable payload and execution boundary. A job
without that context is invalid and must fail before resource access.

## I. Future exports Tenant context

Every future export request, worker, and generated artifact must retain the
requesting Tenant boundary. Export storage and download authorization must be
Tenant-scoped. Cross-Tenant export data is a fail-closed security failure.

## J. Search index Tenant partition

Every future search document and query must contain an unambiguous Tenant
partition. Search results without the requested Tenant partition are invalid;
there is no global fallback for Tenant-owned content.

## K. Cache Tenant namespace

Every future cache key and invalidation path for Tenant-owned data must include
the Tenant namespace. A cache hit without a matching Tenant namespace must be
treated as a miss and never returned.

## L. Media Tenant namespace and authorization

Every future media path, object key, signed URL, and download operation for
Tenant-owned data must carry a Tenant namespace and authorization check. A
media identifier alone is not sufficient authority.

## M. Notification Tenant context

Every future notification creation, delivery, preference lookup, and audit
operation must carry the originating Tenant context. A recipient or identity
that exists in multiple Tenants does not merge those Tenant streams.

## N. Analytics Tenant-local boundary

Future behavioral analytics must remain Tenant-local, using the product’s
pseudonymous identity rules. Aggregation must not create a cross-Tenant
behavioral profile or allow one Tenant to query another Tenant’s events.

## O. Backup and restore boundary

Backup and restore are a governed future category, not a current A2
implementation. The status is `FUTURE_OBLIGATION` / `NOT_IMPLEMENTED`; A2 adds
no backup provider scripts, export path, restore command, or per-Tenant backup
capability.

Future provider-managed or application-managed backups must inherit the
confidentiality and Tenant-isolation boundary of the source data. Backup and
restore operations must be privileged and auditable; a restore from Tenant A
must never be promoted into Tenant B. Before promotion, restore validation must
check Tenant ownership, foreign keys, schema compatibility, and integrity.
Retention, redaction, and removal requirements must be explicit, and backup
artifacts are not ordinary Tenant downloads. Provider-managed backups remain
subject to this contract. The detailed recovery and continuity handoff belongs
to A7/NFR-8.

## P. Security-event expectation

Security-event recording is a required future obligation for relevant
Tenant-isolation failures and security-sensitive decisions. Before the first
externally exposed Tenant-scoped route or server action, cross-Tenant attempts
must emit a redacted durable security event. A2 documents the expectation but
does not invent a logging implementation or schema. The event taxonomy,
retention, redaction, and delivery boundary hand off to A6/NFR-9 before that
work begins.

## Q. Testing and CI contract

The A2 gate includes:

- structural discovery of current Drizzle tables;
- governed production-path discovery for `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`,
  `.cts`, `.mjs`, and `.cjs`, including complete `src/server/**`,
  `src/application/**`, `src/app/api/**`, and the single-file middleware/proxy
  boundary, with explicit test/spec exclusion;
- TypeScript AST discovery of public class methods (including static methods,
  overload implementations, and callable class fields), exported functions,
  exported object methods/properties, direct and aliased route handlers, and
  named or anonymous default classes, with operation-level registry metadata;
- an explicit reviewed `GLOBAL_NON_TENANT` allowlist with exact category,
  implementation-path, and operation contracts; a free-form exemption reason
  cannot make a Tenant-sensitive surface global;
- an AST import-boundary check that rejects production imports into excluded
  test/spec/e2e directories or filenames, including relative, `@/` alias,
  export, static dynamic-import, and static `require` forms; test-to-test
  imports remain permitted;
- a fail-closed unsupported-callable-form check for exported or class/object
  callable factories that cannot be resolved to a known AST target; callable
  safety is never inferred from an export/member name, and legitimate
  non-callable factory outputs require an exact reviewed path/name/AST-form
  contract;
- recursive discovery and explicit declaration of every `drizzle/**/*.sql`
  migration plus the current migration head;
- a registry entry for every discovered model, operation, and governed path;
- an isolation probe for every `TENANT_SCOPED` registry entry;
- executable simulations for missing entries, missing probes, duplicate IDs,
  invalid category/scope declarations, missing implementation paths, future
  implementations, undeclared operations across the supported callable forms,
  unsupported callable factories, falsely-global Publication/job/route/cache
  entries, production-to-test imports, migration drift, and undeclared
  discovered models;
- unit, integration, typecheck, lint, build, database-schema check, and
  whitespace checks as reported in the implementation handoff.

The meta-test is intentionally designed to fail CI when a governed surface is
added without registry metadata, when a Tenant-owned model is added without a
scope declaration, when a new global exception is not reviewed into the
allowlist, when a callable export cannot be discovered safely, or when
production imports an excluded test/spec path. The import scan is static: it
does not claim to resolve computed/template imports, generated modules,
runtime-loaded modules, or package aliases beyond the reviewed `@/` mapping.

## R. Registry and meta-test architecture

The registry is a typed list of stable metadata records. Each record declares
its category, implementation path, public operation when present, surface,
Tenant classification, isolation strategy, and required negative-test IDs.
`tests/tenant-isolation-meta.test.ts` validates the records against complete
filesystem discovery, TypeScript AST operation discovery, structural schema
discovery, migration history/head discovery, and the executable probe registry.
It has no authorization logic and performs no database connection. Future
governed directories are intentionally empty today; their presence in the
governed-root list makes an unregistered implementation fail the gate rather
than silently becoming global.

## Current production inventory

| Surface | Classification | Current isolation contract |
| --- | --- | --- |
| `tenants` model and Tenant repository | `TENANT_ROOT` | Canonical Tenant ID/slug resolution; root owns child namespace. |
| `memberships` model | `TENANT_SCOPED` | Non-null `tenant_id` FK; structural model probe. |
| Membership identity + Tenant lookup | `TENANT_SCOPED` | Identity and Tenant are joint repository predicates; context binding probe. |
| Membership + Tenant + ID lookup | `TENANT_SCOPED` | Tenant and Membership ID are joint predicates; malformed/foreign IDs fail closed. |
| `publications` model | `TENANT_SCOPED` | Non-null `tenant_id` FK; structural model probe. |
| Publication direct read | `TENANT_SCOPED` | Tenant + Publication ID query, then canonical exposure/audience policy. |
| Publication ACTIVE/ARCHIVE collection | `TENANT_SCOPED` | Tenant + lifecycle + keyset query, bounded orchestration, then policy. |
| Publication create operation | `TENANT_SCOPED` | Trusted context/requested Tenant match before repository write; scope validation is not capability authorization. |
| `RequestContext` and resolver wiring | `TENANT_SCOPED` | Server-owned identity/Tenant binding and mismatch rejection. |
| Health route/service, DB client, config, schema barrel, migration history | `GLOBAL_NON_TENANT` | Specific infrastructure exemptions; no Tenant resource data. |

The current route/application/repository/schema/config files under the governed
roots are all declared by the registry, including their discovered public
operations. The reserved categories `jobs`, `exports`, `search`, `cache`,
`media`, `notifications`, `analytics`, and `backups/restore` are
`FUTURE_NOT_IMPLEMENTED`; no fake implementation is added by A2.

## Threat and failure matrix

| Threat/failure | Expected fail-closed behavior | Current obligation/status |
| --- | --- | --- |
| Guessed foreign UUID | Scoped lookup returns no resource; no data disclosure. | `PASS` — direct repository/service probes. |
| Membership ID from another Tenant | Tenant + ID query returns null/not-found. | `PASS` — Membership repository and integration evidence. |
| Same global identity with two Memberships | Explicit Tenant selects only that Tenant’s Membership. | `PASS` — context probe and integration evidence. |
| Forged Tenant hint | Resolve through Tenant repository and Membership binding; reject mismatch. | `PASS` — RequestContext tests. |
| Stale/mismatched trusted facts | Reject before query or map denial to safe outcome. | `PASS` — direct/collection service tests. |
| Global query missing Tenant predicate | Architecture/meta-test catches the undeclared or unscoped surface. | `PASS` — repository contract and registry gate. |
| Cache key missing Tenant | Treat as invalid/miss; never return data. | `FUTURE_OBLIGATION` — cache not implemented. |
| Job missing Tenant context | Reject before Tenant-owned work. | `FUTURE_OBLIGATION` — jobs not implemented. |
| Export missing Tenant | Reject generation/download and isolate artifacts. | `FUTURE_OBLIGATION` — exports not implemented. |
| Search index missing Tenant partition | Reject document/query or return no Tenant-owned result. | `FUTURE_OBLIGATION` — search not implemented. |
| Media path missing Tenant namespace | Reject path/signature/download. | `FUTURE_OBLIGATION` — media not implemented. |
| Notification crosses Tenant | Do not create or deliver cross-Tenant event. | `FUTURE_OBLIGATION` — notifications not implemented. |
| Analytics crosses Tenant | Keep events and aggregates Tenant-local. | `FUTURE_OBLIGATION` — analytics not implemented. |
| Backup/restore crosses Tenant or bypasses integrity checks | Keep artifacts confidential, require privileged audit, validate ownership/FKs, and never promote A data into B. | `FUTURE_OBLIGATION` / `NOT_IMPLEMENTED` — backup and restore not implemented; A7/NFR-8 handoff. |
| Cross-Tenant attempt before security-event boundary | Emit a redacted durable security event once an externally exposed Tenant-scoped route/server action exists. | `FUTURE_OBLIGATION` — A6/NFR-9 handoff; logging not implemented in A2. |
| Cursor reused across Tenant | Cursor supplies position only; requested trusted Tenant supplies scope. | `PASS` — collection unit and integration evidence. |
| Malformed identifier | Reject before PostgreSQL. | `PASS` — repository/context/service tests. |
| Deleted/nonexistent resource | Same safe not-found outcome as wrong-Tenant resource. | `PASS` — direct-read evidence. |

## Approval record

- Review date: 2026-09-03
- Reviewed SHA: `ed3674bc8689aacd1075161215d16cd4994efcac`
- Result: `APPROVED WITH NONBLOCKING OBLIGATIONS`
- Frozen A2 exit: `PASS`
- B.2.4 gate: `UNBLOCKED`

Independent security review completed. All independent blocking findings
A2-MED-01 through A2-MED-10 were closed at approval.

The following obligations remain nonblocking:

- Before the first externally exposed Tenant-scoped route or server action,
  cross-Tenant attempts must emit durable, redacted security events.
- Before paid production launch, Tenant-safe backup/restore controls must be
  implemented and negatively tested under the relevant A7/NFR-8 work.
- Future Tenant-sensitive jobs, exports, search, cache, media, notifications,
  analytics, and backup/restore surfaces must enter the Tenant-surface registry
  and receive appropriate Tenant-isolation negative probes.
- TG-04 remains `NONBLOCKING`, with migration governance continuing.
- Existing A4 nonblocking obligations remain unchanged.

## Review boundary

A2 is approved with nonblocking obligations. B.2.4 is unblocked by this
approval record; its implementation is outside this documentation-only
commit. A4 remains separately approved with nonblocking future obligations in
ADR 0005.
