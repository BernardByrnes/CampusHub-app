# CH-EVT-002 — Organiser Attribution Implementation Checkpoint

- Status: **CH-EVT-002 ORGANISER ATTRIBUTION — IMPLEMENTATION PROPOSED / SENIOR REVIEW REQUIRED**
- Checkpoint type: documentation and implementation-boundary proposal only
- Canonical foundation: `codex/8v-b-next-foundation`
- Required base SHA: `2d37ff94b9cadcf41aa803857cde930992288d24`
- Proposed runtime branch: `codex/ch-evt-002-organiser-attribution-gate`
- Proposed implementation migration head: `0017_calm_menace.sql` remains the current head; a future runtime checkpoint would append `0018` only after separate approval

This document defines the smallest safe implementation path for CH-EVT-002. It
does not implement that path. It does not change the Product Specification,
Implementation Blueprint, schema, migrations, runtime code, tests, UI,
capabilities, authentication, media, or deployment.

The promoted CH-EVT-001 Event Core remains valid. This checkpoint supplies the
Organiser-attribution dependency that is missing from the full frozen Event
create/publish story, but it does not relabel Event Core as a complete
CH-EVT-001 implementation.

## 1. Authority and scope

The proposal is read against the following authority, in descending order:

1. `CampusHub_Product_Specification_v1.3_FROZEN.md`;
2. `CampusHub_Implementation_Blueprint_v1.3_FROZEN.md`;
3. `docs/governance/campushub-v1.3-controlled-refreeze.md`;
4. `docs/governance/fg05-events-lifecycle-gate.md`;
5. `docs/governance/privileged-mutation-authority-invalidation.md`;
6. `docs/governance/ch-evt-001-event-core-implementation-checkpoint.md`;
7. the reviewed implementation at foundation SHA
   `2d37ff94b9cadcf41aa803857cde930992288d24`.

This is a proposed implementation contract, not an authorization to begin
runtime work. A later implementation checkpoint must name its exact stories,
acceptance criteria, migration and recovery plan, A2/A4 evidence, A6 facts,
concurrency evidence, and external dependencies before coding begins.

## 2. Product contract carried forward

The frozen CH-EVT-002 contract is narrow:

- An Organiser is a Tenant-scoped attribution label.
- It has a name and an optional logo at the Product level.
- Guild Administrators create and maintain Organisers.
- An Organiser is attribution only.
- It is not an account-holding entity, Global User, Membership, authority
  principal, or independent publishing identity.
- It has no login, credentials, role grants, student participation state,
  owner/member list, Club membership, social profile, or independent Tenant
  context.
- An Event or Publication may name at most one Organiser.
- Organiser identity never becomes authorization. Naming an Organiser does not
  grant an Event or Publication any capability.

This preserves the frozen Product Specification §18.9, the FG-05 Organiser
boundary, and the Event Core exclusions. No new Product decision is made here.

## 3. Clubs are not part of this slice

An Organiser may display a club, office, association, society, or similar name
as attribution. That label does not create a production Club entity.

The following remain explicitly out of scope:

- Club login or account;
- Club administrators or members;
- Club publishing rights;
- student Club membership;
- Club dashboard or hierarchy;
- Club role grants;
- account-holding Clubs before their separately governed Phase 2 trigger.

The implementation must not turn Organiser into a disguised Club-management or
social-organisation subsystem.

## 4. Proposed Organiser domain boundary

Organiser should be Tenant-owned reference and attribution data. The first
runtime slice should use the smallest durable shape:

| Field | Proposed contract |
| --- | --- |
| `id` | Stable UUID, unique within the owning Tenant. |
| `tenantId` | Explicit Tenant owner; never inferred from an Organiser ID alone. |
| `version` | Positive integer, starts at `1`, used for expected-version edits. |
| `name` | Trimmed, non-empty, explicitly bounded text. |
| `createdAt` | Server/database-owned creation time. |
| `updatedAt` | Server/database-owned mutation time. |
| future logo reference | Optional reference to an approved Tenant-owned media asset; not implemented in this slice. |

The eventual persistence shape should include a unique `(tenant_id, id)` key so
same-Tenant composite foreign keys can protect references. Organiser names are
not globally unique and are not cross-Tenant unique; two Organisers in one or
different Tenants may share a display name unless later Product authority says
otherwise.

Organiser must not contain credentials, contact-channel ownership, Membership
identity, Global User identity, Guild Term identity, grants, publishing
capability, student state, member lists, or independent authorization context.

### 4.1 Minimum lifecycle

If the frozen Product authority does not supply a delete/archive lifecycle, the
first implementation should provide only:

- create;
- rename/edit metadata with expected version;
- Tenant-bound read/list/select for attribution.

No hard delete or rich archive transition is authorized by this checkpoint.
The implementation must not silently destroy historical attribution. Delete or
archive semantics remain a separate Product/architecture decision if they are
needed later.

## 5. Approved maintenance capability

The current foundation has `event.manage`, Publication capabilities, and
`sport.manage`, but no Organiser-specific capability. The approved new
capability is:

```text
organiser.manage
module scope: tenant
resource: organiser
```

This is an approved implementation decision, not a capability implementation
in this documentation repair.

Rationale:

- Organiser create/edit is Tenant reference-data administration.
- Event publishers should not automatically gain Organiser-maintenance
  authority.
- Publication publishers should not automatically gain Organiser-maintenance
  authority.
- Selecting an existing Organiser while editing Event content uses the Event's
  existing `event.manage` mutation authority.
- Selecting an existing Organiser while editing a Publication uses the
  Publication's existing mutation authority, subject to the separate
  Publication attribution gate below.
- An Organiser never grants publishing permission.

The capability must be added only through the canonical persisted capability
vocabulary and grant mechanism. It is explicit capability authority only: it
must not be auto-granted, authorized by the string `Guild Administrator`, or
used as a shortcut for unresolved role seeding. Runtime tests may seed explicit
valid `organiser.manage` grants through the existing grant mechanism. Production
provisioning and role-bundle population remain explicit and must not derive
authority from a role name.

## 6. Organiser mutation and PMAFB contract

Organiser create and edit are privileged mutations. A future implementation
must reuse the approved shared Privileged Mutation Authority Finalization
Boundary (PMAFB), represented at this foundation by the reusable
`PostgresPrivilegedMutationAuthority` mechanism used by Event Core. It must not
create an Organiser-local authority algorithm or return a reusable authorization
lease.

### 6.1 Create

The transaction shape is:

```text
explicit Tenant
→ Tenant/Membership/Guild Term/Role Grant authority locks and re-read
→ final authoritative PostgreSQL-time check
→ PMAFB
→ Organiser INSERT with version = 1
→ organiser.created A6 append
→ commit
```

The authority request must be `organiser.manage`, Tenant-scoped, and bound to
the trusted `RequestContext` identity. The insert and audit append use the same
transaction. Audit failure rolls back the Organiser creation.

### 6.2 Edit

The transaction shape is:

```text
authority locks and re-read
→ exact same-Tenant Organiser row lock
→ Tenant and expected-version validation
→ final authority re-read
→ fresh PostgreSQL clock_timestamp()
→ PMAFB
→ guarded expected-version update
→ organiser.changed A6 append
→ commit
```

The lock must be retained through the guarded update, audit append, and commit.
Strict expiry applies: database time at or after grant or Guild Term expiry
fails closed. The application clock, transaction-start `now()`, a stale
RequestContext fact, and a cached `authorized = true` are not write permits.

### 6.3 Outcomes and no-op behavior

- A wrong-Tenant Organiser resolves as not-found-equivalent and must not leak
  existence.
- Missing, malformed, invalid, or stale resources fail closed using the
  existing safe outcome families.
- A true no-op performs no write, does not increment version, and does not
  append a success audit event.
- A denied, invalid, stale, or failed mutation never appends a fabricated
  success audit event.

For an existing Organiser mutation, the future implementation must keep the
same deterministic authority-lock order used by PMAFB and acquire the
Organiser resource lock only after authority locks. It must hold all applicable
locks through the final authority/time check, business mutation, audit, and
commit.

## 7. Event attribution contract

An Event has zero or one optional Organiser. The preferred relational design is
a nullable `organiserId` on `events` with a same-Tenant composite foreign key:

```text
(events.tenant_id, events.organiser_id)
  → (organisers.tenant_id, organisers.id)
```

The implementation must not duplicate the Organiser name into Event as the
primary source of truth and must not replace the relationship with arbitrary
free text. A later historical snapshot would require separate Product and
architecture authority; this checkpoint does not invent one.

### 7.1 Event mutation authority

For the current CH-EVT-001 lifecycle:

- draft creation may select an existing same-Tenant Organiser;
- draft edit may add, change, or remove the Organiser;
- published Event Organiser editing is not silently authorized because Event
  Core permits edits only while `draft`;
- selecting an existing Organiser as part of Event mutation uses `event.manage`;
- creating or editing the Organiser record itself uses `organiser.manage`;
- an Organiser grants no Event publishing authority.

The Event mutation preparation path must preserve the already-approved
CH-EVT-001 Event-first resource order. For an existing Event mutation, the
selected Organiser is another dependent resource acquired after the Event row
and the established Campus/audience preparation, but before the final Event
PMAFB check. The deterministic order is:

```text
Tenant → Membership → Guild Term → Role Grants
→ existing Event row, ordered by Tenant/ID
→ Event version/lifecycle validation
→ existing Event dependent resources in their established order
→ selected same-Tenant Organiser row(s), ordered by ID, if supplied
→ final authority re-read
→ fresh PostgreSQL clock_timestamp()
→ Event PMAFB
→ immediate guarded Event update
→ event.changed audit
→ commit
```

For Event create there is no Event row to lock. Create uses the existing
Campus/audience preparation order first, then locks and validates the selected
same-Tenant Organiser when supplied, followed by final authority/time checks,
PMAFB, the Event insert, `event.created` audit, and commit:

```text
authority locks
→ existing create resource preparation in its established order
→ selected same-Tenant Organiser lock/validation, if supplied
→ final authority re-read
→ fresh PostgreSQL clock_timestamp()
→ PMAFB
→ Event insert
→ event.created audit
→ commit
```

Removing attribution requires no Organiser row lock because no Organiser is
selected, but Event expected-version and lifecycle rules remain mandatory. Any
selected Organiser must exist, belong to the explicit Tenant, and remain valid
through the same transaction.

### 7.2 Student/read projection

Student and other authorized read projections may expose only the attribution
facts needed to answer “Who is running this?”:

- Organiser ID when required internally by the projection;
- Organiser display name;
- an approved logo projection only after the media dependency is closed.

They must not expose actor IDs, Membership IDs, role grants, audit facts,
administrative metadata, or internal authorization state. Wrong-Tenant
Organiser references, selector results, and joins fail closed without revealing
existence.

## 8. Publication attribution is separately dependency-gated

The frozen Product Specification requires that an Event or Publication may name
one Organiser. This checkpoint does not ignore that requirement, but it also
does not silently broaden into a Publication authorization refactor.

The current foundation's Publication create, draft-edit, and publish executors
call the existing `PostgresCapabilityAuthorizer` directly. They predate the
shared `PostgresPrivilegedMutationAuthority` PMAFB used by Event Core and do
not yet provide the Event Core PMAFB integration contract required for a new
Organiser resource lock before finalization.

Therefore the classification is:

```text
B — Publication attribution is dependency-gated behind a separately reviewed,
bounded Publication privileged-mutation/PMAFB integration checkpoint.
```

No Publication runtime, schema, migration, audit, or authorization change is
authorized here. That later checkpoint must establish the same-Tenant
Organiser relation, resource-lock order, current Publication mutation
authority, A6 behavior, and PostgreSQL evidence before Publication attribution
is claimed complete.

Existing `authorOfficeLabel` remains a distinct Publication field. It is an
author-provided attribution label with its existing semantics; it is not
silently replaced by Organiser and does not become an Organiser foreign key.
The later Publication decision must explicitly decide how, if at all, both
fields can coexist in a truthful read projection.

## 9. Logo and media dependency

The Product-level optional logo remains media-gated. No approved reusable
general media persistence/upload contract exists at this foundation SHA, so
this checkpoint does not authorize:

- raw remote logo URLs;
- arbitrary filesystem paths;
- fake Media IDs;
- base64 image storage in Organiser rows;
- an Organiser-only upload subsystem;
- image transformation, deletion, redaction, or cache invalidation behavior.

The eventual relationship may be an optional reference to an approved
Tenant-owned media asset governed by the reviewed media pipeline. The first
runtime Organiser Core slice may therefore support name and attribution only.

```text
FULL CH-EVT-002 COMPLETION NOT CLAIMED — OPTIONAL LOGO REMAINS MEDIA-GATED
```

## 10. A6 audit recommendation

The smallest closed Organiser audit vocabulary is:

| Event type | Resource type | Meaning |
| --- | --- | --- |
| `organiser.created` | `organiser` | A new Organiser committed. |
| `organiser.changed` | `organiser` | A material Organiser metadata change committed. |

Audit facts should remain minimized and structural, for example `action` and
committed `version`. They should not contain Organiser names, logos, actor
secrets, Membership identifiers, or copied content unless an existing audit
authority later requires a specific fact.

Each Organiser mutation and its audit append must commit atomically. An audit
append failure rolls back the mutation. Denied, stale, invalid, and true no-op
operations do not receive fabricated success events.

An Event attribution change should use the existing minimized `event.changed`
contract when the Event mutation is material; it should not create a duplicate
Organiser audit chain or store Organiser content in Event facts. If a future
review determines that the relation change needs a distinct structural fact,
that must be a narrow A6 decision rather than an implementation-side shortcut.

## 11. Persistence and migration discipline

A future runtime checkpoint should add one append-only migration after the
current `0017_calm_menace.sql` head. That migration would be the place for the
Organiser table and the Event same-Tenant relation, subject to the approved
implementation design and recovery plan.

This documentation checkpoint creates **no `0018` migration**, does not modify
any historical migration, and does not apply a migration to any database.

The future schema must include, at minimum:

- explicit Tenant ownership;
- unique `(tenant_id, id)` Organiser identity;
- positive version check;
- non-empty bounded name check;
- same-Tenant foreign-key protection for every Event/Publication reference;
- restrictive deletion behavior that does not silently destroy historical
  attribution, subject to separately approved lifecycle semantics.

Organiser names must not be globally unique or cross-Tenant unique.

## 12. Tenant Surface Registry, A2, and A4 obligations

A runtime Organiser checkpoint must register and test each new surface narrowly:

- Organiser persistence and migration;
- Organiser create and edit mutations;
- Organiser direct/read/list/select paths;
- Event-to-Organiser relation;
- student Event attribution projection;
- the future Publication-to-Organiser relation when that dependency is closed.

Required negative evidence includes:

- Tenant A cannot read Tenant B's Organiser;
- Tenant A cannot mutate Tenant B's Organiser;
- Tenant A cannot infer Tenant B Organiser existence by ID;
- Tenant A Event cannot attach Tenant B Organiser;
- a wrong-Tenant selector/list cannot expose labels;
- a PUBLIC Event read cannot cross Tenant boundaries through an Organiser join;
- an Event or Publication lookup cannot use an Organiser ID without the
  explicit Tenant predicate.

The registry must not use a directory-wide exemption or treat an Organiser as
an authority principal. A2 must cover operation identity and fail-closed
discovery for the new mutation/read surfaces; A4 must cover explicit Tenant
ownership, identifier boundaries, and the same-Tenant relation.

## 13. Required real PostgreSQL evidence

A future implementation must use the existing integration harness and
deterministic transaction barriers/locks. Sleep-only race evidence is not
acceptable.

### 13.1 Organiser create/edit

Prove, against real PostgreSQL:

- stale expected-version writer is rejected;
- two concurrent edits have exactly one winner;
- Tenant invalidation ordering is fail-closed;
- Membership invalidation ordering is fail-closed;
- grant revocation ordering is fail-closed;
- Guild Term closure ordering is fail-closed;
- grant expiry and term expiry before PMAFB are rejected;
- audit failure rolls back the Organiser mutation.

### 13.2 Event attachment

Prove:

- same-Tenant Organiser attachment succeeds;
- foreign-Tenant Organiser attachment fails without existence leakage;
- nonexistent Organiser attachment fails closed;
- a concurrent Organiser/resource wait cannot create a post-PMAFB authority
  gap;
- create/edit/remove attribution obeys Event expected-version and lifecycle
  rules;
- a selected Organiser lock is retained through Event mutation, audit, and
  commit.

The evidence must include a deterministic Event-first regression in which an
Event edit obtains the Event row first, validates its version/lifecycle, then
waits on a selected Organiser row held by a second transaction. While the
Organiser wait is active, the first transaction's authority must be expired or
invalidated; after the wait resolves, final authority revalidation must reject
the mutation before PMAFB, leaving the Event, version, and audit unchanged.
The ordinary opposite serialization must also be covered: the Event obtains
and validates its dependent Organiser before final PMAFB and commits safely.
Both orderings require deterministic barriers/lock evidence, never arbitrary
sleep-only proof.

The tests must cover both relevant transaction orderings where a blocking
relationship exists and must report backend/lock evidence rather than relying
on arbitrary delays.

## 14. Recommended first runtime slice

Subject to senior approval, the narrowest useful runtime slice is:

- Tenant-owned Organiser persistence;
- bounded name and version validation;
- `organiser.manage` in Tenant module scope;
- PMAFB-backed create/edit with atomic minimized A6 audit;
- Tenant-bound read/list/select;
- optional zero/one same-Tenant Event attribution;
- Event draft create/edit/read projection integration using `event.manage`;
- same-Tenant relational constraints;
- Tenant Surface Registry, A2, and A4 evidence;
- real PostgreSQL isolation, authority, concurrency, and rollback tests.

The slice must remain partial. It does not authorize Publication attribution
until the separate PMAFB integration gate is approved, and it does not make
the full CH-EVT-002 story complete while logo support remains media-gated.

## 15. Explicit exclusions

This checkpoint does not authorize:

- Organiser login, account, credentials, or independent publishing;
- Club accounts, membership, dashboards, hierarchy, or role grants;
- student-created Organisers;
- RSVP, XP, notifications, outbox, or delivery infrastructure;
- postpone/cancel implementation or schedule-history runtime;
- jobs, schedulers, expiry workers, or SYSTEM authority;
- Auth or OD-03;
- media infrastructure, arbitrary image URLs, or fake assets;
- sponsorship, Sports, Fixtures, Results, standings, Follow, or Team pages;
- a Publication authorization/PMAFB refactor in this checkpoint;
- deployment, production configuration, or production database migration;
- frontend redesign;
- Agent Orchestrator or KlinKlik changes;
- changes to frozen authority documents or existing ADR history.

## 16. Relationship to CH-EVT-001

Promoted CH-EVT-001 Event Core remains valid and remains the current Event
foundation. It intentionally excluded Organiser attribution, as recorded in
its implementation checkpoint.

CH-EVT-002 supplies the Organiser-attribution dependency missing from the full
frozen CH-EVT-001 create/publish Event story. Even after a narrow Organiser
Core implementation is independently approved, full CH-EVT-001 story
completion may remain blocked by the Event image/media dependency and other
separately gated Event stories.

```text
CH-EVT-001 EVENT CORE — PROMOTED
FULL CH-EVT-001 STORY COMPLETION NOT CLAIMED — ORGANISER/MEDIA DEPENDENCIES REMAIN
```

## 17. Senior-review decision register

The following implementation decisions are approved for the future bounded
runtime checkpoint. They do not authorize runtime implementation in this
documentation repair:

| Decision | Approved implementation boundary |
| --- | --- |
| Maintenance capability | `organiser.manage` with module scope `tenant` is approved. |
| Capability authority | It is explicit capability authority only; no automatic role-name authority or implicit grant. |
| Organiser ownership | Organiser is Tenant-owned reference/attribution data. |
| Event relation | Event has zero/one nullable same-Tenant Organiser relation. |
| Event attribution authority | Attaching, changing, or removing attribution during Event draft mutation uses `event.manage`. |
| Organiser metadata authority | Creating/editing Organiser metadata uses `organiser.manage`. |
| Organiser lifecycle | Delete/archive remains deferred; the first runtime slice exposes no application delete/archive operation. |
| Organiser audit | `organiser.created` and `organiser.changed` use minimized structural facts and commit atomically with the mutation. |
| Publication attribution | Publication Organiser attribution remains separately gated behind Publication PMAFB integration. |
| Optional logo | Optional Organiser logo remains media-gated. |
| Runtime-slice status | The first Organiser Core runtime slice remains partial and does not claim full CH-EVT-002 completion. |

Runtime fixtures may seed explicit valid `organiser.manage` grants through the
existing grant mechanism. Production provisioning and role-bundle population
remain explicit and must not derive authority from the string `Guild
Administrator`.

## 18. Validation and non-authorization record

This checkpoint is valid only as a documentation-only candidate. Before
commit, the implementation agent must verify:

- governance/documentation tests pass;
- frozen-document integrity is unchanged;
- `git diff --check` passes;
- Gitleaks reports no finding for the checkpoint range;
- exactly this document is changed;
- no runtime source, schema, migration, test-runtime file, frozen authority,
  configuration, or existing ADR is changed.

No runtime, schema, migration, test, UI, capability, Auth, deployment, or
Product behavior change is claimed by this document.

## 19. Review handoff

The proposed commit should contain only:

```text
docs/governance/ch-evt-002-organiser-attribution-implementation-checkpoint.md
```

Suggested commit message:

```text
docs: define CH-EVT-002 Organiser attribution checkpoint
```

It must be pushed only to:

```text
codex/ch-evt-002-organiser-attribution-gate
```

Do not merge or promote this checkpoint. Do not begin runtime Organiser work
until independent Sol High review and senior verification are complete.

**CH-EVT-002 ORGANISER ATTRIBUTION CHECKPOINT — AWAITING SENIOR REVIEW**
