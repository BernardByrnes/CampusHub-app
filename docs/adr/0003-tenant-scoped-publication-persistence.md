# ADR 0003: Tenant-Scoped Publication Persistence

- Status: **Accepted implementation decision — non-frozen clarification**
- Date: 2026-09-01

## Decision

Publication is the first concrete tenant-owned resource. It is persisted in a
dedicated `publications` table; no generic polymorphic resource table is
introduced.

Its canonical structural persistence includes closed `priority` values
(`standard` and `priority`), required nonempty office attribution, nullable
`publishAt`, nullable `expiresAt`, and a required closed `audienceMode`
(`entire_tenant` or `targeted`), alongside its type, body, visibility, and
lifecycle. `audienceMode` has no silent database default. Image/attachment
media fields remain deferred to the later media/content phase.

Publication creation requires an explicit trusted `tenantId`. Publication
lookup requires both `tenantId` and `publicationId` in the database predicate.
A foreign-Tenant identifier and a nonexistent identifier return the same
`null` repository result, without hydrating or disclosing the row.

The B.2.2 read chain is deliberately layered: the tenant-scoped repository
loads the Publication, a pure mapper combines it with server-resolved
`ResolvedTenantReadFacts`, a governed content-exposure seam, and an explicit
evaluated targeted-audience decision, and the server-only application service
passes the resulting `ResourceAccessFacts` to the canonical B.2.0
`authorizeResourceRead` policy. Denied service results are code-only; a read
does not mutate the Publication or trigger lifecycle transitions.

The mapper treats drafts and all scheduled Publications as unreadable, requires
a historical `publishAt` for direct reads, and allows published, expired, and
archived Publications when content is not suppressed. `expiresAt` alone does
not deny direct/archive reads. Targeted cohort evaluation, scheduling or
auto-publish jobs, expiry jobs, corrections, moderation workflows, transport
routes, search, notifications, and media remain deferred to later phases.
