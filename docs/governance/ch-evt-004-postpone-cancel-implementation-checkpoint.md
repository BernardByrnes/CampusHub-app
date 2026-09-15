# CH-EVT-004 — Postpone or Cancel an Event

- Status: **CH-EVT-004 POSTPONE/CANCEL CHECKPOINT — AWAITING SENIOR REVIEW**
- Checkpoint type: documentation-only implementation-boundary proposal
- Canonical foundation: `codex/8v-b-next-foundation`
- Required base SHA: `795df7118429ddf13e82aca9577daab0a63a6fc0`
- Proposed implementation branch: `codex/ch-evt-004-postpone-cancel-gate`
- Current migration head: `drizzle/0018_parched_maximus.sql`

This document authorizes no runtime implementation. It defines the bounded
Lifecycle Core that may be implemented only after this checkpoint receives
independent review and the normal implementation authorization. It must be
read with the frozen Product Specification, frozen Implementation Blueprint,
the approved FG-05 Events gate, the approved Privileged Mutation Authority
Finalization Boundary (PMAFB), and the CH-EVT-001 and CH-EVT-002 checkpoints.

The frozen Product Specification owns Event WHAT/WHY. The Blueprint and
approved checkpoint contracts constrain production HOW. Where this document
labels a point **PROPOSED — SENIOR DECISION REQUIRED**, a later implementation
must stop rather than silently choose a product meaning.

## 1. Authority and source inspection

This checkpoint was prepared against:

1. `CampusHub_Product_Specification_v1.3_FROZEN.md`;
2. `CampusHub_Implementation_Blueprint_v1.3_FROZEN.md`;
3. `docs/governance/campushub-v1.3-controlled-refreeze.md`;
4. `docs/governance/fg05-events-lifecycle-gate.md`;
5. `docs/governance/privileged-mutation-authority-invalidation.md`;
6. `docs/governance/ch-evt-001-event-core-implementation-checkpoint.md`;
7. `docs/governance/ch-evt-002-organiser-attribution-implementation-checkpoint.md`;
8. the promoted Event and Organiser runtime at foundation SHA
   `795df7118429ddf13e82aca9577daab0a63a6fc0`.

No frozen Product or Blueprint text is changed by this checkpoint. The
approved FG05-OD-01 and FG05-OD-02 decisions are preserved. This document
does not close OD-08, CH-EVT-003, CH-NTF, or any unrelated Product gate.

## 2. Current promoted runtime baseline

At the required foundation SHA:

- `EventLifecycle` contains `draft`, `published`, `postponed`, and
  `cancelled`.
- The implemented privileged mutations are draft creation, draft edit, and
  `draft → published`.
- `events` currently stores the current `startsAt`, nullable `endsAt`,
  `lifecycle`, `version`, current content, Campus, optional Organiser,
  visibility, audience mode, RSVP-enabled flag, and timestamps.
- There is no postponement reason, cancellation reason, schedule history, or
  lifecycle history in Product persistence.
- The Event audit vocabulary currently contains `event.created`,
  `event.changed`, and `event.published`.
- FG05's `endAt` threshold wording maps to the promoted runtime's `endsAt`
  field; the implementation must preserve that semantic distinction without
  introducing a second date field.
- The read projection and repository collection currently serve only
  `published` Events. Derived `past` is calculated from
  `endsAt ?? startsAt`; it is not persisted.
- Home and Discover consume the bounded Event read seam, so they currently do
  not expose postponed or cancelled Event projections.
- Event mutations use `event.manage`, the trusted RequestContext seam, and
  the shared `PostgresPrivilegedMutationAuthority` / PMAFB path.
- The existing Event publish preparation locks the Event first, then validates
  the Campus, audience targets, and optional Organiser before final authority
  and mutation. A future transition must retain a deterministic compatible
  order.
- The current migration head is `0018_parched_maximus.sql`.

This baseline is implementation evidence, not permission to expand the
checkpoint. In particular, no fake Auth, client identity, scheduler, worker,
or notification hook may be introduced.

## 3. Checkpoint scope

### 3.1 Lifecycle Core — implementable after approval

The bounded runtime slice may cover only these durable transitions:

```text
published  → postponed
postponed  → published
published  → cancelled
postponed  → cancelled
```

It may include:

- complete replacement schedule validation;
- mandatory, bounded reasons;
- immutable lifecycle/schedule history;
- repeated-postponement reconstruction;
- cancellation-retention snapshot semantics;
- expected-version and PMAFB enforcement;
- minimized A6 audit events;
- Tenant-safe direct and collection read projections;
- Home and Discover lifecycle filtering;
- deterministic real-PostgreSQL concurrency, rollback, and isolation evidence.

### 3.2 Dependency-gated completion — not implemented here

This checkpoint does not implement or authorize:

- RSVP persistence, mutation, recipient resolution, or race handling;
- cancellation-versus-RSVP runtime behavior;
- mandatory cancellation notification delivery;
- notification preference, retry, idempotency, or delivery state;
- outbox rows, jobs, workers, schedulers, or SYSTEM transitions;
- media, Event images, Publication attribution, Organiser mutation changes,
  Auth/OD-03, Sports, XP, deployment, or frontend redesign.

The required status qualifier is:

```text
FULL CH-EVT-004 STORY COMPLETION NOT CLAIMED — RSVP RACE AND CANCELLATION NOTIFICATION DEPENDENCIES REMAIN
```

The future cancellation-vs-RSVP invariant is recorded for integration, not
implemented: if cancellation commits first, a later RSVP must return the
existing `INVALID_STATE` family after observing the cancelled Event; if RSVP
commits first, cancellation must observe the current version and state.

## 4. Lifecycle state machine

The implementation must enforce this complete transition set for this slice:

| From | To | Required input/evidence |
| --- | --- | --- |
| `draft` | `published` | Existing CH-EVT-001 publish contract. |
| `published` | `postponed` | `expectedVersion`, complete replacement schedule, mandatory reason, fresh `event.manage`, PMAFB. |
| `postponed` | `published` | `expectedVersion`, no schedule edit, full current publish dependency revalidation, fresh `event.manage`, PMAFB. |
| `published` | `cancelled` | `expectedVersion`, mandatory reason, immutable retention snapshot, fresh `event.manage`, PMAFB. |
| `postponed` | `cancelled` | Same as cancellation from `published`, using the approved effective-published schedule definition below. |

The following are explicitly invalid and must fail closed:

```text
cancelled → published
cancelled → postponed
cancelled → draft
published → draft
postponed → draft
postponed → postponed
```

`past` remains a derived projection. No transition writes `past`, no automatic
archive is persisted, and no scheduler, worker, SYSTEM transition, or expiry
job is part of this checkpoint.

## 5. Postpone command and schedule semantics

The dedicated postpone command is:

```text
expectedVersion
startsAt
endsAt | null
reason
```

`startsAt` and `endsAt` are the complete replacement schedule. The command
must require the `endsAt` key even when its value is `null`; an implementation
must never retain the old `endsAt` accidentally. The existing invariant remains
mandatory:

```text
endsAt == null OR endsAt > startsAt
```

The reason is Product state, not a log-only detail. It must be trimmed,
non-empty, and explicitly bounded. `FIXTURE_REASON_MAX_LENGTH = 500` is the
nearest existing precedent; this checkpoint proposes a 500-character Event
reason bound unless Product authority or senior review requires a different
already-governed bound. The implementation must not use an unbounded text
field or generic metadata JSON.

Only a `published` Event may be postponed. Each postponement appends one
history row containing the replacement schedule and the immediately preceding
published schedule's start time as `postponedFrom`. A second postponement is
not a direct `postponed → postponed` mutation; the Event must first be
republished, after which the next postpone records the then-current published
schedule. Thus:

```text
published A
  → postponed to B, postponedFrom = A
  → published B
  → postponed to C, postponedFrom = B
```

History retains A and B; C is the current replacement schedule while the Event
is postponed. No prior schedule or reason is overwritten.

### 5.1 Chronological-later rule

The frozen Product Specification and FG05 gate require a new date/time but do
not explicitly settle whether the replacement `startsAt` must be strictly
later than the previous published `startsAt`. “Postpone” suggests that it
should, but that semantic inference is not authority.

**PROPOSED — SENIOR DECISION REQUIRED:** require
`replacement.startsAt > currentPublished.startsAt` for every postpone. If this
decision is not approved, the runtime implementation must stop at this
contract question rather than accept an earlier or equal date by assumption.

Regardless of that decision, the replacement schedule must be complete and
must satisfy the `endsAt > startsAt` invariant.

## 6. Republish contract

Republishing is a dedicated command:

```text
expectedVersion
```

It is valid only for `postponed → published`. It cannot edit the schedule,
reason, audience, visibility, Campus, or Organiser. The replacement schedule
already stored as current Event state becomes the published schedule.

Before PMAFB, republish must revalidate the complete existing publish
dependencies inside the same transaction:

- explicit Tenant and Tenant lifecycle;
- trusted Membership/principal and current `event.manage` grant;
- Guild Term and grant expiry/revocation;
- Event row and expected version;
- Campus ownership and active status;
- current complete audience definition and target validity;
- academic-year target configuration;
- optional same-Tenant Organiser validity;
- current schedule validity.

Republish appends an immutable `republished` history row, advances the Event
version exactly once, appends `event.republished`, and commits all three facts
atomically. It must not erase, rewrite, or collapse postponement history.

## 7. Cancellation contract and retention

The dedicated cancel command is:

```text
expectedVersion
reason
```

Cancellation is valid only from `published` or `postponed`. It preserves the
current schedule, Organiser, audience, and every prior history row. There is no
cancellation reversal in this slice.

### 7.1 Effective published schedule

FG05-OD-02 defines cancellation after postponement using “the effective
published start date/time current when cancellation commits.” This checkpoint
recommends the following unambiguous interpretation for senior approval:

- when lifecycle is `published`, the effective published schedule is the
  current Event schedule;
- when lifecycle is `postponed`, the current replacement schedule is **not yet
  published**. The effective published schedule is the schedule represented by
  the latest immutable `postponedFrom` value, namely the last schedule that
  successfully reached `published`;
- after republish, the replacement schedule becomes the effective published
  schedule and is the value used by a later cancellation.

This preserves the distinction between the current replacement schedule and
the last effective published schedule without reconstructing state from
mutable fields. For example, cancellation of `postponed to B` after published
A uses A for the retention threshold; cancellation after B has been republished
and later postponed to C uses B.

### 7.2 Immutable cancellation-retention snapshot

At cancellation commit, persist an immutable `cancellationRetentionUntil`
snapshot equal to the effective published `startsAt` defined above. The future
runtime should add this nullable current-state field to `events` and store the
same value in the cancellation history row. It is null for non-cancelled
Events, set exactly once by the cancellation transition, and never changed
after cancellation. The two values must be written in the same transaction;
the current Event field supports bounded reads and the history field preserves
the immutable transition fact.

An Event cancelled after its retention threshold has already passed remains
durably cancelled but is immediately a derived-past projection. No background
job is needed.

## 8. Proposed append-only history structure

Product schedule/lifecycle history is separate from A6 privileged audit. A6
must not become the schedule-history store, and generic audit facts must not
contain full reasons or schedule payloads.

The recommended future table is `event_lifecycle_history`:

| Field | Requirement |
| --- | --- |
| `id` | Stable UUID primary key. |
| `tenantId` | Explicit Tenant owner. |
| `eventId` | Event identity, protected by a same-Tenant composite FK. |
| `sequence` | Positive, one-based, strictly append-only per `(tenantId, eventId)`. |
| `eventVersion` | Positive Event version after the transition; unique per Event. |
| `fromLifecycle` / `toLifecycle` | Exact governed transition pair. |
| `startsAt` / `endsAt` | Complete schedule after the transition. |
| `postponedFromStartsAt` | Required only for `published → postponed`; otherwise null. |
| `reason` | Required and bounded for postpone/cancel; null for publish/republish. |
| `cancellationRetentionUntil` | Required only for cancellation; immutable snapshot. |
| `occurredAt` | Authoritative PostgreSQL transition timestamp. |

The table must have:

- a unique `(tenantId, eventId, sequence)` constraint;
- a unique `(tenantId, eventId, eventVersion)` constraint;
- a same-Tenant `(tenantId, eventId) → events(tenantId, id)` foreign key;
- explicit Tenant-scoped indexes for direct history reads;
- checks tying transition type, lifecycle pair, reason, postponed-from value,
  and retention snapshot together;
- no update or delete application path;
- database privilege/trigger protection so the runtime principal cannot
  rewrite or remove history rows;
- no use as a substitute for the append-only A6 audit table.

The initial `draft → published` transition appends the first history row and
records the first published schedule. Draft creation and ordinary draft edits
do not create schedule history. This keeps the history about published
lifecycle/schedule facts rather than transient authoring values. If Product
authority intends “first-ever scheduled” to include unpublished draft values,
that must be decided before implementation.

The current `events` row remains the current authoritative state. Reads do not
become event-sourcing reconstruction: the current schedule/lifecycle/version
comes from `events`, while immutable history supplies `postponedFrom`, prior
published schedules, reasons under the approved visibility policy, and direct
history presentation.

## 9. Student and management read contract

Every read continues to enforce explicit Tenant, visibility, audience, and
public-read rules. Lifecycle must never bypass audience eligibility. A PUBLIC
Event may remain anonymously readable only through the existing public Tenant
surface; no identity is fabricated. Authenticated member-dependent reads and
management reads continue to require the trusted RequestContext seam.

### 9.1 Student projection

The future bounded Event projection may expose:

- `lifecycle`;
- current `startsAt` and `endsAt`;
- `postponedFrom` while postponed;
- `cancellationRetentionUntil` only as the approved bounded presentation
  needed to explain visibility, not as an authority input;
- a clear cancelled treatment while retained;
- derived `past`.

The client supplies no lifecycle, version, schedule, reason, retention, or
audience authority. No RSVP behavior is implemented here.

**PROPOSED — SENIOR DECISION REQUIRED:** Product authority requires mandatory
human-readable reasons to be persisted but does not expressly require raw
postponement/cancellation reason text in student reads. The conservative
proposal is to show students lifecycle, schedule, `postponedFrom`, and clear
cancelled treatment, while keeping raw reasons to authorized management/history
reads until Product explicitly approves student-visible reason text. A later
decision may expose a bounded reason without changing the lifecycle contract.

### 9.2 Lifecycle surface matrix

The following is the proposed explicit read matrix for senior approval. “Yes”
still means only after the existing Tenant/visibility/audience authorization.

| Lifecycle/projection | Home | Discover/upcoming | Direct read | Past/history read |
| --- | --- | --- | --- | --- |
| `published`, not derived past | Yes | Yes | Yes | Yes when requested by the approved history/read path |
| `postponed`, replacement schedule not derived past | Yes, with postponed treatment | Yes, while it is an upcoming replacement schedule | Yes | Yes |
| `cancelled`, before retention threshold | Yes, with clear cancelled treatment | No active/upcoming result; available through direct/history presentation | Yes | Yes |
| derived past, including cancelled after retention | No | No | Yes only under the approved direct-read policy | Yes |
| `draft` | No | No | Management-only under Event authority; never student-facing | No student exposure |

For a postponed Event whose replacement schedule reaches its derived-past
threshold, it leaves Home and active/upcoming Discover in the same way as
other past Events, while direct/history behavior remains governed. A cancelled
Event is not an actionable upcoming item, but remains visible through the
lifecycle-aware Home treatment and direct/history paths until its retention
threshold. This matrix is a bounded proposal, not permission to change current
runtime before senior approval.

## 10. Reason and history visibility

Postponement and cancellation reasons are first-class Product state:

- trimmed, non-empty, bounded input;
- stored in immutable history, never only in logs or A6;
- not copied into generic audit payloads;
- never overwritten by a later schedule revision;
- returned only through a specifically authorized management/history surface
  unless Product later approves student-visible reason text.

The history read must remain Tenant-bound and must not reveal a foreign Event's
existence through a bare Event or history identifier. A student projection must
not expose actor Membership identifiers, raw request data, or unrelated audit
facts.

## 11. PMAFB and transaction contracts

All four new lifecycle operations use the existing `event.manage` capability,
trusted RequestContext, `PostgresPrivilegedMutationAuthority`, and one
transaction. No lifecycle-local authorization algorithm or reusable lease is
allowed.

The common shape is:

```text
explicit Tenant
→ authority locks and current authority reads
→ Event row FOR UPDATE
→ expected-version check
→ lifecycle validation
→ transition-specific validation/resource locks
→ final authority re-read
→ fresh PostgreSQL clock_timestamp()
→ PMAFB
→ Event update
→ immutable history append
→ minimized A6 append
→ commit
```

No blocking resource lookup may begin after PMAFB. Event mutation, history
append, and required A6 append are one Product-state transaction. Any required
in-transaction failure rolls back all three.

### 11.1 Postpone lock set

Postpone needs:

- authority rows required by the shared PMAFB;
- the exact Tenant/Event row `FOR UPDATE`;
- no unrelated Campus, audience, or Organiser lock unless the final approved
  implementation proves it is required for the transition;
- the latest history facts needed to establish `postponedFrom`, read while the
  Event lock serializes the Event's transition history.

After final authority/time validation, update the Event, append the history
row, append `event.postponed`, and commit atomically.

### 11.2 Republish lock set

Republish uses the existing Event publish dependency order after the Event row
is locked:

- authority rows;
- Event row and expected version;
- active same-Tenant Campus;
- current audience targets in deterministic dimension/ID order;
- academic-year configuration/targets where applicable;
- optional same-Tenant Organiser;
- final authority/time/PMAFB;
- Event update, history append, and A6 append.

The implementation must preserve the already-reviewed Event Core lock order
and prove it with real PostgreSQL blocking evidence.

### 11.3 Cancel lock set

Cancel needs:

- authority rows required by PMAFB;
- exact Tenant/Event row `FOR UPDATE`;
- expected version and allowed lifecycle check;
- immutable history lookup under the Event lock to determine effective
  published schedule and retention snapshot.

It must not add unrelated Campus/audience/Organiser blocking work. After the
final authority/time check, it updates current lifecycle and retention,
appends history and `event.cancelled`, then commits.

## 12. A6 audit contract

Keep the existing `event.published` for `draft → published` and add the
smallest closed vocabulary for this slice:

```text
event.postponed
event.republished
event.cancelled
```

The proposed normalized Event audit facts are limited to:

```text
action
lifecycle
version
historySequence
```

`reason`, full schedules, audience definitions, title/body/venue, recipient
lists, contact facts, and raw request data do not belong in A6 unless a later
approved audit contract requires a narrowly defined fact. A6 remains an
append-only privileged audit trail, not the Product history store.

Each successful lifecycle mutation appends exactly one corresponding A6 event
after the guarded Product mutation. Denied, stale, malformed, invalid-state,
invalid-schedule, expired-authority, and true-no-op paths append no success
audit. History insertion failure or audit insertion failure rolls back the
Event mutation and the other append.

## 13. Tenant isolation, A2, and A4 obligations

A future runtime implementation must register the new surfaces narrowly in the
Tenant Surface Registry and A2 operation registry:

- `event_lifecycle_history` persistence and repository;
- `event.postpone` mutation;
- `event.republish` mutation;
- `event.cancel` mutation;
- direct/history Event reads;
- Home and Discover lifecycle projections;
- A6 event types and history relation.

A4 must record the new history identifier and the immutable relation to Event.
No directory-wide or infrastructure exemption is permitted.

Required negative evidence includes:

- Tenant A cannot postpone, republish, or cancel Tenant B's Event;
- Tenant A cannot read Tenant B's lifecycle history;
- a bare Event/history ID cannot disclose foreign existence;
- history rows cannot attach to an Event in another Tenant;
- Home and Discover queries retain explicit Tenant predicates;
- visibility and audience eligibility remain enforced for every lifecycle;
- foreign history labels, reasons, schedules, and counts never appear in a
  response or error detail.

## 14. Required real PostgreSQL evidence

The implementation checkpoint must use separate real PostgreSQL connections,
deterministic barriers, and explicit lock/blocking/commit-order evidence. A
sleep-only test is not proof. At minimum it must prove:

1. stale postpone returns `VERSION_CONFLICT`;
2. stale republish returns `VERSION_CONFLICT`;
3. stale cancel returns `VERSION_CONFLICT`;
4. two concurrent postponements have exactly one winner;
5. postpone versus cancel from one version has exactly one winner;
6. republish versus cancel has exactly one winner;
7. history sequences have no duplicates or gaps for committed transitions;
8. duplicate/retry attempts cannot append duplicate history silently;
9. authority revocation before PMAFB blocks the transition;
10. authority expiry while waiting before PMAFB blocks the transition;
11. history insertion failure rolls back the Event mutation;
12. A6 insertion failure rolls back Event and history;
13. denied, stale, invalid-state, invalid-schedule, and failed-audience paths
    leave Event/version/history/audit unchanged;
14. no blocking resource lookup occurs after PMAFB.

The future CH-EVT-003 integration must additionally prove both cancellation /
RSVP orderings, including `INVALID_STATE` when cancellation wins. Those tests
are dependency-gated and are not fabricated in this checkpoint.

## 15. Migration and implementation discipline

This documentation checkpoint creates no migration. If the runtime slice is
approved, it may create exactly one append-only migration after
`0018_parched_maximus.sql`, conventionally `0019_<generated-name>.sql`, with
its matching Drizzle snapshot and journal entry.

That future migration may add the history structure, required current Event
retention state, checks, indexes, same-Tenant foreign keys, and closed audit
vocabulary support. It must not edit migrations `0001`–`0018`, create a
compensating migration, or apply anything to production or a persistent
managed database as part of implementation review.

## 16. Explicit exclusions

This checkpoint does not authorize:

- RSVP implementation or RSVP persistence;
- cancellation/RSVP race implementation;
- cancellation recipient resolution;
- notification or outbox infrastructure;
- delivery, retry, or idempotency workers;
- scheduler, expiry job, background archive, or SYSTEM authority;
- XP, media, image, Publication, Organiser mutation, Auth/OD-03, Sports,
  sponsorship, deployment, or frontend redesign.

## 17. Senior decision register

The following decisions are presented explicitly for independent senior review.

| # | Decision | Proposed checkpoint position |
| --- | --- | --- |
| 1 | Append-only Event history schema | Approve `event_lifecycle_history` with same-Tenant Event FK, one-based per-Event sequence, unique Event version, complete after-transition schedule, immutable reasons, retention snapshot, and authoritative timestamp. |
| 2 | Full replacement schedule | Approve required `startsAt` plus explicit `endsAt`/`null`; never retain the old `endsAt`. |
| 3 | Chronologically later replacement | **OPEN — SENIOR DECISION REQUIRED.** Recommend replacement `startsAt` strictly later than the current published `startsAt`. |
| 4 | Effective published schedule | **PROPOSED — SENIOR CONFIRMATION REQUIRED.** For a postponed Event, use the latest `postponedFrom` / last successfully published schedule, not the unpublished replacement. |
| 5 | Cancellation retention snapshot | Approve immutable `cancellationRetentionUntil` equal to the effective published `startsAt`, stored in current Event state and cancellation history. |
| 6 | Postponed Home behavior | Proposed: show while replacement schedule is not derived past, with postponed treatment and all existing eligibility checks. |
| 7 | Postponed Discover behavior | Proposed: show in upcoming results while replacement schedule is not derived past, with postponed treatment and all existing eligibility checks. |
| 8 | Cancelled Home behavior | Proposed: show with clear cancelled treatment until retention threshold; then remove as derived past. |
| 9 | Cancelled Discover behavior | Proposed: exclude from active/upcoming Discover because it is no longer actionable; retain direct/history access while policy permits. |
| 10 | Direct Event read | Proposed: retain Tenant/visibility/audience authorization; return postponed/cancelled lifecycle treatment while retained; never expose drafts to students. |
| 11 | History/past read | Proposed: bounded Tenant-authorized history/direct path may expose immutable schedule/lifecycle facts and derived past; no foreign existence leakage. |
| 12 | Student visibility of reasons | **OPEN — SENIOR DECISION REQUIRED.** Conservative proposal: raw reason remains management/history-only; students receive lifecycle, schedule, postponed-from, and clear cancelled treatment. |
| 13 | A6 vocabulary | Approve `event.postponed`, `event.republished`, `event.cancelled`, retaining `event.published`; facts are action/lifecycle/version/historySequence only. |
| 14 | PMAFB lock sets | Approve authority → Event → transition-specific resources → final authority/time → PMAFB → Event/history/A6, with no post-PMAFB blocking lookup. |
| 15 | History sequence/version | Approve sequence starts at 1 for initial publish, increments once per committed durable lifecycle transition, and is unique with post-transition Event version. |
| 16 | RSVP-race dependency | Deferred to CH-EVT-003; cancellation-wins `INVALID_STATE` invariant is required future evidence, not implemented here. |
| 17 | Cancellation notification dependency | Deferred to CH-NTF; current `going`/`interested` holders are mandatory, non-disableable recipients; delivery is post-commit and retryable/idempotent later. |
| 18 | Persisted past/scheduler | Approve no persisted `past`, scheduler, worker, SYSTEM transition, or expiry job. |
| 19 | First runtime slice boundary | Approve postpone, republish, cancel, history, retention, read projections, A6, isolation, and PostgreSQL evidence only. |
| 20 | Full CH-EVT-004 qualifier | Approve that full story completion is not claimed until RSVP race and cancellation-notification dependencies are separately available and evidenced. |

## 18. Validation and review gate

This checkpoint must remain exactly one changed file:

```text
docs/governance/ch-evt-004-postpone-cancel-implementation-checkpoint.md
```

Before review, run documentation/governance validation, frozen-document
integrity checks, `git diff --check`, and Gitleaks over the checkpoint range.
No runtime, schema, migration, test, CI, UI, or frozen-document file may be
modified.

After the normal documentation commit and push to
`codex/ch-evt-004-postpone-cancel-gate`, obtain a fresh read-only `gpt-5.6-sol`
High review against the exact pushed SHA. The reviewer must specifically
evaluate history completeness, repeated postponement semantics, effective
published schedule, cancellation retention, student/Home/Discover reads,
PMAFB lock ordering, A6 minimization, Tenant isolation, RSVP/notification
dependency boundaries, and scope leakage.

The review is read-only. It may not modify files, create commits, push, merge,
promote, implement Event runtime, alter schema/migrations, deploy, or change
Auth/OD-03, Sports, Agent Orchestrator, or KlinKlik.

The implementation must not begin in this operation. The expected checkpoint
status remains:

```text
CH-EVT-004 POSTPONE/CANCEL CHECKPOINT — AWAITING SENIOR REVIEW
```

The full story qualifier remains:

```text
FULL CH-EVT-004 STORY COMPLETION NOT CLAIMED — RSVP RACE AND CANCELLATION NOTIFICATION DEPENDENCIES REMAIN
```
