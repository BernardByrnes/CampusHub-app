# A10 — XP Ledger and Idempotency Architecture Checkpoint

- Status: **A10 XP LEDGER & IDEMPOTENCY CHECKPOINT — AWAITING SENIOR VERIFICATION**
- Decision posture: **PROPOSED — SENIOR DECISION REQUIRED**
- Repository: `BernardByrnes/CampusHub-app`
- Foundation branch: `codex/8v-b-next-foundation`
- Foundation SHA: `ab9ba34d171d992d0601ef095a3688840ca77fb0`
- Checkpoint branch: `codex/a10-xp-ledger-idempotency-gate`
- Checkpoint type: governance and architecture documentation only
- Runtime/schema/migration status: not implemented or authorized by this checkpoint

## 1. Purpose and non-authority

This document defines a proposed architecture boundary for A10 — XP Ledger and
Idempotency. It translates the frozen v1.3 Product Specification, the frozen
Implementation Blueprint, the controlled refreeze record, and the promoted
CH-EVT-003 RSVP contract into a reviewable future implementation contract.

It is not a runtime implementation, schema authorization, migration, Product
Specification amendment, or approval of any unresolved Product decision. No
implementation agent may treat a proposal in this document as approved until an
independent read-only Sol High review and the required senior verification have
accepted it.

This checkpoint creates exactly one governance file. It does not create or
modify XP code, Event RSVP code, tests, schema, migrations, CI, UI, transport,
notifications, jobs, queues, an outbox, or a persistent database.

The current foundation remains the authority baseline. Historical v1.2 files
remain historical records and are not silently elevated over the frozen v1.3
documents.

## 2. Authority and inspected baseline

The proposal is subordinate to applicable external authority, the frozen
Product Specification v1.3, approved Product Owner decisions and controlled
supersessions, approved architecture/security ADRs, approved checkpoint
contracts, and the frozen Implementation Blueprint in the repository's stated
authority order.

The exact baseline inspected was:

- `CampusHub_Product_Specification_v1.3_FROZEN.md`;
- `CampusHub_Implementation_Blueprint_v1.3_FROZEN.md`;
- `docs/governance/campushub-v1.3-controlled-refreeze.md`;
- `docs/governance/ch-evt-003-rsvp-implementation-checkpoint.md`;
- the promoted RSVP domain, application, repository, schema, migration, A2
  Tenant Surface Registry, A4 identifier inventory, and PostgreSQL evidence.

The Product Specification supplies TI-9, GSC-3, GSC-6, GSC-7, GSC-8, GSC-9,
GSC-10, GSC-14, CH-XP-001 through CH-XP-004, and the one-XP-per-Event RSVP
requirement. It also excludes Student Voice from XP and keeps the XP daily cap
and capped-allocation semantics open under OD-12.

The promoted RSVP implementation currently has:

- one current `event_rsvps` row per Tenant/Event/Membership;
- same-Tenant Event and Membership foreign keys;
- a Tenant/Event/Membership/operation-family/request-key unique retry record in
  `event_rsvp_idempotency`;
- expected participation-version concurrency;
- authoritative Tenant, module, Membership, Event, audience, and database-time
  checks in one transaction;
- Event-row and current- RSVP locking compatible with cancellation and lifecycle
  races;
- trusted server-produced identity context rather than client authority.

The existing RSVP retry record is a transport/request mechanism. It is not the
XP source of truth and must not be reinterpreted as conceptual XP uniqueness.

## 3. A10 invariants

The future runtime must preserve these invariants:

1. XP is explainable to the Student and every balance-affecting total is
   derivable from immutable ledger deltas.
2. XP ownership is `Tenant + Membership`. No Tenant behavioural XP relationship
   is stored on or inferred through Global User.
3. A conceptual source action awards at most once, regardless of request retry
   key, process retry, worker retry, or concurrent PostgreSQL transactions.
4. Request idempotency, conceptual source uniqueness, and ledger-entry identity
   remain three distinct concepts.
5. Corrections and reversals append new facts; they never edit or delete the
   original award.
6. Student reads are Membership-local, bounded, and cannot expose another
   Student's ledger or a cross-Tenant behavioural aggregation.
7. Poll XP, if later authorized, references a privacy-safe participation fact
   and never a ballot, answer, or option selection.
8. Student Voice produces zero XP and is not a source vocabulary member.
9. Historical awards are not recalculated when future rule versions change.
10. A failure at the approved business-action/ledger boundary cannot leave a
    partial RSVP, source claim, idempotency completion, or ledger fact.

## 4. Proposed canonical model

The following are proposed production concepts. Physical names may follow the
repository's naming conventions during a later implementation, but the
ownership, immutability, and uniqueness semantics are not optional.

### 4.1 `xp_ledger_entries`

Each row is one immutable business/accounting-like XP fact:

| Concept | Required meaning |
| --- | --- |
| `id` | Stable ledger-entry UUID; unique within the database. |
| `tenantId` | Explicit Tenant owner. |
| `membershipId` | Exact Tenant-local Membership owner. |
| `entryType` | Closed vocabulary: `award`, `capped_award`, `correction`, or `reversal`. |
| `amount` | Signed integer delta. `capped_award` is always zero and never affects balance. |
| `ruleId` | Stable closed XP rule identity. |
| `ruleVersion` | Immutable rule version used for this fact. |
| `sourceKind` | Closed conceptual source vocabulary, not arbitrary Tenant input. |
| `sourceReferenceId` | Opaque Tenant-local source reference; never raw content or a ballot. |
| `sourceOccurrence` | Stable discriminator where one source can legitimately have more than one approved rule occurrence. |
| `sourceClaimId` | The structural conceptual-source claim that makes an award unique. |
| `requestIdempotencyKeyDigest` | Bounded opaque request provenance; never the conceptual uniqueness key. |
| `reasonCode` / `reasonText` | Required for correction/reversal and minimized for normal awards. |
| `sourceEntryId` | Required for correction/reversal where the original fact is being corrected or reversed. |
| `actorMembershipId` | Required for privileged correction/reversal; same-Tenant and not a Global User identifier. |
| `occurredAt` | Authoritative server/database time for the business fact. |
| `createdAt` and immutable creation metadata | Reconstruction and audit support without mutable history. |

`amount`, `ruleId`, `ruleVersion`, source facts, reason, actor attribution,
and timestamps are immutable after insertion. A ledger row is never updated,
deleted, or truncated by ordinary application code.

### 4.2 `xp_source_claims`

The source-claim relation is the structural exactly-once boundary for ordinary
positive/capped source awards. It is not the balance and is not a replacement
for the ledger.

It contains a stable claim ID, Tenant, Membership, stable rule ID, closed source
kind, source reference, source occurrence, award outcome (`awarded` or
`capped`), and the canonical ledger-entry ID. Both rows are created in the
same transaction using preallocated identifiers, so a committed claim always
has its corresponding immutable ledger fact.

The database requires a unique constraint over:

```text
Tenant + Membership + stable rule ID + source kind + source reference ID + source occurrence
```

The rule version and request idempotency key are deliberately not part of this
unique identity. A rule version change must not award the same conceptual Event
again, and a new transport key must not bypass the claim.

For a source with a relational identity, a generic polymorphic string alone is
not sufficient. The implementation must add a typed source relation or
source-specific child/claim table with Tenant-first composite foreign keys. An
Event RSVP claim therefore binds `(tenantId, eventId)` to the same-Tenant Event
and `membershipId` to the same-Tenant Membership.

### 4.3 Request idempotency

Request idempotency remains separate from source uniqueness.

The existing `event_rsvp_idempotency` row remains the request retry record for
the current RSVP command. A later generic XP award surface may use a separate
`xp_award_idempotency` relation containing Tenant, Membership, operation family,
an opaque bounded key or digest, a material-intent fingerprint, and the
canonical result/claim reference.

- Same key plus the same material intent returns the original canonical result.
- Same key plus materially different source, rule, amount, or intent returns
  `IDEMPOTENCY_CONFLICT` (or the exact approved equivalent family).
- A different key for the same conceptual source resolves the existing source
  claim and returns its canonical award/capped result; it never creates a second
  ledger entry.

An idempotency row may have a narrowly defined completion update for request
replay bookkeeping. That does not authorize updates to ledger history or source
claims.

### 4.4 Proposed closed source vocabulary

The proposed vocabulary is derived from the frozen Pilot rule catalogue:

- `verification_completion`;
- `profile_field_completion`;
- `poll_participation`;
- `event_rsvp`;
- `daily_quiz_participation`;
- `daily_quiz_accuracy`;
- `streak_milestone`.

The vocabulary is closed at the application boundary. A Tenant cannot invent a
new source kind or rule by sending a string. New source kinds require an
additive Product/architecture review and corresponding Tenant-surface,
privacy, audit, and PostgreSQL evidence.

The following are explicitly not source kinds: saves, follows, supports,
opening or reading content, Student Voice, arbitrary browsing, and transport
requests. Corrections and reversals reference an existing fact; they do not
create an ungoverned source kind.

## 5. Event RSVP source contract

The first proposed producer is the promoted CH-EVT-003 RSVP slice. This section
does not authorize changing the current RSVP runtime; it states the contract a
future CH-XP integration must satisfy.

### 5.1 One Event award key

One successful eligible initial RSVP to `going` or `interested` produces at
most one award for:

```text
Tenant + Membership + ruleId=event.rsvp + sourceKind=event_rsvp
+ sourceReferenceId=Event ID + sourceOccurrence=initial_eligible_rsvp
```

Event title, schedule, mutable Event version, RSVP state, request idempotency
key, and transport identity are not parts of the conceptual source identity.
The durable business fact is the successful initial eligible participation in
that Tenant Event.

### 5.2 State changes do not re-award

- `going` to `interested` does not award again.
- `interested` to `going` does not award again.
- withdrawal does not award and does not delete the source claim.
- withdrawn to `going` or `interested` does not award again.
- a repeated same-state request returns the current canonical result and does
  not award again.
- replay with the same or a different request idempotency key cannot create a
  second claim.

The existing current RSVP row remains the participation state. The source
claim is the durable once-per-Event XP boundary and survives state changes.

### 5.3 Concurrency

Two first-RSVP transactions may race with the same or different request keys.
The existing Event/Membership/RSVP transaction locks and the database unique
source-claim constraint must jointly ensure one committed claim and one ledger
award. A losing transaction waits for the relevant unique/row conflict,
rereads the canonical result, and returns it or a governed stale outcome. It
must not use `SELECT` then `INSERT` as the sole protection.

The same Membership may earn once for each different Event because Event ID is
part of the source reference. A different Membership in the same Event has a
different source key. Tenant-first relations prevent analogous identifiers in
another Tenant from colliding or being read.

The future integration must preserve GSC-14 order, Event lifecycle/start-time
checks, `expectedParticipationVersion`, current-state semantics, RSVP request
idempotency, Tenant isolation, and cancellation/postponement serialization.

## 6. Privacy-safe source references

The ledger explains an award with the minimum opaque Tenant-local references
needed for the Student's own history. It does not become an attendee directory,
behavioural search index, or cross-Tenant analytics store.

For Event RSVP, the source reference may identify the Tenant Event/participation
business fact through a Tenant-scoped opaque ID. It must not expose attendee
lists, another Student's Membership ID, contact data, raw Event content, or a
Global `identitySubjectId`.

For eventual Poll participation, the source must be an approved opaque
participation record or equivalent privacy-safe fact. It must never reference a
ballot, selected option, answer, or a join that makes the answer inferable.
Poll implementation remains A1/OD-11 gated.

Student Voice has no XP source and must never appear in the source vocabulary.
The Global User record remains free of Tenant behavioural XP data. A4 must
continue to classify XP identity as Tenant + Membership, not Global User.

## 7. Append-only database and privilege contract

The future database design must enforce the business invariant in PostgreSQL,
not only through TypeScript conventions.

### 7.1 Runtime privileges

The application/runtime principal may, subject to the approved authority
closure, read authorized Tenant-local XP data and insert immutable ledger facts
and source claims. A narrowly scoped request-idempotency relation may permit
the insert/update operations needed to complete a request record.

The runtime principal must not have `UPDATE`, `DELETE`, or `TRUNCATE` on
`xp_ledger_entries` or `xp_source_claims`, and must not have owner, superuser,
`CREATEROLE`, schema-`CREATE`, `REFERENCES`, or `TRIGGER` authority that can
bypass those restrictions. The database owner and any role reachable through
recursive `ADMIN`, `SET`, or `INHERIT` authority must be checked using the
approved effective-authority closure pattern before XP work is accepted.

Rule configuration is read-only to ordinary award execution. Rule management
uses the separately governed `xp.rule_manage` capability and its own reviewed
PMAFB/A6 boundary; this checkpoint does not implement it.

### 7.2 Structural protections

The future implementation must provide:

- Tenant foreign keys and Tenant-first composite Membership FKs;
- typed same-Tenant source relations wherever an approved source is relational;
- a database unique constraint for source claims;
- a closed database/application event and source vocabulary;
- append-only triggers and/or privilege hardening that reject ledger
  `UPDATE`, `DELETE`, and `TRUNCATE` by the runtime principal;
- an owner/admin separation that prevents a runtime role from changing its own
  protections;
- correction/reversal rows as new inserts with immutable references to the
  source fact;
- no mutable `membership.xp_total` or equivalent authoritative counter.

The source claim and ledger entry are preallocated and inserted in one
transaction. A committed source claim without a ledger entry is invalid and
must be detected by reconciliation. A duplicate claim conflict must resolve to
the existing immutable result rather than mutate it.

No database object or migration is created by this document.

## 8. Award transaction and atomicity

For the first RSVP producer, the future XP integration must use the existing
RSVP transaction rather than a second commit or an unauthorized worker:

1. lock and reread the existing Tenant, module, Membership, Event,
   idempotency, and current RSVP facts in the established compatible order;
2. run the final authoritative database-time and GSC-14 decision;
3. determine the current RSVP transition and whether it is the initial eligible
   award-producing transition;
4. if applicable, claim the conceptual source with the database uniqueness
   constraint and insert the immutable ledger fact;
5. mutate the current RSVP row and complete the request idempotency result;
6. commit all of those facts together.

The exact physical statement order may follow the reviewed lock plan, but the
business boundary is one database transaction. No accepted first eligible RSVP
may commit without its required XP source fact once CH-XP-002 and the approved
numeric/rule dependencies are available.

If the ledger or source-claim insert fails before commit, the whole transaction
rolls back: no RSVP mutation, source claim, ledger row, or completed request
idempotency row remains. The caller receives a controlled persistence failure
and may retry. The implementation must not report a successful RSVP while
silently losing the required first XP fact.

This is a product-accounting fact, not an email/notification side effect. GSC-10
continues to govern later notifications: delivery is after the committed
business state, retryable, and duplicate-safe. No outbox, job, queue, or SYSTEM
authority is created here. OD-08 remains open for those execution semantics.

The current promoted RSVP behavior remains unchanged until a separately
authorized CH-XP runtime checkpoint satisfies this contract.

## 9. Rule identity and forward-only versioning

The future rule catalogue uses stable closed rule identities such as
`event.rsvp`, `poll.participation`, `profile.field`, and the separately governed
Daily Quiz and Streak identities. The exact production vocabulary remains
reviewable, but arbitrary Tenant-defined rule/source names are not permitted.

Each active rule has an immutable positive version. A later approved version is
activated forward-only for new business actions. Every ledger fact snapshots
the stable rule ID, rule version, and effective amount used at the time. Old
ledger entries are never recalculated from current configuration.

The checkpoint chooses no numeric amounts, platform ranges, daily cap, grace
window, or capped-allocation ordering. Those values remain subject to the
authority and open-decision process described below.

## 10. OD-12 boundary

`OD-12 REMAINS OPEN — NO NUMERIC DAILY CAP OR CAPPED ALLOCATOR AUTHORIZED`

The architecture may preserve the following invariant envelope supplied by
Product authority without selecting the unresolved number or algorithm:

- normal positive awards will be subject to a future approved daily cap;
- the underlying business action succeeds when the cap limits the award;
- excess above the eventual cap is discarded, not deferred or carried over;
- corrections and fraud reversals are exempt from the normal-positive-award
  cap;
- a capped attempt is represented by a zero-amount, non-balance
  `capped_award` fact with the applicable rule/reason;
- historical awards are not recalculated after rule changes.

No prototype amount or temporary cap may be used. No allocation ordering may be
implemented to resolve the open capped-allocation branch. If a future XP runtime
cannot safely determine its amount without OD-12, it must stop/fail closed
rather than invent a default. Numeric XP runtime remains blocked until the
required authority is supplied.

## 11. Balance and Student read model

The authoritative balance is:

```text
sum(immutable balance-affecting ledger amounts for Tenant + Membership)
```

`capped_award` zero facts are explainability records and do not affect that
sum. A cached/materialized balance may be added later only as a rebuildable
derived projection. It can never become authority, and reconciliation must be
able to detect divergence and rebuild it from the ledger.

The Student read contract is:

- explicit trusted Tenant and Membership context;
- own XP only;
- bounded, keyset-paginated history;
- stable action/rule explanation without unnecessary source content;
- no other Student's ledger or identity;
- no cross-Tenant aggregation;
- no leaderboard or ranking surface.

Detailed source-level support/security access is separately capability-gated,
reasoned, minimized, and audited. `xp.adjust` alone does not grant ordinary
administrator access to detailed Student history.

## 12. Corrections, reversals, and A6

The proposed closed ledger event vocabulary is:

- `award`: positive balance-affecting fact from a valid source;
- `capped_award`: zero-amount non-balance fact;
- `correction`: an authorized new positive delta correcting a platform error;
- `reversal`: an authorized negative delta for an erroneous award or recorded
  fraud finding.

Every correction or reversal:

- is a new immutable ledger row;
- references the original source entry/claim;
- has a mandatory reason code and bounded explanation;
- has exact actor Membership attribution when Membership-backed;
- uses expected concurrency and a unique correction intent so a retry cannot
  apply it twice;
- uses the existing shared PMAFB and `xp.adjust`/approved authority boundary
  where applicable;
- creates the minimum required A6 security audit event for the privileged
  decision.

The original award is never updated or deleted. A correction/reversal failure
cannot rewrite the balance or partially commit a new fact. A future correction
notification remains governed by CH-NTF and is not implemented here.

The XP ledger is a product accounting/explanation history. A6 remains the
security/governance audit history. A6 must not be used as the XP balance source,
and ordinary Student award generation must not copy excessive behavioural
payload into audit events. A6 facts remain minimized and Tenant-scoped.

## 13. Reconciliation contract

The future reconciliation algorithm must run against a consistent database
view and report drift without silently mutating immutable history. It must:

1. recompute each Tenant/Membership balance from ledger deltas;
2. compare that result with any derived/cache representation;
3. verify every source claim has exactly one matching award or capped ledger
   fact and that no award source has duplicate claims;
4. detect source claims or ledger rows with missing/foreign Tenant or Membership
   relations;
5. detect invalid rule versions, invalid event-type/amount combinations,
   malformed correction/reversal references, duplicate correction intents, and
   impossible source occurrences;
6. report the immutable identifiers, Tenant, Membership, rule/source category,
   and safe reason for drift without exposing unrelated Student data;
7. leave history untouched and require a separately authorized correction or
   reversal workflow for remediation.

The invariant/algorithm is defined here separately from execution scheduling.
OD-08 remains open: no cron, worker, queue, outbox, background job, or SYSTEM
transition is authorized by this checkpoint.

## 14. Required real PostgreSQL evidence for A10 runtime

The future implementation must use separate real PostgreSQL connections and
deterministic barriers. `Promise.all` or arbitrary sleeps alone are not proof.
Where blocking is claimed, evidence must include backend PIDs and
`pg_blocking_pids` or equivalent lock-observation data.

| Probe | Required evidence |
| --- | --- |
| XP-PG-01 | Same source and same request key: exactly one claim and one award; replay returns the canonical result. |
| XP-PG-02 | Same source and different request keys: still exactly one claim/award; the second key cannot bypass source uniqueness. |
| XP-PG-03 | `going → interested`, withdrawal, and withdrawn reactivation: no additional Event RSVP award. |
| XP-PG-04 | Same Membership and different Events: one legitimate award per Event. |
| XP-PG-05 | Different Tenants with analogous IDs: no cross-read, cross-write, or false uniqueness conflict. |
| XP-PG-06 | Forced ledger/source-claim failure: no partial RSVP, claim, ledger, or completed idempotency state. |
| XP-PG-07 | Business-source/award atomicity at the dangerous boundary: the approved transaction either commits both or rolls back both. |
| XP-PG-08 | Repeated/concurrent correction or reversal: one append-only corrective intent, no history rewrite, no duplicate delta. |

Additional evidence must cover same-key material-intent conflict,
`IDEMPOTENCY_CONFLICT`, malformed source references, runtime privilege
hardening, recursive effective-authority closure, Student read isolation,
Tenant negative probes, and reconciliation detection of deliberately injected
invalid fixtures in a disposable database.

## 15. A2, A4, and implementation obligations

The later runtime checkpoint must add narrow Tenant Surface Registry entries
and negative evidence for, at minimum:

- `xp_ledger_entries`;
- `xp_source_claims`;
- `xp_award_idempotency`, if implemented as a separate relation;
- approved rule/configuration relations;
- any derived balance projection;
- the Student own-XP read repository/service;
- reconciliation inspection/reporting surfaces.

Every Tenant-owned relation must have explicit Tenant filtering, same-Tenant
foreign keys where relational, safe wrong-Tenant behavior, and A4 identifier
classification. No new A4 inventory entry or runtime registry entry is made by
this documentation-only checkpoint.

The later implementation must also prove:

- no Global User behavioral ownership;
- no arbitrary source/rule strings from a client;
- no mutable authoritative XP total;
- append-only runtime privilege and database-trigger behavior;
- A6 events for privileged correction/reversal/rule operations only where
  required;
- current RSVP semantics and all existing CH-EVT-003 PostgreSQL races remain
  green.

## 16. Explicit exclusions

This checkpoint does not authorize or implement:

- XP runtime or any XP schema/migration;
- Levels, Streak, Daily Quiz, badges, rewards, or Campus Energy;
- Poll runtime, ballot persistence, tally, or A1 privacy work;
- Student Voice runtime or Student Voice XP;
- notification, email, push, SMS, reminder, cancellation delivery, or outbox;
- jobs, queues, schedulers, reconciliation workers, or SYSTEM transitions;
- XP UI, transport/API routes, or external delivery;
- leaderboards or rankings;
- sponsorship, predictor, media, Auth, OD-03, or deployment;
- changes to Event RSVP runtime, migration `0020`, migration `0019`, or any
  historical migration;
- promotion, merge, production migration, or persistent database mutation.

The retained Event qualifiers remain:

**FULL CH-EVT-003 STORY COMPLETION NOT CLAIMED — XP AND NOTIFICATION
DEPENDENCIES REMAIN**

**FULL CH-EVT-004 STORY COMPLETION NOT CLAIMED — CANCELLATION NOTIFICATION
DEPENDENCY REMAINS**

**FULL CH-EVT-002 STORY COMPLETION NOT CLAIMED — PUBLICATION ATTRIBUTION AND
OPTIONAL LOGO REMAIN GATED**

**FULL CH-EVT-001 STORY COMPLETION NOT CLAIMED — EVENT MEDIA DEPENDENCY REMAINS**

## 17. Required decision register

Every item below is a proposal or a preserved deferral, not an approval.

| ID | Decision | Status | Boundary/evidence required to close |
| --- | --- | --- | --- |
| A10-D01 | Ledger ownership and append-only source of truth | **PROPOSED — SENIOR DECISION REQUIRED** | Accept `Tenant + Membership` ownership, immutable deltas, no authoritative mutable total, and PostgreSQL append-only proof. |
| A10-D02 | Conceptual source identity and uniqueness | **PROPOSED — SENIOR DECISION REQUIRED** | Accept a structural unique source claim independent of request keys, with typed same-Tenant relations and concurrent conflict evidence. |
| A10-D03 | Request idempotency versus source uniqueness | **PROPOSED — SENIOR DECISION REQUIRED** | Accept separate same-key replay/conflict semantics and different-key source-claim resolution. |
| A10-D04 | RSVP once-per-Event source key | **PROPOSED — SENIOR DECISION REQUIRED** | Accept Membership + Event + stable RSVP rule + initial eligible occurrence; prove state changes, withdrawal, reactivation, and races. |
| A10-D05 | Privacy-safe source references | **PROPOSED — SENIOR DECISION REQUIRED** | Accept opaque Tenant-local references, typed source relations, no attendee directory, no Global User behavior, and no Poll ballot reference. |
| A10-D06 | Rule identity and versioning | **PROPOSED — SENIOR DECISION REQUIRED** | Accept closed stable rule IDs, immutable versions, amount snapshots, forward-only activation, and no historical recalculation. |
| A10-D07 | Business-action/award atomicity | **PROPOSED — SENIOR DECISION REQUIRED** | Accept one future RSVP transaction for the state change, source claim, ledger fact, and request completion, with forced-failure evidence. |
| A10-D08 | Correction/reversal model | **PROPOSED — SENIOR DECISION REQUIRED** | Accept append-only new deltas, mandatory reasons, authority/A6 boundary, source references, and correction-intent uniqueness. |
| A10-D09 | Derived balance model | **PROPOSED — SENIOR DECISION REQUIRED** | Accept ledger sum as authority, rebuildable cache only, bounded own-XP reads, and no leaderboard. |
| A10-D10 | Reconciliation invariant | **PROPOSED — SENIOR DECISION REQUIRED** | Accept drift/duplicate/malformed-chain detection without silent history mutation and separate OD-08 execution scheduling. |
| A10-D11 | Database/runtime-role hardening | **PROPOSED — SENIOR DECISION REQUIRED** | Accept runtime INSERT/authorized SELECT only for immutable facts, no destructive privilege, owner/admin separation, and recursive authority closure evidence. |
| A10-D12 | Real PostgreSQL race and failure evidence | **PROPOSED — SENIOR DECISION REQUIRED** | Accept XP-PG-01 through XP-PG-08 plus lock, privilege, isolation, and reconciliation evidence as a runtime exit gate. |
| A10-D13 | Numeric daily cap and capped allocation semantics | **DEFERRED — OD-12 REMAINS OPEN** | No numeric cap, prototype value, allocation ordering, carry-over, or temporary default may be implemented. |

## 18. Future implementation exit criteria

Before A10 runtime can be considered complete, an implementation checkpoint
must be based on an approved version of this architecture, re-check the exact
foundation, and provide:

- only the authorized XP runtime/schema/migration scope;
- A2/A4 registry and identifier updates with negative Tenant evidence;
- immutable database protections and recursive runtime-authority proof;
- the closed source/rule vocabulary and source-specific same-Tenant relations;
- RSVP integration that preserves every CH-EVT-003 behavior and dependency
  boundary;
- all XP-PG probes with real PostgreSQL and deterministic lock evidence;
- unit, application, governance, integration, typecheck, lint, build, and
  schema validation appropriate to the authorized change;
- Gitleaks and exact-SHA CI evidence;
- independent Sol High review of the exact implementation SHA.

No future implementation may close OD-12, A1/OD-11, or OD-08 by implication.

**A10 XP LEDGER & IDEMPOTENCY CHECKPOINT — AWAITING SENIOR VERIFICATION**
