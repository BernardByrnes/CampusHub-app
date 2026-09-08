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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { RESOURCE_VISIBILITIES } from "@/domain/authorization/resource-visibility";
import {
  PUBLICATION_AUDIENCE_DIMENSIONS,
  PUBLICATION_AUDIENCE_PROVENANCE_POLICIES,
  PUBLICATION_RESIDENCE_TARGETS,
} from "@/domain/authorization/publication-audience-vocabulary";
import {
  PUBLICATION_LIFECYCLES,
  PUBLICATION_AUDIENCE_MODES,
  PUBLICATION_PRIORITIES,
  PUBLICATION_TYPES,
} from "@/domain/content/publication";

import {
  academicDivisions,
  campuses,
  programmes,
  residences,
} from "./organization";
import { tenants } from "./tenant";

export const publicationTypeEnum = pgEnum("publication_type", PUBLICATION_TYPES);

export const publicationPriorityEnum = pgEnum(
  "publication_priority",
  PUBLICATION_PRIORITIES,
);

export const publicationLifecycleEnum = pgEnum(
  "publication_lifecycle",
  PUBLICATION_LIFECYCLES,
);

export const publicationVisibilityEnum = pgEnum(
  "publication_visibility",
  RESOURCE_VISIBILITIES,
);

export const publicationAudienceModeEnum = pgEnum(
  "publication_audience_mode",
  PUBLICATION_AUDIENCE_MODES,
);

export const publicationAudienceDimensionEnum = pgEnum(
  "publication_audience_dimension",
  PUBLICATION_AUDIENCE_DIMENSIONS,
);

export const publicationAudienceProvenancePolicyEnum = pgEnum(
  "publication_audience_provenance_policy",
  PUBLICATION_AUDIENCE_PROVENANCE_POLICIES,
);

export const publicationAudienceResidenceTargetEnum = pgEnum(
  "publication_audience_residence_target",
  PUBLICATION_RESIDENCE_TARGETS,
);

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    version: integer("version").notNull().default(1),
    type: publicationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    priority: publicationPriorityEnum("priority")
      .notNull()
      .default("standard"),
    visibility: publicationVisibilityEnum("visibility")
      .notNull()
      .default("MEMBERS"),
    lifecycle: publicationLifecycleEnum("lifecycle")
      .notNull()
      .default("draft"),
    audienceMode: publicationAudienceModeEnum("audience_mode").notNull(),
    authorOfficeLabel: text("author_office_label").notNull(),
    publishAt: timestamp("publish_at", {
      withTimezone: true,
      mode: "date",
    }),
    expiresAt: timestamp("expires_at", {
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
    index("publications_tenant_id_id").on(table.tenantId, table.id),
    unique("publications_tenant_id_id_unique").on(table.tenantId, table.id),
    index("publications_tenant_lifecycle").on(
      table.tenantId,
      table.lifecycle,
    ),
    index("publications_tenant_collection_order").on(
      table.tenantId,
      table.audienceMode,
      table.lifecycle,
      table.publishAt,
      table.id,
    ),
    check(
      "publications_title_nonempty",
      sql`char_length(btrim(${table.title})) > 0`,
    ),
    check(
      "publications_version_positive",
      sql`${table.version} >= 1`,
    ),
    check(
      "publications_body_nonempty",
      sql`char_length(btrim(${table.body})) > 0`,
    ),
    check(
      "publications_author_office_label_nonempty",
      sql`char_length(btrim(${table.authorOfficeLabel})) > 0`,
    ),
  ],
);

export type PublicationRow = typeof publications.$inferSelect;
export type NewPublicationRow = typeof publications.$inferInsert;

export const publicationAudienceCriteria = pgTable(
  "publication_audience_criteria",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id").notNull(),
    publicationId: uuid("publication_id").notNull(),
    dimension: publicationAudienceDimensionEnum("dimension").notNull(),
    provenancePolicy: publicationAudienceProvenancePolicyEnum(
      "provenance_policy",
    ).notNull(),
    campusId: uuid("campus_id"),
    academicDivisionId: uuid("academic_division_id"),
    programmeId: uuid("programme_id"),
    academicYear: integer("academic_year"),
    residenceTarget: publicationAudienceResidenceTargetEnum(
      "residence_target",
    ),
    residenceId: uuid("residence_id"),
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
    foreignKey({
      name: "publication_audience_criteria_publication_same_tenant_fk",
      columns: [table.tenantId, table.publicationId],
      foreignColumns: [publications.tenantId, publications.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "publication_audience_criteria_campus_same_tenant_fk",
      columns: [table.tenantId, table.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "publication_audience_criteria_division_same_tenant_fk",
      columns: [table.tenantId, table.academicDivisionId],
      foreignColumns: [academicDivisions.tenantId, academicDivisions.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "publication_audience_criteria_programme_same_tenant_fk",
      columns: [table.tenantId, table.programmeId],
      foreignColumns: [programmes.tenantId, programmes.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "publication_audience_criteria_residence_same_tenant_fk",
      columns: [table.tenantId, table.residenceId],
      foreignColumns: [residences.tenantId, residences.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "publication_audience_criteria_payload_shape",
      sql`(
        (${table.dimension} = 'campus' AND ${table.campusId} IS NOT NULL AND ${table.academicDivisionId} IS NULL AND ${table.programmeId} IS NULL AND ${table.academicYear} IS NULL AND ${table.residenceTarget} IS NULL AND ${table.residenceId} IS NULL)
        OR (${table.dimension} = 'academic_division' AND ${table.campusId} IS NULL AND ${table.academicDivisionId} IS NOT NULL AND ${table.programmeId} IS NULL AND ${table.academicYear} IS NULL AND ${table.residenceTarget} IS NULL AND ${table.residenceId} IS NULL)
        OR (${table.dimension} = 'programme' AND ${table.campusId} IS NULL AND ${table.academicDivisionId} IS NULL AND ${table.programmeId} IS NOT NULL AND ${table.academicYear} IS NULL AND ${table.residenceTarget} IS NULL AND ${table.residenceId} IS NULL)
        OR (${table.dimension} = 'academic_year' AND ${table.campusId} IS NULL AND ${table.academicDivisionId} IS NULL AND ${table.programmeId} IS NULL AND ${table.academicYear} IS NOT NULL AND ${table.academicYear} >= 1 AND ${table.residenceTarget} IS NULL AND ${table.residenceId} IS NULL)
        OR (${table.dimension} = 'residence' AND ${table.campusId} IS NULL AND ${table.academicDivisionId} IS NULL AND ${table.programmeId} IS NULL AND ${table.academicYear} IS NULL AND ${table.residenceTarget} IS NOT NULL AND ((${table.residenceTarget} = 'specific_residence' AND ${table.residenceId} IS NOT NULL) OR (${table.residenceTarget} IN ('any_resident', 'non_resident') AND ${table.residenceId} IS NULL)))
      )`,
    ),
    uniqueIndex(
      "publication_audience_criteria_campus_unique",
    )
      .on(table.tenantId, table.publicationId, table.campusId)
      .where(sql`${table.dimension} = 'campus'`),
    uniqueIndex(
      "publication_audience_criteria_division_unique",
    )
      .on(table.tenantId, table.publicationId, table.academicDivisionId)
      .where(sql`${table.dimension} = 'academic_division'`),
    uniqueIndex(
      "publication_audience_criteria_programme_unique",
    )
      .on(table.tenantId, table.publicationId, table.programmeId)
      .where(sql`${table.dimension} = 'programme'`),
    uniqueIndex(
      "publication_audience_criteria_academic_year_unique",
    )
      .on(table.tenantId, table.publicationId, table.academicYear)
      .where(sql`${table.dimension} = 'academic_year'`),
    uniqueIndex(
      "publication_audience_criteria_specific_residence_unique",
    )
      .on(table.tenantId, table.publicationId, table.residenceId)
      .where(
        sql`${table.dimension} = 'residence' AND ${table.residenceTarget} = 'specific_residence'`,
      ),
    uniqueIndex(
      "publication_audience_criteria_residence_target_unique",
    )
      .on(table.tenantId, table.publicationId, table.residenceTarget)
      .where(
        sql`${table.dimension} = 'residence' AND ${table.residenceTarget} IN ('any_resident', 'non_resident')`,
      ),
  ],
);

export type PublicationAudienceCriteriaRow =
  typeof publicationAudienceCriteria.$inferSelect;
export type NewPublicationAudienceCriteriaRow =
  typeof publicationAudienceCriteria.$inferInsert;
