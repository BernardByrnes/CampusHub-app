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
import { FIXTURE_STATES } from "@/domain/sports/fixtures";

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

export const fixtureStateEnum = pgEnum("fixture_state", FIXTURE_STATES);

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

export const fixtures = pgTable(
  "fixtures",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict", onUpdate: "cascade" }),
    competitionId: uuid("competition_id").notNull(),
    homeTeamId: uuid("home_team_id").notNull(),
    awayTeamId: uuid("away_team_id").notNull(),
    campusId: uuid("campus_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    venue: text("venue").notNull(),
    state: fixtureStateEnum("state").notNull().default("scheduled"),
    reason: text("reason"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("fixtures_tenant_id_id_unique").on(table.tenantId, table.id),
    index("fixtures_tenant_starts_at").on(table.tenantId, table.startsAt, table.id),
    index("fixtures_tenant_state").on(table.tenantId, table.state, table.startsAt),
    index("fixtures_tenant_competition").on(table.tenantId, table.competitionId),
    index("fixtures_tenant_home_team").on(table.tenantId, table.homeTeamId),
    index("fixtures_tenant_away_team").on(table.tenantId, table.awayTeamId),
    index("fixtures_tenant_campus").on(table.tenantId, table.campusId),
    foreignKey({
      name: "fixtures_competition_same_tenant_fk",
      columns: [table.tenantId, table.competitionId],
      foreignColumns: [competitions.tenantId, competitions.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "fixtures_home_team_same_tenant_fk",
      columns: [table.tenantId, table.homeTeamId],
      foreignColumns: [teams.tenantId, teams.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "fixtures_away_team_same_tenant_fk",
      columns: [table.tenantId, table.awayTeamId],
      foreignColumns: [teams.tenantId, teams.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "fixtures_campus_same_tenant_fk",
      columns: [table.tenantId, table.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }).onDelete("restrict").onUpdate("cascade"),
    check("fixtures_home_away_different", sql`${table.homeTeamId} <> ${table.awayTeamId}`),
    check("fixtures_venue_nonempty", sql`char_length(btrim(${table.venue})) > 0 AND char_length(${table.venue}) <= 200`),
    check("fixtures_reason_shape", sql`${table.reason} IS NULL OR (char_length(btrim(${table.reason})) > 0 AND char_length(${table.reason}) <= 500)`),
    check("fixtures_version_positive", sql`${table.version} >= 1`),
  ],
);

export type SportRow = typeof sports.$inferSelect;
export type NewSportRow = typeof sports.$inferInsert;
export type CompetitionRow = typeof competitions.$inferSelect;
export type NewCompetitionRow = typeof competitions.$inferInsert;
export type TeamRow = typeof teams.$inferSelect;
export type NewTeamRow = typeof teams.$inferInsert;
export type FixtureRow = typeof fixtures.$inferSelect;
export type NewFixtureRow = typeof fixtures.$inferInsert;
