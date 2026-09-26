# CampusHub OD-08 SYSTEM / Background Execution Decision

Status: **OD-08 CLOSED — GENERIC CAMPUSHUB SYSTEM/BACKGROUND EXECUTION ARCHITECTURE**

- Prepared: 2026-09-26
- Scope: CampusHub Pilot
- Decision class: Product / Architecture / Operations
- Approved source architecture: docs/governance/od08-system-background-execution-gate.md
- Source architecture SHA: 63ff42835fff058fced175daaaca0e754a82f237
- Source architecture disposition: APPROVED / NONE
- Approved proposal SHA: ff3979c341dac44054a105d153f116ee0d9dfb45
- Runtime disposition: NONE
- Deployment disposition: NONE

## 1. Purpose and decision boundary

This record memorializes the CampusHub Product Owner's approval of the bounded
D01–D14 decisions below as one controlled Product / Architecture / Operations
decision. Approval is bound to the proposal at SHA
ff3979c341dac44054a105d153f116ee0d9dfb45. This recording update changes
approval/status metadata only; it does not change the approved D01–D14
substance.

The approved OD-08 SYSTEM/background execution architecture gate is the
technical basis for the D01–D14 decision. This record adopts that architecture
substantially as written and makes the initial policy selections explicit. No
concrete contradiction with higher authority was identified during review.

The governing authority was considered in this order:

1. CampusHub_Product_Specification_v1.3_FROZEN.md;
2. explicit Product Owner supersessions and approved decision records;
3. the independently approved OD-08 architecture gate identified above;
4. CampusHub_Implementation_Blueprint_v1.3_FROZEN.md; and
5. the controlled refreeze and applicable A2, A4, A6, PMAFB, and feature-gate
   records, followed by runtime and test evidence.

Neither frozen governing document is modified by this decision record. Before
the approval recorded here, OD-08 remained open and the existing
implementation blocks remained in force. The approval closes OD-08 only for
the generic CampusHub SYSTEM/background execution architecture and policies
expressly stated here. It does not authorize implementation or supersede
unrelated Product decisions, feature gates, or checkpoint requirements.

The approval recorded here resolves only the generic
OD-08-open status and architecture questions that the controlled refreeze,
Blueprint, and related gates expressly reserved for OD-08. Their statements
that OD-08 was open remain historically accurate for the state before this
approval; their remaining safeguards and future-runtime sequencing
requirements continue to apply. The approval supplies the previously deferred
generic execution decision; it does not make an outbox, worker, transition, or
delivery runtime current or automatically authorized.

## 2. Approved decisions D01–D14

The Product Owner approved every item below together as one decision on
2026-09-26. Their substantive wording is the wording approved at proposal SHA
ff3979c341dac44054a105d153f116ee0d9dfb45.

### D01 — Canonical execution mechanism

**Approved decision:** Adopt a PostgreSQL-backed durable-intent /
transactional-outbox mechanism as the canonical CampusHub asynchronous
execution architecture.

PostgreSQL is authoritative for durable intent, Tenant binding, logical effect
identity, execution state, claim/fencing generation, retry state, and terminal
outcome. An external queue may wake workers, but may never be the sole source
of truth. Direct fire-and-forget callbacks and provider calls inside a source
business transaction are not canonical CampusHub mechanisms.

This decision selects an architecture, not a physical schema, migration,
worker, queue provider, or enabled runtime.

### D02 — Queued intent is not authority

**Approved decision:** Keep the following concepts distinct:

- intent identity;
- originating provenance;
- authorization;
- current target validity;
- logical-effect uniqueness; and
- provider/delivery-attempt identity.

A queued intent grants only durable permission to evaluate its named
operation. It carries no standing human authority. A deferred privileged
transition must reauthorize its current originating authority and current
resource state under the operation's separately approved policy and the shared
PMAFB contract. A post-commit effect uses its own approved effect policy and
fresh current-state eligibility; it does not borrow the source actor's PMAFB
result as delivery authority.

### D03 — Transactional handoff

**Approved decision:** Where a source operation requires durable later work,
commit the source business state, its required A6 source-success event, and its
durable intent/outbox occurrence atomically in one PostgreSQL transaction.
If required intent creation fails before commit, the source transaction fails.
External delivery begins only after that transaction commits. A provider or
delivery failure after commit cannot roll back the source action.

The operation-specific contract determines whether each item is required;
this decision does not make every business action emit an intent or audit
event.

### D04 — Worker claim and fencing model

**Approved decision:** Use a short PostgreSQL claim transaction with
row-level claim locking, a monotonically increasing claim/fencing generation,
and database-clock lease expiry. Commit the claim before slow work; do not hold
database locks across network calls. Completion, retry, and terminal-state
updates must be conditional on the current fencing generation.

A lease timeout alone is not evidence that an external call did not happen.
Workers must use a governed dispatch adapter wherever the operation contract
requires one; they may not call providers around that admission boundary.

### D05 — Truthful delivery guarantee

**Approved decision:** Reject any claim of exactly-once external delivery.
CampusHub may claim only the guarantees supported by the particular
operation/provider:

- at-most-once logical Product notification generation where CH-NTF requires
  it;
- duplicate-safe internal materialization through durable logical uniqueness;
- at-least-once execution attempts where appropriate;
- idempotent provider retries when the provider supports the stable
  idempotency identity; and
- an explicit DELIVERY_UNKNOWN outcome when external acceptance cannot be
  established safely.

A provider-accepted but unacknowledged request must not be blindly resent when
provider deduplication or reconciliation cannot establish that retry is safe.

### D06 — Automatic retry policy

**Approved decision:** For external post-commit provider effects, allow at most
**six total automatic attempts per delivery identity**, including the initial
attempt, and no more than **24 hours from the first provider attempt**.

The effective automatic-retry boundary is the earliest of:

- six total attempts;
- 24 elapsed hours;
- Product/source validity ending;
- Tenant becoming ineligible;
- recipient or source becoming ineligible;
- the governing policy becoming invalid; or
- a terminal provider result.

Use exponential backoff with jitter. Do not freeze exact per-attempt seconds
into Product authority. A possible operational progression is approximately
30 seconds, 2 minutes, 10 minutes, 30 minutes, 2 hours, then 6 hours. This
sequence is **non-binding operational guidance**, not Product authority or a
required configuration.

Runtime must enforce the attempt and elapsed-time bounds using server/database
time. This policy applies to external provider delivery attempts, not to the
internal source-transactional materialization step or to a new business
transition. After the automatic boundary, a retryable unresolved failure
becomes DEAD_LETTER; ambiguous external success becomes DELIVERY_UNKNOWN; and
invalid current eligibility becomes SUPPRESSED or HELD according to the
operation policy. Exhaustion must not be bypassed by creating a fresh logical
effect identity.

### D07 — Operator recovery

**Approved decision:** Permit inspection and redrive only through a governed
recovery operation. Redrive preserves the Tenant, logical effect identity,
original intent and provenance, provider idempotency identity where
applicable, and complete attempt history. Every redrive revalidates current
state and policy.

An operator may not bypass authorization, eligibility, Product policy, Tenant
suspension, or duplicate-safety controls. Minting a new idempotency key solely
to evade an exhausted or ambiguous result is forbidden.

### D08 — Tenant suspension dispatch boundary

**Approved decision:** Adopt the per-Tenant dispatch-admission barrier in the
approved architecture gate. The final Tenant suspended commit is the
CampusHub provider-invocation cutoff: no new provider invocation may begin
after that commit.

Provider calls must cross the governed adapter/admission boundary, not rely on
a stale worker-side eligibility check. CampusHub cannot retract a request
already admitted and delivered to a provider before suspension. Suspension
must wait for admitted work to complete, become safely fenced/reconciled, or
enter its approved ambiguous terminal treatment. If safety cannot be
demonstrated, dispatch remains quiescing and fail-closed.

### D09 — Reactivation and missed work

**Approved decision:** Reactivation must not blindly replay work that became
due while the Tenant dispatch gate was closed. Before dispatch reopens,
occurrences due during that interval are terminalized under their
Product-specific contracts.

For ordinary one-shot notification/reminder effects, an occurrence missed
during the closed interval remains suppressed and is not sent late merely
because the Tenant becomes active again.

For scheduled Publication behavior under CH-SUB-002, a still-scheduled
Publication whose scheduled time elapsed during suspension is not published
retroactively. It returns to draft, receives the required explanation, and
requires a fresh authorized scheduling command before any future publication.
This is the mandatory CH-SUB-002 outcome, not a new Product rule.

Adopt the approved gate's narrow, policy-bound SYSTEM safety transition for
this scheduled-to-draft reconciliation. It may act only on the current
same-Tenant Publication and occurrence that qualify under the approved
suspension interval and current-state contract. The original Publisher grant
is provenance, not execution authority for this mandatory cleanup. A revoked
originating grant or changed row version must not indefinitely block the
cleanup when the current resource still qualifies. The implementation must
serialize against and re-read the current row, preserve newer unrelated
fields, and never publish or retarget the Publication. The lifecycle change,
required explanation, terminal occurrence outcome, and approved A6 event
commit atomically. If the safety policy or required current facts cannot be
established, reconciliation remains held and dispatch stays closed.

### D10 — Durable reopening cutoff

**Approved decision:** Adopt the approved architecture gate's
database-backed reopening boundary, using PostgreSQL transaction/commit
timestamp evidence for the end of the suspension interval. The reopening
transaction's identity and Tenant gate generation must be recorded, and the
authoritative commit timestamp must be resolved and durably persisted before
dispatch admission reopens. Due occurrences at or before that cutoff belong
to the closed interval.

If the cutoff cannot be established safely, including unavailable or
discarded commit-timestamp evidence, the system fails closed: dispatch does
not reopen, the bounded reconciliation is repeated, and a fresh guarded
reopening transaction is required. Sweep time, transaction-start time, caller
time, or an unverified application timestamp is not a substitute.

This decision accepts the architecture as stated. If implementation evidence
demonstrates a concrete PostgreSQL/platform incompatibility, return for
architecture review rather than silently weakening the boundary.

### D11 — SYSTEM authority model

**Approved decision:** SYSTEM has no generic standing capability. SYSTEM work
is permitted only under:

1. an explicitly approved deferred-transition policy; or
2. an explicitly approved post-commit-effect policy.

Each closed, versioned policy must name its Tenant boundary, trigger,
resource/source type, required current facts, authority semantics,
stale/invalid outcome, audit contract, and idempotency identity. Unlisted
operations remain disabled. SYSTEM may not become a global service-account
bypass.

### D12 — Initial transition/effect matrix

**Approved decision:** The generic mechanism has only the following initial
architecture classes. Every class still requires its own bounded runtime
authorization.

| Class | Approved policy | Remaining implementation boundary |
| --- | --- | --- |
| Scheduled Publication publish | Deferred privileged transition. Revalidate originating publication authority and current Publication lifecycle, version, due time, and other current preconditions. Stale, revoked, or invalid intent does not publish. | This decision does not authorize Publication scheduling or publish runtime. Priority Notice publication remains subject to OD-10 and a separately approved policy; no Priority Notice runtime is authorized here. |
| Missed scheduled Publication after Tenant suspension | Dedicated narrow SYSTEM safety reconciliation. Only a currently qualifying same-Tenant scheduled Publication may move from scheduled to draft; preserve newer fields; never publish; atomically record the explanation, occurrence outcome, and approved A6 event. | This decision adopts only this safety-policy direction. Runtime remains separately gated and must satisfy CH-SUB-002 and the approved architecture gate. |
| CH-NTF post-commit effects | The generic mechanism may support future separately authorized durable in-app notification materialization and external delivery only where the relevant Product category and contact-channel ownership authority permit it. Potential cases include Event cancellation/change effects and reminders/digests only when their Product timing decisions are closed. | No CH-NTF runtime, delivery channel, open timing value, or notification policy is authorized by this decision. |
| All other asynchronous transitions/effects | Disabled unless expressly supplied by Product authority and an approved operation-specific policy. | No inferred or blanket SYSTEM authority. |

### D13 — A6 SYSTEM audit direction

**Approved decision:** Machine-authored business transitions use an explicit
SYSTEM actor discriminator and policy identity. They must not fabricate an
actorMembershipId.

For the missed-Publication safety transition, the future closed A6 event
contract minimally identifies the Tenant, Publication, prior/resulting
version, operation/policy identity and version, occurrence, due/reopening time
needed for the result, and reason code. It excludes Publication content,
recipient lists or identities, contact details, Global User identity, and
synthetic Membership identity.

This approves a direction only. Physical A6 schema, union, migration,
identifier, and runtime changes remain subject to a separate implementation
checkpoint and required A6 approval.

### D14 — Notification and unrelated Product values remain open

**Approved decision:** This OD-08 decision does not close or supply:

- the CH-NTF-003 numeric daily in-app cap;
- quiet-hour start or end values;
- digest send time or composition details;
- Event reminder lead time;
- the Priority Notice numeric cap / OD-10;
- OD-03 contact-channel ownership;
- exact notification-retention duration;
- Poll A1 / OD-11; or
- any other unrelated open Product decision.

The generic execution mechanism cannot be used to infer or fill any of these
values.

## 3. Effect of approval and continuing gates

With the Product Owner approval recorded above, **OD-08 is CLOSED only for the
generic CampusHub SYSTEM/background execution architecture described in
D01–D14.** Future bounded implementation checkpoints may rely on those generic
decisions without reopening the generic queued-intent, outbox, retry, and
suspension-boundary decision.

Closure does not mean that all background operations are authorized, that
every SYSTEM transition is permitted, or that Notifications or CH-NTF are
implemented or complete. It does not close D14 decisions or other Product
gates and does not authorize deployment, a production migration, or production
configuration.

Each future operation still requires its Product story and closed
operation-specific policy, authorized exact-scope implementation checkpoint,
Tenant-surface/A2 and A4 obligations, applicable A6 event contract,
PMAFB/current-state and PostgreSQL race evidence, CI, independent review, and
separate deployment authorization where applicable. No operation may be
enabled merely because it appears in the architecture matrix.

## 4. Approval record

Product Owner decision: **APPROVED**

Decision date: 2026-09-26

Scope: CampusHub Pilot

Approved proposal SHA: ff3979c341dac44054a105d153f116ee0d9dfb45

Architecture review: **APPROVED / NONE** at
63ff42835fff058fced175daaaca0e754a82f237

Runtime authorization: **NONE**

Deployment authorization: **NONE**

### Product Owner approval statement (recorded)

As CampusHub Product Owner, I approve D01–D14 in
docs/governance/od08-system-background-execution-decision.md at candidate SHA
ff3979c341dac44054a105d153f116ee0d9dfb45 as one bounded CampusHub Pilot
Product / Architecture / Operations decision. Upon this approval, OD-08 is
closed only for the generic SYSTEM/background execution architecture stated
in the record; every specific future operation remains separately gated by
its Product story/policy and bounded implementation checkpoint. This approval
does not authorize runtime, schema or migration implementation, Notification
implementation, deployment, or production migration, and does not close the
open Product decisions listed in D14.
