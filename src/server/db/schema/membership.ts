import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ASSURANCE_LEVELS } from "@/domain/authorization/assurance-level";
import { MEMBERSHIP_LIFECYCLE_STATUSES } from "@/domain/membership/membership";
import {
  MEMBERSHIP_RESIDENCE_STATES,
  PROFILE_FIELD_PROVENANCES,
} from "@/domain/membership/membership-audience-vocabulary";

import {
  academicDivisions,
  campuses,
  programmes,
  residences,
} from "./organization";
import { tenants } from "./tenant";

export const membershipAssuranceLevelEnum = pgEnum(
  "membership_assurance_level",
  ASSURANCE_LEVELS,
);

export const membershipLifecycleEnum = pgEnum(
  "membership_lifecycle",
  MEMBERSHIP_LIFECYCLE_STATUSES,
);

export const profileFieldProvenanceEnum = pgEnum(
  "profile_field_provenance",
  PROFILE_FIELD_PROVENANCES,
);

export const membershipResidenceStateEnum = pgEnum(
  "membership_residence_state",
  MEMBERSHIP_RESIDENCE_STATES,
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    /** Opaque future-auth subject; never a provider-specific user foreign key. */
    identitySubjectId: text("identity_subject_id").notNull(),
    assuranceLevel: membershipAssuranceLevelEnum("assurance_level")
      .notNull()
      .default("L0"),
    lifecycle: membershipLifecycleEnum("lifecycle")
      .notNull()
      .default("unverified"),
    campusId: uuid("campus_id"),
    campusProvenance: profileFieldProvenanceEnum("campus_provenance"),
    academicDivisionId: uuid("academic_division_id"),
    academicDivisionProvenance: profileFieldProvenanceEnum(
      "academic_division_provenance",
    )
      .notNull()
      .default("optional"),
    programmeId: uuid("programme_id"),
    programmeProvenance: profileFieldProvenanceEnum("programme_provenance")
      .notNull()
      .default("optional"),
    academicYear: integer("academic_year"),
    academicYearProvenance: profileFieldProvenanceEnum(
      "academic_year_provenance",
    )
      .notNull()
      .default("optional"),
    residenceState: membershipResidenceStateEnum("residence_state")
      .notNull()
      .default("unknown"),
    residenceId: uuid("residence_id"),
    residenceProvenance: profileFieldProvenanceEnum("residence_provenance")
      .notNull()
      .default("optional"),
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
    uniqueIndex("memberships_tenant_identity_unique").on(
      table.tenantId,
      table.identitySubjectId,
    ),
    foreignKey({
      name: "memberships_campus_same_tenant_fk",
      columns: [table.tenantId, table.campusId],
      foreignColumns: [campuses.tenantId, campuses.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "memberships_academic_division_same_tenant_fk",
      columns: [table.tenantId, table.academicDivisionId],
      foreignColumns: [academicDivisions.tenantId, academicDivisions.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "memberships_programme_division_same_tenant_fk",
      columns: [table.tenantId, table.programmeId, table.academicDivisionId],
      foreignColumns: [
        programmes.tenantId,
        programmes.id,
        programmes.academicDivisionId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "memberships_residence_same_tenant_fk",
      columns: [table.tenantId, table.residenceId],
      foreignColumns: [residences.tenantId, residences.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    check(
      "memberships_campus_provenance_shape",
      sql`(${table.campusId} IS NULL AND ${table.campusProvenance} IS NULL) OR (${table.campusId} IS NOT NULL AND ${table.campusProvenance} IS NOT NULL AND ${table.campusProvenance} IN ('institution_verified', 'roster_derived', 'self_declared'))`,
    ),
    check(
      "memberships_academic_division_provenance_shape",
      sql`(${table.academicDivisionId} IS NULL AND ${table.academicDivisionProvenance} = 'optional') OR (${table.academicDivisionId} IS NOT NULL AND ${table.academicDivisionProvenance} <> 'optional')`,
    ),
    check(
      "memberships_programme_provenance_shape",
      sql`(${table.programmeId} IS NULL AND ${table.programmeProvenance} = 'optional') OR (${table.programmeId} IS NOT NULL AND ${table.programmeProvenance} <> 'optional')`,
    ),
    check(
      "memberships_academic_year_provenance_shape",
      sql`(${table.academicYear} IS NULL AND ${table.academicYearProvenance} = 'optional') OR (${table.academicYear} IS NOT NULL AND ${table.academicYearProvenance} <> 'optional')`,
    ),
    check(
      "memberships_academic_year_positive",
      sql`${table.academicYear} IS NULL OR ${table.academicYear} >= 1`,
    ),
    check(
      "memberships_programme_requires_division",
      sql`${table.programmeId} IS NULL OR ${table.academicDivisionId} IS NOT NULL`,
    ),
    check(
      "memberships_residence_shape",
      sql`(${table.residenceState} = 'unknown' AND ${table.residenceId} IS NULL AND ${table.residenceProvenance} = 'optional') OR (${table.residenceState} = 'non_resident' AND ${table.residenceId} IS NULL AND ${table.residenceProvenance} <> 'optional') OR (${table.residenceState} = 'resident' AND ${table.residenceId} IS NOT NULL AND ${table.residenceProvenance} <> 'optional')`,
    ),
    check(
      "memberships_identity_subject_nonempty",
      sql`char_length(btrim(${table.identitySubjectId})) > 0`,
    ),
  ],
);

export type MembershipRow = typeof memberships.$inferSelect;
export type NewMembershipRow = typeof memberships.$inferInsert;
