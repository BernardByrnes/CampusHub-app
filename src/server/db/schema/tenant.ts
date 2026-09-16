import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { TENANT_LIFECYCLE_STATUSES } from "@/domain/tenancy/tenant";
import { CAPABILITY_MODULE_SCOPES } from "@/domain/authorization/capability-vocabulary";

export const tenantLifecycleEnum = pgEnum(
  "tenant_lifecycle",
  TENANT_LIFECYCLE_STATUSES,
);

export const tenantModuleScopeEnum = pgEnum(
  "tenant_module_scope",
  CAPABILITY_MODULE_SCOPES,
);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    status: tenantLifecycleEnum("status").notNull().default("pilot"),
    timezone: text("timezone").notNull(),
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
    uniqueIndex("tenants_slug_unique").on(table.slug),
    check(
      "tenants_slug_format",
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${table.slug}) <= 80`,
    ),
    check(
      "tenants_display_name_nonempty",
      sql`char_length(btrim(${table.displayName})) > 0`,
    ),
    check(
      "tenants_timezone_nonempty",
      sql`char_length(btrim(${table.timezone})) > 0`,
    ),
  ],
);

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenantRow = typeof tenants.$inferInsert;

/**
 * Durable, Tenant-owned module enablement. Consumer operations may read this
 * fact, but do not grant themselves the ability to change it.
 */
export const tenantModuleStates = pgTable(
  "tenant_module_states",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict", onUpdate: "cascade" }),
    module: tenantModuleScopeEnum("module").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("tenant_module_states_tenant_module_unique").on(
      table.tenantId,
      table.module,
    ),
    unique("tenant_module_states_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    check("tenant_module_states_version_positive", sql`${table.version} >= 1`),
  ],
);

export type TenantModuleStateRow = typeof tenantModuleStates.$inferSelect;
export type NewTenantModuleStateRow = typeof tenantModuleStates.$inferInsert;
