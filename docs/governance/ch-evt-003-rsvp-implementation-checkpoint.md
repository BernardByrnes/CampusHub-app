# CH-EVT-003 — RSVP and Interest Implementation Checkpoint

- Status: **CH-EVT-003 RSVP CHECKPOINT — AWAITING SENIOR REVIEW**
- Repository: CampusHub-app
- Foundation: codex/8v-b-next-foundation
- Foundation SHA: 6eb4d5bc4d24b6cb0432f9e7093888b003520f63
- Checkpoint branch: codex/ch-evt-003-rsvp-gate
- Checkpoint type: governance and implementation authorization only
- Runtime status: not implemented by this checkpoint

## 1. Purpose and boundary

This document is the bounded implementation checkpoint for the RSVP and Interest
slice of CH-EVT-003. It translates the already approved Product Specification,
the v1.3 Implementation Blueprint, FG-05, and the existing Event contracts into
an implementation boundary that a later runtime checkpoint can be reviewed
against.

This document does not implement RSVP, Interest, XP, notifications, Auth,
transport, a migration, or a database schema. It does not close FG-05 as a
whole and it does not claim that CH-EVT-003 is complete.

The later implementation must stop if a requirement in this document is not
available from an approved authority or a separately approved dependency. An
implementation agent must not fill an open decision with an invented default.

The retained completion qualifier is:

**FULL CH-EVT-003 STORY COMPLETION NOT CLAIMED — XP AND NOTIFICATION
DEPENDENCIES REMAIN**

The following existing qualifiers remain in force:

**FULL CH-EVT-004 STORY COMPLETION NOT CLAIMED — RSVP RACE AND CANCELLATION
NOTIFICATION DEPENDENCIES REMAIN**

**FULL CH-EVT-002 STORY COMPLETION NOT CLAIMED — PUBLICATION ATTRIBUTION AND
OPTIONAL LOGO REMAIN GATED**

**FULL CH-EVT-001 STORY COMPLETION NOT CLAIMED — EVENT MEDIA DEPENDENCY REMAINS**

## 2. Authority and inspected baseline

This checkpoint is subordinate to applicable external authority, the frozen
Product Specification, approved Product Owner decisions, approved architecture
and security ADRs, approved checkpoint contracts, and the frozen Implementation
Blueprint in the order established by the governing documents.

The checkpoint was prepared against the exact promoted foundation
6eb4d5bc4d24b6cb0432f9e7093888b003520f63. The implementation agent must
reconfirm the exact base before starting runtime work.

The review baseline includes:

- CampusHub_Product_Specification_v1.3_FROZEN.md;
- CampusHub_Implementation_Blueprint_v1.3_FROZEN.md;
- docs/governance/campushub-v1.3-controlled-refreeze.md;
- docs/governance/fg05-events-lifecycle-gate.md;
- the approved PMAFB contract;
- the CH-EVT-001 Event Core checkpoint;
- the CH-EVT-002 Organiser checkpoint;
- the CH-EVT-004 Lifecycle Core checkpoint;
- the existing Event domain, repository, read, management, context, registry,
  and PostgreSQL integration code.

The historical v1.2 documents remain historical authority records and are not
modified or silently replaced by this checkpoint.

## 3. Product contract

CH-EVT-003 provides a Student-facing current RSVP or Interest state for an
eligible Event. The Pilot state vocabulary is:

- going;
- interested;
- withdrawn.

The durable current state is scoped to one Tenant, one Event, and one
Membership. There is at most one current row for that tuple. A later
implementation may retain immutable operational history only when an approved
audit or history contract requires it; this checkpoint does not authorize an
unbounded attendance ledger or an identity-revealing student list.

The approved user-visible behaviour is:

1. an eligible Student may choose going or interested for an actionable Event;
2. a Student may change between going and interested while the Event is
   actionable;
3. a Student may withdraw while the Event is actionable;
4. a repeated request for the already-current state is an idempotent no-op;
5. a permitted state change replaces the current state exactly once;
6. a withdrawn state does not make a Student eligible to bypass Event,
   Membership, assurance, or time checks;
7. no new RSVP mutation is accepted after the Event starts;
8. no RSVP mutation is accepted while the Event lifecycle is postponed or
   cancelled;
9. after an approved republish, normal RSVP actionability can resume subject to
   the new schedule and the same authorization checks;
10. RSVP does not create a check-in, attendance, roster, or attendee directory.

The current Event lifecycle and schedule remain authoritative. RSVP must not
silently change Event title, audience, visibility, schedule, lifecycle,
organiser, or any other Event field.

## 4. Product and dependency limits

The later implementation is limited to the RSVP and Interest contract. It must
not implement or imply:

- Poll A1;
- Student Voice;
- Team Follow;
- a public attendee list;
- check-in or attendance;
- standings or manual tables;
- XP award calculation;
- notification or outbox delivery;
- reminder, change, or cancellation delivery;
- Auth or OD-03;
- a new identity/session producer;
- scheduling, workers, or expiry jobs;
- Event media;
- organiser replacement;
- deployment or production migration.

CH-XP-002 remains a prerequisite for the one-XP-per-Event acceptance criterion.
CH-NTF notification infrastructure remains a prerequisite for reminder,
schedule-change, and cancellation notifications. The RSVP implementation must
expose the governed event points for those integrations without pretending that
the dependencies exist.

The implementation must use the existing server-produced trusted
RequestContext and identitySubjectId seam. Query parameters, arbitrary headers,
client cookies, browser-supplied identity, and test identities must not be
accepted as authority.

## 5. GSC-14 participation evaluation

RSVP and Interest are participation actions governed by the shared GSC-14
evaluator. The evaluation order is fixed:

1. Tenant lifecycle;
2. module enabled;
3. resource exists and is actionable;
4. current Membership state;
5. assurance;
6. Event audience and frozen cohort;
7. verified attributes;
8. story-specific prerequisites.

The evaluator returns one primary denial, using the existing governed error
families. The implementation must not expose a foreign Tenant resource by
returning a different error merely because an identifier was supplied.

RSVP is a Student participation mutation. It is not a privileged Event
management mutation and must not be authorized by event.manage, a role name,
publication authority, a stale RequestContext, or a client-supplied grant.
The current Membership and assurance facts must be revalidated in the RSVP
transaction under the same authority rules used by the Event read and
participation contracts.

The module-enabled condition must be backed by an authoritative fact. The
current inspected runtime does not provide a persisted Event-module-enabled
record that can be safely substituted by active Tenant status. A runtime
implementation must add or identify an approved module-enabled source before
it reports an Event as module-enabled. Treating every active Tenant as
module-enabled is not permitted.

## 6. Eligibility and state semantics

An RSVP request is eligible only when all applicable GSC-14 conditions hold:

- the Tenant is active;
- the Event module is enabled by an authoritative source;
- the Event exists in the caller's Tenant and is visible to the caller;
- the Event is published and not derived-past;
- the Event is not postponed or cancelled;
- RSVP is enabled for the Event;
- the current Membership is active and eligible;
- the assurance and Event-audience predicates pass;
- the Event has not reached its authoritative start instant;
- the requested state and expected version are well formed.

The existing Event derived-past rule remains authoritative. An Event is past at
the authoritative Tenant/server time reaching endsAt when endsAt exists, or
startsAt otherwise. RSVP is closed at startsAt even where a later endsAt exists.
No scheduler or persisted automatic archive transition is introduced.

The canonical GSC-14 primary denial is selected in the fixed evaluator order.
The mapping is exact; a generic fallback must not replace an earlier canonical
participation denial:

| GSC-14 step | Condition | Required outcome |
| --- | --- | --- |
| 1. Tenant lifecycle | Tenant lifecycle blocks participation | TENANT_SUSPENDED |
| 2. module enabled | The authoritative Event module is disabled | MODULE_DISABLED |
| 3. resource exists/actionable | The Event is unavailable in the caller's authorized context | NOT_FOUND, or TENANT_SCOPE_NOT_FOUND where that existing Tenant boundary requires it |
| 3. resource exists/actionable | An ordinary Event is not in an actionable serving state, RSVP is disabled, the start instant has been reached, the Event is postponed, or the Event is derived-past | RESOURCE_NOT_ACTIVE |
| 3. cancellation override | A cancellation committed before the RSVP can commit | INVALID_STATE with the current Event state, as required by CH-EVT-004 |
| 4. current Membership state | Membership is stale, suspended, participation-suspended, alumni, transferred-out, closed, or otherwise ineligible | MEMBERSHIP_STATE_INELIGIBLE |
| 5. assurance | Required assurance is not present | ASSURANCE_REQUIRED |
| 6. resource audience/frozen cohort | Current Membership is outside the Event audience | AUDIENCE_INELIGIBLE |
| 7. verified attributes | A required verified participation fact is unavailable | PREREQUISITE_MISSING |
| 8. story-specific prerequisites | A prerequisite remains missing after the earlier steps | PREREQUISITE_MISSING |

The evaluator returns exactly one primary GSC-14 denial. In particular,
TENANT_SUSPENDED, MODULE_DISABLED, MEMBERSHIP_STATE_INELIGIBLE,
ASSURANCE_REQUIRED, AUDIENCE_INELIGIBLE, and PREREQUISITE_MISSING are not
collapsed to PERMISSION_DENIED. A foreign Event is never exposed merely
because a version or idempotency token was supplied.

VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, and INVALID_INPUT are later
request/concurrency outcomes, not substitutes for an earlier GSC-14 denial.
They apply only after the authoritative participation evaluation allows the
request to reach the relevant request or concurrency boundary.

The following transition table is the minimum contract:

| Current state | Requested going | Requested interested | Requested withdrawn |
| --- | --- | --- | --- |
| no current row | create | create | invalid: no prior RSVP to withdraw |
| going | no-op | update | update |
| interested | update | no-op | update |
| withdrawn | update/reactivate | update/reactivate | no-op |

The withdrawn-to-going and withdrawn-to-interested transitions are already
authorized by the frozen Event RSVP state model and CH-EVT-003. They update the
same current RSVP row; they do not create a second RSVP or Membership
relationship. Reactivation is permitted only before startsAt and only after
the same fresh GSC-14 and Event-actionability evaluation as every other
state-changing RSVP mutation. It never bypasses RSVP enabled, audience,
assurance, Membership, Event lifecycle, or the authoritative time boundary.

While an Event is postponed, no new RSVP, state change, withdrawal, or
reactivation is permitted. Existing current rows are preserved and are not
automatically withdrawn. After republish, the new schedule governs actionability.

## 7. Request shape and server ownership

The narrow command input is limited to:

- the Event identifier;
- requested state;
- expectedParticipationVersion;
- a stable idempotency key.

The client does not provide:

- identitySubjectId;
- Tenant id;
- Membership id;
- assurance level;
- Event visibility or audience;
- audience eligibility;
- module-enabled status;
- Event lifecycle;
- server time;
- XP amount;
- notification recipients;
- participationVersion after the mutation;
- Event version as a Student concurrency token.

The server derives all of those facts from trusted context, current database
rows, authoritative policy, and the transaction clock. The successful response
returns the canonical current state and participationVersion produced by the
transaction.

## 8. Idempotency and version contract

RSVP is retry-sensitive under GSC-7. A durable, Tenant-scoped retry record or
an existing equivalent must be used. An in-memory map, process-local cache,
browser key, or best-effort log is not sufficient.

The idempotency identity must bind at least:

- Tenant;
- Membership;
- Event;
- operation family;
- stable idempotency key.

The stored request fingerprint must include every material input, including
requested state and expectedParticipationVersion, plus the existing
Tenant/Membership/Event/operation identity.
Replaying the same key and same material request returns the original canonical
result without a second state change, second XP award, or second notification
enqueue. Reusing a key for a materially different request returns
IDEMPOTENCY_CONFLICT.

The current RSVP row owns a positive participation version. Conceptually,
event_rsvps.version is at least 1 and means RSVP/current-participation version;
it is not the Event version. The command token is exactly
expectedParticipationVersion:

- 0 is a command sentinel meaning that no current RSVP row is expected; it is
  never persisted as a participation version;
- a first successful none-to-going or none-to-interested mutation creates
  participationVersion 1;
- every successful state-changing mutation of an existing row advances
  participationVersion from N to N + 1 exactly once;
- a materially stale state-changing request whose expectedParticipationVersion
  differs from the authoritative current version returns VERSION_CONFLICT with
  no RSVP, Event, XP, notification, or outbox mutation;
- a same-state request is a semantic no-op after authoritative row locking and
  fresh GSC-14 evaluation. It returns the authoritative current state and
  participationVersion, does not increment the version or updatedAt, and does
  not manufacture a write merely to satisfy an older well-formed token;
- malformed participation-version input remains INVALID_INPUT.

The Event version remains internal to Event management and lifecycle
concurrency. A Student RSVP command never asks the client to predict Event
version. RSVP locks and rereads the Event row, so cancellation, postponement,
republish, lifecycle, schedule, and fresh database-time checks still serialize
through that row.

The implementation must decide, through the approved persistence contract, how
the retry record and current participation row are atomically claimed. It must
not make two independent commits for idempotency and participation mutation.

Durable request idempotency remains separate from same-state semantic
idempotence. A same key plus the same fingerprint returns the original
canonical result even if the current participation version has changed after
that commit. A same key plus a materially different fingerprint returns
IDEMPOTENCY_CONFLICT.

## 9. Participation-version concurrency examples

The runtime and PostgreSQL tests must implement these examples:

### Two simultaneous first going requests

Both requests use expectedParticipationVersion 0. One transaction inserts
going with participationVersion 1. The other observes authoritative
going/version 1 after the row conflict and returns that current state as the
permitted same-state no-op. Exactly one current row exists.

### Simultaneous first going and interested requests

Both requests use expectedParticipationVersion 0. One inserts version 1. The
other observes a materially different authoritative state and returns
VERSION_CONFLICT. It does not silently overwrite the winner.

### Two simultaneous identical state changes

For going/version 3 to interested, both requests use expectedParticipationVersion
3. The winner commits interested/version 4. The loser rereads interested/version
4 and returns it as a same-state no-op. It does not write version 5.

### Simultaneous different state changes

One valid state change wins and increments once. A materially different stale
loser returns VERSION_CONFLICT without a second overwrite. The same model
applies to withdrawal and withdrawn reactivation.

## 10. Transaction and lock boundary

Eligibility, authorization, current state, time, idempotency, aggregate
effect, and current-row mutation are one database transaction. There is no
read-readiness transaction followed by a later publish-style mutation.

The lock order must be deterministic and compatible with the existing Event
lifecycle path. The proposed order is:

1. authoritative Tenant scope row;
2. current Membership row;
3. any authoritative module-enabled row;
4. exact Event row with a row lock;
5. current participation row for the Membership and Event;
6. durable idempotency row/key;
7. final re-read of authority, lifecycle, schedule, audience, version, and
   server time;
8. guarded current-row write and the transaction's governed side effects.

If an existing approved repository contract requires a different order, the
implementation must document why it remains deadlock-safe and must preserve the
Event lifecycle lock order. The exact Event row must be locked before the final
RSVP actionability decision.

The transaction must use an authoritative server/database clock at the final
decision point. It must not use a browser timestamp or a stale RequestContext
timestamp. A request that blocks across the Event start boundary must be
re-evaluated after the Event lock is acquired; it must not commit an RSVP after
the start instant.

No post-authority blocking is allowed for an Event management mutation, and
RSVP itself must not call PMAFB because it is not event.manage. The transaction
must still apply the same current authority and Tenant-scope facts that GSC-14
requires.

## 11. Lifecycle race contract

Cancellation and postponement serialize through the authoritative Event row.
The following outcomes are mandatory:

| First committed operation | Waiting operation | Required result |
| --- | --- | --- |
| RSVP | cancellation | RSVP is committed if it was valid at its lock decision; cancellation then sees the committed row and applies its governed cancellation behaviour |
| cancellation | RSVP | RSVP rereads the cancelled Event and fails with the existing INVALID_STATE family; no RSVP, XP, or notification side effect is committed |
| RSVP | postponement | postponement rereads the current participation and preserves the governed RSVP/history semantics |
| postponement | RSVP | RSVP rereads postponed lifecycle and fails closed; existing participation is preserved |
| republish | RSVP | RSVP uses the newly committed schedule and lifecycle after the lock |
| RSVP | republish | republish observes the current participation according to the approved lifecycle contract |

For cancellation, every current going or interested participation that is in
the governed notification audience remains available to the future
CH-NTF integration. This checkpoint does not enqueue or send that notification.

No race test may rely on an arbitrary sleep. Real PostgreSQL row locks,
barriers, backend PIDs, pg_stat_activity, pg_blocking_pids, or equivalent
deterministic evidence must prove the blocking relationship.

## 12. Time and schedule boundaries

The authoritative RSVP close instant is Event startsAt. The transaction must
also apply the existing derived-past rule and lifecycle state. A future
endsAt does not extend the RSVP window beyond startsAt.

Required boundary tests for the future runtime include:

- no endsAt and a future startsAt;
- an endsAt after startsAt;
- startsAt exactly equal to the authoritative decision time;
- startsAt before the decision time;
- a request blocked before the start and released after the start;
- postponement before a request;
- republish with a future replacement schedule;
- cancellation after one or more postponements.

The database clock used for the final decision must be observable in test
fixtures and must not be supplied by the request.

## 13. Read projections and privacy

Student reads expose only the caller's own current participation state and the
aggregate counts permitted by the approved Event read contract. They do not
expose:

- attendee identities;
- membership identifiers;
- a list of going or interested students;
- withdrawn student identities;
- check-in state;
- attendance records;
- cross-Tenant counts.

Publisher or other management reads may receive aggregate counts only when the
existing Event management authority and Tenant scope allow it. Management
reads do not become an attendee directory by virtue of holding event.manage.

The implementation must document the read behaviour for postponed and
cancelled Events. Existing approved Event history and retention rules remain
authoritative. A future implementation must not infer that cancelled retention
permits mutation or public identity exposure.

Collection queries must apply Tenant filtering before pagination or aggregation.
Detail reauthorization must run for every Event identifier. Empty optional
filters must normalize to unset rather than broadening a query.

## 14. Audit and minimization

GSC-8 does not require an audit row for every ordinary Student read or
participation action. This checkpoint does not add a new audit vocabulary entry
or authorize a new audit table.

If the approved A6 security architecture later requires an RSVP security event,
that event must be separately named, minimized, Tenant-scoped, and written
atomically with the governed action. It must not contain a recipient list or
turn RSVP into an attendance ledger.

The later implementation must never log contact channels, assurance evidence,
full identity data, or a hidden attendee directory merely to support RSVP.
Required future notification delivery must use the separately approved
notification contract and must not be simulated by an audit insert.

## 15. Tenant isolation and governance

The future runtime must add narrow Tenant-surface registry entries for the RSVP
commands, current-state reads, aggregate projections, idempotency record, and
any approved history. Each entry must identify the Tenant owner, operation
category, authorization seam, and negative evidence.

There is no global RSVP repository exemption. No constructor, helper, export
alias, CommonJS escape, module-load side effect, or test-only path may bypass
the A2 registry. New runtime surfaces must pass the complete registry
validator.

The future implementation must preserve:

- same-Tenant Event and Membership relations;
- same-Tenant idempotency and current participation rows;
- no foreign-Tenant existence leak;
- current RequestContext identitySubjectId binding;
- default-deny policy;
- A4 Global User versus Tenant Membership boundary;
- A6 minimization and append-only rules where a separately approved event is
  required.

Required negative tests include:

- foreign Tenant Event identifier;
- foreign Membership identifier;
- wrong identitySubjectId;
- stale or suspended Membership;
- assurance below the Event audience requirement;
- disabled Tenant;
- disabled Event module;
- postponed Event;
- cancelled Event;
- past Event;
- RSVP disabled;
- wrong resource/module scope;
- forged client authority and forged version;
- cross-Tenant collection and aggregate queries.

## 16. PostgreSQL evidence required for runtime authorization

The later runtime checkpoint must include real PostgreSQL evidence, not only
mocked repository tests. The minimum matrix is:

| ID | Scenario | Required evidence |
| --- | --- | --- |
| RSVP-PG-01 | two valid requests for one expected version | exactly one state change and one winner |
| RSVP-PG-02 | same-state concurrent retries | one canonical result, no duplicate transition or XP |
| RSVP-PG-03 | going versus interested | one winner, stale loser, no silent overwrite |
| RSVP-PG-04 | RSVP versus cancellation | deterministic Event-row blocking and governed winner/loser outcome |
| RSVP-PG-05 | RSVP versus postponement | deterministic blocking and no action while postponed |
| RSVP-PG-06 | request crosses startsAt while blocked | final server-time recheck denies after start |
| RSVP-PG-07 | idempotency replay after commit | original result and no duplicate side effect |
| RSVP-PG-08 | idempotency key conflict | IDEMPOTENCY_CONFLICT with no mutation |
| RSVP-PG-09 | foreign Tenant and wrong Membership | no existence leak and no write |
| RSVP-PG-10 | aggregate isolation | counts cannot cross Tenant boundaries |
| RSVP-PG-11 | malformed or missing module authority | fail closed rather than assuming active Tenant means enabled |
| RSVP-PG-12 | postponed then republished | preserved prior state and new schedule governs actionability |

Every race must report committed versions, final lifecycle, current
participation state, idempotency outcome, and side-effect counts. No required
scenario may be marked PASS when it was skipped.

## 17. Future persistence and migration discipline

This documentation checkpoint creates no schema and no migration. The current
migration head remains 0019_high_harry_osborn.sql.

If the later implementation requires persistence, it must propose a new
append-only migration after the current head, currently described only as
0020_<generated-name>.sql. Historical migrations must not be rewritten.

The implementation must justify the exact tables, keys, indexes, foreign keys,
and retention fields. At minimum, any current participation table must enforce
Tenant/Event/Membership consistency and one current row per tuple. Any durable
idempotency record must be Tenant-scoped and uniquely bound to its operation
identity. No migration may create an attendee directory, XP table, notification
outbox, scheduler, or unrelated audited domain.

Production migration application is outside this checkpoint and requires the
separate deployment gate.

## 18. Future implementation surface

The later implementation may add only the minimum surface for:

- a Student RSVP/Interest application service;
- a current-state repository and bounded aggregate query;
- a durable retry/idempotency repository;
- policy functions reusing Event audience and GSC-14;
- an Event detail/read projection containing the caller's own state;
- a bounded Publisher aggregate projection if already authorized;
- PostgreSQL integration fixtures and governance probes.

The implementation must not add:

- a public attendee route;
- a roster or check-in model;
- an XP award engine;
- notification transport;
- worker scheduling;
- a new authentication provider;
- a Team Follow implementation;
- a new Event lifecycle state;
- a background archive mutation.

The existing trusted-context seam remains the only permitted identity input.

## 19. Senior decision register

The following decisions are fixed by existing authority for this checkpoint:

| Ref | Decision | Status |
| --- | --- | --- |
| EVT-RSVP-01 | RSVP and Interest are Student participation actions | supplied |
| EVT-RSVP-02 | event.manage is not required for Student RSVP | supplied |
| EVT-RSVP-03 | current state is scoped by Tenant, Event, and Membership | supplied |
| EVT-RSVP-04 | one current row exists for a tuple | supplied |
| EVT-RSVP-05 | going is a valid current state | supplied |
| EVT-RSVP-06 | interested is a valid current state | supplied |
| EVT-RSVP-07 | withdrawal and reactivation are valid actions while actionable | supplied |
| EVT-RSVP-08 | same-state request is an idempotent no-op | supplied |
| EVT-RSVP-09 | going and interested may replace one another | supplied |
| EVT-RSVP-10 | RSVP closes at Event startsAt | supplied |
| EVT-RSVP-11 | derived past uses endsAt or startsAt | supplied |
| EVT-RSVP-12 | postponed Event rejects new RSVP mutation | supplied |
| EVT-RSVP-13 | cancelled Event rejects new RSVP mutation | supplied |
| EVT-RSVP-14 | existing participation is not auto-withdrawn on postponement | supplied |
| EVT-RSVP-15 | republish may reopen actionability under new schedule | supplied |
| EVT-RSVP-16 | aggregate counts only are exposed | supplied |
| EVT-RSVP-17 | attendee identity list is not exposed | supplied |
| EVT-RSVP-18 | check-in and attendance are out of scope | supplied |
| EVT-RSVP-19 | GSC-14 order is mandatory | supplied |
| EVT-RSVP-20 | trusted RequestContext is server-owned | supplied |
| EVT-RSVP-21 | identitySubjectId is never client supplied | supplied |
| EVT-RSVP-22 | state-changing RSVP mutations use expectedParticipationVersion; Event version is not the Student RSVP command token | supplied |
| EVT-RSVP-23 | GSC-7 durable retry semantics apply | supplied |
| EVT-RSVP-24 | conflicting idempotency key is rejected | supplied |
| EVT-RSVP-25 | one transaction covers decision and mutation | supplied |
| EVT-RSVP-26 | Event row lock serializes lifecycle races | supplied |
| EVT-RSVP-27 | final authoritative time is rechecked | supplied |
| EVT-RSVP-28 | no scheduler is added for derived past | supplied |
| EVT-RSVP-29 | XP award is one per Event but dependency is deferred | gated |
| EVT-RSVP-30 | reminder/change/cancel notification is deferred | gated |
| EVT-RSVP-31 | no new RSVP audit table is authorized | supplied |
| EVT-RSVP-32 | no Auth implementation is authorized | supplied |
| EVT-RSVP-33 | no module-enabled assumption from Tenant activity is allowed | blocker |
| EVT-RSVP-34 | withdrawn to going/interested reactivation is allowed before startsAt, subject to complete fresh GSC-14 and Event actionability | supplied |
| EVT-RSVP-35 | postponed/cancelled aggregate read retention must follow Event authority | implementation confirmation |
| EVT-RSVP-36 | exact durable idempotency schema requires implementation review | implementation confirmation |
| EVT-RSVP-37 | notification recipient derivation is future CH-NTF work | gated |
| EVT-RSVP-38 | RSVP story is not complete until dependencies are evidenced | supplied |
| EVT-RSVP-39 | expectedParticipationVersion 0 means no current row expected and is never persisted | supplied |
| EVT-RSVP-40 | the first persisted participationVersion is 1 | supplied |
| EVT-RSVP-41 | a successful state change advances participationVersion from N to N + 1 exactly once | supplied |
| EVT-RSVP-42 | same-state no-op returns the authoritative current participationVersion without increment | supplied |
| EVT-RSVP-43 | Event version remains internal lifecycle concurrency and is not the RSVP token | supplied |
| EVT-RSVP-44 | GSC-14 uses exact canonical denial families in order, with the CH-EVT-004 cancellation INVALID_STATE override | supplied |

Rows marked blocker, open implementation decision, or implementation
confirmation must be resolved by explicit authority or fail-closed runtime
behaviour before a later candidate can claim completion.

## 20. Review blockers and approval conditions

Independent review must confirm at least:

1. the document changes no runtime, schema, migration, frozen authority, or
   existing governance file;
2. the state and audience contract is consistent with Product and FG-05;
3. the use of GSC-14 is exact and does not turn RSVP into event.manage;
4. the durable idempotency requirement prevents duplicate effects;
5. the Event-row serialization contract closes lifecycle races;
6. the start-time boundary is server-owned and rechecked after blocking;
7. aggregate-only privacy is preserved;
8. XP and notification dependencies remain explicitly gated;
9. the module-enabled blocker is not hidden by an active-Tenant shortcut;
10. the future migration and registry boundary is narrow and append-only;
11. all required PostgreSQL evidence is explicit and deterministic;
12. no implementation agent could reasonably infer Auth, public attendee
    identity, scheduling, notification delivery, or XP completion from this
    checkpoint.

A reviewer returning FIX_REQUIRED must identify the exact finding. No runtime
implementation or repair is authorized by this document.

## 21. Later validation contract

Before a later runtime candidate may be reviewed, it must run the applicable
focused domain, application, repository, Event lifecycle, architecture,
Tenant-isolation, A4, and governance tests. It must then run real PostgreSQL
integration evidence for RSVP-PG-01 through RSVP-PG-12, with no required test
skipped.

The normal quality gates are:

- npm run test:unit;
- npm run typecheck;
- npm run lint;
- npm run build;
- npm run db:check;
- git diff --check;
- configured Gitleaks;
- exact-SHA GitHub CI including PostgreSQL integration.

The later candidate must report:

- exact parent and candidate SHA;
- migration name and applied test database state;
- Tenant-surface registry and negative probes;
- GSC-14 denial precedence;
- exact idempotency and version outcomes;
- Event-row lock evidence;
- start-time race evidence;
- lifecycle race evidence;
- aggregate privacy evidence;
- XP and notification dependency status.

## 22. Explicit non-authorization

This checkpoint does not authorize:

- CH-EVT-003 runtime implementation by itself;
- CH-EVT-004 additional runtime work;
- CH-EVT-005 or any other Event story;
- XP implementation;
- notification or outbox implementation;
- Auth or OD-03;
- Polls or Student Voice;
- Team Follow;
- standings, Results, or Team pages;
- Event media or organiser expansion;
- scheduling, jobs, or persisted archive transitions;
- production migrations or deployment;
- Agent Orchestrator changes;
- KlinKlik changes;
- modification of the frozen Product Specification or Blueprint.

The only requested outcome is independent review of this documentation
checkpoint. The status remains:

**CH-EVT-003 RSVP CHECKPOINT — AWAITING SENIOR REVIEW**
