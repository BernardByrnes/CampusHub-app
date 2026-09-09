# OD-03 Implementation-Gate Timing Supersession

- Status: **APPROVED PRODUCT-OWNER CONTROLLED SUPERSESSION — AUTH ENGINEERING UNBLOCKED; INDEPENDENT SECURITY REVIEW REQUIRED BEFORE PROMOTION; PRIVACY/LEGAL REVIEW REQUIRED BEFORE PILOT**
- Date: 2026-09-09
- Scope: OD-03 timing for future Auth and contact-channel engineering
- Boundary record: `docs/architecture/adr/0007-contact-channel-provenance-boundary.md`
- Approved boundary candidate: `885dbb29c8b4ed92d9ba978714d357345f77ae30`

## Purpose and authority

This record is a narrow Product Owner-controlled supersession of the timing
gate attached to the OD-03 contact-channel provenance boundary. It does not
change the substantive boundary in ADR 0007, close OD-02, or modify the frozen
Product Specification. It records the later Product Owner instruction that
changes when engineering may begin while preserving hard security and
privacy/legal gates at the appropriate later stages.

The Product Owner expressly approved the OD-03 boundary at
`885dbb29c8b4ed92d9ba978714d357345f77ae30`:

- Global account owns contact-channel and account-security facts;
- Tenant Membership/evidence owns Tenant-specific provenance and assurance
  meaning;
- Tenant evidence binds to the exact verified contact-channel record;
- replacing or recovering a Global contact channel does not transfer Tenant
  provenance or assurance evidence;
- Membership assurance remains Tenant-derived; and
- Global contact-channel persistence must not become a cross-Tenant
  behavioural store.

Applicant-supplied, roster-supplied, and institutional-channel semantics remain
governed by the frozen Product Specification. OD-02 remains open.

## Previous timing gate

The prior OD-03 checkpoint treated formal Product Owner, identity/security, and
privacy/legal approvals as requirements that all had to be complete before Auth
engineering or verified-channel persistence could begin. That sequencing rule
was broader than the Product Owner's now-approved timing boundary.

## Superseding timing decision

The Product Owner supersedes that sequencing requirement as follows:

- Auth engineering may proceed using synthetic or controlled test identities
  and data after the Product Owner approval recorded above;
- no real student contact data may be processed during this engineering phase;
- no real roster onboarding, Pilot launch, or production student-data
  processing is authorized by this record; and
- no formal privacy/legal approval is claimed or implied.

This is a timing correction, not a new Auth design or a decision on credentials,
sessions, MFA, delivery vendors, or privileged non-student authority.

## Independent security promotion gate

Before any Auth implementation checkpoint is promoted, an independent,
read-only identity/security review remains mandatory. The established review
mechanism is `gpt-5.6-sol` at High reasoning. The review must cover the exact
candidate and, as applicable, credential and secret handling, sessions,
enumeration, token/OTP/MFA behavior, replacement and recovery, Tenant
interactions, identifier separation, privilege escalation, rate limits,
CSRF/session fixation, concurrency/replay, and security-event obligations.

Security review is a hard engineering promotion gate. A green technical test
run or Product Owner timing approval does not substitute for that review.

## Privacy/legal Pilot gate

Formal privacy/legal review remains open and mandatory before CampusHub
processes real student contact data in a Pilot or production environment. That
review must address the applicable lawful basis, notice, controller/processor
roles, retention and deletion, data rights, security-event retention,
cross-Tenant separation, provenance, vendors/subprocessors, and applicable
Ugandan or other binding requirements. This record does not state that any such
review has occurred.

## Remaining blockers and non-authorizations

The following remain outside this supersession:

- OD-02 privileged non-student Tenant authority;
- real roster import and university authorization;
- Pilot launch and real student-data processing;
- production SMS/email contractual approval and deployment;
- any unsupplied credential, session, MFA, token, delivery, or recovery
  product decision; and
- any other open decision, feature gate, legal gate, or security gate in the
  frozen governing documents.

This record authorizes no Auth code, users/contact-channel/session/credential
schema, migration, UI, transport, roster import, privileged-user persistence,
Pilot, or deployment. Those require their own bounded authorization and gates.

## Traceability

The substantive boundary remains in ADR 0007 and the A4 identifier inventory.
The controlled refreeze register records this timing supersession without
rewriting historical v1.3 text. Future Auth work must cite this record and the
ADR, use synthetic/controlled identities until the real-data gate is satisfied,
and stop for independent security review before promotion. The formal
privacy/legal Pilot gate remains open.
