import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { memberships } from "./membership";
import { tenants } from "./tenant";

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    actorMembershipId: uuid("actor_membership_id").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    resourceVersion: integer("resource_version"),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    eventFacts: jsonb("event_facts").notNull(),
    previousHash: text("previous_hash").notNull(),
    currentHash: text("current_hash").notNull(),
    keyVersion: integer("key_version").notNull(),
    integrityFormatVersion: integer("integrity_format_version").notNull(),
    eventContractVersion: integer("event_contract_version").notNull(),
  },
  (table) => [
    unique("audit_events_tenant_sequence_unique").on(
      table.tenantId,
      table.sequence,
    ),
    index("audit_events_tenant_resource").on(
      table.tenantId,
      table.resourceType,
      table.resourceId,
    ),
    index("audit_events_tenant_event_type").on(
      table.tenantId,
      table.eventType,
    ),
    foreignKey({
      name: "audit_events_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "audit_events_actor_membership_same_tenant_fk",
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "audit_events_sequence_positive",
      sql`${table.sequence} >= 1`,
    ),
    check(
      "audit_events_event_type_closed",
      sql`${table.eventType} IN ('publication.published', 'sport.created', 'sport.changed', 'sport.deactivated', 'competition.created', 'competition.changed', 'competition.deactivated', 'team.created', 'team.changed', 'team.deactivated')`,
    ),
    check(
      "audit_events_resource_type_closed",
      sql`${table.resourceType} IN ('publication', 'sport', 'competition', 'team')`,
    ),
    check(
      "audit_events_resource_version_positive",
      sql`${table.resourceVersion} IS NULL OR ${table.resourceVersion} >= 1`,
    ),
    check(
      "audit_events_event_facts_object",
      sql`jsonb_typeof(${table.eventFacts}) = 'object'`,
    ),
    check(
      "audit_events_hash_shape",
      sql`${table.previousHash} ~ '^[0-9a-f]{64}$' AND ${table.currentHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "audit_events_key_version_positive",
      sql`${table.keyVersion} >= 1`,
    ),
    check(
      "audit_events_integrity_format_supported",
      sql`${table.integrityFormatVersion} = 1`,
    ),
    check(
      "audit_events_event_contract_supported",
      sql`${table.eventContractVersion} = 1`,
    ),
  ],
);

export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
