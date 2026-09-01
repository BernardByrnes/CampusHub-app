# ADR 0003: Tenant-Scoped Publication Persistence

- Status: **Accepted implementation decision — non-frozen clarification**
- Date: 2026-09-01

## Decision

Publication is the first concrete tenant-owned resource. It is persisted in a
dedicated `publications` table; no generic polymorphic resource table is
introduced.

Publication creation requires an explicit trusted `tenantId`. Publication
lookup requires both `tenantId` and `publicationId` in the database predicate.
A foreign-Tenant identifier and a nonexistent identifier return the same
`null` repository result, without hydrating or disclosing the row.

This phase establishes database ownership and repository isolation only. The
B.2.0 resource-read policy remains a separate operation policy, while
audience evaluation and any Publication readability mapper are deferred to the
later controlled phase.
