# ADR 0007: Contact-Channel Provenance Boundary

- Status: **APPROVED BY PRODUCT OWNER — AUTH IMPLEMENTATION UNBLOCKED; INDEPENDENT SECURITY REVIEW REQUIRED BEFORE PROMOTION; PRIVACY/LEGAL REVIEW REQUIRED BEFORE PILOT**
- Date: 2026-09-09
- Scope: OD-03 ownership of contact-channel provenance between Global User and Tenant Membership/evidence

This ADR records the Product Owner-approved boundary for contact-channel
ownership and Tenant-specific verification evidence. It is documentation only.
It does not create Auth persistence, verified-channel persistence, or a new
assurance level. Under the controlled OD-03 implementation-gate timing
supersession, Auth engineering may proceed with synthetic or controlled test
identities only. This does not claim that identity/security or privacy/legal
review is complete: independent security review remains a hard gate before an
Auth implementation checkpoint is promoted, and privacy/legal review remains a
gate before a Pilot or processing real student contact data.

## Context and Product authority

The current Product authority separates the global account/security identity
from Tenant Membership and evidence. A contact channel can be owned by one
global account while its evidentiary meaning differs between Tenants. For
example, a verified email may support current-enrolment evidence in one
university while providing only contact or affiliation evidence in another.

OD-03 records the ownership boundary for that contact-channel provenance. The
Product Owner approval and the controlled timing supersession are recorded in
`docs/governance/od03-implementation-gate-supersession.md`.
The frozen Product Specification remains authoritative for the existing
applicant, roster, institutional-domain, assurance, and recovery semantics.
The A4 identifier inventory records the identifier ownership and prohibited
cross-Tenant uses. This ADR defines the boundary for future Auth or
verified-channel persistence; the timing supersession unblocks synthetic/test
engineering while preserving independent security promotion review and the
privacy/legal Pilot gate. It does not silently close OD-02 or any other open
decision.

## Decision

The Global User/account-security boundary owns the actual contact-channel
record. The Tenant Membership/evidence boundary owns the meaning of that
channel for a particular Tenant. A Tenant evidence record may reference the
exact Global contact-channel record that supplied the evidence, but the global
record must remain neutral about Tenant affiliation and behavior.

### Global account contact-channel ownership

A future Global contact-channel record may contain only account/security facts,
including where required:

- a stable contact-channel ID;
- the Global User/account ID;
- channel type (`email` or `phone`);
- the canonicalized channel value;
- ownership-verification state and `verifiedAt`;
- `createdAt` and `updatedAt`;
- security or recovery usability where separately authorized.

The global record may support a login identifier where the Product authority
allows it, account ownership verification, account recovery, security
notifications, and separately authorized MFA/recovery composition.

It must not contain Tenant ID, Membership ID, university-affiliation
provenance, roster source, institutional attestation, assurance level,
participation history, or Tenant behavioral data.

### Tenant Membership/evidence ownership

Tenant-scoped evidence may record that the exact verified channel was applicant
supplied, roster supplied, institutional-domain evidence, or another later
explicitly approved provenance type. It may carry only the narrowly required
facts, such as:

- Tenant ID and Membership ID;
- the exact referenced contact-channel ID;
- provenance type and evidence status;
- evidence or verification timestamp;
- Tenant attestation where required;
- the assurance consequence derived from Product rules.

The same email or phone may therefore have different evidentiary meaning in
different Tenants. Tenant evidence is never globalized merely because the
underlying channel record is global.

### Exact-channel binding

Evidence binds to the exact contact-channel record whose ownership was
verified. It must not bind to an informal value such as “the user’s current
email” or “the user’s current phone.” A replacement channel is a new security
fact and does not inherit the old channel’s Tenant evidence.

### Replacement, removal, invalidation, and recovery

When a Global contact channel is replaced, removed, invalidated, or otherwise
ceases to support the evidence on which Membership assurance depended, the
referencing Tenant evidence is not migrated automatically. If that evidence
was the sole support for an assurance level, the Membership becomes due for
assurance re-establishment or review under the existing Product rules.

A recovery or replacement channel proves ownership of that replacement
channel only. It does not inherit roster-supplied provenance, institutional
provenance, or Tenant assurance evidence.

### Assurance derivation

The Global contact channel owns no `L1`, `L2`, or `L3` assurance. Assurance is a
Membership-level conclusion derived from Tenant-specific evidence and the
frozen Product rules.

In particular:

- successful OTP for an applicant-supplied channel proves channel ownership,
  but does not by itself uplift Membership assurance;
- a roster-supplied channel may support `L3` when all existing Product
  requirements are met;
- an institutional domain may support `L3` only when the Tenant attests that
  access is reliably bound to current enrolment or status;
- a domain suffix alone proves nothing and cannot create unsupported assurance.

### Cross-Tenant and identifier controls

Global account security may know that one Global User has multiple Tenant
Memberships, but Global contact-channel storage must not become a cross-Tenant
behavioral store. Ordinary runtime repositories and APIs must not provide
cross-Tenant contact lookups such as finding Memberships by email or listing
Tenants using a contact channel.

The contact-channel ID is an account/security identifier. It may appear in a
Tenant Membership evidence record only as the exact reference needed to show
which verified channel supported that Tenant-specific provenance. It must not
be exposed as a student-facing cross-Tenant identifier, used for behavioral
aggregation, added to ordinary analytics/event/audit payloads for convenience,
or used as an alternative to Tenant + Membership authorization.

All Tenant evidence access therefore requires explicit `Tenant + Membership`
context. Existing A4 prohibitions on global behavioral links remain in force.

### Implementation obligations

Before future implementation:

1. keep Global contact-channel persistence separate from Tenant Membership
   evidence persistence;
2. bind evidence to an immutable contact-channel ID, not a mutable channel
   value;
3. prevent replacement, removal, or invalidation from silently transferring
   provenance or assurance;
4. require assurance re-establishment when the supporting evidence no longer
   exists;
5. enforce Tenant + Membership scope on every evidence read and mutation;
6. preserve the applicant, roster, institutional-attestation, and recovery
   semantics supplied by the Product authority;
7. add the exact identifier and prohibited-use rules to the A4 inventory;
8. keep privileged non-student authority governed by OD-02 and existing
   Membership-backed seams; and
9. keep the separate credential, session, delivery, MFA, and security decisions
   as explicit implementation and promotion gates; synthetic/controlled Auth
   engineering may proceed under the timing supersession, but real student
   contact data and Pilot/production processing remain blocked pending the
   required privacy/legal review.

No implementation obligation in this ADR authorizes a users table,
contact-channels table, sessions, credentials, OTPs, Auth routes, Auth UI,
email/SMS delivery, MFA, or privileged-user persistence in this checkpoint.

## Consequences

This boundary keeps account ownership and recovery facts reusable across
Tenants without globalizing university-specific meaning. It also makes channel
replacement explicit: ownership of a new channel is not proof of the old
channel’s provenance. The cost is that Tenant evidence must retain an exact
reference and may require review after channel invalidation, which is the
necessary consequence of preserving assurance correctness.

## Rejected alternatives

### A. Store all provenance globally

Rejected because university-specific evidentiary meaning would leak into
Global User/account state and create cross-Tenant coupling.

### B. Store email/phone independently on each Membership as the canonical account channel

Rejected because authentication and recovery would be duplicated and
inconsistent across Tenants, and replacement semantics would be unsafe.

### C. Transfer evidence whenever the User changes their contact channel

Rejected because a replacement channel has not inherited the evidence that
established the old channel’s Tenant provenance.

### D. Infer assurance from domain suffix alone

Rejected because the Product authority explicitly forbids that assumption.

## Out of scope

OD-03 does not decide password hashing, OAuth provider, magic-link versus
password login, session storage, MFA technology, OTP provider, email or SMS
vendor, token TTLs, rate limits, privileged non-student authority, or any
other OD-02 branch. Those require separate Product, architecture, security,
legal, or implementation decisions where applicable.

The substantive OD-03 boundary is approved by the Product Owner. The controlled
timing supersession does not claim identity/security or privacy/legal approval:
independent security review remains mandatory before promotion of an Auth
implementation checkpoint, and privacy/legal review remains mandatory before a
Pilot or processing real student contact data in production. OD-02 and its
privileged non-student authority branches remain open.
