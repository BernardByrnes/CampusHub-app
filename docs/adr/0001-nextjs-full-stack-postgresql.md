# ADR 0001: Next.js full-stack application with PostgreSQL and Drizzle

- Status: **APPROVED BY PRODUCT OWNER — PENDING CANONICAL DOCUMENT RE-FREEZE**
- Date: 2026-09-01

## Decision

CampusHub production will use one full-stack Next.js App Router application
with TypeScript, Tailwind CSS, server-side application/domain services,
PostgreSQL, and Drizzle ORM. Next.js hosts the server runtime, Route Handlers,
and Server Actions where appropriate.

The intended production repository is `BernardByrnes/CampusHub-app`. Its local
implementation is isolated from the static prototype repository.

The architecture is:

```text
Browser
  -> Next.js Server Components / Route Handlers / Server Actions
  -> application services
  -> authorization and domain policies
  -> repositories and Drizzle
  -> PostgreSQL
```

Transport files are thin. UI components and transport handlers must not become
the source of truth for tenant identity, membership, assurance, authorization,
XP, Streak, or other security-sensitive behavior.

## Supersedes

This decision supersedes the implementation-stack direction of
`Next.js -> Django/DRF -> PostgreSQL` for the production application. The
frozen Product Specification and Blueprint still contain that older stack
reference and are not edited during 8V-B.0.

The stack contradiction is recorded for a later governance action:

> TODO: `CONTROLLED_REFREEZE_REQUIRED`

Only the implementation-stack decision is superseded. Frozen product rules,
privacy requirements, lifecycle semantics, and authority gates remain binding.

## Rationale

- One TypeScript production codebase reduces operational footprint.
- A shared language supports typed contracts across transport, application, and
  domain layers.
- PostgreSQL preserves transactional integrity and explicit constraints.
- Drizzle keeps schema, SQL behavior, and migrations reviewable.
- The shape is suitable for a small team and AI-assisted development.
- A later extraction to separate services remains possible if needed.

## Constraints and deferred decisions

- Authentication/provider architecture is not selected; no provider or custom
  JWT implementation is installed in 8V-B.0.
- A1 Poll response privacy/linkability is **PENDING 8V-A APPROVAL**. No
  selected-option persistence, ballot storage, tally, or Poll result export is
  permitted.
- A10 Makerere daily XP cap is **PENDING 8V-A APPROVAL**. No numeric value or
  capped-award allocator is permitted.
- Hosting is deliberately undecided.
- Tenant, Membership, XP, Streak, and other business models are deferred to
  later authority-gated phases.

## Risks

- There is no Django Admin; administrative workflows need an intentional
  application design in a later phase.
- The application must build and test a strong authorization architecture
  rather than relying on framework defaults.
- Careless Next.js code can mix UI, business, and security concerns.
- Database constraints and transactions must remain explicit for concurrency-
  sensitive rules.
- The trust boundary must never migrate to Client Components or client-owned
  form/header values.
