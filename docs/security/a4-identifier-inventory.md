# 8V-B.A4 Identifier Inventory

## Classification and boundary

This inventory covers identifiers visible in the current production foundation
and future identifier classes required by the frozen authority. It deliberately
does not invent formats for future identifiers. `CURRENT` means the identifier
exists in current schema, domain, repository, context, or collection code.
`FUTURE_REQUIRED` means the frozen product contract requires a later identifier
class but the implementation is not present. `FORBIDDEN_GLOBAL_BEHAVIORAL_LINK`
means an identity identifier must not be used as a cross-Tenant behavioral join
key, even if a future account model contains it.

## Current identifiers

| Identifier | Owner/surface | Current representation or use | Classification |
| --- | --- | --- | --- |
| `tenant.id` | Tenant root and Tenant-bound foreign keys | PostgreSQL UUID primary key. | `CURRENT` |
| `tenant.slug` | Tenant lookup/routing hint | Validated lower-case slug; not an authorization grant. | `CURRENT` |
| `identitySubjectId` | External/global identity seam | Opaque non-empty subject used with an explicit Tenant to locate Membership. | `CURRENT` |
| `RequestContext.identitySubjectId` | Trusted active context | Server-produced identity subject fact for one active Tenant. | `CURRENT` |
| `membership.id` | Membership resource | PostgreSQL UUID primary key; always read with Tenant scope. | `CURRENT` |
| `membership.tenantId` | Membership ownership | PostgreSQL UUID FK to `tenant.id`; determines Membership Tenant ownership. | `CURRENT` |
| `membership.identitySubjectId` | Membership-to-identity relation | Opaque subject relation, unique only with `membership.tenantId`. | `CURRENT` |
| `membership.campusId` | Membership Campus affiliation | Nullable PostgreSQL UUID paired with `membership.tenantId` for a same-Tenant Campus FK; null is a transitional incomplete state. | `CURRENT` |
| `membership.academicDivisionId` | Membership Academic Division affiliation | Nullable PostgreSQL UUID paired with `membership.tenantId` for a same-Tenant Academic Division FK. | `CURRENT` |
| `membership.programmeId` | Membership Programme affiliation | Nullable PostgreSQL UUID paired with `membership.tenantId` and `membership.academicDivisionId` for a same-Tenant Programme/Division FK. | `CURRENT` |
| `membership.residenceId` | Membership Residence affiliation | Nullable PostgreSQL UUID paired with `membership.tenantId` for a same-Tenant Residence FK; absent for unknown and non-resident states. | `CURRENT` |
| `RequestContext.tenantId` | Trusted active context | One active Tenant UUID; no Tenant list. | `CURRENT` |
| `RequestContext.membershipId` | Trusted active context | One active Membership UUID for `RequestContext.tenantId`. | `CURRENT` |
| `publication.id` | Publication resource | PostgreSQL UUID primary key; direct and collection reads are Tenant-scoped. | `CURRENT` |
| `publication.tenantId` | Publication ownership | PostgreSQL UUID FK to `tenant.id`. | `CURRENT` |
| `campus.id` | Campus resource | PostgreSQL UUID primary key; stable across label changes and owned by one Tenant. | `CURRENT` |
| `campus.tenantId` | Campus ownership | PostgreSQL UUID FK to `tenant.id`; downstream references use the Tenant-first composite identity. | `CURRENT` |
| `academicDivision.id` | Academic Division resource | PostgreSQL UUID primary key; stable across label changes and non-destructive merges. | `CURRENT` |
| `academicDivision.tenantId` | Academic Division ownership | PostgreSQL UUID FK to `tenant.id`; parent and merge references remain Tenant-local. | `CURRENT` |
| `academicDivision.parentAcademicDivisionId` | Academic Division hierarchy | Nullable PostgreSQL UUID paired with `academicDivision.tenantId` for a same-Tenant composite FK. | `CURRENT` |
| `academicDivision.mergedIntoAcademicDivisionId` | Academic Division merge metadata | Nullable PostgreSQL UUID paired with `academicDivision.tenantId` for a same-Tenant composite FK. | `CURRENT` |
| `programme.id` | Programme resource | PostgreSQL UUID primary key; stable across label changes and non-destructive merges. | `CURRENT` |
| `programme.tenantId` | Programme ownership | PostgreSQL UUID FK to `tenant.id`; downstream references use the Tenant-first composite identity. | `CURRENT` |
| `programme.academicDivisionId` | Programme affiliation | PostgreSQL UUID paired with `programme.tenantId` for a same-Tenant Academic Division FK. | `CURRENT` |
| `programme.mergedIntoProgrammeId` | Programme merge metadata | Nullable PostgreSQL UUID paired with `programme.tenantId` for a same-Tenant composite FK. | `CURRENT` |
| `residence.id` | Residence resource | PostgreSQL UUID primary key; stable optional Residence identity. | `CURRENT` |
| `residence.tenantId` | Residence ownership | PostgreSQL UUID FK to `tenant.id`; no `non_resident` Residence row is inferred. | `CURRENT` |
| `tenantAcademicYearConfig.tenantId` | Tenant academic-year configuration | PostgreSQL UUID one-to-one primary key and FK to `tenant.id`. | `CURRENT` |
| `Publication collection cursor.id` | Keyset position | Opaque encoded Publication UUID position; not an authority or Tenant override. | `CURRENT` |
| `Publication collection cursor.publishAt` | Keyset position | Encoded timestamp paired with cursor ID for deterministic ordering. | `CURRENT` |
| `memberships.tenant_id -> tenants.id` | Database ownership FK | `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `memberships.(tenant_id,campus_id) -> campuses.(tenant_id,id)` | Same-Tenant Membership Campus FK | Composite affiliation constraint; `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `memberships.(tenant_id,academic_division_id) -> academic_divisions.(tenant_id,id)` | Same-Tenant Membership Academic Division FK | Composite affiliation constraint; `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `memberships.(tenant_id,programme_id,academic_division_id) -> programmes.(tenant_id,id,academic_division_id)` | Same-Tenant Membership Programme/Division FK | Composite affiliation constraint; `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `memberships.(tenant_id,residence_id) -> residences.(tenant_id,id)` | Same-Tenant Membership Residence FK | Composite affiliation constraint; `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `publications.tenant_id -> tenants.id` | Database ownership FK | `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `campuses.tenant_id -> tenants.id` | Database ownership FK | `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `academic_divisions.tenant_id -> tenants.id` | Database ownership FK | `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `academic_divisions.(tenant_id,parent_academic_division_id) -> academic_divisions.(tenant_id,id)` | Same-Tenant parent FK | Composite ownership constraint; `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `academic_divisions.(tenant_id,merged_into_academic_division_id) -> academic_divisions.(tenant_id,id)` | Same-Tenant merge FK | Composite ownership constraint; `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `programmes.tenant_id -> tenants.id` | Database ownership FK | `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `programmes.(tenant_id,academic_division_id) -> academic_divisions.(tenant_id,id)` | Same-Tenant Programme affiliation FK | Composite ownership constraint; `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `programmes.(tenant_id,merged_into_programme_id) -> programmes.(tenant_id,id)` | Same-Tenant merge FK | Composite ownership constraint; `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `residences.tenant_id -> tenants.id` | Database ownership FK | `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `tenant_academic_year_config.tenant_id -> tenants.id` | One-to-one ownership FK | `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |

The current ID-bearing Tenant-owned models are `memberships`, `publications`,
`campuses`, `academic_divisions`, `programmes`, `residences`, and
`tenant_academic_year_config`, with `tenants` as their Tenant root. There is no
current Global User, account, session, credential, OAuth, or MFA table.

## Future identifier classes

| Identifier class | Intended owner/use boundary | Classification |
| --- | --- | --- |
| Global User ID | Global account identity and security/account operations only. | `FUTURE_REQUIRED` |
| Tenant-local analytics pseudonym | Tenant-local analytics events, reports, and approved exports. | `FUTURE_REQUIRED` |
| Verification evidence identifiers | Tenant Membership assurance/evidence records. | `FUTURE_REQUIRED` |
| Poll participation receipt identifiers | Tenant-local poll participation and privacy mechanism. | `FUTURE_REQUIRED` |
| Voice identity-access/audit identifiers | Separately granted, audited Tenant-local Voice identity access. | `FUTURE_REQUIRED` |
| XP/Streak source identifiers | Tenant-local ledger/source and idempotency attribution. | `FUTURE_REQUIRED` |
| Notification identifiers | Tenant-local notification, preference, delivery, and grouping records. | `FUTURE_REQUIRED` |
| Privileged role/grant identifiers | Tenant-scoped RoleGrant, term, revocation, and governance records. | `FUTURE_REQUIRED` |
| Audit-event identifiers | Scoped immutable audit/security-event records. | `FUTURE_REQUIRED` |

No concrete format is prescribed for these future classes by A4.

## Forbidden global behavioral links

| Identifier/link | Prohibited use | Classification |
| --- | --- | --- |
| `identitySubjectId` as a behavioral key | Must not key global XP, Level, Streak, Poll, Voice, event, opportunity, notification, engagement, or behavioral analytics stores. | `FORBIDDEN_GLOBAL_BEHAVIORAL_LINK` |
| Future Global User ID as a behavioral key | Must not join Tenant behavior across universities or enter Tenant behavioral reports/exports. | `FORBIDDEN_GLOBAL_BEHAVIORAL_LINK` |
| Global account/contact identifier as a Tenant profile key | Must not replace `tenantId + membershipId` or an approved Tenant-local pseudonym. | `FORBIDDEN_GLOBAL_BEHAVIORAL_LINK` |

Tenant behavioral stores must anchor through `tenantId + membershipId` or an
approved Tenant-local pseudonym. Account recovery and security communication
may use the global account boundary, but must remain neutral about Tenant
Memberships and activity.

## Ownership notes

- `tenant.id` is a root/ownership identifier, not a global behavioral key.
- `membership.id` is a Tenant-local resource identifier and is never exposed
  as evidence that another Tenant Membership exists.
- `identitySubjectId` may locate one Membership only when paired with the
  active Tenant; its global scope does not authorize a Membership list.
- A cursor contains position only. Its ID/timestamp cannot override the
  requested Tenant scope.
- Future audit, export, analytics, notification, jobs, search, cache, media,
  and Auth identifier classes require their own reviewed Tenant boundary.
