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
  ACADEMIC_DIVISION_LIFECYCLE_STATUSES,
  CAMPUS_LIFECYCLE_STATUSES,
  PROGRAMME_LIFECYCLE_STATUSES,
  RESIDENCE_LIFECYCLE_STATUSES,
} from "@/domain/organization/hierarchy";

import { tenants } from "./tenant";

export const campusLifecycleEnum = pgEnum(
  "campus_lifecycle",
  CAMPUS_LIFECYCLE_STATUSES,
);

export const academicDivisionLifecycleEnum = pgEnum(
  "academic_division_lifecycle",
  ACADEMIC_DIVISION_LIFECYCLE_STATUSES,
);

export const programmeLifecycleEnum = pgEnum(
  "programme_lifecycle",
  PROGRAMME_LIFECYCLE_STATUSES,
);

export const residenceLifecycleEnum = pgEnum(
  "residence_lifecycle",
  RESIDENCE_LIFECYCLE_STATUSES,
);

export const campuses = pgTable(
  "campuses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    label: text("label").notNull(),
    status: campusLifecycleEnum("status").notNull().default("active"),
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
    unique("campuses_tenant_id_id_unique").on(table.tenantId, table.id),
    index("campuses_tenant_status").on(table.tenantId, table.status),
    check(
      "campuses_label_nonempty",
      sql`char_length(btrim(${table.label})) > 0`,
    ),
  ],
);

export const academicDivisions = pgTable(
  "academic_divisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    label: text("label").notNull(),
    parentAcademicDivisionId: uuid("parent_academic_division_id"),
    level: integer("level").notNull().default(1),
    status: academicDivisionLifecycleEnum("status")
      .notNull()
      .default("active"),
    mergedIntoAcademicDivisionId: uuid("merged_into_academic_division_id"),
    mergedEffectiveAt: timestamp("merged_effective_at", {
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
    unique("academic_divisions_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("academic_divisions_tenant_parent").on(
      table.tenantId,
      table.parentAcademicDivisionId,
    ),
    index("academic_divisions_tenant_status").on(table.tenantId, table.status),
    foreignKey({
      name: "academic_divisions_parent_same_tenant_fk",
      columns: [table.tenantId, table.parentAcademicDivisionId],
      foreignColumns: [table.tenantId, table.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "academic_divisions_merge_same_tenant_fk",
      columns: [table.tenantId, table.mergedIntoAcademicDivisionId],
      foreignColumns: [table.tenantId, table.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "academic_divisions_label_nonempty",
      sql`char_length(btrim(${table.label})) > 0`,
    ),
    check(
      "academic_divisions_level_valid",
      sql`${table.level} IN (1, 2)`,
    ),
    check(
      "academic_divisions_level_parent_shape",
      sql`(${table.level} = 1 AND ${table.parentAcademicDivisionId} IS NULL) OR (${table.level} = 2 AND ${table.parentAcademicDivisionId} IS NOT NULL)`,
    ),
    check(
      "academic_divisions_parent_not_self",
      sql`${table.parentAcademicDivisionId} IS NULL OR ${table.parentAcademicDivisionId} <> ${table.id}`,
    ),
    check(
      "academic_divisions_merge_not_self",
      sql`${table.mergedIntoAcademicDivisionId} IS NULL OR ${table.mergedIntoAcademicDivisionId} <> ${table.id}`,
    ),
    check(
      "academic_divisions_merge_metadata_shape",
      sql`(${table.status} = 'merged' AND ${table.mergedIntoAcademicDivisionId} IS NOT NULL AND ${table.mergedEffectiveAt} IS NOT NULL) OR (${table.status} <> 'merged' AND ${table.mergedIntoAcademicDivisionId} IS NULL AND ${table.mergedEffectiveAt} IS NULL)`,
    ),
  ],
);

export const programmes = pgTable(
  "programmes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    academicDivisionId: uuid("academic_division_id").notNull(),
    label: text("label").notNull(),
    status: programmeLifecycleEnum("status").notNull().default("active"),
    mergedIntoProgrammeId: uuid("merged_into_programme_id"),
    mergedEffectiveAt: timestamp("merged_effective_at", {
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
    unique("programmes_tenant_id_id_unique").on(
      table.tenantId,
      table.id,
    ),
    index("programmes_tenant_division").on(
      table.tenantId,
      table.academicDivisionId,
    ),
    index("programmes_tenant_status").on(table.tenantId, table.status),
    foreignKey({
      name: "programmes_division_same_tenant_fk",
      columns: [table.tenantId, table.academicDivisionId],
      foreignColumns: [academicDivisions.tenantId, academicDivisions.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "programmes_merge_same_tenant_fk",
      columns: [table.tenantId, table.mergedIntoProgrammeId],
      foreignColumns: [table.tenantId, table.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "programmes_label_nonempty",
      sql`char_length(btrim(${table.label})) > 0`,
    ),
    check(
      "programmes_merge_not_self",
      sql`${table.mergedIntoProgrammeId} IS NULL OR ${table.mergedIntoProgrammeId} <> ${table.id}`,
    ),
    check(
      "programmes_merge_metadata_shape",
      sql`(${table.status} = 'merged' AND ${table.mergedIntoProgrammeId} IS NOT NULL AND ${table.mergedEffectiveAt} IS NOT NULL) OR (${table.status} <> 'merged' AND ${table.mergedIntoProgrammeId} IS NULL AND ${table.mergedEffectiveAt} IS NULL)`,
    ),
  ],
);

export const residences = pgTable(
  "residences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    label: text("label").notNull(),
    status: residenceLifecycleEnum("status").notNull().default("active"),
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
    unique("residences_tenant_id_id_unique").on(table.tenantId, table.id),
    index("residences_tenant_status").on(table.tenantId, table.status),
    check(
      "residences_label_nonempty",
      sql`char_length(btrim(${table.label})) > 0`,
    ),
  ],
);

export const tenantAcademicYearConfig = pgTable(
  "tenant_academic_year_config",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    minimumYear: integer("minimum_year").notNull(),
    maximumYear: integer("maximum_year").notNull(),
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
    check(
      "tenant_academic_year_config_minimum_positive",
      sql`${table.minimumYear} >= 1`,
    ),
    check(
      "tenant_academic_year_config_range_valid",
      sql`${table.maximumYear} >= ${table.minimumYear}`,
    ),
  ],
);

export type CampusRow = typeof campuses.$inferSelect;
export type NewCampusRow = typeof campuses.$inferInsert;
export type AcademicDivisionRow = typeof academicDivisions.$inferSelect;
export type NewAcademicDivisionRow = typeof academicDivisions.$inferInsert;
export type ProgrammeRow = typeof programmes.$inferSelect;
export type NewProgrammeRow = typeof programmes.$inferInsert;
export type ResidenceRow = typeof residences.$inferSelect;
export type NewResidenceRow = typeof residences.$inferInsert;
export type TenantAcademicYearConfigRow =
  typeof tenantAcademicYearConfig.$inferSelect;
export type NewTenantAcademicYearConfigRow =
  typeof tenantAcademicYearConfig.$inferInsert;
