import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  boolean,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { EVENT_LIFECYCLES } from "@/domain/events/events";

import {
  academicDivisions,
  campuses,
  programmes,
  residences,
} from "./organization";
import {
  publicationAudienceDimensionEnum,
  publicationAudienceModeEnum,
  publicationAudienceProvenancePolicyEnum,
  publicationAudienceResidenceTargetEnum,
  publicationVisibilityEnum,
} from "./publication";
import { tenants } from "./tenant";

export const eventLifecycleEnum = pgEnum("event_lifecycle", EVENT_LIFECYCLES);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict", onUpdate: "cascade" }),
    version: integer("version").notNull().default(1),
    title: text("title").notNull(),
    description: text("description").notNull(),
    venue: text("venue").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    campusId: uuid("campus_id").notNull(),
    visibility: publicationVisibilityEnum("visibility").notNull().default("MEMBERS"),
    audienceMode: publicationAudienceModeEnum("audience_mode").notNull(),
    rsvpEnabled: boolean("rsvp_enabled").notNull().default(false),
    lifecycle: eventLifecycleEnum("lifecycle").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("events_tenant_id_id_unique").on(table.tenantId, table.id),
    index("events_tenant_lifecycle_starts_at").on(
      table.tenantId,
      table.lifecycle,
      table.startsAt,
      table.id,
    ),
    index("events_tenant_campus_lifecycle").on(
      table.tenantId,
      table.campusId,
      table.lifecycle,
    ),
    check("events_version_positive", sql`${table.version} >= 1`),
    check("events_title_nonempty", sql`char_length(btrim(${table.title})) > 0 AND char_length(${table.title}) <= 160`),
    check("events_description_nonempty", sql`char_length(btrim(${table.description})) > 0 AND char_length(${table.description}) <= 5000`),
    check("events_venue_nonempty", sql`char_length(btrim(${table.venue})) > 0 AND char_length(${table.venue}) <= 200`),
    check("events_ends_after_start", sql`${table.endsAt} IS NULL OR ${table.endsAt} > ${table.startsAt}`),
    foreignKey({
      name: "events_campus_same_tenant_fk",
      columns: [table.tenantId, table.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }).onDelete("restrict").onUpdate("cascade"),
  ],
);

export const eventAudienceCriteria = pgTable(
  "event_audience_criteria",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    eventId: uuid("event_id").notNull(),
    dimension: publicationAudienceDimensionEnum("dimension").notNull(),
    provenancePolicy: publicationAudienceProvenancePolicyEnum("provenance_policy").notNull(),
    campusId: uuid("campus_id"),
    academicDivisionId: uuid("academic_division_id"),
    programmeId: uuid("programme_id"),
    academicYear: integer("academic_year"),
    residenceTarget: publicationAudienceResidenceTargetEnum("residence_target"),
    residenceId: uuid("residence_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("event_audience_criteria_tenant_event").on(
      table.tenantId,
      table.eventId,
      table.dimension,
      table.id,
    ),
    foreignKey({
      name: "event_audience_criteria_event_same_tenant_fk",
      columns: [table.tenantId, table.eventId],
      foreignColumns: [events.tenantId, events.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "event_audience_criteria_campus_same_tenant_fk",
      columns: [table.tenantId, table.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "event_audience_criteria_division_same_tenant_fk",
      columns: [table.tenantId, table.academicDivisionId],
      foreignColumns: [academicDivisions.tenantId, academicDivisions.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "event_audience_criteria_programme_same_tenant_fk",
      columns: [table.tenantId, table.programmeId],
      foreignColumns: [programmes.tenantId, programmes.id],
    }).onDelete("restrict").onUpdate("cascade"),
    foreignKey({
      name: "event_audience_criteria_residence_same_tenant_fk",
      columns: [table.tenantId, table.residenceId],
      foreignColumns: [residences.tenantId, residences.id],
    }).onDelete("restrict").onUpdate("cascade"),
    check(
      "event_audience_criteria_payload_shape",
      sql`(
        (${table.dimension} = 'campus' AND ${table.campusId} IS NOT NULL AND ${table.academicDivisionId} IS NULL AND ${table.programmeId} IS NULL AND ${table.academicYear} IS NULL AND ${table.residenceTarget} IS NULL AND ${table.residenceId} IS NULL)
        OR (${table.dimension} = 'academic_division' AND ${table.campusId} IS NULL AND ${table.academicDivisionId} IS NOT NULL AND ${table.programmeId} IS NULL AND ${table.academicYear} IS NULL AND ${table.residenceTarget} IS NULL AND ${table.residenceId} IS NULL)
        OR (${table.dimension} = 'programme' AND ${table.campusId} IS NULL AND ${table.academicDivisionId} IS NULL AND ${table.programmeId} IS NOT NULL AND ${table.academicYear} IS NULL AND ${table.residenceTarget} IS NULL AND ${table.residenceId} IS NULL)
        OR (${table.dimension} = 'academic_year' AND ${table.campusId} IS NULL AND ${table.academicDivisionId} IS NULL AND ${table.programmeId} IS NULL AND ${table.academicYear} >= 1 AND ${table.residenceTarget} IS NULL AND ${table.residenceId} IS NULL)
        OR (${table.dimension} = 'residence' AND ${table.campusId} IS NULL AND ${table.academicDivisionId} IS NULL AND ${table.programmeId} IS NULL AND ${table.academicYear} IS NULL AND ${table.residenceTarget} IS NOT NULL AND ((${table.residenceTarget} = 'specific_residence' AND ${table.residenceId} IS NOT NULL) OR (${table.residenceTarget} IN ('any_resident', 'non_resident') AND ${table.residenceId} IS NULL)))
      )`,
    ),
    uniqueIndex("event_audience_criteria_campus_unique")
      .on(table.tenantId, table.eventId, table.campusId)
      .where(sql`${table.dimension} = 'campus'`),
    uniqueIndex("event_audience_criteria_division_unique")
      .on(table.tenantId, table.eventId, table.academicDivisionId)
      .where(sql`${table.dimension} = 'academic_division'`),
    uniqueIndex("event_audience_criteria_programme_unique")
      .on(table.tenantId, table.eventId, table.programmeId)
      .where(sql`${table.dimension} = 'programme'`),
    uniqueIndex("event_audience_criteria_academic_year_unique")
      .on(table.tenantId, table.eventId, table.academicYear)
      .where(sql`${table.dimension} = 'academic_year'`),
    uniqueIndex("event_audience_criteria_specific_residence_unique")
      .on(table.tenantId, table.eventId, table.residenceId)
      .where(sql`${table.dimension} = 'residence' AND ${table.residenceTarget} = 'specific_residence'`),
    uniqueIndex("event_audience_criteria_residence_target_unique")
      .on(table.tenantId, table.eventId, table.residenceTarget)
      .where(sql`${table.dimension} = 'residence' AND ${table.residenceTarget} IN ('any_resident', 'non_resident')`),
  ],
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type EventAudienceCriteriaRow = typeof eventAudienceCriteria.$inferSelect;
export type NewEventAudienceCriteriaRow = typeof eventAudienceCriteria.$inferInsert;
