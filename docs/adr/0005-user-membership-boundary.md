# ADR 0005: Global User and Tenant Membership Boundary

- Status: **APPROVED — INDEPENDENT SECURITY REVIEW 2026-09-02**
- Review decision: **A4_APPROVED_WITH_NONBLOCKING_OBLIGATIONS**
- Reviewed production SHA: `279a3b7d2f2e5fbe87e4d74025884ec9bd229060`
- Date: 2026-09-02
- Decision owner: independent security review
- Scope: 8V-B.A4 user/Membership boundary and identifier governance

## Authority and decision boundary

The frozen Product Specification is authoritative for this decision, especially
the Global User/Membership hard invariant in §10 and TI-12, the explicit active
Tenant context, Tenant-local notifications and analytics, transfer behavior,
support boundary, and audit/security constraints. ADR 0004 records the later
independent A2 approval at its historical reviewed SHA. This ADR records A4
only; it does not approve authentication, Global User persistence, or the later
B.2.4 implementation. B.2.4.1–.7 have since implemented Tenant-Membership-owned
audience behavior, and B.2.4.9 remains the required independent final review.

## Independent review record

The independent review decision is `A4_APPROVED_WITH_NONBLOCKING_OBLIGATIONS`.
Approval is limited to the Global User/Membership boundary and identifier
inventory contract at the reviewed SHA above. It does not authorize Global User
or Auth persistence, cross-Tenant behavioral joins, or any later phase.

The following obligations remain nonblocking for A4 and must be completed before
the relevant future surfaces are implemented:

- strengthen the global behavioral guard before Global User/Auth persistence;
- add negative tests for Auth, analytics, notifications, exports, jobs,
  recovery, support, admin, transfer, and closure surfaces;
- use Tenant-local analytics pseudonyms rather than global identity keys; and
- keep account recovery and security communication Tenant-neutral.

The current production foundation has no Global User, account, session,
credential, OAuth, or MFA persistence. It uses `identitySubjectId` as an
opaque external/global identity subject seam while Membership remains the
Tenant-owned record. A4 documents the future contract and adds governance and
negative evidence; it does not implement authentication.

## A. Global User purpose

A future Global User may identify one account across the product for
authentication and account/security operations only. Permitted account-level
concerns include credentials, verified contact channels, MFA and recovery
state, session/security state, consent/security records, and security
communication. A Global User must never become a cross-university behavioral
profile.

The current `identitySubjectId` is not a Global User table or a provider-specific
foreign key. Future Auth may produce this server-owned subject seam, but its
presence does not grant a Tenant, Membership, or operation authority.

## B. Tenant Membership purpose

A Membership represents the identity’s relationship with one Tenant and owns
university-specific profile, assurance, lifecycle, and behavioral data. The
current Membership fields are `id`, `tenantId`, `identitySubjectId`,
`assuranceLevel`, `lifecycle`, `campusId`, `campusProvenance`,
`academicDivisionId`, `academicDivisionProvenance`, `programmeId`,
`programmeProvenance`, `academicYear`, `academicYearProvenance`,
`residenceState`, `residenceId`, `residenceProvenance`, `createdAt`, and
`updatedAt`. These Campus, Academic Division, Programme, Academic Year, and
Residence affiliation/provenance fields remain Tenant Membership-owned. The
identifier inventory records which fields are identifiers, ordinary
attributes, or behavioral facts and how they are scoped.

## C. Active Tenant context

An application operation uses one deliberate active Tenant context. The server
resolves `identitySubjectId` plus an explicit Tenant ID or slug hint to one
Tenant and at most one Membership, then returns a trusted fact snapshot for
that Tenant only. The context contains no Membership list, no other Tenant
metadata, and no behavioral profile. Missing, nonexistent, or unavailable
Tenant scope remains the safe `TENANT_SCOPE_NOT_FOUND` boundary where the
current resolver applies that equivalence.

Tenant switching is an explicit future product action. Navigation must not
implicitly switch the active Tenant, and an API request must be authorized
against the explicitly active context.

## D. Multi-Membership isolation

For identity X with Membership A in Tenant A and Membership B in Tenant B:

- a Tenant A operation may resolve only Membership A;
- a Tenant B operation may resolve only Membership B;
- a Tenant A response must not reveal Membership B’s ID, Tenant ID/name,
  lifecycle, assurance, activity, count, or existence;
- a Tenant B response has the symmetric rule; and
- the identity’s global account seam must not be used to join Tenant behavior.

The Membership repository therefore exposes only Tenant-bound operations for
ordinary application flow: `findMembershipForIdentityAndTenant` and
`findMembershipByIdForTenant`. A future account-level Tenant switcher or
Membership discovery service requires separate design and must return no
behavioral data or unauthorized Tenant metadata.

## E. Identifier ownership

Current identifiers are inventoried in
`docs/security/a4-identifier-inventory.md`. Tenant IDs and Membership IDs are
Tenant-bound resource identifiers; `identitySubjectId` is an opaque global
identity seam used to locate a Membership only together with an explicit
Tenant. Publication IDs are Tenant-scoped. Collection cursors carry only a
keyset position and never carry authority or a Tenant override. Database
foreign keys preserve Tenant ownership from Memberships and Publications to
the Tenant root. B.2.4 also preserves same-Tenant ownership for typed hierarchy,
academic-year configuration, and normalized Publication audience criteria.

Future identifier classes remain unformatted until their governing phase
defines them. A global User ID may identify an account, but it is explicitly
forbidden as a cross-Tenant behavioral join key.

## F. Behavior ownership

All university-specific behavior belongs to the active Tenant Membership or to
a Tenant-local pseudonymous identity derived under a later reviewed contract.
The following are forbidden on a Global User and forbidden as global
cross-Tenant behavioral links:

- student number, campus, faculty/school/college, programme, year, residence;
- assurance/evidence history and Tenant profile;
- XP, Level, Streak, Poll participation, Voice activity, Event activity,
  Opportunity activity, and content engagement;
- notifications and Tenant-local analytics identity; and
- any global engagement score, student profile, behavioral export, or
  cross-Tenant behavioral aggregate.

The A4 governance test carries a deliberately small forbidden vocabulary for
future declared Global User/account persistence. It is a maintainable
guardrail, not a claim of a perfect static analyzer. With no such persistence
today, its current status is `NOT_IMPLEMENTED / FUTURE_OBLIGATION`.

## G. Support/admin access boundary

Support and administration require explicit Tenant context before displaying
Membership data. Ordinary tools must not offer a global “show me everything
this person does across universities” view. A future exceptional Platform
security capability must be separately governed, time-boxed where applicable,
explicitly scoped, and audited; it is not an ordinary Membership lookup.

## H. Notifications isolation

Product notifications are Tenant-local and grouped by Tenant. A global
identity with two Memberships does not receive one undifferentiated behavioral
notification stream. Security/account notifications may remain Tenant-neutral,
but they must not disclose a Tenant list, activity, role, assurance, or
behavioral history.

## I. Analytics identifier rules

`identitySubjectId`, and any future Global User ID, must not enter analytics
event stores, reports, exports, or behavioral aggregates. Future analytics use
a Tenant-local pseudonymous identifier, with its algorithm and schema deferred
to A11. A4 locks the boundary but does not generate or persist the pseudonym.

## J. Audit and log identifier limits

Future audit and security-event records may identify the relevant authorized
actor, Tenant, Membership, resource, and action only within the reviewed
scope. Ordinary logs and errors must not perform cross-Tenant behavioral joins,
expose another Membership ID, reveal a Membership count, or turn an error
message into a Tenant-existence oracle. Security/account events may be
Tenant-neutral where the frozen authority permits, but redaction, retention,
access, and tamper-evidence require later governance. A4 does not build a
logging subsystem.

## K. Exports

Future member-identifying exports require explicit Tenant context, scoped
authorization, requester/approver separation, and Tenant-bound artifact and
download identifiers. A Global User ID or `identitySubjectId` must not be used
to assemble a cross-Tenant behavioral export. Exports are not implemented.

## L. Background jobs

Future jobs that read or mutate Membership-owned data must carry explicit
Tenant context in durable input and execution state. There is no implicit
“all Tenants” behavioral job. A missing or mismatched Tenant context fails
before resource access. Jobs are not implemented.

## M. Account recovery and security communication

Account recovery, contact-channel verification, session security, and security
communication are global/account-level and Tenant-neutral. They must not
reveal a list of university Memberships, Tenant activity, XP, Poll or Voice
history, or Tenant roles. A recovery response must not confirm that an account
has a Membership in a particular Tenant. Auth and recovery are not implemented.

## N. Deletion and closure

Closing or deleting a Membership is not deleting the global account. Future
Membership closure must preserve the reviewed Tenant-local retention and
historical-attribution rules without converting behavior into a cross-Tenant
aggregate. Global account deletion must follow future legal, privacy, and
retention policy; it must not create a global behavioral profile as a shortcut.
No deletion workflow is implemented.

## O. Transfer

University transfer creates a new Membership in the destination Tenant.
Tenant-specific XP, Level, Streak, Poll participation, Voice history, and
other behavioral history do not transfer or merge. The old Membership moves to
the product-approved terminal state, such as `transferred_out` or `alumni`,
and historical attribution remains in the old Tenant. Transfer is not
implemented.

## P. Future Auth integration constraints

Future Auth integration must:

1. produce a server-owned opaque identity subject without making provider
   identifiers Tenant behavioral keys;
2. keep account credentials, contact verification, MFA, recovery, and session
   security separate from Membership profile/behavior;
3. require an explicit Tenant context for Membership resolution and operation;
4. preserve one-Membership trusted context output, not a Membership list;
5. prevent implicit Tenant switching and cross-Tenant behavioral joins; and
6. keep account recovery/security communication neutral about Tenant
   Memberships.

No Auth provider, SDK, tables, password storage, sessions, or MFA are added by
A4.

## Q. Negative-test requirements

The A4 leakage plan and architecture test must prove, for current surfaces,
same-identity dual Membership isolation, explicit Tenant A/B context output,
foreign Membership-ID null results, wrong/nonexistent equivalence, no
unscoped Membership lookup, no Membership list in RequestContext, safe
Publication direct/collection behavior, and non-leaking response/error shape.
Future logs, exports, analytics, notifications, account recovery,
support/admin, jobs, and transfer/closure workflows remain explicit
`FUTURE_OBLIGATION` tests and may not be treated as implemented evidence.

## Ownership matrix

| Ownership boundary | Allowed data/examples | Global behavioral restriction |
| --- | --- | --- |
| Global User/account level | Authentication credentials; verified contact channels; MFA; account recovery; sessions/security state; consent/security records. | No Tenant profile, activity, engagement, role, assurance, or behavioral history. |
| Tenant Membership | Student number; campus; faculty/school/college; programme; year; residence; assurance/evidence history; profile; XP; Level; Streak; Poll participation; Voice activity; Event activity; Opportunity activity; content engagement; notifications; Tenant-local analytics identity. | Every row and behavioral identifier is Tenant-local. These fields are forbidden on Global User. |

## Review boundary

This ADR is approved for A4 with the nonblocking future obligations recorded
above. It does not close those obligations or grant a new A2/A4 approval. A2
was subsequently independently approved at its historical reviewed SHA, which
unblocked B.2.4. B.2.4.1–.8 now implement and document Tenant-Membership-owned
targeted audience behavior; B.2.4 still awaits the final independent B.2.4.9
review.
