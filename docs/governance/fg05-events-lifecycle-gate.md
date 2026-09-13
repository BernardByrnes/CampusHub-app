# FG-05 Events Lifecycle Gate

Status: **FG-05 PROPOSED — PRODUCT OWNER AUTHORIZATION REQUIRED**

This is a documentation-only governance checkpoint. It proposes the Pilot
Events contract for Product Owner authorization and independent review; it does
not authorize Event runtime code, a schema, a migration, a UI, a background
job, a notification, or deployment.

- Foundation: `codex/8v-b-next-foundation`
- Foundation SHA: `c721f44de06963c6bd8ce0775ed7bd9fed1cd756`
- Proposed stories: `CH-EVT-001` through `CH-EVT-004`
- Product authority: `CampusHub_Product_Specification_v1.3_FROZEN.md`
- Production HOW authority: `CampusHub_Implementation_Blueprint_v1.3_FROZEN.md`

## 1. Authority and checkpoint boundary

The frozen Product Specification remains the only Product WHAT/WHY authority.
The frozen Implementation Blueprint remains the subordinate production HOW
contract. This document records how the two documents apply to the Events
epic; it does not amend either frozen document and does not close any open
Product decision.

The proposal carries forward the normative contracts in:

- `CH-EVT-001` — create and publish an Event;
- `CH-EVT-002` — Organiser attribution;
- `CH-EVT-003` — RSVP and interest;
- `CH-EVT-004` — postpone or cancel an Event;
- `GSC-14` — the shared server-authoritative participation evaluator;
- the Tenant, visibility, audience, capability, concurrency, and A6 contracts.

An implementation agent may not infer implementation authorization from this
document. Before runtime work begins, Product Owner authorization, an
implementation checkpoint with exact acceptance criteria, the applicable A2/A4
Tenant-surface evidence, and independent security/architecture review must be
present.

## 2. Pilot scope and explicit exclusions

The Pilot Event contract includes Tenant-owned Events, Publisher management,
audience-bound Home/Discover exposure, Organiser attribution, lifecycle
transitions, and the bounded RSVP/interest surface described below.

The relevant frozen global Pilot OOS items for Events, from the Product
Specification's `Out of Pilot, Deliberately` register, are:

- maps and geolocation;
- clubs as account-holding entities;
- ticketing;
- check-in;
- an attendee directory or attendee list;

These global exclusions are not broadened by this gate. Their Event-specific
consequences are:

- venue is free text only, with no map API, geolocation, or coordinate field;
- Organiser is attribution-only;
- a Club/Organiser is not an authority principal, has no independent account
  or publishing login, and does not receive `event.manage` merely by being an
  attribution label.

The following are FG-05 checkpoint exclusions or separately gated dependencies,
not additional claims about the global Pilot OOS register:

- Team Follow and follower/reminder behavior;
- Sports, Polls, Student Voice, Opportunities, sponsorship, and Auth/OD-03;
- XP implementation outside its own gate;
- notification infrastructure and unrelated modules.

This checkpoint creates no runtime or persistence change. In particular it
does not create an Event table, an RSVP table, an `event.manage` capability
value, an audit event writer, a media pipeline, an outbox, a notification
sender, a scheduler, or a migration. The current source has no Event runtime
surface; the Product-defined `event.manage` authority must be added only by a
later, separately reviewed implementation checkpoint if authorized.

## 3. CH-EVT-001 — Event contract

An Event is a Tenant-owned resource. The proposed Event record carries:

- explicit Tenant ownership;
- title and description;
- optional Event image through the reviewed media seam;
- optional Tenant-scoped Organiser attribution;
- venue as free text only;
- start date/time;
- optional end date/time;
- one same-Tenant Campus;
- canonical content visibility: `PUBLIC`, `MEMBERS`, or
  `VERIFIED_MEMBERS`;
- the canonical audience definition;
- whether RSVP is enabled;
- lifecycle and expected version facts;
- created/updated attribution and timestamps under the applicable audit and
  privacy contracts.

The venue is text only. No map lookup, geolocation, or coordinate field is
part of the Pilot contract. Visibility and audience are independent
dimensions: visibility defines the canonical content boundary, while the
audience definition determines which eligible users within that boundary may
receive the Event. Neither dimension is collapsed into, or automatically
derived from, the other, and the established canonical visibility contract is
reused rather than replaced with an Event-specific enum.

Draft creation, every persisted draft edit, and lifecycle management are
Tenant-scoped and default-deny. Each persisted mutation requires the
Product-defined `event.manage` capability in the applicable Tenant/module
scope and a current authorized Publisher or Guild Administrator path. This
applies to every persisted Event field, including title, description, image
reference, Organiser attribution, venue, dates, Campus, visibility, audience,
and RSVP-enabled state. A role name, client field, stale RequestContext, prior
page access, prior transition, cached capability result, or prior grant must
not be sufficient. The exact runtime capability vocabulary, persistence, and
fresh transaction-time authorization are implementation-checkpoint work, not
authorized by this proposal.

Only a genuine no-op may avoid a mutation authorization check: the requested
persisted state is already identical to the authoritative state, no database
Event mutation occurs, the Event version does not advance, no lifecycle change
or mutation-success audit event occurs, no notification/side effect is
generated, and no other Product state changes. A no-op does not grant access
to management-only draft data; any operation that reads or returns such a
draft still requires the applicable draft read/management authorization. A
stale writer, duplicate submission with different state, or idempotency
replay follows the established conflict/idempotency contract and is not
silently reclassified as a no-op.

When published, an Event is eligible for the Home and Discover read
orchestrators only after Tenant/visibility checks and current audience
eligibility. A reader must never learn foreign-Tenant existence from a title,
count, audience, or error. Once the Event has passed, it is removed from Home
and represented according to the approved archive contract below.

## 4. CH-EVT-002 — Organiser attribution

An Organiser is a Tenant-scoped attribution label with a name and optional
logo, created and maintained by Guild Administrators. It is not an account-
holding entity in Pilot, has no login, and cannot publish independently.
Clubs as account-holding entities are globally frozen Pilot OOS under §26.2;
any future reconsideration requires formal re-chartering.

An Event or Publication may name one Organiser. The Organiser relationship,
logo reference, and every lookup must be same-Tenant. A future implementation
must not turn an attribution label into a Global User, Membership, authority
principal, or behavioural history. Optional logo storage is subject to the
separately reviewed media pipeline; this gate does not implement it.

## 5. Visibility, audience, and participation authority

The Event read path follows the established resource order. A `PUBLIC` Event
may use the approved unauthenticated Tenant-bound public reader path; a
Membership-bound read uses the trusted request context:

1. bind the explicit Tenant and applicable exposure context;
2. resolve the Event within that Tenant;
3. enforce lifecycle and visibility;
4. apply the canonical audience/exposure policy;
5. return only the bounded Event projection.

Visibility is not eligibility. A visible Event is not automatically actionable
for RSVP. RSVP uses `GSC-14` exactly as the frozen Product Specification
defines it. The evaluator is server-only and ordered as follows:

1. Tenant lifecycle;
2. module enabled state;
3. resource existence and actionability;
4. current Membership state;
5. assurance;
6. resource audience/frozen cohort;
7. verified attributes;
8. story-specific prerequisites.

For an unauthenticated visitor, the public path may return only an Event that
is `PUBLIC`, exposed by a Tenant permitting the applicable public surface,
within a serving lifecycle, and valid under the applicable public audience and
exposure rules. No Membership identity is fabricated for that path. PUBLIC
read authorization and authenticated participation are separate concerns:
trusted `RequestContext`/`identitySubjectId` remains required for
member-specific reads, Membership-dependent audience decisions, RSVP,
Publisher management, and privileged lifecycle mutations.

The Event surface must preserve the single actionable-denial behavior and must
not infer eligibility from a client-supplied identity, query parameter, cookie,
header, local-storage value, audience flag, or role label. The existing trusted
RequestContext and `identitySubjectId` seam remains the only permitted future
authenticated transport seam; this gate does not implement Auth.

## 6. Lifecycle contract

The Product lifecycle is the following. The `past/archived` wording is kept
exactly because the frozen Product Specification uses that conceptual state;
the persisted representation and transition mechanism remain an explicit
implementation decision below.

| From | To | Required facts | Contract |
| --- | --- | --- | --- |
| `draft` | `published` | fresh transaction-time `event.manage`, complete valid Event, valid visibility and audience, expected version | One atomic, versioned transition. |
| `published` | `postponed` | fresh transaction-time `event.manage`, new date/time, mandatory human-readable reason, expected version | Preserve the original date and expose “postponed from”. |
| `postponed` | `published` | fresh transaction-time `event.manage`, approved current date/time, valid visibility and audience, expected version | One atomic, versioned transition; no silent history loss. |
| `published` or `postponed` | `cancelled` | fresh transaction-time `event.manage`, mandatory human-readable reason, expected version | One atomic, versioned transition; close later RSVP mutation. |
| `published` | `past/archived` | approved archive authority and threshold; fresh `event.manage` when a privileged actor performs it | Remove from Home and preserve history. |
| `cancelled` | `past/archived` | approved archive authority and threshold; fresh `event.manage` when a privileged actor performs it | Keep clear cancelled treatment until the threshold. |

Unlisted transitions, including cancellation back to published, arbitrary
published-to-draft rollback, and RSVP after closure, fail closed. No
implementation may add them merely because a state column permits them.

Every privileged Event lifecycle mutation independently revalidates current
`event.manage` authority inside the authoritative transaction immediately
before mutation commits. This includes draft creation where management
authority is required, every persisted draft edit, publication, postponement,
republishing after postponement, cancellation, and any explicit privileged
archive transition. Only a true no-op that performs no persisted mutation may
avoid mutation authorization; management-only draft reads remain protected.
It never relies on stale request facts, a role label, a previous successful
transition, or a cached capability result. A future OD-08-authorized SYSTEM
transition is a separately governed execution path; this proposal authorizes
neither that path nor any additional Event capability.

This revalidation is not by itself an authority lease. `RequestContext` is
trusted context, but it cannot prove that a RoleGrant still exists, that a
grant has not expired, that the Guild Term remains active, or that the module
and capability remain enabled at the Event mutation's serialization/commit
point. The implementation must establish a linearizable authorization/mutation
boundary so the committed Event mutation corresponds to authority that was
valid at that point.

The implementation checkpoint must identify and review the serialization
mechanism. Acceptable implementation families may include deterministic locks
on authoritative capability/grant/term rows, an authorization/grant epoch or
version checked atomically with the Event mutation, SERIALIZABLE or an
equivalent reviewed transaction strategy, or an established authorization
gateway already proven to provide the same invariant. FG-05 selects none of
these mechanisms and does not create a new global authorization architecture.

The required ordering is explicit. If applicable authority revocation commits
first, the in-flight Event mutation must re-observe the revoked authority and
fail closed, leaving Event state and version unchanged with no false-success
privileged audit event. If the Event mutation commits first while authority is
valid, that mutation remains valid; the later revocation applies to subsequent
privileged operations, which must fail closed. No mutation may commit after a
committed revocation while relying only on an earlier authorization snapshot.

The later implementation must revalidate, as applicable to the governed
operation, Tenant lifecycle, module enablement, current Membership/principal
authority, RoleGrant/capability, grant expiry, Guild Term status, assurance or
MFA requirements, Event Tenant ownership, and expected Event version. This
does not resolve OD-01, OD-02, or OD-06.

### 6.1 Archive semantics requiring Product Owner closure

The Product contract requires a past Event to move to an archive state, but it
does not select all of the following implementation-level choices:

- whether the durable value is `archived`, a derived `past` projection, or a
  separately approved equivalent;
- whether the threshold is `endAt` when present and `startsAt` otherwise;
- how the original date of a cancelled Event is defined after postponement;
- whether the transition is performed by a future OD-08-authorized SYSTEM job,
  an authorized request-time transition, or another governed mechanism.

This gate chooses none of those branches. Background execution is not
authorized: the Blueprint requires SYSTEM reauthorization under OD-08 before
future jobs or scheduled transitions. CH-EVT-001/004 implementation must stop
at this boundary until the Product Owner and the applicable execution/security
review supply the missing choice.

## 7. CH-EVT-003 — RSVP and interest

For an active, eligible Event with RSVP enabled, a Student Member may hold one
current RSVP state: `going` or `interested`, and may withdraw it. A state may
be changed or withdrawn only until the Event starts, using the authoritative
server/Tenant time in the same transaction as the mutation.

The proposed persistence and mutation contract is:

- one current row per `(Tenant, Event, Membership)`;
- same-Tenant structural ownership for Event and Membership;
- expected-version or equivalent row serialization for Event/RSVP races;
- a stable idempotency boundary for retries;
- repeating the same state returns the current state without a second RSVP or
  second XP award;
- an allowed change replaces the current `going`/`interested` state rather
  than creating a second RSVP;
- withdrawal preserves the governed history while removing the active state;
- aggregate counts only for Organisers in Pilot;
- no attendee list, attendee identity projection, or check-in.

The participation evaluator runs before any RSVP mutation and is revalidated
inside the authoritative transaction. `RSVP enabled`, Event lifecycle,
membership actionability, start-time closure, Tenant, and audience facts are
not trusted from the client.

Product authority requires one XP award per Event under `CH-XP-002`, not per
RSVP change. XP is not implemented by this gate. A future CH-EVT/XP
implementation must either include the approved XP dependency or stop before
claiming the full RSVP acceptance criteria; it must not silently claim an XP
award that was never recorded.

Product authority requires one reminder for an RSVP'd student and relevant
Event-change notifications under the applicable notification preference
policy. Cancellation notifications are different: students whose current RSVP
is `going` or `interested` must receive them, and they cannot be disabled by
the student. Those effects remain deferred to the separately gated CH-NTF
infrastructure. This document creates no notification, outbox, delivery,
retry, or background-job behavior and makes no false claim that the
notification criteria are already satisfied.

## 8. CH-EVT-004 — Postponement and cancellation

Postponement requires a new date/time and a mandatory reason. It preserves the
original date in the Event history and displays “postponed from”. Each durable
transition is expected-version protected and auditable. A replacement date is
not a client-side edit that can bypass lifecycle or RSVP checks.

Cancellation requires a mandatory reason, retains the Event with an explicit
cancelled treatment until the original date passes, and closes future RSVP
mutation. Existing `going` and `interested` students are the mandatory,
non-disableable cancellation-notification audience once CH-NTF is available.
Reminder and ordinary Event-change notifications remain preference-aware; this
gate does not implement delivery.

Cancellation and RSVP use the same authoritative Event row and a single
transactional state check. If cancellation commits first, a later RSVP is not
accepted and returns the existing `INVALID_STATE` family with the current
Event state. If an RSVP commits first, cancellation observes the current
version and proceeds only under its expected-version contract. Neither path
may silently overwrite the other or report success after a partial state.

The treatment of RSVP while an Event is `postponed`, the definition of
“original date” after repeated postponements, and whether a postponed Event
remains RSVP-actionable before republishing are not selected here. They are
listed as Product Owner decisions rather than guessed by an implementation
agent.

## 9. Tenant isolation and read surfaces

Every Event, Organiser, RSVP, lifecycle history row, and future audit resource
reference is Tenant-owned or explicitly Tenant-bound. The implementation
checkpoint must provide:

- same-Tenant Event/Campus and Event/Organiser constraints;
- same-Tenant Event/audience target validation;
- same-Tenant Event/Membership RSVP constraints;
- explicit Tenant predicates on every read, write, aggregate, and transition;
- Tenant Surface Registry registration and A2 Tenant-negative probes;
- no lookup by Event ID, Organiser ID, or RSVP ID alone;
- no cross-Tenant counts, snippets, audience labels, or error details;
- bounded Home/Discover projections that reauthorize the Event before return;
- direct-detail reauthorization after collection selection.

The organiser view exposes aggregate `going`/`interested` counts only. A
student view exposes the current Event and the requesting Membership's own
RSVP state, never a directory of other Members.

## 10. Concurrency, idempotency, and failure atomicity

Lifecycle and RSVP mutations are high-impact state changes. A later
implementation must document one deterministic lock/serialization order that
begins with the explicit Tenant context and does not reverse the established
resource-authority order. It must lock or otherwise serialize the Event row
before deciding a lifecycle-dependent RSVP result, and must use one transaction
for validation, state mutation, audit append, and any in-scope durable fact.

The authoritative Product-state transaction covers required Event/RSVP
mutations, concurrency checks, required Event history/state facts, and required
A6 audit facts. Failure of one of those in-transaction operations rolls back
the Product-state transaction. External notification delivery is different:
after the Product-state transaction commits, a later in-app, email, push, or
other sender failure must not reverse the committed Event transition. The
separately approved CH-NTF design must provide durable retry, idempotent
processing/delivery, and observable failure/retry state without producing
duplicate logical notifications.

Required evidence for the implementation checkpoint includes:

- publish versus publish: one winner and one canonical version conflict;
- publish/postpone/cancel versus stale competing transition: no lost update;
- cancellation versus RSVP in both orderings, with the cancellation-wins
  `INVALID_STATE` result when applicable;
- RSVP retry and same-state idempotency;
- RSVP versus event-start closure using an authoritative time boundary;
- aggregate counts remaining Tenant-local and consistent after concurrent
  state replacement/withdrawal;
- authority revocation versus every privileged Event mutation, using separate
  real PostgreSQL connections and deterministic blocking/commit-order evidence:
  when revocation commits first, the Event mutation fails closed with unchanged
  Event state/version and no false-success audit; when the Event mutation
  commits first, it remains valid and a later mutation using the revoked
  authority fails;
- rollback evidence showing every denial, stale version, invalid lifecycle,
  audience failure, or in-transaction required mutation/audit failure leaves
  the Event/RSVP state at its pre-operation durable value;
- evidence that a post-commit external notification-delivery failure does not
  roll back committed Event/RSVP state and is covered by the later retry and
  idempotency contract.

No arbitrary sleep is evidence of PostgreSQL ordering. Real PostgreSQL lock,
blocking, commit-order, and exact-SHA CI evidence is required for the
production checkpoint.

## 11. A6 audit and minimization

Privileged Event lifecycle mutations must use the approved append-only A6
architecture. The future Event implementation must add reviewed closed audit
contracts rather than calling an unrestricted string/payload appender. A
candidate minimum vocabulary is:

- `event.created`;
- `event.changed`;
- `event.published`;
- `event.postponed`;
- `event.cancelled`; and
- `event.archived`.

These names are a proposal for the Event implementation checkpoint, not a
runtime authorization or an addition to the current audit union. The
checkpoint must obtain the required A6 contract review before changing the
audit schema or event vocabulary.

Audit facts must be minimized: Event ID, Tenant, actor Membership where
applicable, resulting version/state, transition reason category or required
reason reference, and authoritative timestamp. Do not place descriptions,
venue text, image bytes, recipient lists, Membership directories, contact
facts, or raw request data into audit facts. RSVP audit treatment must be
specified by the implementation/security checkpoint without turning A6 into a
student-behavior history or exposing other students' identities.

## 12. Deferred dependencies and seams

| Dependency | Current treatment | Consequence |
| --- | --- | --- |
| Trusted Auth/RequestContext transport | Existing trusted seam only; no fake Auth | Event work cannot accept query/header/cookie/test identity as production authority. |
| `event.manage` runtime capability | Product-defined capability; absent from current runtime vocabulary | Add only in an independently reviewed implementation checkpoint. |
| XP / `CH-XP-002` | Required by Product for one award per Event, not implemented here | Do not claim complete RSVP acceptance without the approved dependency/evidence. |
| CH-NTF reminders and change/cancellation notices | Reminder/change delivery follows applicable preference policy; cancellation to current `going`/`interested` RSVP holders is mandatory and non-disableable; delivery is post-commit | No notification infrastructure is created by FG-05; future delivery must be retryable and idempotent under CH-NTF. |
| Event image and Organiser logo | Optional Product fields, future reviewed media seam | No upload, media persistence, transformation, or deletion workflow here. |
| Background archive/SYSTEM transition | OD-08 and Blueprint background-job gate | No scheduler, worker, or expiry job here. |
| Ticketing/check-in/attendee directory | Frozen Pilot OOS | No schema, UI, or authorization path. |

## 13. Proposed implementation sequencing after authorization

This order is a planning boundary, not implementation authorization:

1. **CH-EVT-001 core Event:** Tenant ownership, Campus/visibility/audience
   constraints, draft/publish, bounded Home/Discover reads including the
   approved public path, expected versions, and the approved archive
   representation/trigger.
2. **CH-EVT-002 attribution:** Tenant Organiser label, Guild Administrator
   maintenance, optional media reference seam, and attribution-only read
   behavior.
3. **CH-EVT-004 lifecycle controls:** postpone/cancel/history, mandatory
   reasons, archive interaction, A6 contracts, and deterministic transition
   race evidence.
4. **CH-EVT-003 RSVP:** GSC-14, one current RSVP, idempotency, aggregate-only
   organiser view, XP integration evidence, notification dependency evidence,
   and cancellation/start-time races.
5. **Surface and release gate:** Tenant-negative tests, architecture tests,
   PostgreSQL integration, focused UI/browser evidence if a surface is
   included, exact-SHA CI, independent Sol High review, and Product Owner
   verification.

No step may silently absorb CH-NTF, CH-XP, OD-08, Auth, or a future media
checkpoint.

## 14. Traceability and decision table

| Product contract | Proposed governed behavior | Required evidence before runtime claim |
| --- | --- | --- |
| CH-EVT-001 | Event fields, independent visibility/audience boundary, draft/publish, Home/Discover exposure, archive treatment | Event schema/repository, authorization, visibility/audience tests, public-read and Tenant-negative probes, archive decision closure |
| CH-EVT-002 | Tenant Organiser attribution only; no login or independent publishing | Same-Tenant relation, Guild Administrator authorization, no-account/no-behavior tests |
| CH-EVT-003 | GSC-14 RSVP/interest/withdraw, one current state, aggregate counts, idempotent changes | Evaluator evidence, membership isolation, PostgreSQL race tests, XP/notification dependency evidence |
| CH-EVT-004 | Versioned postpone/cancel, mandatory reasons, preserved history, cancellation race | State machine tests, lock/commit-order evidence, A6 review, archive/“original date” closure |
| Event visibility and public reads | `PUBLIC`, `MEMBERS`, and `VERIFIED_MEMBERS` remain independent of audience; eligible `PUBLIC` Events retain unauthenticated reads | Canonical visibility tests, public-reader Tenant/exposure checks, no fabricated identity, member-read separation |
| Event management authority | Every persisted draft create/edit and privileged lifecycle mutation requires current `event.manage` and a linearizable authority/mutation boundary; only a true no-op performs no mutation | Fresh-authority denial/revocation/expiry tests plus deterministic two-ordering PostgreSQL revocation races for create/edit/publish/postpone/republish/cancel and any privileged archive path |
| Event state versus notification delivery | Required Product state and A6 facts commit atomically; post-commit delivery failure never reverses committed state | Transaction rollback tests plus future CH-NTF retry/idempotency evidence |
| Event notification semantics | Reminder and ordinary change notices follow preference policy; cancellation notices to current `going`/`interested` holders are mandatory and non-disableable | Preference-boundary and cancellation-recipient tests; CH-NTF remains separately gated |
| FG-05 scope classification | Maps/geolocation, clubs as account-holding entities, ticketing/check-in/attendee directory are Frozen global Pilot OOS; venue/Organiser rules are Event-specific consequences; other modules are checkpoint exclusions | Scope traceability review with no silent Pilot-OOS expansion |
| A6/GSC-8/GSC-9 | Append-only minimized privileged audit facts | Closed Event audit contract, A6/Tenant registry updates, tamper/rollback tests |
| Blueprint §§8, 10–15, 20, 22–24 | Server-only authority, persistence/mutation/read ownership, concurrency, jobs, audit, testing, sequencing, recovery | Implementation checkpoint and independent review; not supplied by this document alone |

## 15. Genuine Product Owner decisions required

The following are the only material Event branches intentionally left open by
this proposal. They must be resolved in a recorded Product decision before an
implementation agent chooses a value:

| Decision | Supplied contract | Unresolved question | Timing / consequence |
| --- | --- | --- | --- |
| FG05-OD-01: archive representation and trigger | A past Event moves to an archive state and leaves Home; cancelled Events remain treated as cancelled until the original date passes | Durable `archived` versus derived `past`; authoritative threshold (`endAt`/`startsAt`/cancelled original date); and OD-08-authorized execution mechanism | Blocker before the archive portion of CH-EVT-001/004 and any claim of automatic archival. |
| FG05-OD-02: repeated postponement semantics | Original date is retained and shown as “postponed from”; `published → postponed → published` exists | Does “original date” mean the first scheduled date or the immediately preceding published date, and how is RSVP actionability handled while postponed? | Blocker before CH-EVT-004 implementation. |
| FG05-OD-03: dependency-complete RSVP release | RSVP awards XP once and sends required reminders/change/cancellation notices | May a separately approved Event checkpoint ship RSVP only with XP/CH-NTF dependencies present, or must it remain gated until both are implemented? | Blocker before claiming complete CH-EVT-003 acceptance. |

These entries do not decide values, close OD-08, authorize XP/notifications,
or replace any frozen Product decision. Existing OD-02, OD-03, A1, OD-07,
OD-08, OD-11, OD-12, and other governing gates remain unchanged.

## 16. Exit criteria for FG-05

FG-05 may move beyond this proposal only when all of the following are
recorded:

1. Product Owner authorization of this narrow CH-EVT-001..004 contract and
   closure or explicit sequencing treatment for FG05-OD-01..03;
2. independent Sol High read-only review of this exact document;
3. a separate implementation checkpoint naming exact stories, acceptance
   criteria, migration/recovery plan, A2/A4 evidence, A6 event contracts,
   concurrency tests, and external side-effect dependencies;
4. exact-SHA unit, architecture, Tenant-negative, PostgreSQL, and CI evidence
   for the implementation; and
5. no claim that Events are implemented, that Auth exists, or that Pilot/legal
   readiness has been achieved merely because this gate is approved.

## 17. Explicit non-authorization

This checkpoint does not authorize:

- Event runtime code, tests that require runtime changes, schema, or migration;
- Result/Fixture/Sports changes or FG-13 work;
- Polls, Student Voice, Auth/OD-03, Opportunities, sponsorship, or XP;
- notification/outbox/delivery infrastructure;
- media upload or transformation;
- scheduler, background job, expiry job, or SYSTEM authority;
- production migration, deployment, or environment changes;
- frozen Product Specification or Blueprint edits;
- Agent Orchestrator or KlinKlik changes.

**FG-05 PROPOSED — PRODUCT OWNER AUTHORIZATION REQUIRED**
