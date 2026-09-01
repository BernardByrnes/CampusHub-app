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
| `RequestContext.tenantId` | Trusted active context | One active Tenant UUID; no Tenant list. | `CURRENT` |
| `RequestContext.membershipId` | Trusted active context | One active Membership UUID for `RequestContext.tenantId`. | `CURRENT` |
| `publication.id` | Publication resource | PostgreSQL UUID primary key; direct and collection reads are Tenant-scoped. | `CURRENT` |
| `publication.tenantId` | Publication ownership | PostgreSQL UUID FK to `tenant.id`. | `CURRENT` |
| `Publication collection cursor.id` | Keyset position | Opaque encoded Publication UUID position; not an authority or Tenant override. | `CURRENT` |
| `Publication collection cursor.publishAt` | Keyset position | Encoded timestamp paired with cursor ID for deterministic ordering. | `CURRENT` |
| `memberships.tenant_id -> tenants.id` | Database ownership FK | `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |
| `publications.tenant_id -> tenants.id` | Database ownership FK | `ON DELETE RESTRICT`, `ON UPDATE CASCADE`. | `CURRENT` |

The current ID-bearing Tenant-owned models are therefore `memberships` and
`publications`, with `tenants` as their Tenant root. There is no current Global
User, account, session, credential, OAuth, or MFA table.

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
