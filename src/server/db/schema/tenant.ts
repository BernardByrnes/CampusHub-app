import { sql } from "drizzle-orm";
import {
  check,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { TENANT_LIFECYCLE_STATUSES } from "@/domain/tenancy/tenant";

export const tenantLifecycleEnum = pgEnum(
  "tenant_lifecycle",
  TENANT_LIFECYCLE_STATUSES,
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
