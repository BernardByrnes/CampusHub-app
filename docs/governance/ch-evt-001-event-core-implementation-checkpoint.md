# CH-EVT-001 Event Core Implementation Checkpoint

Status: **CH-EVT-001 EVENT CORE — IMPLEMENTATION PROPOSED / SENIOR REVIEW REQUIRED**

This is an implementation-shaped governance checkpoint for the first Event
runtime slice. It is not a Product Specification rewrite, a new architecture
decision, or runtime authorization by itself. No Event runtime code, schema,
migration, test fixture, UI, deployment, or environment change is created by
this checkpoint. Runtime implementation may begin only after this exact
checkpoint is independently reviewed and a bounded implementation work
contract is issued.

## 1. Governing authority and base

The later implementation is subordinate to, and must be read with, these
authorities in this order where applicable:

1. `CampusHub_Product_Specification_v1.3_FROZEN.md`;
2. `CampusHub_Implementation_Blueprint_v1.3_FROZEN.md`;
3. `docs/governance/campushub-v1.3-controlled-refreeze.md`;
4. `docs/governance/fg05-events-lifecycle-gate.md`;
5. `docs/governance/privileged-mutation-authority-invalidation.md`.

This checkpoint is based exactly on:

`5a0606eb8f3efda02c0e7cb7aebd355ae4500f74`

That SHA contains the Product Owner-authorized and independently reviewed
FG-05 Events lifecycle gate. It does not supersede any frozen document, close
an unrelated Product decision, or authorize CH-EVT-002, CH-EVT-003, or
CH-EVT-004.

## 2. Purpose and bounded vertical slice

The purpose of CH-EVT-001 is to define the smallest secure, Tenant-owned Event
vertical slice that a later implementation may build. The proposed slice is
limited to:

- Event persistence, domain validation, and bounded projections;
- draft creation;
- persisted draft editing;
- the single `draft` to `published` transition;
- expected-version concurrency;
- the existing canonical visibility contract;
- the existing canonical audience dimensions and provenance rules;
- same-Tenant Campus ownership;
- the Product-defined `event.manage` capability;
- the approved Privileged Mutation Authority Finalization Boundary (PMAFB);
- minimized A6 audit for the three operations in this slice;
- published Event read and list services;
- derived `past` projection;
- bounded Home/upcoming and Discover Event exposure;
- the required additive migration, Tenant-surface registry, A2/A4, and real
  PostgreSQL evidence.

The implementation must not absorb the Organiser, RSVP, postponement,
cancellation, notification, XP, or other future Event checkpoints. A runtime
agent must stop and report if satisfying an acceptance criterion requires a
new Product decision not supplied by the authorities above.

## 3. Explicit scope exclusions

CH-EVT-001 must not implement or authorize:

- CH-EVT-002 Organiser entity or attribution implementation;
- CH-EVT-003 RSVP, XP awards, reminders, or RSVP notifications;
- CH-EVT-004 postponement, cancellation, schedule history, or cancellation
  notifications;
- a free-text organiser substitute, account-holding Club, organiser login, or
  organiser-specific publishing authority;
- media upload, arbitrary remote image URLs, transformation, deletion, or a
  fake image identifier;
- notification, outbox, delivery, retry, worker, scheduler, or background
  archive behavior;
- `past` or `archived` as a persisted lifecycle value;
- Auth, OD-03, identity/session production, or a client identity workaround;
- Sports, Fixtures, Results, Follow, standings, Opportunities, Polls, Voice,
  ticketing, check-in, attendee lists, maps, geolocation, or XP runtime;
- a new recommendation engine, frontend/admin redesign, deployment, or
  production database/configuration change.

## 4. Proposed Event persistence contract

The later implementation must add only the currently authorized Event Core
facts. The conceptual Event resource is Tenant-owned and must include:

- `id`;
- explicit `tenantId`;
- positive `version`, starting at `1`;
- non-empty `title`;
- non-empty `description`;
- free-text `venue`;
- authoritative `startsAt`;
- optional `endsAt`;
- one same-Tenant `campusId`;
- the established canonical visibility values:
  `PUBLIC`, `MEMBERS`, and `VERIFIED_MEMBERS`;
- canonical audience mode and criteria using the existing CampusHub targeting
  dimensions and provenance rules;
- `rsvpEnabled` as a persisted Event fact, without implementing RSVP;
- persisted lifecycle;
- created and updated timestamps;
- actor attribution only where it is already supported safely by the approved
  A6 and PMAFB architecture.

The persisted lifecycle vocabulary may contain only the durable values already
approved for FG-05:

`draft | published | postponed | cancelled`

CH-EVT-001 authorizes runtime transition behavior only for:

`draft -> published`

`postponed` and `cancelled` may be present as approved future durable values if
the actual schema mechanism requires them to avoid an unnecessary second enum
migration, but this checkpoint authorizes no transition into or out of either
state. `past` and `archived` must not be persisted.

The implementation must use same-Tenant relational protection, not application
checks alone. A same-Tenant Event/Campus relationship must be enforced through
the actual PostgreSQL/Drizzle pattern used by the repository, including the
Tenant component in composite identity where required. Audience criteria and
every persisted target must receive the same treatment. Event lookup and
mutation must never be possible by Event ID without explicit Tenant context.

The exact table/constraint names belong in the later implementation migration
plan. They must not be invented in a way that conflicts with the existing
Publication, Sports, or audit schema.

## 5. Domain and persistence invariants

The domain and database boundary must fail closed for at least these facts:

- `title` is non-empty after trimming;
- `description` is non-empty after trimming;
- `venue` is non-empty after trimming;
- `version >= 1`;
- `endsAt > startsAt` whenever `endsAt` is present;
- Event and Campus belong to the same explicit Tenant;
- Event audience criteria and every referenced target belong to the same
  explicit Tenant;
- `draft -> published` is the only runtime lifecycle transition introduced by
  this slice;
- a draft is never returned by a student-facing read;
- a stale expected version is not a no-op and cannot be silently overwritten;
- a true no-op changes no persisted state, version, or success audit;
- time-based `past` is a read projection, not a lifecycle write.

The implementation must preserve safe existing outcome families. It must not
invent a new public error family merely to implement Event Core. Wrong-Tenant
access is not-found-equivalent and must not disclose a title, count, audience,
Campus, lifecycle, or existence fact.

## 6. Visibility and audience contract

Visibility and audience remain separate concerns. The implementation must reuse
the established canonical resource visibility contract and must not introduce
an Event-specific enum with different meanings.

Audience persistence/evaluation must:

- preserve the canonical CampusHub targeting dimensions and provenance rules;
- follow the structural same-Tenant patterns established by Publication
  audience persistence;
- avoid refactoring Publication behavior solely to make Event code look
  generic;
- reuse a shared primitive only when its semantics are already identical;
- otherwise use a bounded Event representation that does not change
  Publication semantics.

Every published Event read must enforce, in server-side application/repository
composition:

1. explicit Tenant context;
2. Event resolution inside that Tenant;
3. lifecycle/readability;
4. canonical visibility;
5. applicable audience and exposure policy;
6. derived-past treatment; and
7. a bounded read projection rather than a raw database row.

A published `PUBLIC` Event may be available through the already approved
Tenant-bound unauthenticated public read path. The implementation must not
fabricate a Membership for a public visitor. `MEMBERS`,
`VERIFIED_MEMBERS`, Membership-dependent audience decisions, management, and
all mutations require the existing trusted authenticated context seam.

No query parameter, arbitrary header, cookie, local-storage value, or test
identity may become production authority.

## 7. `event.manage` capability boundary

The implementation may add the Product-defined `event.manage` capability only
through the existing canonical capability vocabulary and persisted grant
mechanism. It must not create a parallel Event capability registry or a
role-name shortcut.

`event.manage` authorizes Event management only in the applicable Tenant and
module scope. It does not grant:

- Organiser authority;
- RSVP authority;
- notification or XP authority;
- Sports permissions; or
- Publication permissions.

Every persisted Event create, edit, and publish mutation requires a fresh
`event.manage` decision at the approved authority boundary. A true no-op is
not a persisted mutation, does not increment version, and does not write a
success mutation audit. A stale write is not a no-op.

## 8. Mandatory PMAFB integration

Event privileged mutations must use the approved shared Privileged Mutation
Authority Finalization Boundary (PMAFB) in
`docs/governance/privileged-mutation-authority-invalidation.md`. The
implementation must not recreate an Event-local authority algorithm and must
not claim that the current Publication authorization executor is sufficient
merely because it uses one transaction.

The implementation checkpoint must identify the smallest reusable server
primitive needed to apply the approved cross-cutting contract to Event create,
edit, and publish. It must demonstrate that the primitive is semantically
compatible with PMAFB and preserve the following requirements:

- one PostgreSQL transaction for authority, business mutation, and required
  audit append;
- Tenant authority row locking and re-read;
- Membership/principal locking and re-read where applicable;
- current Guild Term locking and re-read;
- applicable RoleGrant rows locked in deterministic order;
- assurance/MFA authoritative facts where applicable;
- module-state participation when a persisted module authority row exists;
- consumer and invalidation lock modes that actually conflict;
- fresh PostgreSQL database time from `clock_timestamp()` or an approved
  equivalent;
- strict expiry: `database_time >= expiry` fails closed;
- authority locks retained through mutation and audit commit;
- Event resource lock after authority locks for an existing Event mutation;
- expected-version and lifecycle revalidation after resource locking;
- authority and database-time revalidation after any blocking resource wait;
- PMAFB immediately before the guarded business mutation;
- no transaction-start `now()` as final expiry authority;
- no cached `authorized = true`;
- no stale RequestContext as a write permit; and
- no bare `SERIALIZABLE` claim as authority correctness.

Create has no Event row to lock before insert, but all applicable authority
locks, re-reads, PMAFB finalization, and audit atomicity still apply before the
insert. Edit and publish must acquire authority locks before the Event row
lock, then revalidate the Event facts after waiting.

## 9. Mutation contracts

### 9.1 Create draft

Create requires:

- explicit Tenant;
- valid current `event.manage`;
- approved PMAFB;
- same-Tenant Campus;
- valid canonical audience criteria; and
- valid Event Core fields.

Successful creation creates exactly one draft with `version = 1` and appends
one minimized `event.created` audit event in the same Product transaction.
There is no Event resource lock before insertion, but authority locks and all
applicable revalidation remain mandatory.

### 9.2 Edit draft

Edit requires:

- explicit Tenant;
- Event resolution inside that Tenant;
- lifecycle `draft`;
- expected version;
- current `event.manage`;
- PMAFB; and
- Event resource lock after authority locks.

A successful material edit updates only allowed Event Core fields, increments
version exactly once, and appends one minimized `event.changed` event. A true
no-op does none of those things. A stale expected version returns the
established `VERSION_CONFLICT` family, performs no mutation, and writes no
success audit.

### 9.3 Publish

Publish requires:

- explicit Tenant;
- lifecycle `draft`;
- a complete valid Event;
- same-Tenant Campus;
- valid visibility and audience;
- expected version;
- current `event.manage`;
- PMAFB; and
- Event resource lock after authority locks.

Successful publish performs exactly one `draft -> published` transition,
increments version exactly once, appends one minimized `event.published`
event, and makes the Event eligible for authorized read/Home/Discover
selection.

A concurrent or stale loser returns the established `VERSION_CONFLICT` or
canonical invalid-state result based on authoritative current state. It must
not lose an update, publish twice, or report a success audit after a failed
mutation.

## 10. A6 contract for this slice

The implementation may propose only these closed Event audit contracts:

- `event.created`;
- `event.changed`; and
- `event.published`.

It must not add `event.postponed`, `event.cancelled`, or `event.archived` until
their separately authorized implementation checkpoint.

Audit facts must be minimized to facts such as:

- Event reference;
- Tenant reference;
- actor Membership/reference where applicable;
- resulting version;
- resulting lifecycle;
- reason/category only when required by the Product operation; and
- authoritative timestamp.

Generic audit payloads must not contain title, body, description, venue,
audience member lists, contact details, image bytes, or raw request bodies.
Business state and the required success audit append must be atomic. An audit
failure rolls back the business mutation. A denied, stale, invalid, or true
no-op path must not append a false success event.

## 11. Read model, derived past, Home, and Discover

The implementation must return bounded Event projections rather than exposing
database rows.

Required read behavior:

- drafts never appear on student-facing reads;
- published future/current Events may appear when visibility and audience pass;
- an Event is past when authoritative Tenant/server/database time reaches
  `endsAt` when present, otherwise `startsAt`;
- derived-past Events leave Home and active/upcoming surfaces;
- direct/history/archive presentation may represent a past Event according to
  the approved read contract;
- no automatic database write occurs merely because time passes; and
- postponed/cancelled runtime behavior is not introduced by CH-EVT-001.

No new recommendation engine is permitted. The later implementation must use
the deterministic KNOW-first composition style already used by Campus Home.
It may add only the server/application Event read seam needed so that:

- Home can resolve the next eligible upcoming Event for the applicable
  Membership/public context;
- Discover can consume authorized bounded Event collection projections;
- Tenant, visibility, and audience filters are applied before return; and
- derived-past Events are excluded from upcoming surfaces.

Event tables must not be queried directly from UI code. A full visual Event
page or admin UI is not required by this server-core slice unless an existing
automated contract genuinely requires it.

## 12. Migration and recovery contract

The implementation agent must inspect the actual Drizzle/PostgreSQL history
before editing schema or migration files. At this checkpoint the current
history ends at `drizzle/0016_result_revision_guards.sql`; any Event migration
must be the next append-only migration after that head, with its matching
Drizzle snapshot and journal entry. Historical migrations must not be edited.

The later migration plan must identify the exact additive shape for:

- the Tenant-owned Event table;
- any new canonical visibility/lifecycle vocabulary needed by the existing
  schema mechanism;
- Event indexes for Tenant-scoped lookup, lifecycle/time selection, Campus,
  visibility, and bounded upcoming reads;
- same-Tenant Event/Campus foreign keys;
- Event audience criteria persistence and same-Tenant target constraints;
- the `event.manage` capability-vocabulary and persisted-grant impact; and
- A6 references only if the existing generic `audit_events` contract requires
  an additive representation.

The implementation must not create a second audit table or invent a
parallel audit architecture. It must not add destructive migration steps or
rewrite an approved migration. Production migration application is outside
this checkpoint.

Recovery must be documented against the actual PostgreSQL/Drizzle mechanism.
The implementation must not promise a reversible rollback for a PostgreSQL
enum addition unless the real mechanism supports it safely. Where rollback is
unsafe, the plan must prefer a forward repair and explicitly state the
operator/recovery boundary.

## 13. A2, Tenant Surface Registry, and A4 obligations

The implementation must register every new Tenant-scoped Event resource and
operation in the existing Tenant Surface Registry. At minimum it must inspect
and account for:

- Event persistence and repository lookup;
- Event audience criteria and target resolution;
- create, draft-edit, and publish mutation services;
- published Event direct reads and bounded lists;
- Home/upcoming and Discover projections;
- any Event history resource only if discovery proves one is genuinely needed
  by this slice; and
- any cache or index surface introduced by the implementation.

The registry and A2 evidence must prove that Tenant A cannot:

- read Tenant B's Event by ID;
- list Tenant B's Events;
- mutate Tenant B's Event;
- infer Tenant B Event existence or title/count/audience facts;
- attach Tenant B's Campus;
- attach a Tenant B audience target;
- receive Tenant B's Event through Home or Discover; or
- obtain Tenant B's Event through a PUBLIC reader using the wrong Tenant
  context.

A4 must be updated only for actual identifiers introduced by the later
implementation. Event IDs remain Tenant-bound resources and are not a
cross-Tenant lookup authority. No globally reusable behavioral identifier may
be introduced merely to make Event registration convenient.

## 14. Required implementation evidence

The later implementation checkpoint must include the following evidence. A
test that only exercises in-memory objects is insufficient for the PostgreSQL
authority and concurrency obligations.

### 14.1 Domain and unit

- field trimming and validation;
- `endsAt > startsAt`;
- derived-past boundary at the authoritative time;
- permitted and forbidden lifecycle transitions;
- canonical visibility vocabulary;
- canonical audience validation;
- true no-op semantics;
- expected-version semantics; and
- minimized audit payload rules.

### 14.2 Repository and schema

- same-Tenant Campus constraint;
- same-Tenant audience-target constraints;
- Tenant-bound Event lookup;
- exact version increment;
- no cross-Tenant Event aggregate/list leakage;
- schema and migration checks; and
- draft suppression and derived-past selection behavior.

### 14.3 PMAFB and real PostgreSQL authority

Use separate real PostgreSQL connections and deterministic blocking/commit
order evidence. Sleep-only timing is not proof. Evidence must cover the
approved authority matrix applicable to Event Core, including:

- Tenant suspension/inactivation versus Event mutation;
- Membership/principal invalidation versus Event mutation where applicable;
- RoleGrant revoke or scope change versus Event mutation;
- Guild Term closure versus Event mutation;
- authority expiry while blocked on an authority lock;
- authority expiry while blocked on the Event resource lock;
- strict expiry at PMAFB; and
- Event mutation first versus invalidation first ordering.

If module enablement has no independent persisted authority row, the
implementation must document that fact and must not fabricate one solely for a
test. The evidence must prove authority locks are retained through the
business mutation and required audit commit.

### 14.4 Event concurrency

At minimum, real PostgreSQL evidence must cover:

- draft edit versus stale draft edit;
- publish versus publish;
- publish versus stale edit;
- stale expected version;
- audit failure causing full rollback; and
- denied authority leaving Event, version, and audit state unchanged.

### 14.5 Reads

- PUBLIC unauthenticated read only through the approved Tenant-bound public
  path;
- MEMBERS visibility;
- VERIFIED_MEMBERS visibility;
- audience pass and fail;
- wrong-Tenant not-found equivalence;
- drafts suppressed;
- past excluded from Home/upcoming;
- deterministic Home next-upcoming Event; and
- Tenant-safe Discover Event lists.

## 15. Existing patterns to inspect

The implementation agent must inspect, and may reuse only where semantics
remain correct:

- Publication domain/application/repository layering;
- Publication canonical visibility and audience persistence;
- `PostgresAuthorizedPublicationCreateExecutor`;
- `PostgresCapabilityAuthorizer`;
- Sports PostgreSQL authorization and race tests;
- `src/server/repositories/audit-event-repository.ts`;
- `src/server/db/schema/audit.ts`;
- `src/domain/audit/audit-event.ts`;
- `CampusHomeService` and `src/application/content/campus-home.ts`;
- the Tenant Surface Registry;
- A2/A4 tests and identifier inventories; and
- Drizzle schema and migration conventions.

The approved PMAFB contract controls where an existing Publication or Sports
pattern is incomplete. No pattern may be copied merely because it is nearby,
and Publication or Sports runtime behavior must not be refactored as part of
CH-EVT-001.

## 16. External-effect boundary

CH-EVT-001 creates no notification, email, outbox, delivery, retry, worker,
scheduler, background archive, XP award, RSVP, check-in, attendee-directory,
ticketing, or map/geolocation effect. Required Product behavior that depends
on CH-XP-002 or CH-NTF remains explicitly deferred under FG05-OD-03.

## 17. Stop conditions and implementation authorization

The later implementation agent must stop and report rather than guess if it
discovers an unresolved Product decision concerning:

- Organisers;
- media/images;
- RSVP;
- postponement;
- cancellation;
- notifications;
- XP;
- jobs/SYSTEM execution; or
- Auth/identity transport.

This document is the proposed CH-EVT-001 scope only. It does not authorize
runtime implementation until senior review accepts this exact checkpoint and a
separate implementation instruction identifies the exact candidate branch and
SHA. No merge, promotion, deployment, production migration, or environment
change is authorized by this document.

## 18. Validation for this documentation checkpoint

Because this checkpoint creates only one governance document, validation is
limited to:

- governance tests;
- frozen-document integrity;
- `git diff --check`; and
- Gitleaks.

The candidate must prove that only this file changed:

`docs/governance/ch-evt-001-event-core-implementation-checkpoint.md`

It must prove that no runtime code, schema, migration, frozen document,
FG-05 document, or PMAFB contract changed. The later runtime implementation
must not be bundled into this documentation commit.

## 19. Commit and review handoff

The documentation candidate must be committed with exactly:

`docs: define CH-EVT-001 Event Core implementation checkpoint`

and pushed only to:

`codex/ch-evt-001-event-core-gate`

The candidate then requires independent senior review of the exact commit SHA.
If the checkpoint is approved, the next separate instruction may authorize
CH-EVT-001 runtime implementation. This operation stops after the normal push.
