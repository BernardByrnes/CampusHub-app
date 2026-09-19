import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  date,
} from "drizzle-orm/pg-core";

import { events } from "./events";
import { memberships } from "./membership";
import { tenants } from "./tenant";

export const xpLedgerEntryTypeEnum = pgEnum("xp_ledger_entry_type", [
  "award",
  "capped_award",
  "correction",
  "reversal",
] as const);
export type XpSourceClaimOutcome = "award" | "capped_award";

export const xpSourceKindEnum = pgEnum("xp_source_kind", [
  "verification_completion",
  "profile_field_completion",
  "poll_participation",
  "event_rsvp",
  "daily_quiz_participation",
  "daily_quiz_accuracy",
  "streak_milestone",
] as const);

export const xpLedgerEntries = pgTable(
  "xp_ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    entryType: xpLedgerEntryTypeEnum("entry_type").notNull(),
    amount: integer("amount").notNull(),
    ruleId: text("rule_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    sourceKind: xpSourceKindEnum("source_kind").notNull(),
    sourceReferenceId: uuid("source_reference_id").notNull(),
    sourceOccurrence: text("source_occurrence").notNull(),
    sourceClaimId: uuid("source_claim_id"),
    requestIdempotencyKeyDigest: text("request_idempotency_key_digest"),
    reasonCode: text("reason_code"),
    reasonText: text("reason_text"),
    sourceEntryId: uuid("source_entry_id"),
    actorMembershipId: uuid("actor_membership_id"),
    tenantDay: date("tenant_day", { mode: "string" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("xp_ledger_entries_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("xp_ledger_entries_reciprocal_unique").on(
      table.tenantId,
      table.sourceClaimId,
      table.membershipId,
      table.id,
      table.entryType,
      table.ruleId,
      table.sourceKind,
      table.sourceReferenceId,
      table.sourceOccurrence,
    ),
    index("xp_ledger_entries_tenant_membership_day").on(
      table.tenantId,
      table.membershipId,
      table.tenantDay,
      table.id,
    ),
    index("xp_ledger_entries_tenant_membership_occurred").on(
      table.tenantId,
      table.membershipId,
      table.occurredAt,
    ),
    foreignKey({
      name: "xp_ledger_entries_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "xp_ledger_entries_membership_same_tenant_fk",
      columns: [table.tenantId, table.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "xp_ledger_entries_actor_membership_same_tenant_fk",
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }).onDelete("restrict").onUpdate("cascade"),
    check(
      "xp_ledger_entries_amount_shape",
      sql`(
        (${table.entryType} = 'award' AND ${table.amount} > 0 AND ${table.sourceClaimId} IS NOT NULL AND ${table.reasonCode} IS NULL AND ${table.reasonText} IS NULL AND ${table.sourceEntryId} IS NULL AND ${table.actorMembershipId} IS NULL)
        OR (${table.entryType} = 'capped_award' AND ${table.amount} = 0 AND ${table.sourceClaimId} IS NOT NULL AND ${table.reasonCode} IS NULL AND ${table.reasonText} IS NULL AND ${table.sourceEntryId} IS NULL AND ${table.actorMembershipId} IS NULL)
        OR (${table.entryType} IN ('correction', 'reversal') AND ${table.amount} <> 0 AND ${table.sourceClaimId} IS NULL AND ${table.reasonCode} IS NOT NULL AND char_length(btrim(${table.reasonCode})) > 0 AND ${table.reasonText} IS NOT NULL AND char_length(btrim(${table.reasonText})) > 0 AND ${table.sourceEntryId} IS NOT NULL AND ${table.actorMembershipId} IS NOT NULL)
      )`,
    ),
    check(
      "xp_ledger_entries_rule_shape",
      sql`${table.ruleId} IN ('verification.complete', 'profile.field', 'poll.participation', 'event.rsvp', 'quiz.participation', 'quiz.accuracy', 'streak.milestone') AND ${table.ruleVersion} >= 1`,
    ),
    check(
      "xp_ledger_entries_source_occurrence_nonempty",
      sql`char_length(btrim(${table.sourceOccurrence})) > 0 AND char_length(${table.sourceOccurrence}) <= 120`,
    ),
    check(
      "xp_ledger_entries_request_digest_shape",
      sql`${table.requestIdempotencyKeyDigest} IS NULL OR ${table.requestIdempotencyKeyDigest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "xp_ledger_entries_reason_text_bound",
      sql`${table.reasonText} IS NULL OR char_length(${table.reasonText}) <= 1000`,
    ),
  ],
);

export const xpSourceClaims = pgTable(
  "xp_source_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    ruleId: text("rule_id").notNull(),
    ruleVersion: integer("rule_version").notNull(),
    sourceKind: xpSourceKindEnum("source_kind").notNull(),
    sourceReferenceId: uuid("source_reference_id").notNull(),
    sourceOccurrence: text("source_occurrence").notNull(),
    expectedEntryType: xpLedgerEntryTypeEnum("expected_entry_type").$type<XpSourceClaimOutcome>().notNull(),
    canonicalLedgerEntryId: uuid("canonical_ledger_entry_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("xp_source_claims_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("xp_source_claims_tenant_canonical_ledger_unique").on(table.tenantId, table.canonicalLedgerEntryId),
    unique("xp_source_claims_conceptual_source_unique").on(
      table.tenantId,
      table.membershipId,
      table.ruleId,
      table.sourceKind,
      table.sourceReferenceId,
      table.sourceOccurrence,
    ),
    unique("xp_source_claims_reciprocal_unique").on(
      table.tenantId,
      table.id,
      table.membershipId,
      table.canonicalLedgerEntryId,
      table.expectedEntryType,
      table.ruleId,
      table.sourceKind,
      table.sourceReferenceId,
      table.sourceOccurrence,
    ),
    index("xp_source_claims_tenant_membership").on(table.tenantId, table.membershipId, table.createdAt),
    foreignKey({
      name: "xp_source_claims_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "xp_source_claims_membership_same_tenant_fk",
      columns: [table.tenantId, table.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }).onDelete("restrict").onUpdate("cascade"),
    check(
      "xp_source_claims_rule_shape",
      sql`${table.ruleId} IN ('verification.complete', 'profile.field', 'poll.participation', 'event.rsvp', 'quiz.participation', 'quiz.accuracy', 'streak.milestone') AND ${table.ruleVersion} >= 1`,
    ),
    check(
      "xp_source_claims_source_occurrence_nonempty",
      sql`char_length(btrim(${table.sourceOccurrence})) > 0 AND char_length(${table.sourceOccurrence}) <= 120`,
    ),
    check(
      "xp_source_claims_event_rsvp_shape",
      sql`(${table.sourceKind} <> 'event_rsvp' OR (${table.ruleId} = 'event.rsvp' AND ${table.sourceOccurrence} = 'initial_eligible_rsvp'))`,
    ),
    check(
      "xp_source_claims_expected_entry_type_shape",
      sql`${table.expectedEntryType} IN ('award', 'capped_award')`,
    ),
  ],
);

export const xpEventRsvpSourceClaims = pgTable(
  "xp_event_rsvp_source_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sourceClaimId: uuid("source_claim_id").notNull(),
    eventId: uuid("event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    unique("xp_event_rsvp_source_claims_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("xp_event_rsvp_source_claims_tenant_claim_unique").on(table.tenantId, table.sourceClaimId),
    unique("xp_event_rsvp_source_claims_tenant_event_unique").on(table.tenantId, table.eventId, table.sourceClaimId),
    foreignKey({
      name: "xp_event_rsvp_source_claims_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "xp_event_rsvp_source_claims_claim_same_tenant_fk",
      columns: [table.tenantId, table.sourceClaimId],
      foreignColumns: [xpSourceClaims.tenantId, xpSourceClaims.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "xp_event_rsvp_source_claims_event_same_tenant_fk",
      columns: [table.tenantId, table.eventId],
      foreignColumns: [events.tenantId, events.id],
    }).onDelete("restrict").onUpdate("cascade"),
  ],
);

export type XpLedgerEntryRow = typeof xpLedgerEntries.$inferSelect;
export type NewXpLedgerEntryRow = typeof xpLedgerEntries.$inferInsert;
export type XpSourceClaimRow = typeof xpSourceClaims.$inferSelect;
export type NewXpSourceClaimRow = typeof xpSourceClaims.$inferInsert;
export type XpEventRsvpSourceClaimRow = typeof xpEventRsvpSourceClaims.$inferSelect;
export type NewXpEventRsvpSourceClaimRow = typeof xpEventRsvpSourceClaims.$inferInsert;
