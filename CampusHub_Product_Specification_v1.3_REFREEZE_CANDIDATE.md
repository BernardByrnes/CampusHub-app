# CampusHub Product Specification v1.3 — Refreeze Candidate

Status: **REFREEZE CANDIDATE — PENDING PRODUCT/ARCHITECTURE REVIEW**

Version: 1.3 candidate
Predecessor: CampusHub Product Specification v1.2 — FROZEN
Purpose: controlled reconciliation of the product contract with later approved
architecture and security decisions

This is a candidate successor, not a new freeze. The v1.2 Product
Specification remains the historical frozen product authority until an explicit
product-owner and architecture review approves this candidate. Nothing in this
candidate reopens or re-approves A2, A4, or B.2.4.

## 1. Authority and document boundary

The authority order for this candidate is:

1. applicable external binding authority;
2. the approved/frozen Product Specification;
3. approved Product Owner decisions and controlled supersessions;
4. approved architecture and security ADRs;
5. independently approved checkpoint contracts; and
6. implementation.

Until this candidate is explicitly approved, the v1.2 frozen Product
Specification remains the product authority. This candidate records the
intended controlled successor and the traceability needed for review.

The Product Specification defines WHAT the product is, WHY it exists, product
behaviour, trust promises, scope, and release gates. The v1.3 Implementation
Blueprint defines HOW production software may implement those contracts. The
Blueprint cannot silently override this specification. The static prototype
Blueprint is a historical design and interaction reference; its demo types,
constants, local state, and UI conveniences are not production contracts unless
this specification or a later approved decision says so.

The controlled supersessions and their supporting authority are recorded in the
controlled refreeze record. This document does not silently turn implementation
into authority.

## 2. Product definition

CampusHub is the digital home of student life: a multi-tenant SaaS product that
gives each university a verified, mobile-first place where students discover
what is happening on their campus, participate in campus life, and receive
privacy-safe recognition for doing so.

The product replaces scattered WhatsApp messages, noticeboards, social posts,
PDF circulars, and word of mouth with:

- verified university Membership at an honestly described assurance level;
- a canonical campus information layer for Publications, Events, Sports, and
  Opportunities;
- structured participation such as polls, RSVPs, saves, follows, and
  appropriately governed Student Voice;
- restrained XP, Level, Streak, and Daily Quiz mechanics; and
- measurable, privacy-safe evidence for the Guild and institution.

The product is licensed per university Tenant. The student experience is
mobile-first responsive web/PWA; administrator work is desktop-efficient and
responsive. CampusHub is not an LMS, SIS, academic-results portal,
course-registration system, payment rail, election platform, unrestricted
social network, chat application, anonymous confession service, marketplace,
or cross-university behavioural graph.

The product priority is:

1. KNOW — useful campus information;
2. PARTICIPATE — safe, meaningful action; and
3. PLAY — restrained return motivation.

PLAY must never dominate campus information or gate essential information.

## 3. Goals and principles

The product goals are:

- students return because CampusHub reliably tells them something useful;
- Guild and university communication can demonstrate defensible reach;
- membership and assurance claims match their evidence;
- students and institutions can understand how data and authority are handled;
- Tenant isolation is absolute across every product surface;
- a small campus communications team can operate the Pilot; and
- Pilot creates evidence without forcing a rewrite of trust-sensitive
  foundations.

The governing principles are:

- information first;
- isolation by architecture and negative evidence, not developer discipline;
- honest assurance;
- privacy that remains true under pressure;
- data minimisation;
- no dark patterns or purchasable progress;
- low-bandwidth practicality;
- software roles express agreed authority rather than creating it;
- audit history is immutable while public content may be corrected, restricted,
  redacted, or removed; and
- build the smallest product that produces useful evidence.

## 4. Release boundaries

### 4.1 Pilot

Pilot may include Tenant foundation, authentication and privileged MFA when
their blockers are cleared, roster verification, progressive profile,
Publications, Events, Opportunities, simple Sports, tenant-conditional Student
Voice, sponsorship, notifications, reduced analytics, transparency, Guild
Terms, audit, and the restrained Play features. Poll product behaviour remains
defined but implementation is blocked by A1.

Pilot does not include leaderboards, rewards, prizes, Campus Energy, sponsored
challenges, sports prediction, a general game engine, sponsor portals,
behavioural sponsorship targeting, web push, clubs as account-holding entities,
or speculative enterprise integrations.

### 4.2 Commercial V1

Commercial V1 adds the operational, legal, governance, reporting, continuity,
and support controls justified by Pilot evidence. It does not weaken the
Tenant, privacy, capability, or publication contracts.

### 4.3 Phase 2

Phase 2 features require a documented trigger. No Phase 2 feature is implied by
this candidate.

Release gates include cleared architecture and UX blockers before build,
reviewed Pilot metrics and no unresolved critical trust incident before
Commercial V1, and penetration testing, backup/restore validation,
data-protection decisions, and contractual governance before paid launch.

## 5. Personas and authority

The core personas remain:

| Persona | Product need |
| --- | --- |
| Student Member | Reliable, low-bandwidth campus information and safe participation. |
| Guild Publisher or Communications Secretary | Fast, scoped content authoring and publishing. |
| Guild Administrator | Tenant operations, governance, reporting, and correction authority. |
| University Official | Constrained official communication and institutional reporting under the licence. |
| Tenant Custodian | Continuity and emergency role authority, not an everyday student role. |
| Voice Moderator | Accountable, separately granted moderation authority. |
| Platform Operator | Provisioning, policy, support, and controlled break-glass authority. |
| Sports or Opportunities supplier | Narrow content scope without an account-holding organisation model in Pilot. |

Software roles cannot settle who appoints, grants, revokes, or overrides these
authorities. Capability bootstrap and privileged non-student authority remain
open decisions OD-01 and OD-02.

## 6. Tenant, identity, Membership, and assurance

### 6.1 Global User and Tenant Membership boundary

A future Global User/account may hold authentication, verified contact channels,
MFA, account recovery, session/security state, and security communication. It
must never become a cross-university behavioural profile.

Tenant Membership owns university-specific profile, assurance, evidence,
campus, academic hierarchy, programme, academic year, residence, behaviour,
XP, Level, Streak, Event activity, Opportunity activity, Poll participation,
Voice activity, notifications, and Tenant-local analytics identity.

There is no current Global User, credential, session, OAuth, MFA, or Auth
persistence contract in this candidate. The opaque identity subject is not a
Global User table and never grants access by itself.

### 6.2 Active Tenant context

Every Tenant operation uses one deliberate active Tenant context. A user with
multiple Memberships must explicitly switch context. The product never infers a
Tenant from navigation, a browser value, an email domain, or an identity
subject alone.

The trusted context contains one Tenant and at most one Membership for that
Tenant. It is a fact snapshot, not operation authority. The operation-specific
policy separately evaluates lifecycle, capability, resource scope, assurance,
audience, and other eligibility.

Missing, malformed, foreign, stale, or mismatched context fails closed. A
Tenant-A response must not reveal Tenant-B Membership IDs, existence, counts,
activity, assurance, or behaviour.

### 6.3 Membership lifecycle

The canonical Membership lifecycle is:

1. unverified;
2. pending_review;
3. verified;
4. stale;
5. on_leave;
6. alumni;
7. transferred_out;
8. participation_suspended;
9. suspended; and
10. closed.

Assurance is a separate Membership attribute. Current, Suspended, and
Completed are not replacements for this lifecycle; they may be presentation
labels only where an unambiguous mapping is approved. stale is a lifecycle
state, not merely an assurance timestamp.

Read, participation, publishing, notification, administration, and export
eligibility are separate decisions. A lifecycle fact is not a universal
authorization decision.

### 6.4 Assurance

The closed student assurance ladder is:

| Level | Meaning |
| --- | --- |
| L0 — Registered | Authenticated account with no credible current-affiliation proof. |
| L1 — Weak Affiliation | Invite/access-code or weak/manual evidence. |
| L2 — Roster Match | Details match an approved university roster. |
| L3 — Strong Institutional Proof | Roster match plus reviewed institutional contact or equivalent strong evidence. |

Assurance describes evidence, not aspiration. An applicant-supplied contact
channel proves control of that channel only. Institutional email alone does not
produce L3 without Tenant-attested identity binding, current-enrolment access,
or reliable revocation.

Privileged identity assurance is a separate track with named confirmation,
mandatory MFA, grant/term binding, and its own audit. It is not student L4.

### 6.5 Affiliation and residence

Campus, Academic Division, Programme, Academic Year, and Residence
affiliation/provenance belong to Tenant Membership. Residences are real
optional Tenant entities. non_resident is a first-class Membership residence
state and is not represented by a fabricated Residence row. An unknown
Residence remains distinct from non_resident.

## 7. Governance, capabilities, and permissions

Authorization is default-deny and capability-based. A decision considers:

- authenticated identity;
- explicit active Tenant and exact Membership context;
- active, unexpired, appropriately scoped capability;
- resource Tenant ownership and scope;
- lifecycle and module state;
- assurance where the story requires it; and
- audience, verified attributes, and story prerequisites.

Capability names include content.read, publication.create,
publication.edit, publication.publish, publication.priority_publish,
event.manage, opportunity.manage, opportunity.publish, poll actions,
verification decisions, member support, voice moderation, quiz management,
xp adjustment, sponsor controls, role grant/revoke, audit, export, and
tenant/platform operations. The capability list does not create authority that
has not been agreed in the licence or open-decision register.

Role grants expire with the applicable Guild Term. Privileged revocation takes
effect immediately server-side. A requester cannot approve their own
member-identifying export. Sponsorship creation and approval require distinct
authorized actors. Platform break-glass is exceptional, time-boxed, audited,
and never ordinary impersonation.

The first-holder bootstrap rule, grant-only-what-you-hold rule, and emergency
Custodian authority remain open where the product authority is insufficient.

## 8. Canonical read and participation rules

### 8.1 Visibility and audience are separate

Visibility answers who may reach or receive the resource. Audience answers
which in-Tenant cohort may act on or be targeted by it.

| Visibility | Product meaning |
| --- | --- |
| PUBLIC | An unauthenticated visitor may reach it only where the Tenant public surface permits. |
| MEMBERS | A read-eligible Membership at L1 or higher may reach it. L0 does not receive normal member-only content. |
| VERIFIED_MEMBERS | A read-eligible Membership meeting the Tenant verification bar, L2 by default, may reach it. |

Visibility is enforced before rendering, direct response, search, notification,
and media service. Audience does not broaden visibility. For ordinary targeted
Publications, unauthorized viewers do not receive the resource through a
collection or direct read. A resource intentionally visible to a broader cohort
may show a single audience-ineligible explanation when the viewer attempts an
action; this is not a universal rule for all resources.

### 8.2 Shared participation evaluator

Poll response, Voice submission, Voice support, RSVP, and Daily Quiz use one
canonical server-side participation evaluation in this order:

1. Tenant lifecycle;
2. module enabled;
3. resource exists and is actionable;
4. Membership lifecycle/safety state;
5. assurance;
6. audience or frozen cohort;
7. verified attributes; and
8. story-specific prerequisites.

The first failure produces one actionable primary reason. A stale,
participation_suspended, suspended, alumni, transferred_out, or closed
Membership is not mislabeled as an assurance failure. Client gates are
presentational and never grant authority.

### 8.3 Canonical error families

Product errors include NOT_FOUND, PERMISSION_DENIED, TENANT_SCOPE_NOT_FOUND,
VERSION_CONFLICT, INVALID_STATE, ALREADY_EXISTS, ALREADY_COMPLETED,
RATE_LIMITED, ASSURANCE_REQUIRED, TENANT_SUSPENDED, MODULE_DISABLED,
RESOURCE_NOT_ACTIVE, MEMBERSHIP_STATE_INELIGIBLE, AUDIENCE_INELIGIBLE,
PREREQUISITE_MISSING, and IDEMPOTENCY_CONFLICT. A safe not-found result must
not become a Tenant-existence oracle.

## 9. Publications and targeted information

### 9.1 One Publication entity

Production uses one Publication entity, not a separate PriorityNotice entity.
It carries:

- type: notice or news;
- priority: standard or priority;
- title, body, attribution, and optional media where the media phase permits;
- lifecycle, visibility, audience, publish time, and optional expiry; and
- schedule/version facts required for safe concurrent mutation.

Priority is a Publication attribute and behaviour. The Priority Notice
numeric cap remains unresolved; no prototype or recommendation may become a
production number without decision OD-10.

### 9.2 Publication lifecycle

The product lifecycle is draft, scheduled, published, expired, and archived.
Unpublished-with-reason, restricted, redacted, and removed are governed
availability outcomes and audit states, not silent deletion.

Draft and scheduled targeted criteria may be replaced under expected-version
protection. Published, expired, and archived audience definitions are
immutable. A stale mutation fails with VERSION_CONFLICT. Publication
correction, retraction, redaction, and removal preserve an immutable audit
history.

The eventual authoritative publish transition must confirm the audience within
the same transaction as the lifecycle transition. It must snapshot the
publish-time target labels. Scheduled fire must revalidate current Tenant,
capability, lifecycle, target validity, and audience; it must hold/fail closed
when targeting is no longer valid and must not broaden to entire Tenant.

The SMALL AUDIENCE FLOOR numeric value remains unresolved. The product requires
a scalar estimate and explicit confirmation, but this candidate chooses no
number.

### 9.3 Targeting contract

Targeted Publication dimensions are:

- campus;
- academic division;
- programme;
- academic year; and
- residence.

The allowed residence targets are a specific Residence, any resident, and
non_resident. Each dimension uses a reviewed provenance policy:
authoritative_only or allow_self_declared. Dimensions are ANDed; values within
one dimension are ORed. Unknown, malformed, incomplete, foreign, duplicate,
zero-criteria, or conflicting definitions fail closed. Entire-Tenant mode has
no criteria and targeted mode has at least one valid group.

Eligibility uses current live Tenant Membership facts and their per-field
provenance. It never uses a Global User or identity subject as a behavioural
shortcut. Counts are scalar and never return recipient identities, names,
emails, Membership IDs, or cross-Tenant metadata.

### 9.4 Publication read and collection behaviour

For a direct or collection read, Tenant scope, lifecycle, visibility, exposure,
viewer, and assurance facts are checked before targeted audience evaluation.
Foreign or hidden Publications behave as safe not-found/exclusion outcomes.
Collections are Tenant-bound, bounded, keyset-paginated, and apply the same
targeting rules to ACTIVE and ARCHIVE surfaces. Unauthorized candidates do not
enter targeted resolution and do not advance a disclosure-bearing result.

Search, notifications, media, analytics, and caches may not bypass the same
visibility, lifecycle, exposure, Tenant, and audience rules. Publication
audience readiness and confirmation are scalar, version-consistent, and
transactionally authoritative; they are not reader authorization shortcuts.

### 9.5 Events, Opportunities, and Sports

Where Events or Opportunities inherit Publication audience behaviour, they use
the same visibility-before-audience interpretation and canonical participation
gates. Ambiguous behaviour for another resource type remains OPEN.

Events support draft/published/postponed/cancelled/past-or-archived semantics,
Tenant audience, organiser attribution, and RSVP through the participation
evaluator. A cancelled Event wins over a later RSVP. An RSVP is idempotent,
Tenant-local, and aggregate-only in Pilot.

Opportunities use targetable campus information, an HTTPS external URL,
deadline expiry, and a recorded vetting process. Platform hard blocks for
fees, prohibited categories, and prohibited domains are not overridable.
Student-facing trust labels reflect a vetting process; no blanket
Verified opportunity claim is allowed unless product authority supports it.
No mandatory assurance gate is added merely because an Opportunity has an
audience.

Sports are Tenant-local. Production fixture states are scheduled, postponed,
cancelled, completed, and abandoned. Results are separately draft/published
with append-only correction history. A prototype Final label is not the whole
production state model.

## 10. Polls, Student Voice, and participation

### 10.1 Polls — separate A1 gate

Polls are non-binding student sentiment polls, never elections or secret-ballot
claims by implication. Product wording says Respond, Submit response, and
Response recorded. The product must not expose how a named student responded.
Results are aggregate and released only when the lifecycle and both privacy
floors permit.

The production response storage and request-path privacy/linkability design
remains blocked under A1. No selected-option persistence model, unlinkability
claim, poll response table, tally, export, or implementation is approved by
this candidate. The transparency copy must match the reviewed A1 design before
Poll implementation. Polls remain a separate gate and are not used to define
Publication semantics.

### 10.2 Student Voice

Student Voice is a Tenant-conditional campus issue channel, disabled by
default. It is not a confession board, anonymous chat, comments feed, or
crisis service. Only the permitted low-risk categories may be configured.

Submissions enter moderation before publication. The internal moderation
lifecycle is distinct from the student-visible status history. Published issues
are pseudonymous to peers; authorized identity access is capability-gated,
reasoned, audited, and never exposed to a University Official. Student Voice
support is one-per-Membership, count-only, idempotent, and zero XP.

Activation requires named accountability, at least two MFA-protected
moderators, category configuration, escalation contact, confirmed provisional
SLA, and licence conditions. A lapse auto-suspends new submissions and leaves
existing status visibility intact.

### 10.3 Participation

RSVP, saves, follows, Voice support, and other participation actions remain
server-authoritative and subject to the applicable canonical evaluator.
Resources may not bypass the evaluator merely because they lack an audience or
assurance override. L1 permission is not rewritten as an L2 roster-match
requirement without product authority.

## 11. Play, XP, and Streak

Play is restrained and never gates essential campus information.

The Daily Quiz is one Tenant-timezone quiz per day with server-authoritative
questions, answers, grading, one attempt, idempotent finalization, and a
future product-defined grace window. Prototype values such as +5 participation
and +5 accuracy are not immutable production constants unless separately
approved. The exact configurable amounts, bounds, grace window, and any
campus-specific unanswered behaviour remain OPEN where the v1.2 authority
leaves them open.

XP is Tenant-Membership-owned, explainable, append-only, idempotent, and
correctable by audited reversal/correction. Saves, follows, reads, and Voice
support do not create XP. The A10 daily XP cap remains unresolved; no numeric
cap or capped allocator is chosen here.

Levels are recognition only. They never gate information or participation.
Streak uses the Tenant timezone, neutral language, opt-in reminders, and an
automatic academic-recess pause. There is no purchasable or user-controlled
freeze in Pilot.

## 12. Notifications, search, transparency, and sponsorship

Notifications are Tenant-local and grouped by Tenant. A multi-Membership
identity never receives one merged behavioural stream. Critical security
messages use the approved security-channel policy; product notifications are
in-app first and are not bulk SMS.

Production search is Tenant-bound, server-authorized, visibility/audience
filtered, paginated, and bounded. Client filtering may operate only on an
already-authorized bounded result set. Unauthorized titles, snippets, counts,
existence, and media are not disclosed.

The Transparency page is generated from approved product and Tenant
configuration and must remain truthful to current settings. It is not
permanently static copy when the Product Specification requires
Tenant-specific disclosure. It must state the actual Poll privacy model,
Student Voice identity boundary, sponsor data boundary, retention position,
and the honest limit that unmanaged downloaded files cannot be remotely
deleted.

Sponsorship is labelled, broad-audience, Tenant-local, and free of behavioural,
demographic, assurance, Poll, Voice, Quiz, or browsing targeting. Sponsors
receive no named student data. Prohibited categories and domains are
platform-controlled and cannot be relaxed by a Tenant.

## 13. Privacy, abuse, operations, and data rights

Trust Invariants are product promises:

| ID | Invariant |
| --- | --- |
| TI-1 | No Tenant reaches another Tenant's private data through any product surface. |
| TI-2 | No normal product function reveals an individual's Poll response. |
| TI-3 | Sponsor-facing artifacts contain no student identifiers or personal data. |
| TI-4 | Prohibited sponsor targeting dimensions are rejected. |
| TI-5 | Student Voice submitter identity is protected, capability-gated, justified, and audited. |
| TI-6 | Revoked privileged authority stops immediately. |
| TI-7 | Platform-prohibited advertiser categories never appear. |
| TI-8 | Member-identifying exports are exceptional, approved, limited, and audited. |
| TI-9 | XP is derived from an explainable append-only ledger. |
| TI-10 | Elevated support and break-glass are scoped, time-boxed, reasoned, audited, and approved as required. |
| TI-11 | Audit history is immutable while public availability is correctable. |
| TI-12 | Global User/account data contains no Tenant behaviour. |

The product minimizes evidence, contact data, logs, media metadata, and
analytics. It requires safe deletion, correction, retention, export, and
redaction workflows once their governing legal and architecture decisions are
cleared. Unmanaged downloads cannot be remotely deleted. Cross-Tenant
security events must be durable and redacted before the first externally
exposed Tenant-scoped Route Handler or Server Action.

Voice, Opportunity, sponsorship, Poll, export, and account-recovery abuse
controls remain feature-specific. CampusHub is not an emergency or counselling
service. Legal, controller/processor, hosting, minors, retention, moderation,
and student data-rights decisions remain human review items.

## 14. Global Story Contracts and acceptance criteria

Every story uses these contracts unless it explicitly states a stricter rule:

- GSC-1: every Tenant request, job, export, media access, notification,
  search, and analytics query carries explicit Tenant context;
- GSC-2: wrong-Tenant use is safe not-found and reveals no existence;
- GSC-3: clients never authoritatively set identity, Tenant, assurance,
  eligibility, XP, finalization, or role authority;
- GSC-4: authorization is default-deny and capability/context/resource scoped;
- GSC-5: stale mutable writes fail with VERSION_CONFLICT;
- GSC-6: high-impact transitions have one durable winner;
- GSC-7: retry-sensitive actions are idempotent and source-unique;
- GSC-8: privileged and security-sensitive changes are audited;
- GSC-9: logs and analytics minimize sensitive payloads;
- GSC-10: external side effects are after-commit, retryable, and duplicate-safe
  unless a story explicitly makes delivery part of success;
- GSC-11: Tenant timezone governs time boundaries;
- GSC-12: loading, empty, error, unavailable, and degraded states are defined;
- GSC-13: applicable permission, isolation, invalid-state, audit,
  idempotency, concurrency, accessibility, and failure tests are mandatory; and
- GSC-14: Poll, Voice, RSVP, and Daily Quiz use the shared evaluator above.

Representative canonical user stories and acceptance criteria are retained in
the following product contract table. The full v1.2 story IDs remain the
backlog reference; this table records the rules most affected by the
controlled refreeze.

| Story | User need | Acceptance criteria |
| --- | --- | --- |
| CH-TEN-001 | A university is provisioned as a Tenant. | One Tenant owns its namespace, settings, timezone, hierarchy, modules, and audit; no cross-Tenant default exists. |
| CH-AUT-001 | A student registers with minimal information. | Account identity is separate from Tenant Membership; no account field becomes global behaviour. |
| CH-MEM-003 | A person holds two university Memberships. | Explicit Tenant context selects one Membership; responses and behaviour never merge. |
| CH-VER-001 | A university imports a roster. | Evidence provenance and claims are recorded; authority and roster-import governance remain open until OD-05 is closed. |
| CH-PUB-001 | A Publisher uses one publishing system. | Notice and news are types of one Publication; Priority is an attribute, not a second entity. |
| CH-PUB-002 | A Publisher drafts, schedules, publishes, and corrects content. | Lifecycle, Tenant, capability, expected version, visibility, audience, timezone, audit, and future publish transaction rules are enforced. |
| CH-PUB-003 | A Publisher targets a cohort. | The five canonical dimensions, per-field provenance, AND/OR semantics, scalar estimate, confirmation, and fail-closed handling apply. |
| CH-PUB-004 | A Publisher retracts harmful or incorrect content. | Public availability changes without deleting immutable audit history; concurrent stale writers lose safely. |
| CH-PUB-005 | An administrator sees reach evidence. | Counts are scalar, privacy-safe, and suppressed where the unresolved policy floor requires it; no reader identity is exposed. |
| CH-EVT-003 | A student RSVPs to an Event. | The canonical participation evaluator runs server-side; RSVP is Tenant-local, idempotent, aggregate-only, and cannot bypass cancellation. |
| CH-OPP-002 | A Guild prevents recruitment scams. | Hard-block vetting rules cannot be overridden; trust labels describe the actual reviewed process. |
| CH-POL-001 | A student trusts a Poll response. | Polls are non-binding, response privacy is not overclaimed, and A1 blocks implementation until storage/linkability is reviewed. |
| CH-VOX-001 | A Tenant enables Student Voice safely. | Activation requires accountable staffing, MFA, allowed categories, escalation, SLA confirmation, and auto-suspension on lapse. |
| CH-XP-001 | A student can understand XP. | XP is Membership-local, ledger-derived, idempotent, and never a cross-Tenant profile. |
| CH-QIZ-001 | A student completes one Daily Quiz. | Tenant timezone, one attempt, server grading, idempotency, and unresolved grace-window policy apply. |
| CH-PRV-001 | A student understands processing. | Transparency is generated from approved product/Tenant configuration and never makes an unsupported privacy or deletion promise. |

## 15. OPEN DECISIONS / BLOCKERS REGISTER

These items are not silently decided by this candidate. Their status is OPEN
until the named authority makes and records a decision.

| ID | Open decision | Blocker timing |
| --- | --- | --- |
| OD-01 | Capability bootstrap: first holder, grant authority, self-grant, expiry, and revocation. | **BLOCK BEFORE PUBLICATION CAPABILITY AUTHORIZATION** |
| OD-02 | Privileged non-student Tenant authority for Custodian, University Official, staff Publisher, and moderator. | **BLOCK BEFORE PRIVILEGED USER PERSISTENCE/AUTHORIZATION** |
| OD-03 | Global account versus Membership/evidence ownership of contact-channel provenance. | **BLOCK BEFORE AUTH / VERIFIED CHANNEL PERSISTENCE** |
| OD-04 | Guild Term handover, delayed elections, grant activation, continuity, and no-authority rollover gaps. | **BLOCK BEFORE GUILD TERM / GOVERNANCE FEATURE** and **BLOCK BEFORE PILOT** |
| OD-05 | Authority for full roster import and university authorization. | **BLOCK BEFORE REAL ROSTER IMPORT / PILOT** |
| OD-06 | Scope and safeguards for Custodian emergency revocation. | **BLOCK BEFORE GOVERNANCE FEATURE / PILOT** |
| OD-07 | First-class Report/ModerationCase model, lifecycle, capability, conflict handling, escalation, SLA, evidence, appeal, and resource types. | **BLOCK BEFORE MODERATION / OPPORTUNITY SAFETY WORK** and relevant **BLOCK BEFORE PILOT** items |
| OD-08 | Which SYSTEM/background transitions reauthorize originating human authority and current state. | **BLOCK BEFORE BACKGROUND JOB / OUTBOX EXECUTION** |
| OD-09 | Numeric SMALL AUDIENCE FLOOR. | **OPEN — no numeric rule may be implemented until product/security/data review.** |
| OD-10 | Numeric Priority Notice cap. | **OPEN — no numeric cap may be implemented until product/security review.** |
| OD-11 | A1 Poll privacy, response storage, linkability, thresholds, and transparency wording. | **BLOCK BEFORE POLL IMPLEMENTATION** |
| OD-12 | A10 daily XP cap and allocation semantics. | **OPEN — no numeric cap or capped allocator may be implemented.** |

Additional v1.2 decisions remain open where they were not superseded:
student information architecture, Level naming, Home composition, public
visitor/search indexing, critical delivery policy, admin grouping, roster
matching fields, Poll floors, Voice readiness, minors, retention, hosting,
penetration testing, backup/restore, data-protection position, pricing, and
licence governance.

## 16. Feature-gated audit register

These are valid review obligations or product clarifications that do not
silently decide the underlying product question. Each must close before the
feature is treated as complete.

| Gate | Issue | Source authority | Blocker timing | Feature gated |
| --- | --- | --- | --- | --- |
| FG-01 | Home ranking, demotion, and section caps. | v1.2 §§14, 30-U3; student research. | Before UX/design freeze. | Home |
| FG-02 | stale Membership recovery and correction flow. | v1.2 CH-MEM/CH-VER; A4. | Before verification/member recovery. | Membership |
| FG-03 | Assurance-specific gate copy. | v1.2 §§11, 14, GSC-14. | Before final gate copy. | Contextual gates |
| FG-04 | Save/Follow relation, notification, and participation treatment. | v1.2 CH-HOM-002 and GSC-14. | Before implementation. | Saves and follows |
| FG-05 | Event lifecycle, cancellation, RSVP, and archive treatment. | v1.2 CH-EVT-001..004. | Before Event implementation. | Events |
| FG-06 | Opportunity trust labels and vetting presentation. | v1.2 CH-OPP-001..004. | Before Opportunity launch. | Opportunities |
| FG-07 | Daily Quiz attempt, scoring, grace, and content exhaustion. | v1.2 CH-QIZ-001..005; OD-12 where relevant. | Before Quiz implementation. | Daily Quiz |
| FG-08 | Student Voice lifecycle, readiness, and public accountability. | v1.2 CH-VOX-001..007; OD-07. | Before Tenant activation. | Student Voice |
| FG-09 | Verification/manual-review workflow and evidence retention. | v1.2 CH-VER-001..007; OD-03/05. | Before real roster/manual review. | Verification |
| FG-10 | Me, settings, privacy, shared-device, and session safety. | v1.2 CH-AUT/CH-PRV; legal/security review. | Before Auth/session launch. | Account and Me |
| FG-11 | Tenant-local notification categories, fatigue, and delivery. | v1.2 CH-NTF; TI-1/TI-12. | Before notification infrastructure. | Notifications |
| FG-12 | Tenant-partitioned search, indexing, and bounded result policy. | v1.2 CH-HOM-004; CR-10. | Before search implementation. | Search |
| FG-13 | Sports team pages, standings, corrections, and manual formats. | v1.2 CH-SPT-001..005. | Before expanded Sports. | Sports |
| FG-14 | Sponsorship slots, broad audience, label, and prohibited policy. | v1.2 CH-SPN-001..005; TI-3/TI-4/TI-7. | Before sponsorship activation. | Sponsorship |
| FG-15 | Non-Voice moderation/reporting model. | v1.2 CH-CNT-003; OD-07. | Before moderation expansion. | Reports and safety |
| FG-16 | Analytics definitions, suppression, and Tenant-local pseudonyms. | v1.2 CH-ANL; A4; TI-1/TI-12. | Before behavioural analytics. | Analytics |

No feature-gate entry is a final product decision. A missing decision keeps the
feature gated.

## 17. Pilot readiness register

These items must be closed before external Pilot even when they do not block
the current foundation implementation.

| ID | Readiness item | Required evidence or owner |
| --- | --- | --- |
| PR-01 | Guild Term continuity and handover. | OD-04 decision, grant activation/expiry, and staffed handover runbook. |
| PR-02 | Roster authority and import governance. | OD-05 decision, university authorization, and safe import process. |
| PR-03 | Custodian safeguards and emergency authority. | OD-06 decision, scope, revocation, audit, and separation of duties. |
| PR-04 | Report and moderation model. | OD-07 decision, accountable moderation, escalation, evidence, and SLA. |
| PR-05 | Privacy/legal controller and processor position. | Written legal review for roster, behaviour, retention, rights, and breach duties. |
| PR-06 | Hosting and data-location decision. | Hosting region, transfer safeguards, operational owner, and disclosure. |
| PR-07 | Transparency accuracy. | Page generated from approved current configuration and reviewed copy. |
| PR-08 | Sessions and shared-device safety. | Login/logout, session review, privileged MFA, and revocation evidence. |
| PR-09 | Student data-rights paths. | Access, correction, deletion, retention, appeal, and support procedures. |
| PR-10 | Active Tenant for multi-Membership users. | Explicit switching, isolated context, and leakage regression evidence. |
| PR-11 | Analytics definitions. | Approved metric definitions, suppression, retention, and local pseudonym boundary. |
| PR-12 | Abuse and escalation readiness. | Incident, takedown, opportunity-scam, Voice, support, and security runbooks. |
| PR-13 | A1 Poll gate. | Independent A1 design approval or Poll module remains disabled. |
| PR-14 | Student Voice readiness. | CH-VOX-001 conditions remain continuously true or module remains disabled. |
| PR-15 | Paid-launch continuity. | Penetration testing, backup/restore validation, and licence governance. |

## 18. Commercial, privacy, and operational boundaries

The commercial model remains annual Tenant licensing through Guild-funded or
institution-funded paths. Pricing, controller/processor status, hosting,
retention periods, minors policy, sponsorship demand, and support costs are
human-review matters. CampusHub records sponsorship and does not process
payments.

The product must not expose named Poll answers, sponsor student data,
cross-Tenant behaviour, unauthorized media, private Voice identity, or
member-identifying exports without the exceptional authority and audit
required by the product contract. Security events, audit, backups, redaction,
and data rights must remain minimal, scoped, and truthful.

## 19. Product assumptions

Current assumptions include: a Tenant can provide a roster in some delimited
form; students commonly use metered mobile data; some Tenants have institutional
contact channels but not all; each Tenant uses one authoritative timezone; a
Tenant can staff any enabled Voice module; and the product can operate without
SSO, SIS integration, payments, or a native app in Pilot.

An assumption is not evidence or approval. If a required assumption fails, the
affected feature is held, degraded honestly, or returned to the open-decision
register.

## 20. Candidate change control

The controlled refreeze record maps CR-01 through CR-17, records old Blueprint
behaviour that is superseded or prototype-only, and separates documentation
sync from new/open product decisions. The v1.2 frozen Product Specification
and v1.2 frozen Prototype Blueprint remain unchanged historical files.

This candidate is not frozen, does not independently approve any checkpoint,
does not implement Auth, Polls, Events, Opportunities, XP, Voice,
Notifications, moderation, or UI, and does not authorize a new migration.

**REFREEZE CANDIDATE — PENDING PRODUCT/ARCHITECTURE REVIEW**
