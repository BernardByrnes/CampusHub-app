# Privileged Mutation Commit-Time Authority Invalidation Contract

Status: **PROPOSED — ARCHITECTURE/SECURITY APPROVAL REQUIRED**

This document defines a reusable production HOW contract for privileged
Tenant mutations. It does not change Product WHAT/WHY authority, authorize a
feature, or implement the mechanism described here.

No Event, Publication, Opportunity, Sports, moderation, Membership, Auth,
schema, migration, test, CI, or deployment change is made by this checkpoint.

## 1. Purpose and governing boundary

The frozen Product Specification requires privileged authority revocation to
take effect immediately on the server, including queued or in-flight work that
has not durably committed. The frozen Implementation Blueprint separately
requires current Tenant, Membership/resource, capability, originating
authority, expected-version, and time-sensitive facts to be revalidated before
future privileged work.

This contract closes the shared architecture question left by those
requirements: a privileged mutation must not use an authorization snapshot
after any applicable persisted authority source has been invalidated during the
mutation transaction.

Product and feature checkpoints still own their operation-specific facts. This
contract owns only the serialization and finalization semantics that make
current privileged authority safe to use.

## 2. Authority sources that must participate

Every mutable fact capable of making a privileged operation ineligible must
participate in the same reviewed serialization protocol. The current
foundation contains the following sources:

| Authority source | Current foundation representation | Invalidating changes | Required treatment |
| --- | --- | --- | --- |
| Tenant lifecycle | `tenants.status` in `src/server/db/schema/tenant.ts` | `suspended` or `archived`, and any future state that removes privileged functionality | Lock and re-read the Tenant row; the invalidating transition uses the same lock order. |
| Module enablement | No separate persisted module-enable row is present in the current foundation; module scope is currently carried by grants | Disablement, suspension, or removal of the applicable module | A future module state must be authoritative, durable, and lockable or epoch-coupled. Absence of a module row is not implicit enablement. |
| Membership/principal | `memberships.lifecycle` and `memberships.assurance_level` in `src/server/db/schema/membership.ts` | Suspension, closure, transfer/deactivation, or an assurance state no longer satisfying the operation | Lock and re-read the exact same-Tenant Membership and any separate authoritative principal/MFA row. |
| RoleGrant/capability | `role_grants.revoked_at`, `capability`, `module_scope`, `membership_id`, and `expires_at` in `src/server/db/schema/governance.ts` | Revocation, scope/capability change, membership change, or grant expiry | Lock every applicable grant row in deterministic order and re-evaluate current values. |
| Guild Term | `guild_terms.status`, `starts_at`, and `ends_at` in `src/server/db/schema/governance.ts` | Term closure, term replacement, or the end of the active term | Lock and re-read the applicable same-Tenant term. Term validity is also checked against database time. |
| Assurance/MFA | Assurance is currently on Membership; no independent MFA persistence is in the current foundation | Assurance downgrade, MFA removal, or failure of an operation-specific privileged-assurance rule | The implementation checkpoint must identify every authoritative row used by the operation and include it in the same protocol. A cached assurance or MFA fact is not sufficient. |
| Time authority | No durable row; grant and term expiry are `expires_at`/`ends_at` values | Wall-clock passage beyond the earliest applicable expiry | Use authoritative PostgreSQL/server time at each required finalization boundary. Do not rely on a browser, request, stale context, or transaction-start clock. |

This inventory is closed only for the facts known at the implementation
checkpoint. If implementation discovers another persisted authority source, the
operation is not ready until that source is added to the inventory and the
serialization proof.

## 3. Trusted context is not an authority lease

`RequestContext` is a trusted server-produced fact snapshot. It binds identity,
Tenant, Membership, lifecycle, and assurance facts for context resolution; it
does not grant operation authority.

The following are never transaction-long authority leases:

- a `RequestContext` obtained at request start;
- a cached `authorized = true` result;
- a role label or client-supplied capability;
- a pre-transaction authorization decision;
- a timestamp supplied by the browser or request;
- a previous successful mutation.

The mutation transaction must reload authoritative rows and make its final
eligibility decision at the defined authority finalization boundary below.

## 4. Selected canonical mechanism

This contract selects deterministic database-row locking with final
database-clock revalidation as the canonical mechanism for the current
architecture. An authority epoch/version may be added by a separately reviewed
implementation checkpoint, but it cannot be used as a shortcut that omits
mutable source synchronization. PostgreSQL `SERIALIZABLE` may be supplemental
defense; it is not sufficient on its own.

### 4.1 Privileged Mutation Authority Finalization Boundary

Every privileged mutation uses one PostgreSQL transaction and one database
handle. The reusable boundary, abbreviated **PMAFB**, is:

1. Validate the request and bind the exact Tenant, actor/Membership, module,
   capability, and resource identifiers. Do not infer authority from the
   client.
2. Derive the complete set of authoritative rows required by the operation.
   The set includes Tenant, module state where one exists, Membership or
   principal, Guild Term, all applicable RoleGrant/capability rows, and any
   authoritative assurance/MFA rows.
3. Lock those rows in the canonical order using mutually conflicting
   PostgreSQL row-lock modes. An ordinary privileged mutation that consumes
   authority but does not change the authority source uses `SELECT ... FOR
   SHARE` or a strictly stronger lock for every applicable authority row. An
   operation that invalidates or otherwise changes an authority source uses
   `SELECT ... FOR UPDATE` on the exact same row before writing it. Using
   `FOR UPDATE` for both sides is also valid. `FOR KEY SHARE` is not the
   default and may be used only when an implementation review proves its
   conflict semantics sufficient for the exact invalidation write.
4. Lock those rows in the canonical order:
   Tenant; module state; Membership/principal; Guild Term; applicable grants
   ordered by `(tenant_id, id)`; then assurance/MFA rows in a stable order.
   Every invalidation operation uses the same order. Missing or ambiguous
   authority rows fail closed rather than being skipped. The contract depends
   on actual PostgreSQL row-level conflict semantics, not merely logical
   convention; every implementation must prove that the exact consumer and
   invalidator lock modes mutually block as intended.
5. Re-read every locked source and evaluate current Tenant lifecycle, module
   enablement, Membership/principal state, capability and scope, revocation,
   Guild Term state, assurance/MFA requirements, and the actor-to-Membership
   binding.
6. Obtain and evaluate authoritative database time. The implementation must
   use a changing PostgreSQL/server clock such as `clock_timestamp()` for this
   final temporal check, or an independently reviewed equivalent. PostgreSQL
   transaction-start `now()`/`CURRENT_TIMESTAMP` is not sufficient when it
   could preserve authority after expiry.
7. For an existing resource, lock the exact same-Tenant resource row in the
   operation's canonical resource order. Re-check expected version, lifecycle,
   ownership, and operation-specific facts. After any blocking wait, repeat
   the authority and database-time checks before proceeding.
8. The PMAFB is the point after all required authority/resource locks and
   rechecks have completed and immediately before the guarded business
   mutation. At this point all mutable authority facts must be valid and the
   earliest applicable expiry must still be strictly in the future.
9. Perform the guarded mutation and any required success audit append in the
   same transaction. The write must retain the expected-version/resource
   predicate; passing authority does not bypass resource concurrency.
10. Commit without releasing the authority locks first. External notifications,
    jobs, and other side effects occur only after the durable transaction and
    cannot be used to repair an unauthorized commit.

For creation, there may be no resource row to lock. The complete authority
lock/recheck/PMAFB sequence still applies before the insert. For updates,
resource locking is always separate from, and follows, the authority locks.

### 4.2 Invalidation operations

Every operation that suspends a Tenant, disables a module, changes privileged
Membership or assurance state, revokes or changes a grant, closes a Guild Term,
or changes another inventoried authority source must use the same transaction
and lock order before writing the invalidation. It must acquire the exact
authority row with `FOR UPDATE` (or a strictly stronger mutually conflicting
mode) before the write and hold that lock through commit or rollback. A
privileged operation that itself changes authority is an authority writer, not
merely an authority consumer, and follows this writer-side rule.

An invalidation path that writes an authority source without participating in
this protocol is not an acceptable implementation. No background reconciliation
or later cache refresh can make an already committed privileged mutation safe.

The protocol produces a deterministic boundary:

- If invalidation obtains and commits the shared authority boundary first, a
  later mutation waits or reads the changed row and fails closed.
- If the privileged mutation obtains the boundary while all authority facts are
  valid, it retains the locks through its mutation/audit commit. A concurrent
  invalidation waits and applies afterward; subsequent privileged mutations
  fail unless authority is freshly valid.

Deadlock avoidance requires the same order for all participants. A lock
timeout, serialization error, or ambiguous row set fails safely and may be
retried only through the established idempotency/conflict contract.

## 5. Time-based expiry semantics

Wall-clock expiry is distinct from row invalidation. A lock cannot stop a grant
or Guild Term from reaching its expiry while a transaction is blocked.

For each operation, the implementation must calculate the earliest applicable
expiry from authoritative state, including at minimum the grant expiry and
Guild Term end, and any operation-specific time limit. It must then use the
authoritative database/server clock at the PMAFB and after every blocking wait
relevant to authority or resource serialization.

The comparison is strict: `current_database_time >= expiry` fails closed. No
browser clock, request timestamp, stale RequestContext timestamp, or
transaction-start timestamp may decide eligibility. Correctness must not
depend on a scheduler eventually noticing expiry.

The required temporal cases are:

- expiry already passed before the PMAFB: fail closed;
- expiry passes while waiting for an authority lock: after the wait, re-read
  every required authority fact, obtain fresh database time, and fail closed
  unconditionally when `database_time >= expiry`; PMAFB has not occurred;
- expiry passes while waiting for a resource lock: after the wait, re-read
  resource/version/lifecycle and applicable authority facts, obtain fresh
  database time, and fail closed unconditionally when `database_time >=
  expiry`; PMAFB has not occurred;
- final authority decision immediately before expiry: use database time and
  the strict comparison; at or after expiry fails, and success is possible
  only if the PMAFB was crossed before expiry.

### 5.1 Technical meaning of “commit-time”

PMAFB is the contract's authority linearization point. It is commit-adjacent,
but it is not a claim that PostgreSQL exposes a literal wall-clock instant at
which the physical transaction commit record becomes durable. The contract is
technically truthful about that distinction:

- explicit mutable invalidations cannot overtake a mutation that has crossed
  PMAFB because the mutation holds the shared authority locks through commit;
- a time expiry that occurs after PMAFB does not retroactively invalidate the
  mutation under this defined business linearization semantics;
- an expiry that occurs before PMAFB, including during any authority or
  resource lock wait, fails closed unconditionally after fresh database-time
  validation.

There is no valid pre-PMAFB exception for a mutation that “already crossed”
PMAFB before an authority or resource wait: by definition every lock and
recheck that can establish authorization or resource eligibility completes
before PMAFB. An implementation must not deliberately cross PMAFB and then
wait for such a precondition.

If a future security review requires validity at the physical commit instant
rather than at PMAFB, the implementation must stop and obtain a stronger
database-level guard or a reviewed short authority lease whose validity covers
mutation finalization. No implementation may claim that bare
`SERIALIZABLE`, `now()`, or a final application-memory check provides that
stronger guarantee.

## 6. Explicitly insufficient mechanisms

The following do not satisfy this contract on their own:

- a RequestContext snapshot or application-memory cache;
- a role name or client-supplied capability;
- authorization before opening the transaction;
- “check immediately before write” without the shared locking/finalization
  boundary;
- PostgreSQL `SERIALIZABLE` alone;
- optimistic Event, Publication, or other resource version alone;
- locking only RoleGrant while ignoring Tenant, Membership, module, term, or
  assurance/MFA authority;
- a caller-provided or transaction-start timestamp;
- a background reconciliation job after an unauthorized commit.

Resource/version locking and authority locking solve different problems. Both
are required where both invariants apply.

## 7. Required race matrix

The implementation checkpoint must use separate real PostgreSQL connections,
deterministic lock/blocking evidence, and the actual protocol selected by the
implementation. Sleep-only tests and bare isolation-level assertions are not
evidence.

| Mutable authority event | Invalidation/expiry first | Privileged mutation first |
| --- | --- | --- |
| Tenant suspension/inactivation | Mutation waits or re-reads suspended/archived Tenant and fails closed; resource/version and success-audit state remain unchanged. | Mutation holds Tenant lock through commit; suspension waits and applies afterward; subsequent mutation fails. |
| Module disablement | Mutation observes disabled module and fails closed. | Mutation wins while module is enabled; disablement applies afterward and later mutation fails. |
| Membership suspension/deactivation/ineligible state | Mutation observes current Membership/principal state and fails closed. | Mutation commits under valid Membership authority; later Membership invalidation blocks subsequent privileged work. |
| RoleGrant/capability revocation or scope change | Mutation observes revoked/changed grant and fails closed with no success audit. | Mutation commits while the grant is valid; revocation waits, then later work fails. |
| Guild Term closure/expiry | Mutation observes closed/out-of-window term and fails closed. | Mutation commits under the active term; closure waits/applies afterward and later work fails. |
| Expiry already passed | Database-clock check fails closed before PMAFB. | Not applicable: a mutation may not win with an already-passed expiry. |
| Expiry while waiting for an authority lock | After the wait, fresh database-clock validation is mandatory; if expiry passed, fail closed unconditionally. PMAFB has not occurred. | A mutation still waiting for a required authority lock has not crossed PMAFB. It may proceed only if fresh post-wait authority/time validation passes before PMAFB. |
| Expiry while waiting for a resource lock | After the wait, resource, authority, and fresh database-time validation are mandatory; if expiry passed, fail closed unconditionally. PMAFB has not occurred. | A mutation still waiting for a required resource lock has not crossed PMAFB. It may proceed only if post-wait resource/authority/time validation passes before PMAFB. |
| Authority decision immediately before expiry | Strict database-time comparison at PMAFB; `time >= expiry` fails. | Success is valid only when PMAFB was crossed while `time < expiry`; no client or transaction-start time may extend it. |

For every loser, no privileged-success audit event is emitted and the business
resource remains unchanged. A separately governed minimized denial/security
event may be recorded only where the existing A6 contract requires it.

## 8. Resource and audit boundaries

Authority serialization does not replace resource serialization. A privileged
mutation must pass both:

1. the PMAFB for current authority; and
2. the resource's Tenant ownership, lifecycle, expected-version, and other
   operation-specific guard.

The resource lock is not authority, and a valid RoleGrant is not permission to
overwrite a stale resource. A `VERSION_CONFLICT`, invalid lifecycle, missing
resource, or other safe resource result must not be converted into success.

Required success audit facts are appended in the same transaction as the
business mutation. A race loser, stale writer, or authority denial must not
emit a privileged-success audit event. This contract does not create an
unrestricted audit payload or a new audit vocabulary.

## 9. Reuse by privileged modules

The contract is reusable for Event management, Publication privileged
transitions, Opportunities, Sports management, moderation, Membership and
administrative mutations, and future privileged modules.

Each feature checkpoint still supplies its own capability, Tenant/resource,
lifecycle, audience/assurance, expected-version, and Product-specific facts.
It must call the shared PMAFB rather than inventing a weaker per-feature race
algorithm. The central implementation contract must make all authority
invalidation writers use the same locking/version protocol as mutation paths.

The current repository shows a partial pattern in
`src/server/authorization/postgres-capability-authorizer.ts`: the current
Publication and Sports transaction gateways lock Tenant, Membership, Guild
Term, and RoleGrant rows before their resource-specific checks. That pattern is
useful evidence, but it is not yet this complete cross-cutting contract because
the current foundation has no separate persisted module-enable source, has no
shared MFA authority row, and uses an injected/application clock in those
gateways. `DrizzleRoleGrantRepository.findCapabilityGrantForTenant` is a
read-only lookup with a caller-provided time and is not a substitute for PMAFB.

No runtime retrofit is authorized by this document. A future implementation
checkpoint must close those gaps, identify all invalidation writers, and prove
the race matrix against the exact SHA being reviewed.

## 10. FG-05 consequence

After this contract receives independent architecture/security approval, the
FG-05 Events gate should reference it for shared authority invalidation and
remove any duplicate or weaker authority-race algorithm. FG-05 still owns the
Event-specific facts:

- `event.manage` capability and module scope;
- Event Tenant ownership;
- Event lifecycle and audience/visibility rules;
- expected Event version;
- Event-specific audit and notification dependencies.

The global contract owns only the commit-safe privileged-authority
serialization, invalidation, and expiry semantics. This checkpoint does not
modify FG-05 or authorize Event implementation.

## 11. Required future implementation evidence

Before any privileged runtime claims this contract, the implementation review
must include:

- a complete authority-source inventory for the operation;
- the canonical lock/epoch order and all invalidation writers;
- proof that Tenant, module, Membership, RoleGrant, Guild Term, and applicable
  assurance/MFA changes use the same serialization boundary;
- explicit invalidation-blocking evidence for every applicable mutable source:
  with the mutation's consumer lock first, the invalidation writer must block
  until mutation commit, and with the invalidation writer first, the mutation
  must wait, re-read the changed authority, and fail closed;
- database-clock evidence for expiry-before, expiry-during-authority-wait,
  expiry-during-resource-wait, and immediately-before-expiry cases;
- deterministic separate-connection tests proving grant and Guild Term expiry
  during authority-row waits and resource-row waits fail closed after fresh
  changing database-time evaluation;
- two-ordering PostgreSQL races for every mutable source;
- separate resource-version race evidence;
- rollback evidence showing no unauthorized business or success-audit commit;
- exact-SHA CI evidence and independent read-only architecture/security review.

Until those conditions are met, the implementation must remain held and must
not claim that RequestContext, a cached decision, `SERIALIZABLE`, or a
resource-version check closes authority invalidation.

## 12. Scope and approval boundary

This document is an architecture proposal only. It does not:

- implement or alter authorization runtime;
- implement Events, Publications, Opportunities, Sports, moderation, or Auth;
- add a module state, authority epoch, audit table, schema, migration, test, or
  CI change;
- close OD-01, OD-02, OD-03, OD-06, OD-08, A1, or any Product decision;
- approve deployment or production database changes.

The status remains:

**PROPOSED — ARCHITECTURE/SECURITY APPROVAL REQUIRED**
