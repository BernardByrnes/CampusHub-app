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
} from "drizzle-orm/pg-core";

import {
  COMPETITION_TABLE_MODES,
  SPORT_LIFECYCLE_STATUSES,
} from "@/domain/sports/sports";

import { campuses } from "./organization";
import { tenants } from "./tenant";

export const sportLifecycleEnum = pgEnum(
  "sport_lifecycle",
  SPORT_LIFECYCLE_STATUSES,
);

export const competitionTableModeEnum = pgEnum(
  "competition_table_mode",
  COMPETITION_TABLE_MODES,
);

export const sports = pgTable(
  "sports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    status: sportLifecycleEnum("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
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
    unique("sports_tenant_id_id_unique").on(table.tenantId, table.id),
    index("sports_tenant_status").on(table.tenantId, table.status),
    index("sports_tenant_name").on(table.tenantId, table.name, table.id),
    check(
      "sports_name_nonempty",
      sql`char_length(btrim(${table.name})) > 0 AND char_length(${table.name}) <= 120`,
    ),
    check("sports_version_positive", sql`${table.version} >= 1`),
  ],
);

export const competitions = pgTable(
  "competitions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    sportId: uuid("sport_id").notNull(),
    name: text("name").notNull(),
    seasonLabel: text("season_label").notNull(),
    campusId: uuid("campus_id").notNull(),
    tableMode: competitionTableModeEnum("table_mode")
      .notNull()
      .default("none"),
    status: sportLifecycleEnum("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
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
    unique("competitions_tenant_id_id_unique").on(table.tenantId, table.id),
    index("competitions_tenant_sport_status").on(
      table.tenantId,
      table.sportId,
      table.status,
    ),
    index("competitions_tenant_campus_status").on(
      table.tenantId,
      table.campusId,
      table.status,
    ),
    foreignKey({
      name: "competitions_sport_same_tenant_fk",
      columns: [table.tenantId, table.sportId],
      foreignColumns: [sports.tenantId, sports.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "competitions_campus_same_tenant_fk",
      columns: [table.tenantId, table.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "competitions_name_nonempty",
      sql`char_length(btrim(${table.name})) > 0 AND char_length(${table.name}) <= 120`,
    ),
    check(
      "competitions_season_label_nonempty",
      sql`char_length(btrim(${table.seasonLabel})) > 0 AND char_length(${table.seasonLabel}) <= 80`,
    ),
    check("competitions_version_positive", sql`${table.version} >= 1`),
  ],
);

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    sportId: uuid("sport_id").notNull(),
    name: text("name").notNull(),
    affiliationLabel: text("affiliation_label"),
    status: sportLifecycleEnum("status").notNull().default("active"),
    version: integer("version").notNull().default(1),
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
    unique("teams_tenant_id_id_unique").on(table.tenantId, table.id),
    index("teams_tenant_sport_status").on(
      table.tenantId,
      table.sportId,
      table.status,
    ),
    foreignKey({
      name: "teams_sport_same_tenant_fk",
      columns: [table.tenantId, table.sportId],
      foreignColumns: [sports.tenantId, sports.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "teams_name_nonempty",
      sql`char_length(btrim(${table.name})) > 0 AND char_length(${table.name}) <= 120`,
    ),
    check(
      "teams_affiliation_label_shape",
      sql`${table.affiliationLabel} IS NULL OR (char_length(btrim(${table.affiliationLabel})) > 0 AND char_length(${table.affiliationLabel}) <= 160)`,
    ),
    check("teams_version_positive", sql`${table.version} >= 1`),
  ],
);

export type SportRow = typeof sports.$inferSelect;
export type NewSportRow = typeof sports.$inferInsert;
export type CompetitionRow = typeof competitions.$inferSelect;
export type NewCompetitionRow = typeof competitions.$inferInsert;
export type TeamRow = typeof teams.$inferSelect;
export type NewTeamRow = typeof teams.$inferInsert;
