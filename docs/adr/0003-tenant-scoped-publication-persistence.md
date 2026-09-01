# ADR 0003: Tenant-Scoped Publication Persistence

- Status: **Accepted implementation decision — non-frozen clarification**
- Date: 2026-09-01

## Decision

Publication is the first concrete tenant-owned resource. It is persisted in a
dedicated `publications` table; no generic polymorphic resource table is
introduced.

Its canonical structural persistence includes closed `priority` values
(`standard` and `priority`), required nonempty office attribution, nullable
`publishAt`, and nullable `expiresAt`, alongside its type, body, visibility,
and lifecycle. Image/attachment media fields remain deferred to the later
media/content phase.

Publication creation requires an explicit trusted `tenantId`. Publication
lookup requires both `tenantId` and `publicationId` in the database predicate.
A foreign-Tenant identifier and a nonexistent identifier return the same
`null` repository result, without hydrating or disclosing the row.

This phase establishes database ownership and repository isolation only. The
B.2.0 resource-read policy remains a separate operation policy, while
audience evaluation and any Publication readability mapper remain deferred to
B.2.2. Publication scheduling, expiry jobs, corrections, and moderation
workflows are also outside this persistence correction.
