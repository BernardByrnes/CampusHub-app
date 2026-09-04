# CampusHub Implementation Blueprint v1.3 — Refreeze Candidate

Status: **REFREEZE CANDIDATE — PENDING PRODUCT/ARCHITECTURE REVIEW**

Version: 1.3 candidate
Role: production HOW contract for the CampusHub application
Product authority: CampusHub Product Specification v1.2 — FROZEN, pending
explicit approval of the v1.3 Product Specification candidate

This document is a production Implementation Blueprint. It is not the
historical static-prototype Blueprint and it does not preserve prototype
implementation assumptions as production architecture. The Product
Specification defines WHAT and WHY. This document defines HOW the production
system may satisfy it. If they conflict, product authority wins and the
conflict is recorded for review.

The v1.2 frozen Product Specification and v1.2 frozen Canonical Prototype
Blueprint remain unchanged historical records. The static prototype remains a
separate repository/reference. Prototype constants, local state, demo types,
and screen conveniences are not production authority.

## 1. Authority, scope, and non-goals

The implementation authority order is:

1. applicable external binding authority;
2. approved/frozen Product Specification;
3. approved Product Owner decisions and controlled supersessions;
4. approved architecture/security ADRs;
5. independently approved checkpoint contracts; and
6. implementation.

This candidate incorporates the approved production-stack supersession in ADR
0001 and the approved A2, A4, and B.2.4 contracts. It does not re-approve
those checkpoints, change their reviewed SHAs, or authorize a product feature.

The current production foundation is a Next.js full-stack application with
Tenant, Membership, typed hierarchy, Publication persistence, canonical
audience contracts, and Tenant-safe direct/collection read orchestration.
Authentication, Global User persistence, Poll response persistence, XP,
Streak, Voice, Events, Opportunities, search, notifications, media, analytics,
exports, jobs, and publishing transport are not silently implied to exist.

## 2. Production architecture

The production request path is:

~~~text
Browser
  -> Next.js Server Components / Route Handlers / Server Actions
  -> application services
  -> authorization and domain policies
  -> repositories
  -> Drizzle ORM
  -> PostgreSQL
~~~

Next.js hosts the production backend/runtime. The production application is
not a Next.js-to-Django/DRF system. The Django/DRF direction is a historical
prototype-era statement superseded by ADR 0001 and is recorded as such in the
controlled refreeze record.

Transport layers remain thin. They validate untrusted input, obtain the
server-owned context, call an application service, map a safe result, and do
not contain the source of truth for Tenant, Membership, assurance,
authorization, lifecycle, audience, XP, or audit decisions.

Server Components are the default. Client Components are interaction islands,
not authorization boundaries. A client-supplied Tenant ID, Membership ID,
assurance value, lifecycle value, audience decision, role, or count is data
only and never authority.

## 3. Layer responsibilities

### 3.1 Transport and Next.js boundary

Route Handlers, Server Actions, and Server Components:

- accept and validate untrusted request data;
- obtain identity and explicit Tenant hints from server-owned boundaries;
- resolve or reject RequestContext;
- invoke application services;
- return safe resource or error shapes; and
- never perform an unscoped data query or client-authoritative policy decision.

### 3.2 Application layer

Application services orchestrate use cases, enforce sequencing, select the
required policy, and own transaction boundaries for mutations. They do not
reconstruct authorization from UI state or compose a readiness/count result
into reader authorization.

### 3.3 Domain layer

Domain types and pure policies define closed vocabularies, lifecycle
semantics, assurance comparison, canonical visibility/audience evaluation,
participation evaluation, error families, and state-transition invariants.
Pure evaluators do not perform I/O, clock lookup, persistence, or mutation.

### 3.4 Repository and database layer

Repositories expose explicit Tenant-bound operations. They apply Tenant and
resource predicates together, map database rows into validated domain facts,
and use Drizzle/PostgreSQL transactions and constraints for persistence and
concurrency. An ordinary unscoped resource-by-ID repository method is not a
production contract.

## 4. Trust boundaries

### 4.1 Browser boundary

The browser can hold presentation and draft state only. It cannot grant
Tenant scope, Membership, assurance, capability, visibility, audience
eligibility, XP, finalization, or lifecycle authority. A continuation or
return-to-action value is validated and cannot become an open redirect.

### 4.2 Identity boundary

The current foundation accepts an opaque identitySubjectId seam. It is not a
Global User table, credential, session, JWT, OAuth, or MFA implementation.
Future Auth must produce a server-owned subject and must not turn it into a
cross-Tenant behavioural key.

### 4.3 Trusted RequestContext boundary

RequestContext resolution binds:

- one authenticated identity subject;
- one explicit Tenant;
- one Tenant lifecycle status;
- at most one Membership in that Tenant;
- the Membership lifecycle status; and
- the Membership assurance level.

The resolver returns a complete trusted fact snapshot or a code-only failure.
It does not grant operation authority. Operation eligibility is a separate
policy decision.

### 4.4 Database boundary

PostgreSQL is the durable source for current foundation data. Tenant
ownership, same-Tenant references, closed values, required fields, and
expected-version constraints are explicit in the schema and migrations.
Application policy remains necessary; database scope alone is not sufficient.

## 5. Persistence principles

### 5.1 Ownership and identifiers

Tenant-owned identifiers are stable UUIDs and are always used with Tenant
scope. Tenant slugs are validated routing hints, not authorization grants.
Membership identity is unique only with Tenant ownership. Cursors carry
position only and cannot override requested Tenant scope.

The current Tenant-owned model set is:

- tenants as the Tenant root;
- memberships;
- campuses;
- academic_divisions;
- programmes;
- residences;
- tenant_academic_year_config;
- publications; and
- publication_audience_criteria.

Each child resource is declared in the Tenant-surface registry and receives
Tenant-negative evidence. Future jobs, exports, search indexes, caches, media,
notifications, analytics, and backup/restore surfaces require their own
reviewed registration and negative tests.

### 5.2 Typed hierarchy

Production uses typed relational tables for Campus, Academic Division,
Programme, Residence, and Tenant academic-year configuration. Stable IDs
survive label changes. Academic Division supports the explicit one- or
two-level contract. Same-Tenant composite foreign keys protect parent,
programme, merge, and Membership affiliation relationships.

Residence is an optional real Tenant entity. Membership residence state
supports resident, non_resident, and unknown semantics; non_resident is a
first-class Membership state and never creates a fabricated Residence row.
Historical attribution, label history, and broad hierarchy mutation remain
separate future contracts.

### 5.3 Membership affiliation and provenance

Campus, Academic Division, Programme, Academic Year, and Residence facts are
owned by Membership. Each field carries its own provenance. An incomplete or
ambiguous field does not become an authoritative audience fact. The
identitySubjectId is not a substitute for Membership + Tenant.

The approved provenance values are roster_derived, institution_verified,
self_declared, and optional where the field is absent. Audience policy may
require authoritative_only or may allow self-declared values. The evaluator
fails closed for unknown, malformed, foreign, incomplete, or disallowed
provenance.

### 5.4 Publication persistence

There is one Publication domain entity. It has:

- type notice or news;
- priority standard or priority;
- lifecycle;
- visibility;
- audience mode;
- attribution;
- publishAt and optional expiresAt;
- stable Tenant-owned identity; and
- expected version for mutable transitions.

Priority is not a separate production entity. The numeric Priority Notice cap
remains an open product/security decision.

Normalized audience criteria use the five approved dimensions:
campus, academic_division, programme, academic_year, and residence. A
dimension is represented once; values inside a dimension are ORed and
dimensions are ANDed. Residence targets are specific_residence, any_resident,
and non_resident. Criteria are Tenant- and Publication-bound and use
same-Tenant target foreign keys. Entire-Tenant mode has no criteria; targeted
mode has at least one valid group.

### 5.5 Migration discipline

The append-only current migration history ends at
drizzle/0008_loving_dagger.sql. No migration is introduced by this Blueprint
candidate. Existing migrations are not rewritten. Future mandatory-column
changes on populated tables use an expand/backfill/contract-safe process.

The approved A2 contract does not require RLS for the current gate. That
decision is preserved; absence of RLS is not permission to omit application
Tenant predicates, repository scoping, or negative tests.

## 6. Request context and operation eligibility

Request context is resolved before Tenant-owned work:

1. validate the authenticated identity subject;
2. validate the explicit Tenant ID or slug hint;
3. look up the Tenant;
4. load Membership by identity subject plus Tenant;
5. validate Tenant, Membership, lifecycle, assurance, and identity joins; and
6. return the complete trusted snapshot or a safe code-only failure.

A missing, malformed, unavailable, foreign, or mismatched join fails closed.
Context resolution must not return a partial object. After context resolution,
the operation policy separately checks:

- Tenant lifecycle;
- Membership lifecycle and safety state;
- capability and grant expiry;
- resource Tenant ownership and scope;
- visibility and exposure;
- assurance;
- audience or frozen cohort; and
- story-specific prerequisites.

Trusted context is therefore not equivalent to operation eligibility. For
example, stale or participation_suspended facts may remain readable under the
approved read policy while participation is denied.

## 7. Authorization architecture

Authorization is centralized in domain/application policy and defaults to
deny. A role is a bundle of capabilities; it is not a bypass around Tenant,
resource, lifecycle, assurance, audience, or audit rules.

Privileged grants are Tenant-scoped, time/term-bound, MFA-protected where the
product requires, and revocable immediately server-side. Capability bootstrap,
the first holder, privileged non-student principal shape, and emergency
Custodian authority remain open decisions OD-01, OD-02, and OD-06.

The canonical read decision has two ordered layers:

1. Tenant, lifecycle, visibility, exposure, viewer, and resource facts are
   checked before audience resolution; then
2. the canonical audience decision and final resource-read policy are applied.

Audience readiness/count is not a substitute for reader authorization.
Readiness is scalar, has no recipient identity projection, and is never a
capability grant.

## 8. Canonical resource reads

### 8.1 Direct reads

The production direct Publication path is:

1. validate input and trusted context;
2. load the Publication with exact Tenant ID + Publication ID;
3. normalize missing/foreign rows to safe NOT_FOUND;
4. resolve governed content exposure;
5. map pre-audience resource facts;
6. apply visibility, lifecycle, viewer, Tenant, and assurance policy;
7. load and validate persisted audience definition for targeted content;
8. load current Membership audience facts;
9. evaluate the canonical audience; and
10. apply final resource-read policy before returning the Publication.

The client does not receive data for a visibility failure. A targeted
audience failure does not broaden to entire Tenant. The direct resolver
requires returned Membership facts to match both the bound Tenant and exact
viewer Membership ID.

### 8.2 Collections

ACTIVE and ARCHIVE collections use a Tenant-bound, bounded, keyset-paginated
candidate query ordered by publishAt DESC and id DESC. Candidate reads,
exposure, pre-audience authorization, set-based targeted resolution, and final
canonical policy are performed in that order. Hidden or ineligible rows are
excluded without leaking their existence, title, count, or metadata.

No unbounded scan, OFFSET-only pagination, per-item direct-read loop, or
readiness/count call is an authorization shortcut. Cursors are position only.

### 8.3 Visibility, audience, search, and delivery

PUBLIC, MEMBERS, and VERIFIED_MEMBERS remain separate visibility values.
MEMBERS normally requires a read-eligible Membership at L1 or higher; L0
does not automatically receive normal members-only content. Audience remains
an independent targeted/actionability axis.

Search, cache, media, notifications, exports, and analytics are future
Tenant surfaces. Each must apply its own reviewed Tenant, visibility,
exposure, audience, and data-minimization contract before it is implemented.
Client-side filtering may only operate over an already authorized bounded
result set.

## 9. Targeted-audience evaluation

The canonical audience definition is validated for exact shape before use.
Unknown dimensions, duplicate dimensions, malformed UUIDs, duplicate values,
unknown Residence states, missing required facts, foreign Tenant IDs, invalid
provenance, empty targeted groups, and stray criteria on entire_tenant fail
closed.

For targeted Publications, the same validated definition is used for:

- target validity;
- scalar Membership estimation/count; and
- final eligibility evaluation.

No recipient list or Membership identity is returned by a count/estimate.
Current live Membership facts are used for ordinary Publication reads; the
eventual publish contract must snapshot target labels at publish time.

## 10. Publication mutation and concurrency

Application services own mutation policy and call repositories through explicit
Tenant-bound operations. Repositories own persistence details and transaction
handles. Transport does not decide whether a Publication may be created,
published, retracted, or broadened.

Draft/scheduled targeted criteria replacement:

- locks the Tenant-bound Publication;
- checks lifecycle and expected version;
- validates the complete replacement definition;
- updates mode, criteria, and version atomically; and
- returns VERSION_CONFLICT for a stale writer.

Published, expired, and archived audience definitions are immutable. A broader
message is a new Publication.

Readiness and confirmation use one transaction-consistent snapshot. The
Publication row is locked by exact Tenant + Publication ID; the criteria,
target validity, and scalar count use the same transaction/database handle and
one reconstructed canonical definition. Confirmation validates the locked
version, target validity, and count before releasing the transaction.

The future authoritative publish transition must perform confirmation inside
the same transaction as the lifecycle change. It must not read readiness,
release the lock, and publish later. Scheduled fire must reauthorize current
Tenant, capability, Guild Term, lifecycle, target validity, and version; it
holds/fails closed instead of broadening invalid targeting.

Real publication create/publish capability authorization and external publish
transport remain deferred. The SMALL AUDIENCE FLOOR numeric value remains
unresolved.

## 11. Concurrency, idempotency, and side effects

High-impact transitions are single-winner operations. Expected versions,
row/table locks, unique constraints, and transaction boundaries are selected
for the invariant at issue. A stale writer receives a safe conflict and cannot
silently overwrite the current state.

Retry-sensitive operations use an idempotency key, source uniqueness, or both.
This applies to future membership creation/claim, RSVP, Poll participation,
Voice support, XP award, Quiz finalization, notification generation, export
generation, and role grants. Replaying the same intent returns the original
safe result; materially different reuse is IDEMPOTENCY_CONFLICT.

External email, notifications, exports, webhooks, and publish transports occur
after the durable business state commits unless their reviewed contract makes
delivery part of success. They are retryable and duplicate-safe. A failed
side effect does not silently roll back a committed business state.

## 12. Background jobs and SYSTEM work

Every future job carries explicit Tenant context in durable input and
execution state. At execution time it revalidates Tenant lifecycle,
Membership/resource state, capability or originating authority, expected
version,
idempotency, and current target validity. Missing context fails before
Tenant-owned work.

Scheduled publish, expiry, Poll open/close, Opportunity expiry, Membership
stale transitions, and Guild Term close require the SYSTEM transition policy
to be decided under OD-08. No job inherits human authority merely because it
was queued by a previously authorized actor. Invalid scheduled targeting is
held/fail-closed rather than broadened.

Outbox/delivery patterns remain a future implementation decision. No new
background implementation is created by this candidate.

## 13. Future Tenant surfaces

The following are governed future categories, not current loopholes:

| Surface | Required production boundary |
| --- | --- |
| Jobs | Explicit Tenant payload, reauthorization, retries, idempotency, and safe failure. |
| Exports | Tenant-scoped artifact, requester/approver separation, minimization, and audit. |
| Search | Tenant partition, server authorization, bounded results, and no unauthorized metadata. |
| Cache | Tenant namespace and authorization-aware invalidation. |
| Media | Tenant namespace, parent-resource authorization, safe content type, redaction/invalidation. |
| Notifications | Tenant-local streams and preferences; no merged cross-Tenant behaviour. |
| Analytics | Tenant-local pseudonym, suppression, definitions, and no Global User join. |
| Backup/restore | Confidential artifacts, privileged/audited restore, ownership/FK validation, and no cross-Tenant promotion. |

These surfaces require TI-1 registration and negative evidence before
implementation. Their absence is not evidence that the contract is resolved.

## 14. Audit, security, privacy, and data lifecycle

Audit is append-only and records privileged mutations, security-sensitive
access, verification, role changes, publication finalization/correction,
moderation, and break-glass activity as required by product authority. Public
content may be corrected, restricted, redacted, or removed while the minimum
audit record remains.

Logs, errors, analytics, counts, and security events minimize payloads. They
do not contain secrets, raw ballot selections, unnecessary Voice content,
contact lists, cross-Tenant metadata, or unauthorized Membership identities.
Durable redacted cross-Tenant security events are required before the first
externally exposed Tenant-scoped Route Handler or Server Action.

Media and attachment authorization follows the parent resource's visibility,
Tenant, and audience. Redaction invalidates future authorized access through
the reviewed media/cache/search/export paths. The system does not promise
remote deletion of bytes already downloaded to unmanaged devices.

Retention, deletion, anonymization, controller/processor status, hosting
location, minors, and data-rights procedures remain legal/product decisions.
No legal conclusion is invented here.

## 15. Product-specific implementation boundaries

### 15.1 Authentication and Global User

No Auth provider, Global User table, credentials, sessions, JWT implementation,
OAuth provider, MFA persistence, or account recovery implementation is
authorized by this candidate. Future Auth must preserve A4: account/security
data is separate from Tenant Membership behaviour.

### 15.2 Polls

Polls remain A1-gated. The implementation must not create response-selection
storage, ballots, tallies, response exports, or unlinkability claims until
the A1 architecture is approved. Participation accounting and any future XP
source must remain separate from selected-option storage.

### 15.3 Student Voice

Voice is disabled by default and requires its readiness gate, permitted
categories, staffed moderators, escalation, SLA, identity-access policy, and
separate moderation/public status models. It is not a global anonymous system
or a crisis service.

### 15.4 Events and Opportunities

If implemented, Events and Opportunities inherit the approved visibility,
Tenant, audience, and participation evaluator where the Product Specification
requires it. Events need lifecycle/cancellation/RSVP concurrency. Opportunities
need HTTPS validation and scam-vetting hard blocks. The Blueprint does not
invent a mandatory assurance requirement for an Opportunity.

### 15.5 XP, Streak, and Daily Quiz

If implemented, XP is Membership-local, append-only, source-unique, and
explainable. The Daily Quiz is server-authoritative, one attempt per
Tenant-timezone day, and idempotent. Streak uses the Tenant timezone, neutral
copy, and automatic recess pause. Numeric XP amounts, the daily cap, and quiz
grace window remain open where product authority leaves them open.

## 16. Tests and quality gates

Each production surface receives applicable:

- pure domain unit tests;
- application orchestration tests;
- PostgreSQL integration tests;
- Tenant-negative and wrong-Tenant equivalence tests;
- A4 dual-Membership leakage tests;
- permission/capability denial tests;
- invalid-shape and malformed-identifier tests;
- concurrency and stale-version tests;
- idempotency/retry tests;
- lifecycle and scheduled-transition tests;
- audit/data-minimization tests;
- migration immutability and current-head tests;
- accessibility, performance, resilience, and UI-state tests where applicable;
  and
- regression tests for every prior closed finding.

The A2 governance gate must discover governed models, production operations,
future surfaces, migrations, global exemptions, and required negative probes.
The A4 boundary test must keep Global User free of Tenant behaviour. B.2.4
evidence must cover Publication visibility, targeting, persistence, direct
reads, collections, readiness, count, confirmation, and isolation.

The current migration head remains drizzle/0008_loving_dagger.sql. No RLS
requirement is added by this candidate. A1/Poll and A10 remain separate gates.

## 17. Current implementation map

This inventory describes the current foundation; it is not a product approval:

| Area | Current state |
| --- | --- |
| Tenant/context | Tenant root, lifecycle, explicit context, and safe context resolution exist. |
| Membership | Tenant-bound identity/ID reads, lifecycle, assurance, and audience facts exist; no Global User persistence exists. |
| Hierarchy | Typed Campus, Academic Division, Programme, Residence, and academic-year configuration persistence exists. |
| Publication | Tenant-owned one-entity persistence, lifecycle/visibility fields, normalized audience criteria, replacement/versioning, direct reads, collections, readiness, and atomic confirmation exist. |
| Audience | Five dimensions, provenance policy, residence states, AND/OR validation, scalar count, and fail-closed evaluation exist. |
| Auth/capabilities | Provider and real privileged capability authorization are future work. |
| Polls | Product contract remains A1-gated; production response implementation is absent. |
| Events/Opportunities/Voice/Play | Product contracts exist in governing documents; production implementations are outside the current foundation. |
| Search/cache/media/notifications/analytics/exports/jobs/backups | Future governed surfaces; no implementation is implied. |

The independently reviewed checkpoint bindings remain historical:

- A2: approval at its recorded historical SHA;
- A4: A4_APPROVED_WITH_NONBLOCKING_OBLIGATIONS at
  279a3b7d2f2e5fbe87e4d74025884ec9bd229060; and
- B.2.4: B2_4_APPROVED_WITH_NONBLOCKING_OBLIGATIONS at
  84c58cc2b525e1061fb4652906968c54ac3a00b3, with closure documentation at
  7016c345d3c0d0b1052bb80821de73e3e29c5e25.

This v1.3 documentation candidate is after those reviews and does not rebind
any approval to its own commit.

## 18. Release and review discipline

No trust-sensitive checkpoint is self-approved. A change is reviewed against
an exact starting SHA, exact changed-file set, relevant tests, migration
state, and final SHA. Independent review binds to the implementation SHA
specified by that review, not to a later documentation or packaging commit.

The v1.3 candidates are not frozen. Product-owner, architecture, security,
legal, and relevant human review must explicitly approve the candidate before
it can replace v1.2 authority. Open decisions in the controlled refreeze
register remain blockers at their stated timing.

**REFREEZE CANDIDATE — PENDING PRODUCT/ARCHITECTURE REVIEW**
