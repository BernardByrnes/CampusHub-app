# FG-13 Sports Results Gate

Status: **FG-13 PARTIALLY SATISFIED — CH-SPT-003 RESULTS/CORRECTION HISTORY AUTHORIZED**

## Decision record

The Product Owner approves the narrow Pilot Result contract for **CH-SPT-003 —
Results and correction history**. This record is a governance checkpoint only. It
authorizes a future CH-SPT-003 implementation after independent review of this
checkpoint; it does not implement or authorize Result runtime work in this
checkpoint.

- Foundation SHA: `50939255347e5cd4a6a5183edf874a047bc2ff48`
- Decision scope: Result and correction history for the existing Tenant-owned
  Fixture model.
- Product authority: Product Owner approval for the FG-13 checkpoint.

## Approved Result contract

### Ownership and Fixture relationship

- A Result belongs to exactly one Tenant-owned Fixture.
- A Fixture has at most one logical Result lineage.
- Scores are not stored directly on Fixture.
- Fixture lifecycle and Result lifecycle remain separate.
- Result and Result revisions are Tenant-owned, explicitly Tenant-scoped, and
  structurally tied to the same Tenant as their Fixture.
- Wrong-Tenant lookup or mutation fails safely without exposing foreign-resource
  details.

### Eligibility and score shape

- A draft or published Result is permitted only for a `completed` Fixture.
- Results for `scheduled`, `postponed`, `cancelled`, or `abandoned` Fixtures are
  not publishable.
- Editing a Result does not automatically change Fixture state.
- Pilot scores are only non-negative integer home and away final scores.
- Draws are valid. Player scorers, cards, assists, penalty breakdowns,
  possession, period scoring, live scoring, and player statistics are out of
  scope.

### Lifecycle, immutability, and correction

- The Result lifecycle is `draft → published`.
- Draft Results are visible only to authorized Sports management and are edited
  with expected-version concurrency.
- Publishing is a high-impact single-winner transition; stale concurrent
  publishers receive the canonical conflict outcome.
- A published Result is immutable: it is not edited in place, deleted, or
  silently overwritten.
- A correction is an append-only revision containing corrected home and away
  scores, a mandatory human-readable reason, actor attribution, a timestamp,
  and a monotonically ordered revision identity/version.
- Prior published revisions remain retained permanently. The correction becomes
  the current published Result without mutating or erasing prior revisions.

### Student visibility and audit

- Students see the latest published Result, a corrected indication when
  applicable, and sufficient history to understand the previous score, corrected
  score, reason, and correction time.
- Internal actor identifiers are not exposed on the student surface.
- Privileged Result actions use the established immutable A6 audit path.
- Audit records at minimum cover Result draft creation, useful draft changes,
  publishing, and correction. Audit payloads are minimized and are not the
  source of truth for the product correction ledger.

### Authority and concurrency

- Result management uses the existing `sport.manage` capability.
- No second Result-management capability is introduced for Pilot.
- Result draft edits, publishing, and corrections use the existing
  expected-version rules; concurrent stale writers cannot silently overwrite
  one another.
- Published Result and correction revision operations do not hard-delete
  product history. Any future exceptional content-removal workflow remains
  subject to the governed content-removal model.

## Explicit deferrals and exclusions

- Correction notification side effects remain required by Product authority but
  are **DEFERRED TO CH-NTF**. This gate creates no notification tables, email
  delivery, outbox, or background jobs.
- Repeat-correction operational alerts remain deferred to the separately gated
  notification/analytics/operations infrastructure.
- Results do not automatically update standings. Manual standings/table formats
  remain owned by CH-SPT-004 and are not authorized here.
- Team pages, Team Follow, follower notifications, automatic tables,
  tournament/bracket logic, and broader manual-format behavior are not
  authorized here.
- No Result persistence, Result API/service, migration, schema, UI, or runtime
  code is created by this documentation checkpoint.

## FG-13 boundary

This checkpoint satisfies only the Result/correction-history portion of FG-13:

`FG-13 PARTIALLY SATISFIED — CH-SPT-003 RESULTS/CORRECTION HISTORY AUTHORIZED`

The following remain open and separately gated:

- CH-SPT-004 standings/manual table formats;
- CH-SPT-005 Team pages;
- Team Follow and follower/reminder notifications;
- any broader Sports or correction/manual-format behavior not covered by this
  narrow contract.

The frozen Product Specification remains unchanged and remains the governing
Product authority. No runtime implementation is included in this checkpoint.
