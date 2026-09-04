# 8V-B.A2 Tenant Isolation Negative-Test Plan

## Review status

Independent security review completed on 2026-09-03. The historical A2
decision is `APPROVED WITH NONBLOCKING OBLIGATIONS` at reviewed SHA
`ed3674bc8689aacd1075161215d16cd4994efcac`; ADR 0004 is the canonical
approval record.

B.2.4 was unblocked by that A2 approval. B.2.4.1–.7 subsequently implemented
the Tenant-Membership-owned targeted Publication audience chain. This plan is
synchronized to that current implementation and does not claim B.2.4 or
B.2.4.9 approval. The final independent B.2.4.9 review remains required.

## Scope and status meanings

The plan covers Tenant-root resolution, the complete Tenant-owned model
inventory, Membership identity/ID/audience-facts reads, typed hierarchy and
affiliation constraints, Publication create/direct/collection operations,
persisted audience evaluation, audience persistence and replacement,
readiness/count/confirmation, RequestContext binding, repository predicates,
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

## Current Tenant model inventory

The structural model inventory is rooted at `tenants` and currently includes:

| Model | Registry surface | Isolation contract |
| --- | --- | --- |
| `tenants` | `tenants` | `TENANT_ROOT`; canonical Tenant ID/slug namespace. |
| `memberships` | `memberships` | `TENANT_SCOPED`; non-null Tenant ownership, Tenant-local affiliation/provenance, and same-Tenant target FKs. |
| `publications` | `publications` | `TENANT_SCOPED`; non-null Tenant ownership, lifecycle/version, and audience mode. |
| `publication_audience_criteria` | `publication_audience_criteria` | `TENANT_SCOPED`; normalized Tenant/Publication criteria with exact payload, duplicate, and same-Tenant target-FK constraints. |
| `campuses` | `campuses` | `TENANT_SCOPED`; stable typed Campus identity. |
| `academic_divisions` | `academic_divisions` | `TENANT_SCOPED`; stable typed hierarchy identity and same-Tenant parent/merge references. |
| `programmes` | `programmes` | `TENANT_SCOPED`; same-Tenant Academic Division and merge references. |
| `residences` | `residences` | `TENANT_SCOPED`; optional Residence identity; no fabricated non-resident row. |
| `tenant_academic_year_config` | `tenant_academic_year_config` | `TENANT_SCOPED`; Tenant-owned numeric academic-year range. |

Legacy Membership rows may still have `campus_id = NULL` and
`campus_provenance = NULL`. No Campus is fabricated. Such a Membership cannot
produce canonical `MembershipAudienceFacts` and cannot satisfy a targeted
Publication audience.

## Current Tenant-sensitive operation inventory

The current registry declares the following implemented operation families; the
registry is metadata and does not grant authorization.

### Tenant and Membership

- Tenant root lookup by ID and slug.
- `RequestContextService.resolveRequestContext` and its public `resolve` alias,
  plus server context wiring and the narrow context-reader contract.
- `DrizzleMembershipRepository.findMembershipForIdentityAndTenant`.
- `DrizzleMembershipRepository.findMembershipByIdForTenant`.
- `DrizzleMembershipRepository.findMembershipAudienceFactsByIdForTenant`.

### Publication and audience

- `CreatePublicationService.createPublication` and
  `DrizzlePublicationRepository.createPublication`.
- `ReadPublicationService.getPublicationForRead` and
  `DrizzlePublicationRepository.findPublicationByIdForTenant`.
- `ListPublicationsService.listPublications` and
  `DrizzlePublicationRepository.listPublicationCandidatesForTenant` for both
  ACTIVE and ARCHIVE surfaces.
- `PersistedPublicationAudienceResolver.resolveAudience` and
  `PersistedPublicationAudienceBatchResolver.resolveAudienceBatch`.
- `DrizzlePublicationRepository.findPublicationAudienceDefinitionForTenant`
  and the bounded set-based
  `findPublicationAudienceDefinitionsForTenant`.
- `DrizzlePublicationRepository.replaceDraftPublicationAudienceForTenant`.
- `DrizzlePublicationRepository.arePublicationAudienceTargetsCurrentlyValidForTenant`.
- `DrizzlePublicationRepository.countPublicationAudienceMembershipsForTenant`.
- `DrizzlePublicationRepository.readPublicationAudienceReadinessSnapshotForTenant`.
- `DrizzlePublicationRepository.validatePublicationAudienceConfirmationAtomicallyForTenant`.
- `getPublicationAudienceReadinessForTenant` and
  `validatePublicationAudienceConfirmationForTenant`.

The registry also declares the authorization-resolver composition path and all
Tenant-owned hierarchy/configuration model surfaces. There is no undeclared
Tenant-sensitive runtime surface in the governed roots.

## Executable governance gate

`tests/tenant-isolation-meta.test.ts` performs structural discovery of Drizzle
tables, every non-test implementation file under the governed production
roots/extensions, TypeScript AST operation discovery, reviewed global and
non-callable contracts, production import boundaries, and recursive migration
discovery. It validates:

1. every discovered Tenant-owned model is registered;
2. every governed implementation path is registered;
3. every discovered public class method, static method, overload
   implementation, callable class field, exported function, exported object
   method/property, direct or aliased route handler, and named/anonymous
   default class operation is registered;
4. every `TENANT_SCOPED` and `TENANT_ROOT` entry has an executable negative
   probe;
5. stable registry IDs are unique;
6. the legal category/scope matrix is enforced;
7. declared implementation paths exist;
8. migration history and head match every discovered SQL migration;
9. every `GLOBAL_NON_TENANT` entry is on the exact reviewed allowlist and
   matches its exact category/path/operation contract;
10. unresolved callable factories, module-load executable forms, exported
    binding aliases/escapes, class initialization, and unsupported runtime
    forms fail closed rather than disappearing; and
11. production imports into excluded test/spec/e2e paths, undeclared future
    surfaces, missing probes, migration drift, and undeclared models/operations
    fail the gate.

The import-boundary scan covers static relative and `@/` alias imports,
re-exports, static dynamic imports, and static `require` calls. It does not
resolve computed/template imports, generated/runtime-loaded modules, or
unreviewed package aliases. The registry has no authorization or database-query
behavior.

## Current registry and probe evidence

The live registry contains 45 entries: 9 model declarations, 39
operation-bearing declarations, 34 `TENANT_SCOPED` entries, 34 required probe
obligations represented by 25 distinct probe IDs, and 8 reviewed
`GLOBAL_NON_TENANT` exemptions. The migration entry declares the complete
history through `drizzle/0008_loving_dagger.sql`.

Every current `TENANT_SCOPED` registry entry has a corresponding executable
negative-probe ID in `tests/tenant-isolation-probes.ts`. The full meta-test also
simulates missing registry entries, missing probes, duplicate IDs, illegal
classifications, missing paths, undeclared operations/models, unsupported
callable forms, falsely-global resource surfaces, production-to-test imports,
and migration drift.

## Targeted-audience negative evidence

The current B.2.4 evidence map is:

| Surface | Required fail-closed behavior | Evidence |
| --- | --- | --- |
| Membership affiliation | Same-Tenant Campus/Division/Programme/Residence FKs; Programme requires Division; provenance/state shapes reject invalid combinations. | `tests/integration/membership-affiliation.test.ts` |
| Typed hierarchy | Same-Tenant parent/merge/Programme links; stable typed tables; no generic hierarchy nodes or fake non-resident row. | `tests/integration/tenant-hierarchy.test.ts` |
| Audience persistence | Normalized criteria, exact dimension payloads, duplicate rejection, same-Tenant Publication/target FKs. | `src/server/repositories/publication-repository.test.ts`, `tests/integration/publication-audience.test.ts` |
| Canonical evaluator | Exactly five dimensions; AND across dimensions; OR within a dimension; exact provenance and Residence semantics; malformed definitions fail closed. | `src/domain/authorization/publication-audience.test.ts`, `src/domain/membership/membership-audience.test.ts` |
| Readiness/count/confirmation | Canonical definition and current target validity; scalar count only; one row-locked transaction snapshot for readiness/confirmation; exact version/count confirmation; stale writes return `VERSION_CONFLICT`. | `src/application/content/publication-audience-readiness.test.ts`, `src/server/repositories/publication-repository.test.ts`, `tests/integration/publication-audience.test.ts` |
| Direct read | Tenant-bound Publication → exposure → pre-audience authorization → persisted definition/Membership facts → canonical evaluator → final authorization; wrong/foreign/hidden results normalize safely. | `src/application/content/read-publication.test.ts`, `src/application/content/publication-read-resolvers.test.ts`, `tests/integration/publication-audience.test.ts`, `tests/integration/postgresql-foundation.test.ts` |
| Collections | Bounded Tenant/keyset candidates → batch exposure → pre-audience authorization → targeted-only batch audience resolution → final canonical authorization; entire-Tenant and denied candidates never enter the targeted batch. | `src/application/content/list-publications.test.ts`, `tests/integration/publication-audience.test.ts`, `tests/integration/postgresql-foundation.test.ts` |
| ACTIVE/ARCHIVE | Targeted filtering applies equally to active and historical surfaces; ineligible viewers see no targeted Publication. | `tests/integration/publication-audience.test.ts` |
| Pagination/scaling | Keyset order `publishAt DESC, id DESC`, hidden rows advance scan position, no OFFSET/duplicates/skips, bounded candidate and batch reads. | `src/application/content/list-publications.test.ts`, `tests/integration/publication-audience.test.ts`, `tests/integration/postgresql-foundation.test.ts` |
| A4 boundary | One explicit Tenant selects one Membership; audience facts derive from Membership ID + Tenant, never Global User or `identitySubjectId` alone. | `tests/a4-user-membership-boundary.test.ts`, `tests/integration/membership-affiliation.test.ts`, `tests/integration/postgresql-foundation.test.ts` |

Targeted zero-criteria definitions, stray criteria on `entire_tenant`, missing
or malformed definitions, incomplete Campus facts, invalid provenance,
unknown Residence, and cross-Tenant target rows all fail closed. No targeted
surface falls back to entire-Tenant access. Readiness/count do not return
recipient identities, and reader authorization does not call readiness/count or
target-validity operations.

## Future governed categories and obligations

The following categories remain intentionally unimplemented and must receive
Tenant context, registry metadata, and negative probes before production use:

| Category | Required future contract | Status |
| --- | --- | --- |
| jobs | Durable and runtime Tenant context is mandatory. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| exports | Request, artifact, and download remain Tenant-bound. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| search | Documents and queries use a Tenant partition. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| cache | Keys and invalidation include the Tenant namespace. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| media | Paths, objects, signatures, and downloads include Tenant authorization. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| notifications | Identity, preference, event, and delivery operations retain Tenant context. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| analytics | Behavioral events and aggregates stay Tenant-local. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |
| backup/restore | Artifacts remain confidential; restore is privileged, audited, ownership/FK validated, and never promotes Tenant A into Tenant B. | `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION` |

Before the first externally exposed Tenant-scoped Route Handler or Server
Action, cross-Tenant attempts must emit redacted durable security events. This
remains a future A6/NFR-9 obligation; no such runtime surface exists here.

## Migration and RLS boundary

The current migration head is `drizzle/0008_loving_dagger.sql` and there is no
`0009`. A2's no-RLS decision remains unchanged. B.2.4 migrations 0005–0008
remain append-only after their creation commits and no new migration is part of
this plan.

## Review boundary

A2 is independently approved with nonblocking obligations at its historical
reviewed SHA. That approval is not a later B.2.4 approval. The B.2.4.1–.8
implementation/evidence chain is now awaiting the separate independent
B.2.4.9 review. Future jobs, exports, search, cache, media, notifications,
analytics, backup/restore, security-event, and existing A4 obligations remain
nonblocking/future obligations as recorded in ADRs 0004 and 0005.
