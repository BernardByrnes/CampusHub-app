import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { tenants } from "./tenant";

export const organisers = pgTable(
  "organisers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull().default(1),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("organisers_tenant_id_id_unique").on(table.tenantId, table.id),
    index("organisers_tenant_name").on(table.tenantId, table.name, table.id),
    check("organisers_version_positive", sql`${table.version} >= 1`),
    check(
      "organisers_name_nonempty",
      sql`char_length(btrim(${table.name})) > 0 AND char_length(${table.name}) <= 120`,
    ),
  ],
);

export type OrganiserRow = typeof organisers.$inferSelect;
export type NewOrganiserRow = typeof organisers.$inferInsert;
