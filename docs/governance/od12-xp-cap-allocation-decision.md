# OD-12 — XP Daily Cap, Allocation and Initial Rule Numeric Policy

- Status: **OD-12 XP NUMERIC POLICY — PROPOSED / AWAITING PRODUCT OWNER & SENIOR REVIEW**
- Decision type: Product/governance documentation proposal only
- Repository: `BernardByrnes/CampusHub-app`
- Foundation branch: `codex/8v-b-next-foundation`
- Foundation SHA: `ab9ba34d171d992d0601ef095a3688840ca77fb0`
- Approved A10 source branch: `codex/a10-xp-ledger-idempotency-gate`
- Approved A10 source SHA: `52d4d4edd4db1c793b5a6bc2458285283b99e0fe`
- Checkpoint branch: `codex/od12-xp-numeric-policy-gate`
- Runtime/schema/migration status: not implemented or authorized by this checkpoint

## 1. Purpose and non-authority

This document proposes the remaining numeric Product policy needed for a
bounded first XP runtime slice: the Pilot daily cap, the cap-boundary
allocation rule, the authoritative day boundary, and the initial Event RSVP
rule amount and platform range.

It is not an approval, Product Specification amendment, runtime design,
schema authorization, migration authorization, or implementation checkpoint.
The proposed values become Product authority only after the existing authority
order has accepted them through Product Owner and independent senior review.

This checkpoint does not modify the frozen Product Specification, the frozen
Implementation Blueprint, the A10 architecture checkpoint, Event RSVP, or any
runtime, schema, migration, test, CI, notification, job, reconciliation, Poll,
Quiz, Streak, Level, Auth, or deployment surface.

If this proposal is approved, it is sufficient numeric authority for the
bounded first runtime slice `A10 XP Ledger Core + Event RSVP award producer`
only. It does not authorize that runtime; implementation still requires an
approved A10 checkpoint and the normal implementation gates.

## 2. Authority and inspected baseline

The proposal is subordinate to applicable external authority, the frozen
Product Specification v1.3, approved Product Owner decisions and controlled
supersessions, approved architecture/security ADRs, approved checkpoint
contracts, and the frozen Implementation Blueprint in the repository's stated
authority order.

The exact inspected baseline was:

- `CampusHub_Product_Specification_v1.3_FROZEN.md`;
- `CampusHub_Implementation_Blueprint_v1.3_FROZEN.md`;
- `docs/governance/campushub-v1.3-controlled-refreeze.md`;
- `docs/governance/a10-xp-ledger-idempotency-gate.md` at A10 SHA
  `52d4d4edd4db1c793b5a6bc2458285283b99e0fe`;
- `docs/governance/ch-evt-003-rsvp-implementation-checkpoint.md`;
- the repository history and the preserved static prototype/reference material.

The frozen Product authority supplies the qualitative rules retained below:
XP is restrained PLAY subordinate to KNOW and PARTICIPATE; it is not
purchasable, spendable, or required for essential information; ordinary
positive awards are subject to a daily cap; the underlying action succeeds
when an award is capped; excess is discarded rather than deferred; capped
attempts remain explainable; corrections and fraud reversals are outside the
normal-positive cap; rule changes are forward-only; and Student Voice,
saves, follows, supports, and reads are not XP sources.

The approved A10 proposal supplies the separate request-idempotency,
conceptual-source, and immutable-ledger concepts, including the ordinary
outcomes `award` and `capped_award`, one canonical ordinary ledger fact per
source claim, Tenant + Membership ownership, and no historical recalculation.
This document supplies only the numeric policy requested by OD-12 and does
not weaken those boundaries.

## 3. Historical and prototype evidence — not authority

The following figures were found in the preserved static prototype/reference
material and are recorded to prevent accidental promotion of them into
production authority:

| Historical figure | Source | Classification |
| --- | --- | --- |
| `+5 XP` for Daily Quiz participation | `CampusHub_Canonical_Prototype_Blueprint_v1.2_FROZEN.md` §11.1/§11.3 and static prototype copy | **HISTORICAL / PLACEHOLDER — NOT SELECTED** |
| `+5 XP` Daily Quiz accuracy bonus | same prototype/reference material | **HISTORICAL / PLACEHOLDER — NOT SELECTED** |
| `+10 XP` maximum for one Daily Quiz attempt | same prototype/reference material | **HISTORICAL / PLACEHOLDER — NOT SELECTED** |
| sample `340 XP` balance and `160 XP to Level 5` | prototype Play/Profile sample data | **HISTORICAL / PLACEHOLDER — NOT SELECTED** |
| prototype level thresholds `0–99`, `100–199`, `200–299`, `300–499`, `500–799` | prototype demo data | **HISTORICAL / PLACEHOLDER — NOT SELECTED** |
| prototype Event RSVP test/demo increments of `5 XP` | static prototype XP ledger fixtures | **HISTORICAL / PLACEHOLDER — NOT SELECTED** |

The v1.3 governing documents and repository history do not supply an approved
numeric daily cap, Event RSVP default, or Event RSVP platform range. No real
CampusHub user or Pilot measurement exists yet. The proposed values below are
Product judgment for a restrained Pilot and are not claimed to be measured
evidence or a continuation of prototype configuration.

## 4. Proposed numeric policy

Subject to Product Owner and senior approval, the single proposed Pilot
numeric policy is:

```text
PILOT_DAILY_XP_CAP = 50
EVENT_RSVP_XP_DEFAULT = 5
EVENT_RSVP_XP_MIN = 1
EVENT_RSVP_XP_MAX = 10
```

All four values are positive integers. The Event RSVP default lies within the
platform range, and the maximum Event RSVP award is one fifth of the proposed
daily cap. The values are deliberately small enough to be explainable as
participation recognition rather than a score, while leaving room for several
legitimate activities before the cap is reached.

### 4.1 Why the proposed daily cap is 50

The proposal treats `50 XP` as a restrained daily ceiling, not a target. It
has these Product reasons:

- it permits ordinary same-day participation such as one Event RSVP, a poll,
  and a Daily Quiz without making the first legitimate actions constantly
  collide with the cap;
- it places a meaningful upper bound on repeated low-cost Event or Poll
  participation even when a Student encounters many eligible sources;
- it is simple to explain: normal positive awards can add at most 50 XP in a
  Tenant day, and a capped action still succeeds;
- it leaves correction and fraud-reversal semantics unchanged because those
  are not normal-positive awards;
- it is low enough to support an anti-farming boundary, but not so low that a
  normal day is routinely reduced to a sequence of capped zeroes.

There is no measured Pilot cohort evidence yet. Real Pilot evidence must be
used later to assess whether the cap causes excessive legitimate capping or
fails to constrain abuse; that evidence may support a separately governed
forward policy change, not a retroactive rewrite.

### 4.2 Authoritative day boundary

The authoritative XP day is the calendar day in the active Tenant's governed
IANA timezone:

```text
00:00:00 inclusive
to the next local midnight exclusive
```

The browser timezone, device timezone, and a UTC calendar day are never
authoritative for the cap. Timestamps remain persisted in UTC. The future
award transaction derives the applicable local Tenant day from authoritative
server/database time and the Tenant timezone inside the same transaction that
claims the conceptual source.

Ordinary timezone-calendar semantics apply on DST transitions: the timezone
library's valid local midnight and offset rules govern the boundary, including
days that are not exactly 24 hours. The initial Uganda deployment has no DST,
but the contract does not rely on that fact. A fixed rolling 24-hour window is
not permitted.

Historical ledger facts retain their immutable UTC timestamps and the
governed day attribution used when they were committed. A later Tenant
timezone-setting change must not rewrite historical ledger facts; any runtime
policy for changing a Tenant timezone must preserve this traceability and be
separately reviewed if it affects future awards.

### 4.3 Cap allocation: whole-award capping

The proposal selects **whole-award capping**. Partial awards do not exist in
this Pilot policy.

If:

```text
normal-positive XP already committed for Tenant + Membership + Tenant day
+ proposed positive rule amount > 50
```

then the underlying business action succeeds, but the XP result is:

```text
source claim outcome = capped_award
ledger entryType     = capped_award
ledger amount        = 0
```

If the current normal-positive total is already 50, the same result applies.
If the proposed award fits, the result is:

```text
source claim outcome = award
ledger entryType     = award
ledger amount        = governed rule amount
```

The Student-facing explanation must state that the action succeeded and the
normal-positive daily cap caused a zero XP award. The capped fact remains an
explainable immutable ledger fact and does not become balance-affecting.

Partial remainder capping was considered and rejected for this checkpoint.
For example, turning a 5 XP Event award into a 2 XP ordinary fact would
require either a new partial-outcome vocabulary or ambiguous amount semantics,
and would make the A10 one-source/one-ordinary-ledger-fact contract harder to
explain and enforce. The smallest clear rule is to consume the source and
record one `capped_award` fact with amount zero.

### 4.4 Capped source consumption

A conceptual source is consumed exactly once regardless of whether it produces
`award` or `capped_award`. A capped source is not a promise to retry later.

- Replaying the same request tomorrow does not turn yesterday's capped source
  into an award.
- A different request idempotency key cannot create a second chance.
- Changing RSVP from `going` to `interested`, or back, cannot create a second
  chance.
- Withdrawal and later reactivation cannot create a second chance.
- A later rule version cannot re-award the same conceptual source.

This preserves A10 conceptual uniqueness and prevents a Student from farming
the boundary through retries or state changes. A future correction/reversal
references an existing immutable fact and remains outside the normal-positive
cap calculation.

### 4.5 Concurrent cap invariant

The eventual award transaction must evaluate the cap against authoritative
ledger state inside the same transaction that claims the conceptual source.
The implementation must serialize the logical key:

```text
Tenant + Membership + governed Tenant-local XP day
```

using a reviewed PostgreSQL lock/serialization strategy. A bare `SELECT SUM`
followed by an INSERT without a lock or equivalent serialization is prohibited.
Two concurrent eligible awards must not both observe the same remaining
allowance and commit normal-positive XP above 50. The committed invariant is:

> Normal-positive XP for one Membership in one governed Tenant-local day never
> exceeds `PILOT_DAILY_XP_CAP` through concurrency.

The exact physical coordination row or lock plan belongs to the A10 runtime
implementation and must be proven with real PostgreSQL barriers and lock
evidence. Corrections and reversals are not included in this normal-positive
sum and do not become a way to bypass the source-claim or append-only rules.

## 5. Event RSVP numeric contract

The first planned XP producer is `event.rsvp`.

```text
EVENT_RSVP_XP_DEFAULT = 5
EVENT_RSVP_XP_MIN     = 1
EVENT_RSVP_XP_MAX     = 10
```

The proposed amount is intentionally a small integer: it recognizes a
successful participation action without making one RSVP materially dominate
the Play layer. The range is narrow and platform-owned. The proposed default
is a Product proposal, not authority imported from the prototype's historical
`+5` demo value.

The Event RSVP rule requires:

- one positive integer amount selected by the Tenant within the platform
  range, with 5 as the initial default;
- one conceptual award opportunity per Event for the Membership;
- identical amount for `going` and `interested`;
- no amount variation by popularity, organiser, campus, audience,
  verification assurance, sponsorship, or personalization;
- no sponsored XP and no assurance-based multiplier;
- withdrawal does not reverse an award merely because the Student changed
  plans;
- reactivation does not award again;
- Event state changes do not change the original snapshotted amount;
- the underlying RSVP action succeeds even when the XP result is
  `capped_award`.

The Event RSVP source key remains the A10 conceptual identity:

```text
Tenant + Membership + ruleId=event.rsvp + sourceKind=event_rsvp
+ Event ID + sourceOccurrence=initial_eligible_rsvp
```

Request keys, Event title/schedule, RSVP state, and rule version do not become
parts of that source identity.

## 6. Rule version interaction and Tenant bounds

The initial Event RSVP rule begins at immutable `version 1` only when runtime
is authorized and the rule is created. A Tenant amount change creates or
activates a new forward-only rule version inside the platform range. It does
not rewrite the prior version or any existing ledger fact.

Rule version is not part of conceptual source uniqueness. An Event already
awarded under version 1 cannot re-award merely because version 2 is later
activated. Each ledger fact retains its rule version and snapshotted amount.

The platform owns `EVENT_RSVP_XP_MIN` and `EVENT_RSVP_XP_MAX`. A Tenant may
choose only an integer within that range. Tenant configuration must not:

- disable conceptual source uniqueness;
- set a negative, zero, fractional, or out-of-range ordinary award;
- bypass or enlarge the daily cap;
- create an arbitrary XP source kind;
- make Student Voice an XP source;
- alter a committed ledger amount or historical rule version; or
- turn a capped source into a future award.

Configuration changes are privileged, forward-only, and subject to the A10
PMAFB/A6 and authority-freshness requirements. This checkpoint does not
implement `xp.rule_manage`, `xp.adjust`, re-authentication, or any other
privileged rule-management workflow.

## 7. Other source amounts remain unselected

This checkpoint does not select numeric values for verification completion,
profile-field completion, Poll participation, Daily Quiz participation or
accuracy, Streak milestones, Levels, or any other source.

Those sources remain subject to their own dependencies and future Product
decisions. In particular:

- Poll XP remains dependent on the A1/OD-11 privacy and participation design;
- Daily Quiz amounts and accuracy allocation remain unselected;
- Streak amounts remain unselected;
- profile and verification amounts remain unselected despite the frozen
  qualitative references to a low value;
- Levels remain separately gated and receive no numeric decision here;
- Student Voice remains zero XP and is not a source.

The prototype figures in §3 are not defaults for these sources. This document
does not claim that all CH-XP-002 rules are complete.

## 8. Compact abuse analysis

| Abuse or pressure | Controls supplied by this proposal | Remaining boundary |
| --- | --- | --- |
| Student farms many trivial Events | One source claim per Membership/Event, whole-award daily cap, Event authority/lifecycle rules | The cap does not solve malicious Event creation by privileged staff. Event governance and abuse review remain required. |
| Repeated RSVP state changes | Source identity ignores request key/state changes; withdrawal/reactivation do not re-award | Existing RSVP state/concurrency rules still apply. |
| Many request idempotency keys | A10 source uniqueness is independent of request idempotency | A10 runtime must enforce the claim atomically. |
| Concurrent source attempts | Tenant + Membership + Tenant-day serialization and exact A10 source claim | Real PostgreSQL race evidence remains an implementation gate. |
| Tenant chooses an extreme amount | Platform-owned positive range `1..10`; privileged forward-only configuration | Rule-management authority and audit are not implemented here. |
| Many different legitimate sources in one day | Shared cap of 50 for normal-positive XP | Product/Pilot evidence may support a future controlled adjustment. |
| Administrator changes a rule during a day | Immutable version and amount snapshot; no historical recalculation | Fresh authority and `xp.rule_manage` remain future runtime work. |
| Poll/Quiz/Streak farming | Closed source vocabulary and unselected future amounts; cap applies once those sources are authorized | Their own product, privacy, and implementation gates remain open. |

The daily cap is an abuse boundary for normal-positive XP, not a complete
anti-fraud system and not a substitute for Event management controls,
authority invalidation, audit, or future operational monitoring.

## 9. First runtime dependency status

**Numeric readiness answer: YES, conditionally.** If Product Owner and senior
authority approve this proposal, and the A10 architecture checkpoint is also
accepted through its required process, the following numeric facts are present
for the bounded first runtime slice `A10 XP Ledger Core + Event RSVP award
producer`:

- Event RSVP amount: default 5, platform range 1–10;
- daily cap: 50 normal-positive XP;
- day boundary: Tenant timezone local midnight to next local midnight;
- cap boundary: whole-award `capped_award` with amount 0;
- concurrency invariant: serialized cap decision inside the source-claim
  transaction;
- source consumption: one award or capped award, never a later retry award.

This conditional YES does not mean:

- Poll XP is ready;
- Daily Quiz XP is ready;
- Streak XP is ready;
- all CH-XP-002 rules are numerically complete;
- CH-XP-004 Platform Operator authority is ready;
- OD-08 jobs, reconciliation scheduling, notifications, or outbox work are
  ready; or
- A10 runtime implementation is authorized before its own approval gates.

## 10. Required decision register

Every item below is a proposal or an explicit preserved non-selection, not an
approval. The numeric/Product decisions require Product Owner and senior
approval.

| ID | Decision | Status | Proposed contract / closure evidence |
| --- | --- | --- | --- |
| OD12-D01 | Pilot daily XP cap | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | Select `PILOT_DAILY_XP_CAP = 50` for normal-positive XP per Tenant + Membership + Tenant-local day; corrections/reversals remain outside the cap. |
| OD12-D02 | Tenant-timezone day boundary | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | Use Tenant IANA timezone, local midnight inclusive to next local midnight exclusive, with UTC persistence and ordinary DST-calendar semantics. |
| OD12-D03 | Cap allocation semantics | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | Select whole-award capping; no partial awards exist; an over-cap source yields `capped_award` amount 0 while the underlying action succeeds. |
| OD12-D04 | Capped-award source consumption | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | A capped conceptual source is consumed exactly once and cannot become an award through tomorrow, retries, state changes, withdrawal/reactivation, or a later rule version. |
| OD12-D05 | Concurrent cap invariant | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | Cap evaluation and source claim occur in one transaction with serialization on Tenant + Membership + Tenant-local day; committed normal-positive XP cannot exceed 50. |
| OD12-D06 | Event RSVP default XP amount | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | Select `EVENT_RSVP_XP_DEFAULT = 5`, identical for `going` and `interested`, once per Event. |
| OD12-D07 | Event RSVP platform min/max range | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | Select `EVENT_RSVP_XP_MIN = 1` and `EVENT_RSVP_XP_MAX = 10`; positive integer Tenant choice only. |
| OD12-D08 | Forward-only Tenant rule versioning | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | Initial runtime rule is version 1; later changes create new versions, preserve snapshots, and never alter source uniqueness or historical ledger facts. |
| OD12-D09 | Unresolved numeric rules for other source kinds | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | Keep verification, profile, Poll, Quiz, Streak, and Level amounts unselected; each requires its own authority/dependency closure. |
| OD12-D10 | First XP runtime readiness | **PROPOSED — PRODUCT OWNER / SENIOR APPROVAL REQUIRED** | Conditional YES for A10 Ledger Core + Event RSVP only after this proposal and A10 are approved; no broader XP readiness is claimed. |

OD-08, A1/OD-11, CH-XP-004 Platform Operator authority, Poll, Quiz, Streak,
Levels, notifications, and reconciliation jobs remain open or separately
gated. This register does not close them by implication.

## 11. Required future implementation evidence

After approval, the bounded runtime checkpoint must still prove, without
changing this Product policy silently:

- source claim and ordinary ledger atomicity under the A10 reciprocal
  constraints;
- Tenant-timezone day derivation using authoritative server/database time;
- serialized concurrent cap decisions with real PostgreSQL barriers;
- exactly one `award` or `capped_award` ordinary fact per conceptual source;
- no source re-award after RSVP state changes or idempotency-key changes;
- immutable rule version and amount snapshots;
- Tenant range enforcement and no privileged rule-management bypass;
- explainable Student-facing capped outcomes;
- A2/A4/Tenant Surface Registry and A6 obligations;
- no Poll ballot linkage, Student Voice XP, leaderboard, job, notification, or
  Platform Operator behavior outside the approved scope.

No schema, migration, reconciliation worker, or persistent database change is
authorized by this documentation checkpoint.

## 12. Preserved Event qualifiers

**FULL CH-EVT-003 STORY COMPLETION NOT CLAIMED — XP AND NOTIFICATION
DEPENDENCIES REMAIN**

**FULL CH-EVT-004 STORY COMPLETION NOT CLAIMED — CANCELLATION NOTIFICATION
DEPENDENCY REMAINS**

**FULL CH-EVT-002 STORY COMPLETION NOT CLAIMED — PUBLICATION ATTRIBUTION AND
OPTIONAL LOGO REMAIN GATED**

**FULL CH-EVT-001 STORY COMPLETION NOT CLAIMED — EVENT MEDIA DEPENDENCY REMAINS**

**OD-12 XP NUMERIC POLICY — AWAITING SENIOR / PRODUCT OWNER VERIFICATION**
