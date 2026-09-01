# ADR 0002: Resource Read Lifecycle Defaults

- Status: **Accepted implementation decision — non-frozen clarification**
- Date: 2026-09-01

## Authority

This record applies the frozen `CampusHub_Product_Specification_v1.2_FROZEN.md`
and then the lower-authority
`CampusHub_Canonical_Prototype_Blueprint_v1.2_FROZEN.md`. Where they differ,
the Product Specification rule that audience is enforced for READ exposure wins.
The frozen files remain unchanged.

## Decision

The generic resource-read policy uses exactly `PUBLIC`, `MEMBERS`, and
`VERIFIED_MEMBERS`. PUBLIC is still inside an explicit Tenant boundary and
requires the Tenant public-surface fact. MEMBERS requires a read-eligible
Membership and assurance `L1` or higher. VERIFIED_MEMBERS requires a
read-eligible Membership and assurance `L2` or higher. Both member-only
visibilities also require the pre-evaluated audience fact to pass.

The approved Pilot Membership read defaults are:

- `unverified`, `pending_review`, `verified`, `stale`, and
  `participation_suspended` retain member-only read eligibility subject to
  assurance.
- `on_leave` retains read by default through configurable `onLeaveReadEnabled`
  (default `true`).
- `alumni` is PUBLIC-only through configurable
  `alumniPublicReadEnabled` (default `true`); retained historical assurance
  does not grant current-student access.
- `transferred_out` and `closed` grant no member-only access, while PUBLIC may
  still pass public-view rules.
- `suspended` grants no Tenant-content access through that Membership context.

Tenant read uses normal policy for `pilot`, `active`, and `grace`; existing
readable content remains available read-only for `suspended`; and `archived`
requires an explicit `archiveNoticeState` of `ACTIVE` or `ENDED`. ACTIVE keeps
existing readable content available during notice; ENDED denies Tenant content.
The policy does not calculate notice duration.

This decision is limited to resource READ exposure. It does not authorize
participation, publishing, XP, polls, Voice, RSVP, Quiz, or any other write or
operation. A later controlled re-freeze may incorporate this clarification.
