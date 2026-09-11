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
import { RESULT_LIFECYCLES } from "@/domain/sports/results";

import { campuses } from "./organization";
import { memberships } from "./membership";
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
export const resultLifecycleEnum = pgEnum("result_lifecycle", RESULT_LIFECYCLES);

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

export const results = pgTable(
  "results",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict", onUpdate: "cascade" }),
    fixtureId: uuid("fixture_id").notNull(),
    lifecycle: resultLifecycleEnum("lifecycle").notNull().default("draft"),
    draftHomeScore: integer("draft_home_score"),
    draftAwayScore: integer("draft_away_score"),
    currentRevisionNumber: integer("current_revision_number"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("results_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("results_one_per_fixture").on(table.tenantId, table.fixtureId),
    index("results_tenant_lifecycle").on(table.tenantId, table.lifecycle),
    index("results_tenant_fixture").on(table.tenantId, table.fixtureId),
    foreignKey({
      name: "results_fixture_same_tenant_fk",
      columns: [table.tenantId, table.fixtureId],
      foreignColumns: [fixtures.tenantId, fixtures.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "results_draft_scores_shape",
      sql`(
        (${table.lifecycle} = 'draft'
          AND ${table.draftHomeScore} IS NOT NULL
          AND ${table.draftAwayScore} IS NOT NULL
          AND ${table.currentRevisionNumber} IS NULL)
        OR
        (${table.lifecycle} = 'published'
          AND ${table.draftHomeScore} IS NULL
          AND ${table.draftAwayScore} IS NULL
          AND ${table.currentRevisionNumber} >= 1)
      )`,
    ),
    check(
      "results_scores_nonnegative",
      sql`${table.draftHomeScore} IS NULL OR (${table.draftHomeScore} >= 0 AND ${table.draftHomeScore} <= 2147483647)`,
    ),
    check(
      "results_away_score_nonnegative",
      sql`${table.draftAwayScore} IS NULL OR (${table.draftAwayScore} >= 0 AND ${table.draftAwayScore} <= 2147483647)`,
    ),
    check("results_version_positive", sql`${table.version} >= 1`),
    check(
      "results_current_revision_positive",
      sql`${table.currentRevisionNumber} IS NULL OR ${table.currentRevisionNumber} >= 1`,
    ),
  ],
);

export const resultRevisions = pgTable(
  "result_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict", onUpdate: "cascade" }),
    resultId: uuid("result_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    homeScore: integer("home_score").notNull(),
    awayScore: integer("away_score").notNull(),
    actorMembershipId: uuid("actor_membership_id").notNull(),
    correctionReason: text("correction_reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("result_revisions_tenant_id_id_unique").on(table.tenantId, table.id),
    unique("result_revisions_result_revision_unique").on(
      table.tenantId,
      table.resultId,
      table.revisionNumber,
    ),
    index("result_revisions_tenant_result").on(
      table.tenantId,
      table.resultId,
      table.revisionNumber,
    ),
    foreignKey({
      name: "result_revisions_result_same_tenant_fk",
      columns: [table.tenantId, table.resultId],
      foreignColumns: [results.tenantId, results.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "result_revisions_actor_same_tenant_fk",
      columns: [table.tenantId, table.actorMembershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check("result_revisions_revision_positive", sql`${table.revisionNumber} >= 1`),
    check(
      "result_revisions_home_score_nonnegative",
      sql`${table.homeScore} >= 0 AND ${table.homeScore} <= 2147483647`,
    ),
    check(
      "result_revisions_away_score_nonnegative",
      sql`${table.awayScore} >= 0 AND ${table.awayScore} <= 2147483647`,
    ),
    check(
      "result_revisions_reason_shape",
      sql`(
        (${table.revisionNumber} = 1 AND ${table.correctionReason} IS NULL)
        OR
        (${table.revisionNumber} > 1
          AND ${table.correctionReason} IS NOT NULL
          AND char_length(btrim(${table.correctionReason})) > 0
          AND char_length(${table.correctionReason}) <= 500)
      )`,
    ),
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
export type ResultRow = typeof results.$inferSelect;
export type NewResultRow = typeof results.$inferInsert;
export type ResultRevisionRow = typeof resultRevisions.$inferSelect;
export type NewResultRevisionRow = typeof resultRevisions.$inferInsert;
