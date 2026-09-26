# CampusHub Pilot Notification Architecture + Implementation Gate

Status: **PROPOSED — DOCUMENTATION-ONLY BOUNDARY; NOT A RUNTIME AUTHORIZATION**

- Work item: `CH-NTF-GATE-001-R2`
- Inspected baseline: `505389930237b02da6de87a9843afccff5d8473f`
- Product authority: `CampusHub_Product_Specification_v1.3_FROZEN.md`
- Production HOW authority: `CampusHub_Implementation_Blueprint_v1.3_FROZEN.md`
- Governing notification stories: CH-NTF-001 through CH-NTF-004
- Runtime disposition: **NO NOTIFICATION RUNTIME IMPLEMENTATION IS AUTHORIZED BY THIS GATE**

## 1. Purpose and boundary

This checkpoint consolidates the already-frozen Pilot notification contract and
identifies the implementation boundary that follows from it. It does not amend
the Product Specification, Blueprint, A2, A4, FG-05, CH-EVT-003, PMAFB, or any
open decision. It does not authorize a notification model, schema, migration,
application code, API, UI, test, sender, transport, job, scheduler, queue,
outbox, retry worker, or deployment.

In this document, **IMPLEMENTABLE NOW** means the behavior is sufficiently
defined by existing authority to carry forward into a later, separately
authorized runtime checkpoint without inventing a Product choice. It does not
mean runtime work is authorized by this documentation-only work item. FG-11
still requires its own implementation gate, Tenant-surface registration,
negative evidence, and review.

**OD-08 remains OPEN.** No SYSTEM authority, queued-intent rule, outbox,
background delivery, retry authority, reminder scheduling, digest scheduling,
or worker behavior is selected here. CH-NTF-003 numeric choices remain
**OPEN / HUMAN_REQUIRED** wherever the frozen specification supplies no value.

## 2. Governing authority and current evidence

The boundary below carries forward, without changing, these sources:

- Product Specification §18.18 defines the four CH-NTF stories, the complete
  Pilot category/default/channel/preference matrix, post-commit and
  duplicate-safe side-effect rules, and volume/fatigue acceptance criteria.
- Product Specification §§21.2 and 22.2 define the conceptual notification
  uniqueness boundary and Tenant subscription-state behavior. Sections 40.6,
  41, and 42 preserve the no-authorization statement, OD-08/OD-10, and FG-11.
  GSC-7, GSC-9, GSC-10, and GSC-13 continue to apply.
- The controlled refreeze keeps OD-08 open and blocks background job/outbox
  execution pending the transition matrix, authority/revocation race, retry,
  and outbox decisions.
- Blueprint §§10–13 and 22–24 require post-commit side effects, explicit
  Tenant context, current-state and authority revalidation for future jobs,
  separately registered future Tenant surfaces, and their own release evidence.
- ADR 0004 §M, A2, and A4 require Tenant context, Tenant-local ownership,
  registry coverage, and negative isolation evidence. Notification identifiers
  remain future-required; A4 prescribes no concrete format. A2 classifies
  notifications as `NOT_IMPLEMENTED` / `FUTURE_OBLIGATION`.
- FG-05 §§7–15 and CH-EVT-003 preserve Event/RSVP notification dependencies,
  current RSVP audience semantics, preference behavior, and post-commit
  delivery failure behavior. FG-05 does not implement notifications.
- The shared PMAFB governs the privileged source mutation and its audit. A
  later notification operation does not inherit the actor's authority from
  that earlier mutation.
- OD-12 and the A10 XP evidence govern XP separately. They do not close the
  notification dependency or OD-08.

At the inspected baseline, the Tenant Surface Registry declares `notification`
as a governed category and future category, but has no implemented notification
surface or approved global notification exception. A2 likewise records the
category as unimplemented. The Event cancellation repository writes the
cancelled Event and lifecycle history; the RSVP repository writes the current
RSVP and, on first eligible participation, its XP fact in the RSVP transaction.
The inspected runtime source contains no notification creation, delivery,
preference, or outbox implementation. These existing Event/RSVP/XP facts are
source evidence only; this gate adds no side effect to them.

## 3. IMPLEMENTABLE NOW — settled contract for a later checkpoint

The following behavior is complete enough to specify from current authority.
A later implementation checkpoint may carry it forward as written, subject to
its own authorization and all applicable blockers in §5.

### 3.1 Tenant and identity boundary

- Product notifications, preferences, grouping, reads, and delivery decisions
  are Tenant-local. A person with Memberships in multiple Tenants has separate
  streams; the streams are never merged.
- The conceptual behavioral owner is the Tenant Membership. Do not key
  behavioral notification records by `identitySubjectId`, Global User ID, or a
  global account/contact identifier. Account-level security communication
  remains neutral about Tenant Memberships and activity.
- Every Tenant-owned creation, preference lookup, read, delivery, and audit
  operation must carry explicit Tenant context and fail closed when that
  context is absent or mismatched.
- Notification eligibility is evaluated against current server-owned facts at
  send time, including applicable Membership attributes, source visibility and
  audience, and Tenant subscription state. A stored or queued recipient is
  not enduring authorization.

### 3.2 CH-NTF-001 — centre contract

The Pilot centre has unread state and a deep link to its source that survives an
intervening login. Opening a notification marks it read; the Member can mark
all read. If a source was unpublished or deleted, resolve the link to a
controlled “no longer available” state. The centre is reached from an icon and
is not a primary navigation destination. Multiple Memberships remain grouped
by Tenant.

### 3.3 CH-NTF-002 — complete Pilot category matrix

This is the complete Pilot category set. No category is added by inference from
a source action or by an implementation convenience.

| Pilot type | Default | Channel | Member can disable |
| --- | --- | --- | --- |
| Priority Notice | On | In-app and email | In-app: no; email: yes |
| Publication targeted to me | On | In-app | Yes |
| Poll opened for me | On | In-app | Yes |
| Poll closing in 24 hours, not yet participated | On | In-app | Yes |
| Event I RSVP'd to — reminder or change | On | In-app | Yes |
| Event I RSVP'd to — cancellation | On | In-app and email | No |
| Saved opportunity deadline (7 days and 24 hours) | On | In-app; email at 24 hours | Yes |
| Result or fixture for a followed team | On | In-app | Yes |
| My Voice issue status change | On | In-app and email | Yes |
| Daily Quiz available | Off | In-app | Yes |
| Streak at risk | Off | In-app | Yes |
| Verification outcome | On | In-app and an available verified security-capable channel | No |
| Account security event | On | An available verified security-capable channel | No |
| Sponsored | Never sent | None | Not applicable |

Preferences are per type and channel except for the non-disableable set. Each
non-critical email category must provide one-click unsubscribe, while required
critical notices remain enabled. Pilot uses in-app first and essential email
only; web push is excluded. Product notifications are not bulk SMS. Phone is
limited to the low-volume transactional security/verification cases stated in
Product Specification §11.4, when in-app delivery is insufficient. This
category matrix does not select a mail or SMS provider or resolve the separate
contact-channel ownership boundary.

### 3.4 CH-NTF-004 — integrity contract

- The conceptual at-most-once identity is per `(Membership, source item, event
type)`, consistent with Product Specification §21.2's `(membership, source,
type)` definition. This is a behavior contract, not a physical key or schema.
- An edited item does not automatically cause re-notification. The Publisher
  explicitly chooses re-notification, and it is rate-limited to once per item.
  Do not expand this into a general send-again capability.
- Targeted-item eligibility is checked at send time against current Membership
  attributes, visibility, audience, and Tenant subscription state.
- No notification is dispatched for a suspended or archived Tenant. The
  Product subscription matrix says notifications are sent in `pilot`, `active`,
  and `grace` states and not sent in `suspended` or `archived` states.
- Delivery failure cannot roll back a successfully committed publication,
  Poll transition, Event update, Voice status update, or XP award. Delivery must
  ultimately be retryable and duplicate-safe, but the execution authority and
  durable retry mechanism are not selected here; see §5 and OD-08.

### 3.5 Existing source semantics carried forward

The source action remains authoritative for its own state. Notification
creation or delivery must not be simulated by an audit insert, must not be
required to repair a failed source transaction, and must not become an
attendee directory. For Events, current RSVP and Event lifecycle rules remain
owned by FG-05 and CH-EVT-003. For XP, the RSVP award remains the separate
Membership-local ledger fact and is not a new CH-NTF category.

## 4. Future architecture constraints (no mechanism selected)

A later architecture and implementation checkpoint must satisfy these
invariants while making no assumption that this gate selected a physical
mechanism:

1. A notification is a separately governed Tenant surface. Add narrow A2
   registry entries for each implemented model, repository, service, route,
   and job as applicable. Include A2 Tenant-negative probes before production
   exposure. A category name in the registry is not registration of an
   implementation.
2. Use an approved Tenant-local identifier anchored to the Membership and
   source. A4 leaves notification identifier formats open. Do not add a Global
   User behavioral join, cross-Tenant recipient grouping, recipient directory,
   or contact-channel copy to a product notification record.
3. Preserve GSC-9 minimization. Store or emit only the fields needed for the
   approved notification, preference, source reference, and delivery behavior;
   do not copy secrets, verification evidence, contact details, or unrelated
   RSVP identities into payloads, logs, generic audit events, or analytics.
4. Keep business-state commit and external delivery separate as GSC-10
   requires. A post-commit delivery failure leaves the committed source state
   intact. The approved design must also prove durable, observable retry and
   duplicate safety before claiming CH-NTF completion.
5. Revalidate current Tenant, Membership, resource, visibility, audience,
   subscription, and applicable preference facts at the governed decision
   point. A notification intent, prior authorization, or stale cached result
   cannot grant authority or bypass current state.
6. Apply the existing shared PMAFB to an in-scope privileged source mutation.
   Do not invoke it as a substitute for a notification delivery contract. A
   background SYSTEM action cannot borrow a human's prior PMAFB result.
7. Keep the channel boundary in §3.3. No web push, sponsored notification,
   bulk product SMS, or unselected provider is introduced by architecture.

This gate does not choose inline callbacks, queues, outboxes, delivery tables,
workers, schedulers, provider APIs, retry limits, or error states. It makes no
claim that a non-durable direct send would meet GSC-10 or FG-05.

## 5. BLOCKED / REQUIRES PRODUCT OWNER DECISION OR OPEN GATE

| Boundary | Current status | Required closure / consequence |
| --- | --- | --- |
| Any notification runtime or schema | **NOT AUTHORIZED BY THIS WORK ITEM**; frozen Product Specification §40.6 says it does not authorize Notifications, and FG-11 requires a separate checkpoint before infrastructure. | A separately authorized exact-scope runtime checkpoint, A2/A4 evidence, security/architecture review, and the runtime-specific release proof. This gate itself grants no code permission. |
| SYSTEM/background dispatch, queued intent, outbox, workers, scheduler, retries, and retry authority | **OD-08 OPEN**; blocked before background job/outbox execution. | Product Owner, architecture, security, and operations must approve the transition and authority matrix, current-state/revocation race behavior, queued-intent semantics, retry behavior, and outbox behavior, with concurrency and revocation evidence. Do not implement these paths before closure. |
| Non-critical in-app daily volume cap | **OPEN / HUMAN_REQUIRED.** CH-NTF-003 supplies only “a configured number”; no numeric cap is approved. | Product Owner decision and review. Do not use a prototype, historical recommendation, temporary default, or inferred value. |
| In-app excess collapse and digest composition | **OPEN where a concrete threshold, grouping, or delivery schedule is needed.** The requirement says excess collapses into one digest entry but selects no digest timing or complete grouping rule. | Product Owner definition before implementing the unresolved behavior. Do not combine unrelated categories or Memberships by inference. |
| Email digest time; event reminder lead time; streak-at-risk delivery time | **OPEN / HUMAN_REQUIRED** except for the specific 24-hour Poll reminder and Opportunity 7-day/24-hour deadline points already stated in Product. The Event story requires a reminder but does not choose its lead time; digest timing is explicitly deferrable in Product Specification §33. | Product Owner must supply any missing timing values. Scheduling those events also remains blocked by OD-08. Do not infer times from the device clock or add a default. |
| Quiet-hours interval and exception classification | **OPEN / HUMAN_REQUIRED.** CH-NTF-003 requires configured night-time hours in the Tenant timezone, except critical notices, but gives no start/end values and does not fully map its “critical” exception to the category matrix. | Product Owner decision on values and exact exception scope. Tenant IANA timezone is the authority once a rule exists; it does not supply missing hour values. No email may be scheduled using an invented interval. |
| Email digest frequency | At most one digest per day plus critical items is fixed; exact send time and digest composition remain open as above. | Preserve the daily maximum; do not interpret it as permission to schedule a digest before OD-08 closure. |
| Priority Notice numeric creation cap | **OD-10 OPEN.** Priority Notices bypass the CH-NTF-003 delivery-volume cap, and Product says CH-PUB-006 rate-limits their creation, but no numeric cap is approved. | Product Owner, security, and operations decision. Do not invent or copy a historical cap. Delivery-volume bypass does not close OD-10. |
| Notification retention duration | Product Specification §27.7 says “a few months” but selects no exact interval or expiry behavior. | Product/privacy decision and data-rights mapping before a retention duration or cleanup job is implemented. Data export/deletion obligations remain in the frozen Product Spec. |
| Identifier format and notification/contact data ownership | A4 marks notification identifiers `FUTURE_REQUIRED` and prescribes no format; OD-03 leaves verified contact-channel provenance open. | A4/Tenant-surface review for identifiers and Product Owner/identity/privacy/security decision for contact ownership. Account security communication must remain Tenant-neutral. |
| Notification generation for Polls | CH-NTF-002 defines Poll categories, but A1/OD-11 still blocks Poll persistence and implementation. | Do not implement a Poll notification producer or use notification state to bypass A1. Revisit only after the Poll gate permits the source behavior. |
| Event-change re-notification trigger | CH-NTF-004 prohibits automatic re-notification on every item edit and requires explicit Publisher choice; FG-05/CH-EVT-003 require preference-aware relevant Event-change notices. | Preserve both requirements. The later checkpoint must specify which governed Event changes offer the explicit choice and how the required relevant notices are produced. Escalate any irreconcilable case to the Product Owner; do not silently weaken either criterion. |

No row above changes an open decision or grants temporary implementation
permission. In particular, do not infer a numeric CH-NTF-003 default from OD-12's
XP values, OD-10, prior prototypes, a tenant's device settings, or operational
convenience.

## 6. Event cancellation and RSVP dependency contract

The following semantics are carried forward without adding a delivery path:

- A current `going` or `interested` RSVP is in the mandatory cancellation
  audience. Cancellation notices are non-disableable and use the CH-NTF-002
  in-app and email channels. A `withdrawn` RSVP is not in that audience.
- Cancellation and RSVP serialize through the authoritative Event row. The
  future audience decision must reflect the governed current RSVP state at the
  cancellation transition; if cancellation commits first, the later RSVP fails
  with the existing `INVALID_STATE` family and creates no notification side
  effect. If RSVP commits first, cancellation observes the committed current
  state. Do not reveal the audience as an attendee list or expose another
  Member's RSVP identity in reads.
- The one RSVP Event reminder and relevant Event-change notices remain
  preference-aware. Preserve the current Event-change/re-notification boundary
  in §5; a generic edit does not automatically fan out a notice.
- Notification delivery occurs after the source business state commits. A
  failed cancellation, Event-change, reminder, or other delivery must not
  undo Event or RSVP state. No notification is enqueued or sent by the current
  Event cancellation or RSVP code.
- CH-EVT-003 remains dependent on the separately gated CH-NTF behavior;
  CH-EVT-004 cancellation-notification dependency remains separately open.
  XP's atomic RSVP ledger fact and its current approved numeric contract do
  not satisfy or replace either notification dependency.

## 7. Future runtime checkpoint exit criteria

A later runtime proposal must name its exact bounded stories and paths and must
not infer authorization from this document. Before it claims implementation
readiness, it must:

1. retain this frozen category matrix, centre behavior, Tenant-local grouping,
   current-state eligibility, preference, idempotency, and post-commit
   semantics;
2. close every applicable Product decision in §5 or explicitly exclude the
   blocked behavior without making a false CH-NTF/CH-EVT completion claim;
3. close OD-08 before any background job, queued intent, outbox execution,
   scheduled reminder/digest, SYSTEM transition, or retry worker is built;
4. update the Tenant Surface Registry and A4 identifier evidence only under
   the separately authorized runtime scope, with cross-Tenant negative probes
   for every exposed surface;
5. define privacy minimization, security-channel ownership, data retention,
   export/deletion handling, and observable delivery failure/retry behavior;
6. prove category defaults/preferences, current audience and visibility,
   subscription suspension, idempotent generation/delivery, duplicate races,
   source failure atomicity, cancellation-vs-RSVP ordering, and post-commit
   delivery failure behavior using the applicable GSC-13 and real PostgreSQL
   evidence; and
7. obtain exact-SHA CI and independent security/architecture review before
   making any completion or deployment claim.

## 8. Disposition

**CH-NTF-001..004 semantics are carried forward as above. OD-08 remains OPEN.
CH-NTF-003 numeric volume-cap and quiet-hours defaults remain OPEN / HUMAN_REQUIRED.
The Event/RSVP notification dependencies remain gated. This checkpoint is
DOCUMENTATION ONLY and authorizes NO notification runtime implementation.**

## 9. Review evidence snapshot

This evidence snapshot records the exact repository state inspected before
this snapshot correction. The complete cumulative comparison is from the
work-item scope baseline to the verified input SHA, not from an inferred or
partial working-tree diff.

- Verified input SHA: `814f0e7efde04db1295641f48c9e7dded1b8c655`
- Scope baseline SHA: `505389930237b02da6de87a9843afccff5d8473f`
- Cumulative diff: **1 file changed, 300 insertions(+), 0 deletions(-)**
- Changed path and status: **A** `docs/governance/ch-ntf-notification-delivery-gate.md`
- Worktree at the verified input SHA before this correction: **clean**
- Runtime, schema, migration, test, worker, scheduler, transport, and deployment
  paths in the cumulative diff: **none**

The snapshot is reproducible with:

```text
git diff --stat 505389930237b02da6de87a9843afccff5d8473f..814f0e7efde04db1295641f48c9e7dded1b8c655
git diff --name-status 505389930237b02da6de87a9843afccff5d8473f..814f0e7efde04db1295641f48c9e7dded1b8c655
```
