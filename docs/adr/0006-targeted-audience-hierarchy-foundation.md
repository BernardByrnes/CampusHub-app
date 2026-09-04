# ADR 0006: Targeted-Publication Audience Hierarchy Foundation

- Status: **IMPLEMENTED — SOL REVIEWED / CLOSED**
- Reviewed implementation SHA: `230b553065f5aeb15c1f068d590c251e02e20b5e`
- Date: 2026-09-03
- Scope: B.2.4.2 typed Tenant hierarchy foundation

This checkpoint closure is not a whole-lane approval; final independent
security review of B.2.4 remains B.2.4.9.

## Decision

CampusHub uses typed Tenant-owned relational tables for `campuses`,
`academic_divisions`, `programmes`, `residences`, and
`tenant_academic_year_config`. A generic hierarchy-node table is not used.
Stable UUIDs preserve identity across label changes. Academic Divisions use an
explicit one- or two-level contract, and relational composite foreign keys
preserve same-Tenant ownership for parents, merge targets, and Programme
affiliation.

Residences are real optional entities. B.2.4.3 subsequently introduced
`non_resident` as a first-class Membership residence state; it is not
represented by a fabricated Residence row. Academic years use a Tenant-owned
numeric minimum/maximum range with no fabricated default rows.
This checkpoint stores current labels and non-destructive merge metadata only;
it does not rewrite historical attribution, redirect references, or add label
history.

B.2.4.1 audience boolean/provenance semantics remain the approved contract.
Later B.2.4.3–.7 checkpoints now persist Tenant Membership affiliation and
normalized Publication audience criteria and connect them to readiness, direct
read, and collection evaluation. TI-1 Tenant-isolation registry and negative
evidence accompany each implemented Tenant-owned model and operation.

The second-level parent invariant that cannot be expressed by the simple
PostgreSQL checks alone belongs to the future canonical hierarchy mutation
boundary. No broad hierarchy CRUD or audience resolution is introduced here.
