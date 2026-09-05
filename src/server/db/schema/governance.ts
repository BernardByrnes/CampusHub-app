import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  CAPABILITY_MODULE_SCOPES,
  CAPABILITY_VALUES,
} from "@/domain/authorization/capability-vocabulary";
import { GUILD_TERM_STATUSES } from "@/domain/governance/guild-term";
import { ROLE_GRANT_ROLES } from "@/domain/governance/role-grant";

import { memberships } from "./membership";
import { tenants } from "./tenant";

export const guildTermStatusEnum = pgEnum(
  "guild_term_status",
  GUILD_TERM_STATUSES,
);

export const roleGrantRoleEnum = pgEnum("role_grant_role", ROLE_GRANT_ROLES);

export const roleGrantCapabilityEnum = pgEnum(
  "role_grant_capability",
  CAPABILITY_VALUES,
);

export const roleGrantModuleScopeEnum = pgEnum(
  "role_grant_module_scope",
  CAPABILITY_MODULE_SCOPES,
);

export const guildTerms = pgTable(
  "guild_terms",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    label: text("label").notNull(),
    startsAt: timestamp("starts_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    endsAt: timestamp("ends_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    status: guildTermStatusEnum("status").notNull().default("upcoming"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("guild_terms_tenant_id_id_unique").on(table.tenantId, table.id),
    uniqueIndex("guild_terms_one_active_per_tenant")
      .on(table.tenantId)
      .where(sql`${table.status} = 'active'`),
    index("guild_terms_tenant_status").on(table.tenantId, table.status),
    check(
      "guild_terms_label_nonempty",
      sql`char_length(btrim(${table.label})) > 0`,
    ),
    check("guild_terms_range_valid", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);

export const roleGrants = pgTable(
  "role_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    guildTermId: uuid("guild_term_id").notNull(),
    membershipId: uuid("membership_id").notNull(),
    role: roleGrantRoleEnum("role").notNull(),
    capability: roleGrantCapabilityEnum("capability").notNull(),
    moduleScope: roleGrantModuleScopeEnum("module_scope").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("role_grants_tenant_id_id_unique").on(table.tenantId, table.id),
    index("role_grants_tenant_membership_capability").on(
      table.tenantId,
      table.membershipId,
      table.capability,
      table.moduleScope,
    ),
    foreignKey({
      name: "role_grants_guild_term_same_tenant_fk",
      columns: [table.tenantId, table.guildTermId],
      foreignColumns: [guildTerms.tenantId, guildTerms.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "role_grants_membership_same_tenant_fk",
      columns: [table.tenantId, table.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "role_grants_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "role_grants_revocation_after_creation",
      sql`${table.revokedAt} IS NULL OR ${table.revokedAt} >= ${table.createdAt}`,
    ),
  ],
);

export type GuildTermRow = typeof guildTerms.$inferSelect;
export type NewGuildTermRow = typeof guildTerms.$inferInsert;
export type RoleGrantRow = typeof roleGrants.$inferSelect;
export type NewRoleGrantRow = typeof roleGrants.$inferInsert;
