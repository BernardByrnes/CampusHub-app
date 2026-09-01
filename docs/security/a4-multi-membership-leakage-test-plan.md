# 8V-B.A4 Multi-Membership Leakage Test Plan

## Review status

This is a proposed A4 evidence and future-obligation plan. It is not an
approval record. A4 remains `PROPOSED — AWAITING INDEPENDENT SECURITY REVIEW`.

## Test subject

Use an identity X with:

- Membership A in Tenant A; and
- Membership B in Tenant B.

Tenant A operations must resolve only A. Tenant B operations must resolve only
B. Neither response may reveal the other Membership ID, Tenant ID/name,
lifecycle, assurance, activity, Membership count, or existence. Tenant
switching is deliberate and explicit; it is not inferred from navigation or a
global identity subject.

## Status meanings

- `PASS`: current executable evidence asserts the required behavior.
- `NOT_IMPLEMENTED`: the surface does not exist in the current production
  foundation.
- `BLOCKED`: a required current test cannot run; no such blocker is accepted
  for the current A4 packet.
- `FUTURE_OBLIGATION`: a later implementation must add a negative test before
  production use.

## Current executable evidence map

| Case | Expected fail-closed behavior | Evidence | Status |
| --- | --- | --- | --- |
| Same identity with two Memberships | Both Memberships may exist because uniqueness is Tenant + identity; behavior remains separate. | `tests/integration/postgresql-foundation.test.ts` multi-Membership test; A4 unit context test. | `PASS` |
| Membership A queried under Tenant B | Return null/not-found; do not reveal A. | Real Membership repository integration test. | `PASS` |
| Membership B queried under Tenant A | Return null/not-found; do not reveal B. | Real Membership repository integration test. | `PASS` |
| Wrong or guessed Membership ID | Same safe null result as nonexistent ID. | Real repository test plus malformed UUID guards. | `PASS` |
| Explicit Tenant switch A -> B | A context contains only A facts; B context contains only B facts. | A4 unit and real PostgreSQL context evidence. | `PASS` |
| Missing or invalid Tenant context | Return `TENANT_REQUIRED` or `TENANT_SCOPE_NOT_FOUND`; do not enumerate Memberships. | RequestContext unit/integration tests. | `PASS` |
| RequestContext response shape | Exactly one trusted Membership ID and one Tenant ID; no Membership list or cross-Tenant metadata. | A4 architecture test. | `PASS` |
| Publication direct read | Tenant-scoped wrong/nonexistent resource is safe `NOT_FOUND`. | Existing direct-read unit/integration evidence. | `PASS` |
| Publication collection | Query and output remain in the requested Tenant; foreign rows are excluded. | Existing collection unit/integration evidence. | `PASS` |
| Error codes and messages | Do not disclose “Membership exists elsewhere”, other IDs, counts, or assurance. | Exact context result assertions and response-shape checks. | `PASS` |
| Ordinary unscoped Membership lookup | No `findMembershipById(id)` or `findAllMembershipsForIdentity(...)` surface. | A4 prototype-method architecture assertion and existing architecture test. | `PASS` |

## Current identifier and behavioral guard evidence

The A4 architecture test structurally discovers Drizzle tables and confirms:

1. current `memberships` and `publications` are the Tenant-owned ID-bearing
   models;
2. no Global User/account/session persistence exists;
3. the identifier inventory names every current ID-bearing Tenant model and
   current context/cursor/FK identifier;
4. current Membership identifier and behavior fields are Tenant-local in the
   ownership matrix; and
5. a focused forbidden vocabulary rejects a future declared Global
   User/account fixture containing XP, Level, Streak, Poll, Voice,
   engagement, Event, Opportunity, student/profile, residence, or academic
   behavioral fields.

The guard is intentionally small and maintainable. It is not a promise to
recognize every possible future synonym; a future account schema requires
security review and an explicit declaration.

## Future leakage obligations

| Surface | Required future negative case | Status |
| --- | --- | --- |
| Logs/security events | No cross-Tenant behavioral joins, other Membership IDs, counts, or existence oracles in ordinary logs/errors. | `FUTURE_OBLIGATION` |
| Exports | No global identity-based behavioral aggregation; artifacts and downloads require explicit Tenant scope and approval. | `FUTURE_OBLIGATION` |
| Analytics | `identitySubjectId`/Global User ID never enters event stores, reports, or exports; use Tenant-local pseudonym. | `FUTURE_OBLIGATION` |
| Notifications | Product stream is grouped by Tenant; security/account messages remain neutral and do not reveal Tenant list/activity. | `FUTURE_OBLIGATION` |
| Account recovery | Recovery/security communication does not reveal Memberships, Tenant activity, XP, Poll/Voice history, or roles. | `FUTURE_OBLIGATION` |
| Support/admin | Every Membership display requires explicit Tenant context; no ordinary cross-university person view. | `FUTURE_OBLIGATION` |
| Background jobs | Durable and runtime Tenant context is mandatory; no implicit all-Tenant behavioral job. | `FUTURE_OBLIGATION` |
| Transfer | New destination Membership; no transfer/merge of Tenant behavioral history. | `FUTURE_OBLIGATION` |
| Closure/deletion | Membership closure remains distinct from global account deletion and does not create cross-Tenant aggregates. | `FUTURE_OBLIGATION` |
| Auth/session/MFA | Global account/security data stays separate from Tenant Membership and behavior. | `FUTURE_OBLIGATION` |

## Review exit criteria

Independent security review must inspect the two-Membership evidence, exact
response shapes, repository surface, identifier classifications, global
behavioral guard limitations, and every future obligation. Any finding must be
remediated before A4 can be treated as complete. A2 remains
`READY_FOR_INDEPENDENT_REVIEW`; B.2.4 must not begin until both A2 and A4 are
independently approved.
