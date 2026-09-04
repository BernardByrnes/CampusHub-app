# 8V-B.A4 Multi-Membership Leakage Test Plan

## Review status

This is the A4 evidence and future-obligation plan, not the approval record.
ADR 0005 records the independent `A4_APPROVED_WITH_NONBLOCKING_OBLIGATIONS`
decision from 2026-09-02 at its historical reviewed SHA. A2 was subsequently
independently approved. B.2.4.1–.8 have implemented and documented
Tenant-Membership-owned targeted audience behavior; B.2.4.9 remains the final
independent review and is not approved by this plan.

## Test subject and hard boundary

Use an identity X with:

- Membership A in Tenant A; and
- Membership B in Tenant B.

Tenant A operations must resolve only A. Tenant B operations must resolve only
B. Neither response may reveal the other Membership ID, Tenant ID/name,
lifecycle, assurance, affiliation, activity, Membership count, or existence.
Tenant switching is deliberate and explicit; it is not inferred from
navigation or a global identity subject.

The current Tenant-owned ID-bearing model set is `memberships`, `publications`,
`publication_audience_criteria`, `campuses`, `academic_divisions`, `programmes`,
`residences`, and `tenant_academic_year_config`, with `tenants` as root. The
audience affiliation fields and per-field provenance for Campus, Academic
Division, Programme, Academic Year, and Residence live on Tenant Membership.
`TrustedRequestContext` remains narrow and carries no affiliation fields.

## Current executable evidence map

| Case | Expected fail-closed behavior | Evidence | Status |
| --- | --- | --- | --- |
| Same identity with two Memberships | Both Memberships may exist because uniqueness is Tenant + identity; each explicit Tenant resolves only its own Membership. | `tests/a4-user-membership-boundary.test.ts`, `tests/integration/postgresql-foundation.test.ts` | `PASS` |
| Membership A queried under Tenant B | Return null/not-found; do not reveal A. | `src/server/repositories/membership-repository.test.ts`, `tests/integration/postgresql-foundation.test.ts` | `PASS` |
| Membership B queried under Tenant A | Return null/not-found; do not reveal B. | `src/server/repositories/membership-repository.test.ts`, `tests/integration/postgresql-foundation.test.ts` | `PASS` |
| Wrong or guessed Membership ID | Same safe null result as nonexistent ID; malformed UUIDs stop before SQL. | Membership repository unit/integration tests | `PASS` |
| Explicit Tenant switch A → B | Context A contains only A facts; context B contains only B facts. | `tests/a4-user-membership-boundary.test.ts`, `tests/integration/postgresql-foundation.test.ts` | `PASS` |
| RequestContext shape | Exactly one trusted Tenant and Membership; no Membership list or cross-Tenant metadata. | `tests/a4-user-membership-boundary.test.ts` | `PASS` |
| Audience facts ownership | Campus, Division, Programme, Academic Year, and Residence facts derive from Membership ID + Tenant; `identitySubjectId` alone is never an audience key. | `src/server/repositories/membership-repository.test.ts`, `tests/integration/membership-affiliation.test.ts`, `tests/integration/publication-audience.test.ts` | `PASS` |
| Incomplete Campus | Missing Campus/Campus provenance remains transitional persistence; no canonical audience facts and no targeted eligibility. | `tests/integration/membership-affiliation.test.ts`, `tests/integration/publication-audience.test.ts` | `PASS` |
| Targeted Publication direct read | Foreign Tenant, missing facts, malformed definitions, and ineligible Memberships return no Publication. | `src/application/content/publication-read-resolvers.test.ts`, `tests/integration/publication-audience.test.ts` | `PASS` |
| Targeted ACTIVE collection | Only eligible Memberships receive targeted Publications in the requested Tenant. | `src/application/content/list-publications.test.ts`, `tests/integration/publication-audience.test.ts` | `PASS` |
| Targeted ARCHIVE collection | Historical/expired/archived status does not bypass targeting. | `tests/integration/publication-audience.test.ts` | `PASS` |
| Collection foreign rows | Candidate query and output remain in the requested Tenant; foreign rows are excluded. | `tests/integration/postgresql-foundation.test.ts`, `tests/integration/publication-audience.test.ts` | `PASS` |
| Error and response shape | No other Membership IDs, email/domain data, identities, counts, or existence oracles are disclosed. | A4 architecture test and direct/collection response assertions | `PASS` |
| Ordinary unscoped Membership lookup | No `findMembershipById(id)` or all-Memberships-for-identity surface exists. | `tests/a4-user-membership-boundary.test.ts`, `tests/architecture.test.ts` | `PASS` |

## Structural and behavioral guard evidence

`tests/a4-user-membership-boundary.test.ts` discovers the current ID-bearing
Tenant models, verifies that no Global User/account/session persistence exists,
checks the identifier inventory, asserts the narrow `TrustedRequestContext`,
and rejects the reviewed forbidden Global User behavioral vocabulary. The
guard is deliberately maintainable; a future account schema still requires
security review and an explicit declaration.

The targeted reader chain is Tenant-bound Publication and Membership data, not
Global User data. Direct and collection audience resolvers use the active
Tenant plus Membership ID and canonical persisted audience definitions. They do
not use email, domain, browser claims, recipient identities, readiness, count,
or target-status validation to authorize a reader.

## Future leakage obligations

| Surface | Required future negative case | Status |
| --- | --- | --- |
| Logs/security events | No cross-Tenant behavioral joins, other Membership IDs, counts, or existence oracles in ordinary logs/errors; redacted durable events before the first externally exposed Tenant route/server action. | `FUTURE_OBLIGATION` |
| Exports | No global identity-based behavioral aggregation; artifacts and downloads require explicit Tenant scope and approval. | `FUTURE_OBLIGATION` |
| Analytics | `identitySubjectId`/Global User ID never enters event stores, reports, or exports; use a Tenant-local pseudonym. | `FUTURE_OBLIGATION` |
| Notifications | Product stream is grouped by Tenant; security/account messages remain neutral and do not reveal Tenant list/activity. | `FUTURE_OBLIGATION` |
| Account recovery | Recovery/security communication does not reveal Memberships, Tenant activity, XP, Poll/Voice history, or roles. | `FUTURE_OBLIGATION` |
| Support/admin | Every Membership display requires explicit Tenant context; no ordinary cross-university person view. | `FUTURE_OBLIGATION` |
| Background jobs | Durable and runtime Tenant context is mandatory; no implicit all-Tenant behavioral job. | `FUTURE_OBLIGATION` |
| Transfer | New destination Membership; no transfer/merge of Tenant behavioral history. | `FUTURE_OBLIGATION` |
| Closure/deletion | Membership closure remains distinct from global account deletion and does not create cross-Tenant aggregates. | `FUTURE_OBLIGATION` |
| Auth/session/MFA | Global account/security data stays separate from Tenant Membership and behavior. | `FUTURE_OBLIGATION` |

## Review exit criteria

The A4 decision remains independently approved with the nonblocking obligations
recorded in ADR 0005. This plan records current A4 evidence and does not grant
a new A4 approval. A2 is independently approved at its historical reviewed
SHA; B.2.4.1–.8 are subsequent governed implementation/evidence checkpoints,
and B.2.4 still awaits the final independent B.2.4.9 review.
