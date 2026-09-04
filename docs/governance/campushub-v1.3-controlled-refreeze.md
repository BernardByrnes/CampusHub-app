# CampusHub v1.3 Controlled Refreeze Record

Status: **REFREEZE CANDIDATE — PENDING PRODUCT/ARCHITECTURE REVIEW**

Repository: BernardByrnes/CampusHub-app
Branch at preparation: codex/8v-b-next-foundation
Purpose: traceable reconciliation of the v1.2 frozen governing documents with
later approved architecture and checkpoint contracts

This record is governance evidence, not an approval. It does not freeze the
v1.3 candidates, approve A2, approve A4, approve B.2.4, resolve an open
decision, or authorize a product feature. The v1.2 frozen Product
Specification and Canonical Prototype Blueprint remain preserved historical
records.

## 1. Governing-document boundary

The candidate documents are:

- CampusHub_Product_Specification_v1.3_REFREEZE_CANDIDATE.md;
- CampusHub_Implementation_Blueprint_v1.3_REFREEZE_CANDIDATE.md; and
- this controlled refreeze record.

The Product Specification candidate defines product WHAT/WHY. The
Implementation Blueprint candidate defines production HOW. Neither candidate
silently overrides the frozen v1.2 Product Specification before explicit
review and approval. The historical static prototype remains useful for visual
and interaction reference only where it does not conflict with product
authority.

The refreeze vocabulary in this record is deliberate:

- **DOCUMENTATION SYNC — NO NEW PRODUCT DECISION** means an approved authority
  or implementation contract is being represented accurately in the candidate;
  and
- **NEW/OPEN PRODUCT DECISION REQUIRED** means the existing authority is
  insufficient and the matter remains in the open register.

## 2. Approval preservation

The v1.3 candidate does not rebind any earlier approval:

| Checkpoint | Historical reviewed implementation SHA | Historical decision | v1.3 treatment |
| --- | --- | --- | --- |
| A2 | ed3674bc8689aacd1075161215d16cd4994efcac | APPROVED WITH NONBLOCKING OBLIGATIONS | Preserved at the historical SHA; no new A2 approval. |
| A4 | 279a3b7d2f2e5fbe87e4d74025884ec9bd229060 | A4_APPROVED_WITH_NONBLOCKING_OBLIGATIONS | Preserved at the historical SHA; no new A4 approval. |
| B.2.4 | 84c58cc2b525e1061fb4652906968c54ac3a00b3 | B2_4_APPROVED_WITH_NONBLOCKING_OBLIGATIONS | Preserved at the independently reviewed implementation SHA. |
| B.2.4 closure record | 7016c345d3c0d0b1052bb80821de73e3e29c5e25 | Documentation closure record | Recorded as post-review documentation; it does not rebind the implementation approval. |

The v1.3 refreeze documentation commit, when made, will occur after these
reviewed SHAs. It is not itself independently reviewed merely because it
records them.

## 3. CR-01 through CR-17 traceability

| Change ID | v1.2 issue | Authority supporting remediation | v1.3 change | Product behavior changed? | Runtime impact | Review needed |
| --- | --- | --- | --- | --- | --- | --- |
| CR-01 | The frozen documents retain the old Next.js -> Django/DRF -> PostgreSQL production direction. | ADR 0001, approved by Product Owner, explicitly supersedes the production stack direction and records CONTROLLED_REFREEZE_REQUIRED. | Product Spec §1 records the document boundary; Implementation Blueprint §§2–3 defines Next.js full-stack, application/domain/policy/repository/Drizzle/PostgreSQL production layering. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; no application behavior or migration changes. | Product/architecture review of the controlled supersession. |
| CR-02 | The prototype Blueprint mixes product rules, UI/demo types, and production translation. | Frozen Product Specification authority order and the v1.2 Blueprint's own rank rule. | Product Spec §1 and Blueprint §1 explicitly separate WHAT/WHY from HOW, preserve product authority, and classify prototype constants/types/local state as non-production unless separately approved. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE. | Product/architecture review. |
| CR-03 | Prototype visibility/audience wording can be read as a universal visible-but-ineligible rule. | Product Specification §14.1, CH-PUB-003, ADR 0002, and independently approved B.2.4 at 84c58cc2b525e1061fb4652906968c54ac3a00b3. | Product Spec §§8–10 and Blueprint §§7–9 state visibility/exposure before audience for ordinary targeted Publications, fail-closed direct/collection behavior, and separate Poll/A1 treatment. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; approved B.2.4 runtime remains unchanged. | Product/security review of wording and resource-specific inheritance. |
| CR-04 | Prototype MEMBERS text allows every active Membership, including L0, to receive normal members-only content. | Product Specification §14.1 and ADR 0002 read defaults. | Product Spec §8 and Blueprint §8 require L1+ for normal MEMBERS and do not grant normal member-only content to L0 without an explicit safe exception. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE. | Product/security review. |
| CR-05 | Prototype contracts use a simplified Current/Suspended/Completed Membership vocabulary. | Product Specification §10 and §22, ADR 0002, and A4 boundary. | Product Spec §6 and Blueprint §5 preserve the ten-state Membership lifecycle and keep assurance separate. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE. | Product/architecture review. |
| CR-06 | Global User and Tenant Membership concerns can be conflated. | Product Specification §10 and independently approved A4 at 279a3b7d2f2e5fbe87e4d74025884ec9bd229060. | Product Spec §6 and Blueprint §§4–7 preserve account/security versus Tenant Membership behavior and explicitly state that Auth/Global User persistence is not present. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE. | A4-boundary and legal/security review where future Auth is concerned. |
| CR-07 | Affiliation and audience provenance can be treated as global or unqualified profile data. | Product Specification §§10–12, ADR 0005, ADR 0006, and B.2.4 at 84c58cc2b525e1061fb4652906968c54ac3a00b3. | Product Spec §6 and Blueprint §5 keep Campus, Academic Division, Programme, Academic Year, and Residence provenance on Tenant Membership and preserve the canonical audience vocabulary. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE. | Product/security review. |
| CR-08 | Prototype has a separate PriorityNotice entity and risks freezing demo priority values. | Product Specification CH-PUB-001 and CH-PUB-006. | Product Spec §9 and Blueprint §5 use one Publication entity with priority as an attribute and leave the numeric cap open. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE. | Product review of the unresolved cap only. |
| CR-09 | Publication lifecycle, targeting, and version/concurrency rules are not represented as one production contract. | Product Specification CH-PUB-002/003/004, ADR 0003, ADR 0006, B.2.4 review package. | Product Spec §9 and Blueprint §§8–10 preserve normalized criteria, current live facts, immutable published audience, expected versions, atomic confirmation, same-transaction future publish confirmation, target-label snapshot, and scheduled fail-closed behavior. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; no B.2.4 runtime change. | Product/security review of future publish obligations. |
| CR-10 | Prototype search direction permits client-side filtering of an unrestricted Tenant dataset. | Product Specification §14.1, CH-HOM-004, TI-1, ADR 0004. | Product Spec §12 and Blueprint §8 require server-authorized, Tenant-bound, visibility/audience-filtered, bounded search; client filtering is allowed only over authorized results. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; search remains future. | Architecture/security review before search implementation. |
| CR-11 | Prototype XP/Quiz numbers and shapes may be mistaken for immutable production constants. | Product Specification CH-XP/CH-QIZ and its open-decision sections; v1.2 Blueprint §§11 and 19. | Product Spec §11 and Blueprint §15.5 classify demo amounts as placeholders, preserve server-authoritative Quiz behavior, and leave A10 cap/grace/configuration values open. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; no XP/Quiz implementation. | Product/security review of open numeric decisions. |
| CR-12 | Prototype participation actions may bypass the canonical participation evaluator or hard-code a stronger gate. | Product Specification GSC-14 and CH-HOM/CH-EVT/CH-OPP contracts. | Product Spec §§8–10 and Blueprint §§7, 8, and 15 require canonical server-side participation gating and do not replace an L1 product grant with L2 copy. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE. | Product/architecture review before participation features. |
| CR-13 | Prototype Opportunity trust labels and assurance language can imply unsupported verification. | Product Specification CH-OPP-001/002 and assurance model. | Product Spec §9 and Blueprint §15.4 require HTTPS and vetting hard blocks while forbidding an unsupported blanket Verified opportunity claim or invented mandatory assurance. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; Opportunities remain outside current foundation. | Product/security review before Opportunity launch. |
| CR-14 | Prototype Event state handling is incomplete and can bypass Membership eligibility. | Product Specification CH-EVT-001..004 and GSC-14. | Product Spec §9 and Blueprint §15.4 preserve draft/published/postponed/cancelled/past-or-archived behavior and RSVP through canonical participation evaluation. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; Events remain outside current foundation. | Product/architecture review before Event implementation. |
| CR-15 | Prototype Voice moderation/public status and privacy rules can conflict with the Product Specification. | Product Specification CH-VOX-001..007 and v1.2 Blueprint §10. | Product Spec §10.2 and Blueprint §15.3 preserve a disabled-by-default, staffed, pseudonymous-to-peers Voice module with separate internal/public states and audited identity access. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; Voice remains outside current foundation. | Product, safety, legal, and security review before activation. |
| CR-16 | Prototype notifications do not fully express Tenant-local separation and category obligations. | Product Specification CH-NTF, TI-1, TI-12, and ADRs 0004/0005. | Product Spec §12 and Blueprint §13 require Tenant-local notifications and prohibit merged cross-Tenant behavior while leaving delivery infrastructure future. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; notifications remain future. | Product/security/privacy review before delivery implementation. |
| CR-17 | Prototype Transparency page can be treated as permanently static copy. | Product Specification CH-PRV-001 and TI-1/TI-5/TI-12. | Product Spec §12 and Blueprint §14 require truthful output from approved product/Tenant configuration and preserve honest Poll, Voice, sponsor, retention, and deletion limits. | NO — DOCUMENTATION SYNC — NO NEW PRODUCT DECISION. | NONE; no UI/runtime change. | Product, legal, and privacy review before launch. |

## 4. Supersession and prototype tombstones

No historical text is deleted. The v1.3 candidates mark these old directions as
superseded, prototype-only, or not a production contract:

| Historical direction | v1.3 treatment | Supporting trace |
| --- | --- | --- |
| Next.js -> Django/DRF -> PostgreSQL production stack | Superseded for production by ADR 0001; Next.js full-stack is the production direction. | CR-01; Blueprint §2. |
| Universal visible-but-ineligible audience behavior | Not valid for ordinary targeted Publications; visibility and audience remain separate and resource-specific. | CR-03; Product Spec §8–9. |
| Active Membership at any assurance level receives normal MEMBERS content | Prototype-only/incorrect for the product contract; normal MEMBERS requires L1+ absent an explicit exception. | CR-04; Product Spec §8. |
| Current/Suspended/Completed as the Membership model | Prototype simplification only; the ten-state lifecycle remains canonical. | CR-05; Product Spec §6. |
| PriorityNotice as a separate production entity | Prototype type only; production uses one Publication entity with a priority attribute. | CR-08; Product Spec §9. |
| Hard-coded Quiz or participation XP values | Demo placeholder only; product amounts and A10 limits remain governed/open. | CR-11; Product Spec §11. |
| Browser/local state as authorization or production source of truth | Prototype demonstration state only; production authority is server-side. | CR-02; Blueprint §§2 and 4. |

## 5. OPEN DECISIONS / BLOCKERS REGISTER

The following decisions are intentionally unresolved:

| ID | Decision required | Timing/status |
| --- | --- | --- |
| OD-01 | Capability bootstrap, first holder, grant authority, self-grant, expiry, and revocation. | **BLOCK BEFORE PUBLICATION CAPABILITY AUTHORIZATION** |
| OD-02 | Privileged non-student Tenant authority for Custodian, University Official, staff Publisher, and moderator. | **BLOCK BEFORE PRIVILEGED USER PERSISTENCE/AUTHORIZATION** |
| OD-03 | Contact-channel provenance boundary between Global User and Membership/evidence. | **BLOCK BEFORE AUTH / VERIFIED CHANNEL PERSISTENCE** |
| OD-04 | Guild Term handover, delayed elections, grant activation, continuity, and rollover authority gap. | **BLOCK BEFORE GUILD TERM / GOVERNANCE FEATURE** and **BLOCK BEFORE PILOT** |
| OD-05 | Full roster upload authority and university authorization. | **BLOCK BEFORE REAL ROSTER IMPORT / PILOT** |
| OD-06 | Custodian emergency-revocation scope and safeguards. | **BLOCK BEFORE GOVERNANCE FEATURE / PILOT** |
| OD-07 | Report/ModerationCase entity, lifecycle, reviewing capability, conflicts, escalation, SLA, evidence, appeal, and resource types. | **BLOCK BEFORE MODERATION / OPPORTUNITY SAFETY WORK** and relevant **BLOCK BEFORE PILOT** items |
| OD-08 | SYSTEM/background transitions that require reauthorization of originating authority and current state. | **BLOCK BEFORE BACKGROUND JOB / OUTBOX EXECUTION** |
| OD-09 | SMALL AUDIENCE FLOOR numeric value. | **NEW/OPEN PRODUCT DECISION REQUIRED**; no number is selected. |
| OD-10 | Priority Notice numeric cap. | **NEW/OPEN PRODUCT DECISION REQUIRED**; no number is selected. |
| OD-11 | A1 Poll response privacy, storage/linkability, thresholds, and transparency wording. | **BLOCK BEFORE POLL IMPLEMENTATION** |
| OD-12 | A10 daily XP cap and allocation semantics. | **NEW/OPEN PRODUCT DECISION REQUIRED**; no number or allocator is selected. |

OD-01 through OD-08 and OD-11 are blockers at the stated future boundary. OD-09,
OD-10, and OD-12 remain open numeric/product decisions; this record does not
turn a recommendation into a chosen value.

## 6. Feature-gate and Pilot registers

The v1.3 Product Specification contains:

- a feature-gated audit register in §16 covering Home ranking, stale
  Membership recovery, assurance copy, Save/Follow, Events, Opportunities,
  Daily Quiz, Voice, verification/manual review, Me/settings/session safety,
  notifications, search, Sports, sponsorship, non-Voice moderation, and
  analytics; and
- a Pilot readiness register in §17 covering Guild Term continuity, roster
  authority, Custodian safeguards, moderation, legal/privacy, hosting,
  Transparency accuracy, sessions/shared devices, data rights, active Tenant
  isolation, analytics definitions, abuse/escalation, A1, Voice readiness,
  and paid-launch continuity.

These registers track gates and evidence. They do not decide the unresolved
questions and do not claim that an absent feature is implemented.

## 7. Nonblocking obligations preserved

The refreeze preserves, without marking implemented:

- the unresolved SMALL AUDIENCE FLOOR;
- real Publication create/publish capability authorization;
- external publish transport;
- confirmation inside the eventual authoritative publish transaction;
- publish-time target-label snapshot;
- scheduled-fire revalidation and fail-closed hold;
- future Campus backfill/nullability strengthening;
- durable redacted security events before external Tenant transport;
- backup/restore before paid launch;
- TG-04 migration/recovery governance;
- A4 future obligations;
- TI-1 governance for future Tenant-sensitive surfaces; and
- separate A1/Poll gating.

## 8. Preservation and validation record

The original frozen files are outside the production app repository in the
separate static-prototype repository and were not modified:

| File | SHA256 observed before refreeze work |
| --- | --- |
| C:\Users\NANCY\CampusHub\CampusHub_Product_Specification_v1.2_FROZEN.md | 6DADB2508D2DFAB19DACF6E9FA5F4265245BCF1E9228BC9B311747A40435F5E4 |
| C:\Users\NANCY\CampusHub\CampusHub_Canonical_Prototype_Blueprint_v1.2_FROZEN.md | 94BD8DB07309978848BAF8C53F20E4437F600EA1304DA300359337998D91B0E4 |

The v1.3 work changes documentation/governance candidates only. It does not
change production runtime code, tests, schema, migration history, RLS posture,
the static prototype, or any prior reviewed implementation SHA.

The migration head remains drizzle/0008_loving_dagger.sql. The v1.3 candidates
remain pending review and must not be labelled FROZEN until explicit approval.

## 9. Review decision required

Before this candidate can become v1.3-FROZEN, reviewers must verify:

- Product Specification behavior remains faithful to frozen product authority;
- each CR is a traceable synchronization or explicitly marked open decision;
- the Implementation Blueprint describes the real Next.js production boundary;
- A2, A4, and B.2.4 approvals remain bound to their historical SHAs;
- all nonblocking obligations remain unresolved where stated;
- v1.2 frozen files and migrations are unchanged; and
- no implementation behavior has been silently expanded by this documentation.

**REFREEZE CANDIDATE — PENDING PRODUCT/ARCHITECTURE REVIEW**
