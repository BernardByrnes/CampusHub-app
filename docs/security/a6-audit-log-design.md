# A6 Audit Log Design

- Status: **PROPOSED — SECURITY ARCHITECTURE DECISION PENDING INDEPENDENT REVIEW**
- Scope: Tenant-owned audit architecture for privileged and security-sensitive operations
- First implementation consumer: `publication.published`

This document materializes the supplied Security Architecture Lead decision for
A6. It is an architecture proposal, not an implementation authorization. It
does not override frozen Product authority, close A6, close A3 globally, or
authorize any production code, migration, schema, UI, merge, or deployment
change. A6 closes only after the independent Sol High reviewer explicitly
accepts the exit criteria in this document.

## 1. Purpose and authority mapping

CampusHub requires a Tenant-owned immutable audit history for privileged and
security-sensitive operations defined by Product authority. A6 establishes the
persistence, integrity, minimization, redaction, and transaction architecture
for that history.

The first authorized implementation consumer is ordinary manual Publication
finalisation, represented by the closed event contract `publication.published`.
A6 is generic infrastructure, but this design does not authorize every future
audited domain. Each future domain must add a separately reviewed closed event
contract.

This design maps to:

- GSC-8 — Audit default;
- GSC-9 — Sensitive payload minimisation;
- TI-11 — audit records remain immutable while public content may change;
- NFR-5 — append-only, tamper-evident Tenant audit;
- CH-GOV-006 — Tenant audit log;
- CH-CNT-001 — audit survives content takedown or redaction;
- CH-PUB-002 and CH-PUB-004 where Publication finalisation or correction
  requires audit;
- the A6 architecture blocker and its exit criteria.

No requirement in this artifact overrides frozen Product authority.

## 2. Tenant boundary

Every Tenant AuditEvent belongs to exactly one Tenant. Every repository
operation involving an AuditEvent requires explicit Tenant ID. Lookup by
AuditEvent ID alone is prohibited, and cross-Tenant reads behave as not found.

When implementation begins, AuditEvent must be registered as a Tenant-scoped
surface under the existing A2 Tenant Surface Registry. A6 authorizes no
cross-Tenant audit query. Platform-wide security logging is a different future
concern and is not implemented through Tenant AuditEvent by assumption.

## 3. Current actor model

For the currently implemented Membership-backed Publication authority path, the
audit actor is the exact Tenant-local Membership. Persist:

`actorMembershipId`

Do not persist `identitySubjectId` inside Tenant audit events. Where an event is
Membership-backed, the actor relationship must be same-Tenant. This prevents
the Tenant audit store from becoming a Global User behavioural history.

Future non-student privileged principals, Platform actors, and SYSTEM actors
remain governed by OD-02, OD-08, and their future authority decisions. A6 does
not invent those actor models; the current schema may therefore be deliberately
narrower and expanded additively after those decisions.

## 4. AuditEvent identity and sequencing

Each AuditEvent has:

- a stable event UUID;
- Tenant ID;
- a Tenant-local monotonically increasing sequence;
- event type;
- actor Membership ID for the currently authorized Membership-backed event
  family;
- resource type;
- resource ID;
- optional resource version where the event concerns versioned state;
- authoritative occurrence timestamp;
- closed validated event facts;
- previous integrity hash;
- current integrity hash;
- integrity key version.

The pair `Tenant ID + sequence` is unique. Sequence begins independently per
Tenant; there is no global behavioural sequence.

## 5. Closed event vocabulary

Application code must expose a closed event union. It must not expose an
unrestricted API such as:

```text
appendAuditEvent(type: string, payload: unknown)
```

The first authorized event contract is `publication.published`. Future event
types require additive, reviewed contracts. A database representation may grow
additively, but application writers must never gain arbitrary audit-payload
authority.

## 6. `publication.published` facts

The `publication.published` AuditEvent records only the minimum facts needed to
establish finalisation:

- Publication ID;
- resulting Publication version;
- transition from `draft` to `published`;
- authoritative occurred/publish timestamp;
- audience mode;
- confirmed scalar audience count;
- publish-time structural audience snapshot.

For targeted audiences, the structural snapshot may contain dimension, target
ID where applicable, target value where applicable, and the publish-time target
label. These values preserve historical targeting attribution when hierarchy
labels later change. For `entire_tenant`, no recipient projection is stored.

## 7. Prohibited audit data and redaction posture

Tenant audit events must not store:

- Publication body;
- Publication title merely for convenience;
- attachment contents or uploaded raw files;
- recipient lists;
- recipient Membership IDs;
- individual recipient identities;
- Global User `identitySubjectId`;
- passwords, session tokens, or MFA secrets;
- contact information;
- raw request objects;
- arbitrary Voice content;
- ballot contents;
- verification evidence documents.

The event stores identifiers, structural facts, categories, reason codes, and
minimum snapshots only.

Audit history survives correction, unpublish, restriction, redaction, and
removal. This is safe because audit payloads do not duplicate raw Publication
content. A later content-removal operation may make the referenced resource
unavailable to ordinary readers while the AuditEvent retains the minimum
historical fact that the privileged action occurred. Audit must not retain
content merely to defeat legitimate redaction.

This design does not implement A7 redaction, cache, or media propagation.

## 8. Append-only contract

AuditEvent supports append. Ordinary application code exposes no update or
delete repository operation. PostgreSQL must additionally reject UPDATE and
DELETE against AuditEvent rows using database-level enforcement; application
discipline alone is insufficient.

Implementation tests must demonstrate direct UPDATE and DELETE rejection. The
design does not claim that a PostgreSQL superuser or physical-storage
administrator is cryptographically incapable of altering bytes. That threat is
addressed by tamper evidence and operational controls rather than a false
absolute-immutability claim.

## 9. Tamper-evidence design

Audit events form an independent ordered integrity chain per Tenant. For event
sequence `N`, `previousHash` is the current integrity hash of sequence `N - 1`.
The first Tenant event uses a documented fixed genesis representation.

`currentHash` is:

```text
HMAC-SHA-256(secret-key-version, canonical-event-representation)
```

The canonical representation includes at minimum:

- Tenant ID;
- sequence;
- event ID;
- event type;
- actor reference;
- resource type;
- resource ID;
- resource version where present;
- occurrence timestamp in one canonical UTC representation;
- canonical closed event facts;
- previous hash;
- key version.

Serialization is deterministic and versioned. Normal JSON object insertion
order is never relied on as the integrity contract.

## 10. Integrity-key boundary

The HMAC secret is not stored in the AuditEvent table, and the real production
secret is not committed to source control. The application receives
signing/verifying key material from an external secret or configuration
boundary. Events record only a non-secret key-version identifier.

Old verification keys must remain available for the retention period of events
signed with them. Tests use explicit synthetic test-only keys.

A6 claims **tamper evidence**, not **tamper impossibility**. If an attacker
simultaneously controls the database, application runtime, and active integrity
secret, they may be capable of constructing a new internally valid chain. That
residual risk is documented honestly.

## 11. Tenant sequence and locking

Tenant-local sequencing must be concurrency-safe. The initial implementation
uses the existing authoritative Tenant row as the serialization root. An
audited mutation participating in the Tenant audit chain acquires the Tenant
lock before determining or appending the next Tenant audit sequence.

The current Publication authority path already uses deterministic ordering:

```text
Tenant
→ Membership
→ Guild Term
→ Role Grant
→ Publication
```

Audit append occurs after the relevant business-resource locks are held and
must not introduce an earlier lock that reverses this order. Future audited
mutation paths joining this chain must preserve compatible deterministic
Tenant-first ordering. A6 must not create an audit-specific locking order
capable of deadlocking existing Tenant mutation paths.

## 12. Publication finalisation atomicity

A successful Publication finalisation and its mandatory `publication.published`
AuditEvent are one durable business transaction:

```text
BEGIN

lock Tenant
lock Membership
lock Guild Term
lock Role Grant
lock Publication

validate Tenant and Membership
validate capability and current Guild Term
validate expected Publication version
validate Publication lifecycle
validate standard-vs-Priority restriction
validate current audience definition and targets
calculate confirmed scalar audience count

establish final authoritative timestamp T

revalidate time-bound authority at T
validate Publication expiry against T

update Publication:
  lifecycle = published
  version = N + 1
  publishAt = T
  updatedAt = T

append publication.published AuditEvent:
  resourceVersion = N + 1
  occurredAt = T

COMMIT
```

There is no successful Publication finalisation without its mandatory audit
event, and no `publication.published` AuditEvent without the corresponding
committed Publication finalisation. If audit signing, sequencing, or insertion
fails after the Publication UPDATE, the transaction aborts and PostgreSQL rolls
back both facts.

## 13. One authoritative timestamp

For Publication finalisation, one server-owned lock-bound timestamp `T` is
authoritative for:

- final Guild Term validity;
- final `publication.publish` grant-expiry validity;
- Publication expiry comparison;
- Publication `publishAt`;
- Publication `updatedAt`;
- AuditEvent `occurredAt`.

No second application-clock read may produce a different timestamp for the same
durable finalisation. The existing `b348f777...` change is consistent with this
direction but is not independently approved as the complete publish feature by
this architecture checkpoint.

## 14. Read contract

Future Tenant audit browsing requires explicit Tenant context, `audit.view` or
another specifically approved capability, bounded pagination, and Tenant
predicates at the repository boundary. A6 does not authorize audit UI or an
audit-view application service now.

The persistence layer may provide narrowly scoped integrity-verification and
test reads necessary to verify the chain. No member-search or cross-Tenant
audit API is authorized.

## 15. Migration strategy

Implementation of this approved design requires exactly one append-only
migration after current migration `0010`. The future migration may create
generic Tenant `audit_events`, required constraints and indexes, and the
append-only PostgreSQL trigger/function.

It must not create `publication_audit_events`, and it must not rewrite
migrations `0000` through `0010`. The previously rejected temporary
`0011_dark_jazinda.sql` has no authority and is not part of the migration
lineage.

Before the implementation migration is accepted, engineering must verify that
there is no evidence the rejected migration was applied to a persistent/shared
CampusHub database. If such evidence exists, implementation stops for
migration-recovery review. No migration is created by this architecture
checkpoint.

## 16. A2 and A4 obligations

When implementation begins, `audit_events` becomes a new Tenant-owned surface.
It therefore receives:

- a Tenant Surface Registry declaration;
- TI-1 negative tests;
- a Tenant-scoped repository contract;
- wrong-Tenant not-found behaviour;
- a same-Tenant actor relationship;
- an A4 identifier-inventory update where appropriate;
- proof that no global behavioural identity entered Tenant audit persistence.

Existing A2/A4 controls must not be weakened.

## 17. Required implementation evidence

The later implementation checkpoint must prove at minimum:

### Audit integrity

- first event verifies;
- chained events verify;
- modified event fails verification;
- modified previous hash fails verification;
- broken sequence fails verification;
- Tenant chains are independent;
- database UPDATE fails;
- database DELETE fails.

### Data minimisation

- no recipient Membership IDs;
- no `identitySubjectId`;
- no title, body, or raw attachment;
- closed Publication audit facts only.

### Atomicity

- successful publish produces exactly one AuditEvent;
- stale publish produces zero;
- denied publish produces zero;
- Priority publish through the ordinary path produces zero;
- audit append failure rolls the Publication mutation back.

### Publication concurrency

- publish vs publish;
- publish vs draft edit;
- publish vs audience replacement in both winner orders;
- `publication.publish` grant revocation vs publish in both serialized winner
  orders.

All PostgreSQL race tests must establish real lock/blocking relationships,
rather than arbitrary sleeps.

## 18. A3 boundary

A6 does not close A3 globally. This design depends only on the currently
reviewed Membership-backed commit-time authority locks for the Publication
mutation.

A3 remains open for:

- full session/token architecture;
- MFA and session propagation;
- permission-cache and revocation-epoch design;
- queued/background authority;
- SYSTEM execution.

The implementation and reviewer must not claim otherwise.

## 19. Out of scope

A6 architecture approval does not authorize:

- Priority Notice publication, rate limits, or re-authentication;
- publication scheduling, scheduled jobs, or expiry jobs;
- notification delivery or outbox architecture;
- publication correction or retraction;
- content-redaction implementation;
- audit UI or audit export;
- Platform audit;
- Poll, Voice, or verification audit;
- role-grant implementation changes;
- non-student privileged actor persistence;
- SYSTEM actor design;
- deployment.

## 20. Exit criteria

A6 closes only when the independent Sol High reviewer explicitly confirms all
four:

1. append-only posture accepted;
2. payload minimisation and redaction interaction accepted;
3. tamper-evidence design accepted;
4. Tenant, actor, and transaction architecture accepted.

Required reviewer wording must clearly state either:

`A6 AUDIT LOG DESIGN — APPROVED / CLOSED`

or:

`A6 AUDIT LOG DESIGN — HUMAN_REQUIRED`

Generic CI success does not imply closure.
