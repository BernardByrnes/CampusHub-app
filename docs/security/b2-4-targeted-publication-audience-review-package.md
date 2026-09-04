# B.2.4 Targeted Publication Audience Review Package

## Status

`APPROVED WITH NONBLOCKING OBLIGATIONS`

This package records the independent B.2.4.9 security re-review of the
implementation at SHA `84c58cc2b525e1061fb4652906968c54ac3a00b3`. This
documentation commit occurs after that reviewed SHA and does not rebind the
implementation review to the documentation commit.

The initial independent review identified blocking `B24-MED-01` for
mixed-version audience confirmation and advisory `B24-LOW-01` for direct
resolver Membership rebinding. Both findings are `CLOSED` at Remediation R1
SHA `84c58cc2b525e1061fb4652906968c54ac3a00b3`.

Independent final verdict: `B2_4_APPROVED_WITH_NONBLOCKING_OBLIGATIONS`.
The final re-review found zero Critical / High / Medium / Low-Advisory
findings.

`B.2.4 TARGETED PUBLICATION AUDIENCE — APPROVED WITH NONBLOCKING OBLIGATIONS AT 84c58cc2b525e1061fb4652906968c54ac3a00b3`

## Authority

- The frozen Product Specification wins over implementation convenience.
- B.2.4 architecture decisions define the typed hierarchy, Membership-owned
  affiliation, canonical audience vocabulary, persistence, readiness, direct
  reads, and collections.
- A2 is independently approved with nonblocking obligations at its historical
  reviewed SHA.
- A4 is independently approved with nonblocking obligations at its historical
  reviewed SHA.
- B.2.4.9 is the completed independent final review at the implementation SHA
  recorded above. This package records the B.2.4 approval with nonblocking
  obligations; it does not issue a new A2 or A4 approval.

## Implementation chain

| Checkpoint | Delivered contract |
| --- | --- |
| B.2.4.1 | Canonical audience dimensions, provenance policies, Residence targets, AND/OR semantics, and fail-closed shape validation. |
| B.2.4.2 | Typed Tenant hierarchy and academic-year configuration with stable IDs and same-Tenant structural constraints. |
| B.2.4.3 | Tenant Membership affiliation and per-field provenance for Campus, Academic Division, Programme, Academic Year, and Residence. |
| B.2.4.4 | Normalized relational Publication audience criteria, same-Tenant FKs, payload checks, duplicate protection, replacement transaction, and immutability. |
| B.2.4.5 | Scalar audience estimate, readiness, exact count confirmation, Publication versioning, stale-write conflict, and target validity. |
| B.2.4.6 | Tenant-bound direct Publication reads with visibility/exposure before persisted audience evaluation. |
| B.2.4.7 | Bounded ACTIVE/ARCHIVE targeted collections, batch audience definition reads, pre-audience filtering, canonical final authorization, and keyset pagination. |
| B.2.4.8 | Final regression, A2/A4 governance evidence, migration immutability audit, synchronized security documentation, and this review package. |
| B.2.4.9 R1 | Transaction/version-consistent readiness and confirmation, plus exact Tenant/Membership rebinding in the direct resolver. |

## Security invariants

- A trusted explicit Tenant binds every Tenant-owned operation.
- Campus, Academic Division, Programme, Academic Year, Residence, and their
  provenance belong to Tenant Membership, not Global User.
- Audience eligibility uses current Tenant Membership audience facts and the
  canonical persisted definition.
- Visibility, lifecycle, exposure, viewer, assurance, and Tenant checks occur
  before targeted audience resolution; final authorization remains canonical.
- Unknown, malformed, incomplete, foreign, or zero-criteria targeted inputs
  fail closed and never become entire-Tenant access.
- Published, expired, and archived Publication audiences are immutable; only
  draft/scheduled replacement is allowed under expected-version protection.
- Replacement locks the Tenant-bound Publication and updates mode, criteria,
  and version atomically.
- Readiness and confirmation lock the exact Tenant-bound Publication and use one
  transaction-consistent Publication, criteria, target-validity, and scalar
  Membership-count snapshot; stale expected versions fail closed.
- Direct audience resolution accepts Membership facts only when their Tenant and
  Membership ID exactly match the bound viewer before canonical evaluation.
- When real publishing is introduced, confirmation must execute in the same
  authoritative transaction as the lifecycle transition; a committed
  confirmation followed by an unrelated publish transaction is not permitted.
- Collections use bounded Tenant/keyset reads, targeted-only batch resolution,
  and no direct-read-per-item or unbounded candidate scan.
- Audience estimates/counts are scalar and return no Membership IDs,
  identitySubjectIds, email lists, names, or cross-Tenant metadata.
- Global User/account/session/Auth persistence and Global User behavioral
  targeting are not implemented.

## Permanent regression gates

The independent reviewer should run and inspect:

- `tests/tenant-isolation-meta.test.ts` and `tests/tenant-isolation-probes.ts`
  for complete model/operation/path/migration discovery, exact global
  contracts, and every `TENANT_SCOPED` negative probe;
- `tests/architecture.test.ts` for A2 structural constraints;
- `tests/a4-user-membership-boundary.test.ts` for the Global User/Membership
  boundary and identifier inventory;
- `src/domain/authorization/publication-audience.test.ts` and
  `src/domain/membership/membership-audience.test.ts` for canonical semantics;
- `src/application/content/publication-read-resolvers.test.ts`,
  `src/application/content/read-publication.test.ts`, and
  `src/application/content/list-publications.test.ts` for direct/batch and
  collection authorization order;
- `src/server/repositories/publication-repository.test.ts` and
  `src/application/content/publication-audience-readiness.test.ts` for
  persistence/readiness/version/count behavior; and
- `tests/integration/tenant-hierarchy.test.ts`,
  `tests/integration/membership-affiliation.test.ts`,
  `tests/integration/publication-audience.test.ts`, and
  `tests/integration/postgresql-foundation.test.ts` for real PostgreSQL,
  cross-Tenant, direct-read, ACTIVE/ARCHIVE, and pagination evidence.

## Migration history

The append-only B.2.4 migration history is:

- `drizzle/0005_nostalgic_prima.sql` — typed hierarchy;
- `drizzle/0006_unknown_psylocke.sql` — Membership affiliation/provenance;
- `drizzle/0007_optimal_mockingbird.sql` — Publication audience criteria; and
- `drizzle/0008_loving_dagger.sql` — Publication version.

The migration head is `drizzle/0008_loving_dagger.sql`. There is no 0009 and
no RLS requirement for this A2-approved invariant.

## Explicit unresolved and nonblocking obligations

1. The SMALL AUDIENCE FLOOR numeric value is unresolved; no numeric rule is
   implemented.
2. No real external Publication publish transport/capability authorization
   exists yet.
3. `publication.create` and future publish still require real capability
   enforcement; confirmation must execute inside the eventual authoritative
   publish transaction.
4. A publish-time target-label snapshot remains a future obligation at the
   authoritative publish/lock transition.
5. Scheduled-fire audience revalidation/hold behavior remains future job work;
   invalid scheduled targeting must fail closed and never become
   entire-Tenant.
6. Later Campus backfill/data-readiness work may strengthen Membership Campus
   database nullability; this checkpoint does not make it NOT NULL.
7. Durable redacted cross-Tenant security events are required before the first
   externally exposed Tenant-scoped Route Handler or Server Action.
8. Backup/restore controls are required before paid launch.
9. TG-04 migration-history/recovery governance remains nonblocking.
10. Future jobs, exports, search, cache, media, notifications, analytics, and
    backup surfaces require TI-1 registration and negative tests.
11. Existing A4 future obligations remain active as recorded in ADR 0005.
12. A1/Poll remains completely separate and independently gated.

None of these obligations is characterized as implemented by B.2.4.8.
