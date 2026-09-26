# OD-08 SYSTEM and Background Execution Architecture Gate

Status: **PROPOSED — OD-08 OPEN; NO BACKGROUND EXECUTION AUTHORIZATION**

- Work item: OD-08-SYSTEM-EXECUTION-GATE-001
- Inspected baseline: 8eab0030b31395c86f1d1ebfb75f95a2cfb72302
- Product WHAT/WHY authority: CampusHub_Product_Specification_v1.3_FROZEN.md
- Subordinate production HOW authority: CampusHub_Implementation_Blueprint_v1.3_FROZEN.md
- Related gates: controlled v1.3 refreeze, PMAFB, A2, A4, A6, FG-05, CH-NTF, CH-EVT-003, CH-EVT-004, A10, and OD-12
- Runtime disposition: **DOCUMENTATION ONLY — NO SYSTEM, JOB, OUTBOX, NOTIFICATION, OR WORKER RUNTIME IS AUTHORIZED**

## 1.1 Inspected authority and runtime evidence

The proposal carries forward the authority and constraints recorded in:

- docs/governance/campushub-v1.3-controlled-refreeze.md;
- docs/governance/privileged-mutation-authority-invalidation.md;
- docs/adr/0004-tenant-isolation-and-resource-registry.md;
- docs/security/a2-tenant-isolation-negative-test-plan.md;
- docs/security/a4-identifier-inventory.md;
- docs/security/a6-audit-log-design.md;
- docs/governance/fg05-events-lifecycle-gate.md;
- docs/governance/ch-ntf-notification-delivery-gate.md;
- docs/governance/ch-evt-003-rsvp-implementation-checkpoint.md;
- docs/governance/ch-evt-004-postpone-cancel-implementation-checkpoint.md;
- docs/governance/a10-xp-ledger-idempotency-gate.md; and
- docs/governance/od12-xp-cap-allocation-decision.md.

The current-runtime evidence includes the Tenant Surface Registry,
PostgresPrivilegedMutationAuthority, Event and RSVP domain/application/
repository services, and the AuditEvent domain/repository. Relevant existing
evidence is in tests/tenant-isolation-meta.test.ts,
tests/integration/capability-authority-race.test.ts,
tests/integration/event-lifecycle-migration.test.ts,
tests/integration/event-rsvp.test.ts, and the Event/Audit unit suites.
Those implementations and tests are evidence of existing boundaries only;
they do not authorize background execution.

## 1. Purpose and authority boundary

This gate proposes a reusable execution contract for future CampusHub work
that persists intent and performs it after the initiating transaction. It
covers deferred business transitions and post-commit side effects without
creating a notification-specific engine.

The frozen Product Specification remains the authority for what CampusHub may
do and why. The frozen Implementation Blueprint remains subordinate and
specifies production HOW. The controlled refreeze records OD-08 as open and
blocks background job and outbox execution until the transition matrix,
queued-intent rules, authority and revocation races, retry contract, and
outbox behavior are decided and evidenced. This proposal recommends a
mechanism; it does not close OD-08, record Product Owner approval, or amend
either frozen authority source.

The current repository contains Event lifecycle mutations with expected
versions, same-Tenant resource scope, A6 writes, and shared
PostgresPrivilegedMutationAuthority (PMAFB) integration. RSVP has a durable
Tenant/Event/Membership/request-key record. The current runtime has no
notification delivery, outbox, job runner, scheduler, or worker. The
notification category in the Tenant Surface Registry is metadata for a
future surface, not registration or authorization of an implementation.

This document does not add or authorize runtime code, schema, migrations,
tests, a Tenant registry entry, A4 identifier formats, delivery providers,
scheduled transitions, new SYSTEM capability, deployment, or changes to any
Product decision. Any later implementation requires its own exact-scope
checkpoint and approvals.

## 2. Recommended architecture decision

**Recommend a PostgreSQL-backed durable intent and outbox ledger, claimed by
workers with short database transactions.** PostgreSQL remains the source of
truth for intent, eligibility, claims, completion, and retry state. An
external queue may wake workers later, but it must not become the only copy of
intent or execution state.

Every intent belongs to one of two execution classes. They share durable
storage and dispatch mechanics but have different authority rules:

| Class | Meaning | Required authorization |
| --- | --- | --- |
| Deferred business transition | A queued command will later change authoritative CampusHub state, such as a specifically approved scheduled transition. | Reauthorize the originating authority and current resource state in the final database transaction. A separately approved, versioned SYSTEM transition policy must name the exact transition. |
| Post-commit effect | A durable effect follows a business change that already committed, such as a notification or external transport. | The source commit is immutable provenance, not borrowed human authority. A separately approved, versioned effect policy authorizes the effect; current source, Tenant, recipient, preference, and delivery conditions are rechecked before each attempt. |

An intent is a request to evaluate work. It is never proof that work remains
authorized, current, eligible, or due. No worker may replay a queued request
as a standing SYSTEM permission, rely on an earlier authorization result, or
turn a stale intent into a broader action.

This is a proposed mechanism only. The queue/outbox, worker claims, retries,
and dispatch remain disabled while OD-08 is open.

## 3. Intent envelope and trust rules

Each future intent must have a closed, versioned operation type and an
operation-specific contract. Its durable envelope is limited to facts needed
to find and revalidate the work:

- explicit Tenant ID in both durable input and execution context;
- stable intent ID, operation type, envelope version, and material-intent
  fingerprint;
- Tenant-scoped source/resource identity and the committed or expected
  resource version and lifecycle facts;
- due time only where Product authority supplies it, stored as an absolute
  server/database time;
- for a deferred human-authorized transition, the originating Tenant-local
  Membership and an immutable reference to the authority basis used to queue
  it, such as the applicable capability/scope and grant identity;
- for a post-commit effect, a reference to the source transaction's committed
  result and the separately approved effect-policy identity/version;
- a stable operation-specific deduplication identity.

An envelope must not contain a serialized client command, arbitrary callback,
SQL, executable expression, password, session or MFA secret, contact-channel
copy, raw content, or an unrestricted recipient list. A worker loads
authoritative records using Tenant-bound repository operations. Unknown
operation or envelope versions, missing Tenant context, missing source
records, malformed identifiers, or unsupported authority references fail
closed before Tenant-owned resource access.

For human-originated transitions, a previously stored authorization result,
request context, capability label, or enqueue-time timestamp is not an
authority lease. Each execution attempt re-reads the exact originating
authority basis and all mutable facts required by the operation. A revoked,
expired, replaced, or materially changed authority basis does not get revived
by a later unrelated grant; the original intent is held and a new authorized
command is required. If the Product transition does not define which
originating authority must be revalidated, the intent is not executable.

For a SYSTEM transition without a human origin, execution is permitted only
when a later Product decision explicitly names the transition and a versioned
SYSTEM policy defines its authority, source facts, and revalidation. SYSTEM
has no general or implicit authority. The Product role/capability matrix's
scheduled-transition entries do not authorize unlisted work or close OD-08.

## 4. Transactional handoff and worker claims

### 4.1 Handoff from a business transaction

When a committed business transition requires later work, the source
transaction writes the business state, its required A6 success event, and the
durable intent/outbox record in the same PostgreSQL transaction. The operation
specific uniqueness rule must be enforced by a database constraint or
equivalent reviewed serialization, so concurrent source transactions cannot
create two logical effects for one governed occurrence.

No provider call, email, notification transport, webhook, or other external
effect runs inside that transaction. If any required source, audit, or handoff
write fails, the transaction rolls back and no success is reported. If the
commit succeeds, a later delivery failure does not undo the source state or
its audit event.

The outbox record proves that its referenced source transaction committed. It
does not prove that the source resource is still current, the target is still
eligible, the effect remains allowed, or that a human actor retains authority
for a new business transition.

### 4.2 Claiming work

Workers claim due records using a short PostgreSQL transaction with
row-level locking, such as SELECT FOR UPDATE SKIP LOCKED. The claim writes a
lease owner, a monotonically increasing claim/fencing generation, a database
clock-based lease expiry, and an attempt count, then commits before doing
slow work. Worker leases and due times use a changing PostgreSQL clock, not a
browser, caller, or transaction-start timestamp.

Workers must not hold database row locks while calling an external provider.
Every completion, retry, or state update is conditional on the current claim
generation so that a worker whose lease expired cannot overwrite a newer
claim's result. A lease timeout can make work available again; it cannot
establish that a prior external call did not succeed.

A claim, lease, or eligibility read is not permission to dispatch. External
provider calls use the Tenant dispatch-admission and suspension protocol in
§7.1; workers never call providers directly.

The operation lifecycle must distinguish at least:

| State | Meaning |
| --- | --- |
| READY | Durable intent is eligible to be claimed when its approved due time arrives. |
| CLAIMED | One worker owns the current lease and fencing generation. |
| DISPATCHING | The trusted adapter has admitted the effect for provider invocation; the Tenant suspension barrier counts it until the adapter returns or is fenced and records an outcome. |
| RETRY_WAIT | A classified transient failure may be attempted again under the bounded retry policy. |
| SUCCEEDED | The effect completed or the guarded transition committed. |
| SUPPRESSED | Current approved state or eligibility rules say no effect is due. |
| HELD | Authority, policy, contract version, or other required fact is missing or invalid; automatic execution stops. |
| DEAD_LETTER | The bounded automatic retry policy ended. Operations must be alerted and use an approved recovery procedure. |
| DELIVERY_UNKNOWN | An external outcome is ambiguous and cannot safely be retried. Automatic delivery stops until an approved reconciliation or recovery decision. |

State names are logical contract terms, not proposed physical schema names.
Recovery must not delete evidence or silently reset a terminal state to READY.
An operator cannot bypass authority, target, or Product checks by manually
redriving a row.

## 5. Revalidation and authority finalization

### 5.1 Deferred business transitions

Every retry or new worker claim starts a fresh attempt. It reloads and
revalidates:

1. explicit Tenant context and current Tenant lifecycle;
2. the exact originating Membership/principal and current lifecycle;
3. capability, module scope, grant identity/revocation/expiry, Guild Term,
   assurance/MFA, or every other mutable authority source required by the
   operation;
4. the exact same-Tenant resource, current lifecycle, expected version, and
   operation-specific preconditions;
5. current target/audience facts and authoritative due-time or expiry facts;
6. idempotency and whether the logical intent has already completed.

The final authority boundary uses the shared PMAFB contract; a job-specific
authorization shortcut is not acceptable. The attempt locks all applicable
authority rows in PMAFB order, then the exact same-Tenant resource and any
required dependent resources in their reviewed order. After every blocking
wait it repeats authority and resource checks and uses fresh PostgreSQL
clock_timestamp() for the database-time check. It crosses PMAFB only after
all required locks and checks complete, performs the guarded state transition
and required audit/handoff writes in one transaction, and holds
authority/resource locks through commit. It does no blocking authority or
resource lookup after PMAFB.

A missing, revoked, expired, or changed origin authority; stale expected
version; invalid lifecycle; changed target; or unsupported state causes a
fail-closed result with no business mutation and no privileged-success audit.
Such a result is not made executable by retrying after a later grant or
re-targeting the intent to a newer resource version.

### 5.2 Post-commit effects

A post-commit effect is not a second execution of the source business command.
It must not rewrite Event, RSVP, Publication, or other source state, and it
must not borrow the source actor's PMAFB result as SYSTEM authority.

The effect handler must verify the committed source reference and its current
version/state, then apply the separately approved effect policy and current
Tenant, recipient/Membership, audience, preference, subscription, and channel
eligibility rules. The handler's SYSTEM authority is narrow to that named
effect and policy version; it grants no general capability or access to
unrelated Tenant data. A target that is no longer eligible is suppressed
without dispatch. A missing or ambiguous policy is held.

Revoking the source actor after the source transaction committed does not
retroactively undo that valid commit. It also does not grant the worker the
actor's authority for a new state transition. Whether a committed consequence
remains eligible is decided only by the effect's approved policy and fresh
current-state checks. An effect is never allowed to bypass Tenant suspension,
Membership eligibility, audience, preference, source lifecycle, or the
applicable delivery rules.

### 5.3 Due intent during Tenant suspension

When an intent's approved due time passes while the Tenant dispatch gate is
closed for suspension, that logical occurrence is missed, not paused for later
catch-up delivery. Persist one terminal `SUPPRESSED` occurrence, keyed by its
stable logical occurrence identity, with its `due_at`, observation/recording
time, Tenant suspension/dispatch generation, source version, and reason
`TENANT_SUSPENDED_AT_DUE`. Whether a scheduler records it at the due time or a
recovery sweep records it later, the unique occurrence is recorded exactly
once. A missed occurrence is never changed back to `READY` or `RETRY_WAIT` on
reactivation. A new future occurrence requires the operation's separately
approved scheduling action and a new logical identity.

Before dispatch is reopened after reactivation, a catch-up transaction or
bounded sweep must terminalize every due occurrence from the closed interval.
The dispatch gate remains closed until this sweep completes; failure leaves it
closed. This prevents a delayed worker or an offline scheduler from turning
elapsed work into a retroactive send.

For a one-shot post-commit effect, including an Event reminder, the recorded
occurrence remains suppressed after reactivation. For a deferred business
transition, no stale command is executed. The occurrence is recorded as
missed/suppressed and needs a fresh authorized command unless an approved,
operation-specific Product contract supplies a safe fallback. For the
CH-PUB-002 scheduled Publication proving case, this gate recommends that a
still-matching `scheduled` Publication return to `draft` when its publish time
passes during suspension; the missed publish occurrence is still recorded as
suppressed, the Publisher is told why, and an explicit new schedule is required
to publish later. That draft fallback is a recommendation for Product Owner
acceptance, not a frozen Product rule or runtime authorization. If its source
version changed or the fallback has not been accepted, hold the occurrence,
leave the Publication unpublished, and require an authorized Publisher
resolution. No reactivation may publish it retroactively.

## 6. Duplicate safety and retry contract

Three identities remain distinct:

1. **Request idempotency** identifies a replay of the initiating request. The
   same key and material intent return the canonical result; reuse with
   different material intent returns the approved conflict outcome.
2. **Logical effect uniqueness** identifies one Product-defined effect. Its
   unique constraint prevents concurrent enqueue/materialization from
   creating a second logical effect.
3. **Provider idempotency** identifies a retry of one external delivery using
   the same stable key on every attempt. It is not a new request key or a new
   logical effect.

Retries use a finite, bounded exponential-backoff policy with jitter. Each
runtime checkpoint must set and approve its operational attempt and elapsed
time bounds before enabling dispatch; this proposal supplies no numeric retry
values and does not substitute them for Product timing decisions. Transient
database or provider failures may enter RETRY_WAIT. Authority denial, stale
resource state, invalid policy, ineligible target, or unsupported intent is
HELD or SUPPRESSED and is not blindly retried.

For an external call whose outcome is unknown, a worker may retry only when
the provider/adapter guarantees deduplication for the same stable
idempotency key, or a reviewed reconciliation procedure establishes that the
effect did not occur. If neither is available, the row becomes
DELIVERY_UNKNOWN and requires an alert and controlled recovery. It must not
blindly resend in a way that could duplicate a user-visible effect. Therefore
no channel may claim duplicate-safe delivery until its actual provider
contract and failure-after-acceptance behavior are evidenced.

Database materialization uses the logical effect's unique identity so a
reclaimed worker cannot create a second notification record. Provider
delivery uses a stable derived key for that same logical effect and channel.
Manual redrive retains both identities; generating a fresh key to evade a
duplicate conflict is prohibited. A new external attempt cannot alter or
replay the underlying business transaction.

## 7. Revocation and concurrency race contract

Deferred privileged transitions serialize against the same authority writers
and resource mutations as foreground privileged work. The required orderings
are:

| Race | Required result |
| --- | --- |
| Authority invalidation commits first | The worker waits or reads the invalidated row, rechecks authority and database time, then holds the intent. No business state or privileged-success audit changes. |
| Worker obtains PMAFB first | The invalidator blocks. The worker performs only the exact authorized transition and commits while holding authority locks. The invalidator proceeds afterward; subsequent work must reauthorize. |
| Grant or Guild Term expires while waiting for an authority/resource lock | After the wait, the worker rereads authority and uses fresh database time. Expiry before PMAFB fails closed. |
| Resource transition or version change commits first | The worker observes the new version/state and holds or suppresses the stale intent. It never retargets to the new version automatically. |
| Tenant suspension closes dispatch admission before the gateway admits a send | The gateway rechecks the current Tenant lifecycle, closed gate, and dispatch generation after any wait; it rejects admission and makes no provider call. The suspension may then commit. |
| Gateway records dispatch admission before suspension closes the gate | The gateway owns that in-flight invocation; suspension closes new admission and cannot commit the Tenant as suspended until the invocation is terminal or safely reconciled/fenced. The provider handoff is ordered before the suspension commit. |
| Worker lease expires while the first worker is still running | Fencing generation prevents the stale worker from updating claim state. Stable effect idempotency handles a duplicate provider call; an ambiguous non-idempotent call is held for reconciliation. |
| Business transaction rolls back | Its outbox intent and success audit roll back with it; no worker can observe a committed intent for that transition. |
| Business transaction commits, then delivery fails | Business state and audit remain committed. The effect follows the retry, hold, or dead-letter policy without replaying the business mutation. |
| Duplicate workers claim the same effect | Database claim serialization, fencing, and the logical effect's unique key yield one canonical effect; repeated external delivery uses the same provider key. |

Every applicable authority source must have both real-PostgreSQL orderings
proved with separate connections and deterministic barriers. Sleep-only
timing, cached authorization, optimistic resource version alone, and
SERIALIZABLE alone do not prove the contract. The PMAFB lock modes, order,
post-wait database-clock checks, and resource locking remain the shared
contract; this gate does not define a second authority algorithm.

### 7.1 Tenant dispatch admission and suspension barrier

The Tenant's final suspension commit is the dispatch cutoff: no worker or
adapter may begin a provider invocation after that commit. Because PostgreSQL
cannot atomically commit with an external provider, a final eligibility read
followed by a direct worker call cannot provide this guarantee. Recommend a
per-Tenant dispatch barrier serialized with the authoritative Tenant lifecycle
writer, using the reviewed Tenant/PMAFB lock order. Its open/closed state and
monotonically increasing generation are execution-control metadata, not a new
Product lifecycle state or an approved physical schema.

Use this protocol for any Tenant-scoped external effect whose approved policy
blocks execution during suspension:

1. The suspension path closes the dispatch barrier and advances its generation
   in a short PostgreSQL transaction, then commits that closure. This prevents
   new admissions; it is the start of quiescence, not yet the final Tenant
   `suspended` commit. The suspension path then waits without holding database
   row locks for already admitted gateway invocations to resolve.
2. Every provider call passes through a trusted dispatch adapter that alone
   holds provider credentials and network egress. A worker submits an intent
   reference and expected generation, never a detachable send permit or
   provider credential. At admission, the adapter re-reads and validates the
   current Tenant lifecycle and gate generation, the intent and due time, and
   the effect's current source/target eligibility. In one short transaction
   serialized with barrier closure, it records an in-flight dispatch
   reservation and commits it. An earlier worker eligibility check cannot
   satisfy this step.
3. The adapter itself immediately invokes the provider for that reservation;
   it does not return a reusable permit to a worker. Database locks are
   released before the network call. The reservation stays in flight until
   the adapter returns or is hard-fenced and records the attempt outcome with
   the current fencing generation. A provider-accepted but unacknowledged
   request is `DELIVERY_UNKNOWN`, not a license to issue another call.
4. Before a final short transaction locks the barrier/Tenant in the reviewed
   order, verifies the closed generation, writes Tenant status `suspended`, and
   commits, prove that no live adapter instance can still start or retry a
   provider invocation. A still-live reservation must return or its adapter
   must be hard-fenced; record an ambiguous result as `DELIVERY_UNKNOWN` and
   prohibit replay. A lease timeout alone is not fencing. A request already
   handed to the provider before suspension may still be processed externally;
   CampusHub cannot cancel it without a separately proven provider contract.
5. Reactivation does not reopen dispatch as part of changing Tenant status.
   Keep the barrier closed, reconcile and terminalize due occurrences from the
   closed interval under §5.3, advance the generation, then open admission in a
   separate guarded transaction. A stale worker or adapter request carrying an
   older generation is rejected.

The two commit orderings are therefore explicit. If the suspension barrier
closure wins before gateway admission, the later adapter transaction observes
the closed generation and produces no provider invocation; the final
suspension commit may follow. If gateway admission wins first, the final
suspension commit waits for that invocation to return or for a reviewed
fencing/recovery result that makes any later invocation impossible, then
occurs afterward. No dispatch
permit can remain with a worker that might call after the final commit. If a
provider or deployment cannot enforce the adapter-only egress and fencing
boundary, the affected channel remains held and is not enabled.

Here, “send” means the adapter's provider invocation/handoff. A provider may
deliver an already accepted request to a recipient later; CampusHub cannot
retract that external delivery unless the provider supports and proves a
separate cancellation/fencing contract. If Product requires recipient receipt
to stop at the suspension commit, that provider capability is an additional
precondition; unresolved or unprovable behavior blocks the channel.

Required PostgreSQL and provider proof covers both orderings with separate
database connections and deterministic barriers, including the exact gap
between worker eligibility and provider invocation:

| Ordering | PostgreSQL proof | Provider/adapter proof |
| --- | --- | --- |
| Suspension wins | Pause a worker after its eligibility read but before gateway admission. Close the barrier and commit Tenant suspension on another connection; resume the worker and assert the stale generation is rejected and no provider invocation is recorded. | Pause the fake adapter at the same boundary; after suspension commits, resume it and assert the provider call count stays zero, including after worker/gateway retry. |
| Dispatch wins | Commit the gateway's in-flight reservation first and pause its fake provider invocation. Begin suspension on another connection; prove it cannot commit Tenant status `suspended` until the reservation is terminal or reconciled/fenced. Then assert the provider invocation precedes the suspension commit and a subsequent call is rejected. | Pause at provider acceptance and acknowledgment boundaries. Assert no invocation begins after the final suspension commit. For crash/accepted-unacknowledged cases, prove the old gateway is fenced and no blind retry or late call can occur; otherwise suspension stays quiescing. |

Use database commit/order markers and provider invocation records rather than
sleep-only timing or wall-clock comparison. Verify the gate's Tenant isolation,
generation checks, zero-active-invocation condition, missed-occurrence
terminalization, and that a failed reactivation sweep cannot reopen dispatch.

Post-commit delivery is not itself a privileged Event mutation and does not
repeat PMAFB for the already committed source action. It still must validate
the committed provenance and all live effect eligibility through the
separately approved effect policy.

## 8. Event and notification proving case

Events prove that the common execution contract can handle current source
state, authority, concurrency, and external side effects without making the
engine notification-specific.

### 8.1 Cancellation

An Event cancellation remains a human-authorized, versioned Event transition:
the Event row and applicable RSVP state serialize under the existing Event
and PMAFB contracts. Only a successfully committed cancellation may hand off
a cancellation-notice intent. The same source transaction must persist the
minimum durable recipient intent required to preserve the mandatory audience
at the cancellation transition: current same-Tenant RSVP holders in going or
interested state. A withdrawn RSVP is excluded. If an RSVP commits first,
cancellation uses the resulting current state; if cancellation commits first,
a later RSVP fails with the approved INVALID_STATE family and creates no
notice intent. This does not create an attendee list or a student-facing
recipient directory.

Cancellation notices use the mandatory, non-disableable Product channels
carried forward by CH-NTF. At dispatch the worker verifies the committed
cancelled Event/version, current Tenant delivery state, and current
recipient/Membership eligibility. Preference controls cannot disable the
mandatory category, but they do not override Tenant suspension, recipient
ineligibility, or delivery-policy checks. Delivery failure leaves the
cancellation, RSVP state, lifecycle history, and source A6 event committed.
CH-EVT-004's cancellation-notification dependency remains open until a
separate notification runtime checkpoint proves generation, recipient
eligibility, idempotency, retry, and delivery.

The recipient set used for the cancellation transition and the per-recipient
delivery record are private delivery data, not generic A6 payload. A6 must not
receive recipient Membership IDs, recipient lists, notification content, or
contact details.

### 8.2 Reminder and Event change

An Event reminder may be queued only after Product authority supplies its
lead-time value and the relevant feature gate authorizes scheduling. The
intent binds the same-Tenant Event, source schedule/version facts, and exact
due time derived from that approved value. At send time, the handler checks
that the Event is still in the applicable published/upcoming state, the
schedule/version still matches, the recipient's RSVP and Membership remain
eligible, the Tenant permits delivery, and current preferences/channel rules
allow the reminder. A stale reminder is suppressed. This document sets no
reminder lead time, quiet hours, volume cap, digest timing, or channel
ownership value. If its due time passes while the Tenant dispatch gate is
closed for suspension, record and permanently suppress that reminder
occurrence under §5.3; reactivation does not send it late.

An ordinary Event edit does not automatically generate another notification.
Any explicit Publisher re-notification must follow CH-NTF-004's
once-per-item boundary and the future notification checkpoint's resolution
of which Event changes are eligible for that choice. If the required
preference-aware Event-change behavior cannot be reconciled with that
boundary, the producer remains blocked for Product Owner resolution.

These examples do not authorize notification runtime, Event scheduling,
persisted past/archive transitions, or any new SYSTEM role.

## 9. Tenant, identifier, audit, and adjacent-gate boundaries

- **A2 and ADR 0004:** Every durable intent and worker execution carries an
  explicit Tenant context. Every Tenant-owned lookup is Tenant-bound. Future
  jobs and notifications need their own exact registry declarations and
  negative Tenant-isolation probes before production use. The current
  category metadata does not register their implementations.
- **A4:** Notification and future job identifiers remain future-required;
  this gate chooses no physical identifier format. Behavioral records remain
  anchored to Tenant plus Membership or another reviewed Tenant-local owner.
  Never key behavioral work by Global User or identitySubjectId, merge
  recipients across Tenants, or copy a contact channel into the Tenant
  product record.
- **A6:** Required source success audit remains atomic with the guarded source
  mutation. A6's present Membership-backed actor model does not invent a
  SYSTEM actor. Any future system-authored business transition or new
  notification audit event needs a closed, separately reviewed A6 actor and
  event contract. Audit payloads remain minimized and exclude recipients,
  raw content, and contact data.
- **FG-05 and CH-EVT-003/004:** Event ownership, audience, lifecycle,
  expected-version, RSVP, cancellation, and notification dependencies remain
  governed by their approved contracts. No notification dependency is
  satisfied by writing an audit event or an outbox row alone.
- **CH-NTF:** The proposed engine carries CH-NTF's Tenant-local identity,
  current-state, preference, at-most-once generation, post-commit,
  duplicate-safe, and current-target rules. The notification gate's current
  disposition is documentation only. OD-08 and all notification runtime
  authorization remain open.
- **A10 and OD-12:** Request retry identity, conceptual XP source uniqueness,
  and ledger-entry identity remain separate as A10 requires. Any future XP
  reconciliation job is subject to this execution gate. OD-12's approved XP
  numbers do not supply notification timing, retry settings, or SYSTEM
  authority.

## 10. OD-08 closure and future implementation gate

This proposal can be considered for acceptance only after the required
Product, architecture/security, and operations owners review the following
contracts. A later approval must state which recommendations are accepted,
changed, or deferred; this document's existence is not that approval.

| Closure area | Required decision or evidence |
| --- | --- |
| Product transition matrix | Name each allowed asynchronous business transition and effect by story, trigger, required origin/System authority, current-state checks, stale/invalid outcome, and whether a fresh user command is required. Explicitly leave unlisted transitions disabled. |
| Queued intent | Approve the closed operation envelope, Tenant context, provenance, expected-version, due-time source, and no-authority-lease rule. Preserve every unresolved Product value as open. |
| Authority and revocation | Approve shared PMAFB reuse, exact origin-authority references, row-lock order, resource order, clock semantics, and both invalidation/worker orderings. |
| Dispatch admission and suspension | Approve the per-Tenant barrier, gateway-only provider egress, in-flight drain/fencing rule, final suspension commit boundary, provider meaning of send, both commit orderings, and fail-closed recovery. |
| Transactional handoff | Approve same-transaction outbox insertion with business state and required A6 event, plus rollback and post-commit failure behavior. |
| Retry and duplicate safety | Approve finite operational retry bounds, observability, dead-letter/recovery procedure, internal logical uniqueness, actual provider idempotency or reconciliation, and ambiguous-result handling. |
| Tenant, privacy, and audit | Complete operation-specific A2/A4 registration and negative evidence, identifier ownership, A6 actor/event contracts, data minimization, retention, and export/deletion treatment. |
| Notification proof | Preserve the CH-NTF category matrix, preference and subscription behavior, Event cancellation audience and RSVP race, explicit-change boundary, and all unresolved reminder, digest, quiet-hour, fatigue, OD-10, retention, and channel-ownership decisions. |

Before any future worker or outbox is enabled, its exact-SHA implementation
checkpoint must additionally provide:

1. exact Product stories, code/schema/migration paths, Tenant Surface Registry
   entries, A4 inventory updates, A6 event contracts, and separately recorded
   Product Owner and independent security/architecture approval;
2. separate-connection PostgreSQL proof for every applicable authority
   source in both orderings, including Tenant, Membership, grant, Guild Term,
   module, assurance/MFA where applicable, and expiry while waiting on
   authority and resource locks, plus both dispatch-admission/Tenant-suspension
   commit orderings and the eligibility-to-provider-call barrier;
3. expected-version and lifecycle races, stale-intent holds, resource/
   authority rollback, atomic source/audit/outbox handoff, duplicate enqueue,
   duplicate worker, lease expiry/fencing, and idempotency conflict evidence;
4. crash-point proof before commit, after commit, before provider call, after
   provider acceptance and before acknowledgment, and after retry exhaustion;
   provider evidence must also prove no invocation begins after final Tenant
   suspension commit and that unresolved in-flight calls keep suspension
   quiescing;
5. cross-Tenant negative tests for durable payload, worker context, repository
   access, recipient resolution, and delivery, plus A6 minimization and
   privacy/retention evidence;
6. actual provider or adapter evidence for stable idempotency and the
   accepted-but-unacknowledged failure case; otherwise the affected channel
   stays held and cannot claim duplicate-safe completion. Missed due
   occurrences during suspension must be terminal before reactivation opens
   dispatch; and
7. exact-SHA CI, operations alert/recovery evidence, and independent
   read-only review. Deployment remains a separate authorization.

Until OD-08 is formally closed and those later gates are satisfied, no
background job, SYSTEM transition, reminder scheduler, outbox execution,
notification sender, retry worker, or external post-commit delivery may be
implemented or enabled on the strength of this proposal.

## 11. Disposition

**RECOMMENDATION: adopt the PostgreSQL durable-intent/outbox contract above,
with source-transactional handoff, per-attempt current-state and authority
revalidation, shared PMAFB for deferred privileged transitions, and
bounded, idempotent post-commit dispatch. OD-08 REMAINS OPEN. This document
does not record Product Owner approval and authorizes NO runtime work.**
