import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  membershipAssuranceLevelEnum,
  membershipLifecycleEnum,
  membershipResidenceStateEnum,
  memberships,
  academicDivisionLifecycleEnum,
  academicDivisions,
  campusLifecycleEnum,
  campuses,
  publicationLifecycleEnum,
  publicationPriorityEnum,
  publicationTypeEnum,
  publicationVisibilityEnum,
  publications,
  profileFieldProvenanceEnum,
  programmeLifecycleEnum,
  programmes,
  residenceLifecycleEnum,
  residences,
  tenantAcademicYearConfig,
  tenantLifecycleEnum,
  tenants,
} from "./index";

describe("Tenant, Membership, and Publication Drizzle schema", () => {
  it("contains the B.1 tables and the first concrete B.2.1 resource table", () => {
    expect(getTableConfig(tenants).name).toBe("tenants");
    expect(getTableConfig(memberships).name).toBe("memberships");
    expect(getTableConfig(publications).name).toBe("publications");
    expect(getTableConfig(campuses).name).toBe("campuses");
    expect(getTableConfig(academicDivisions).name).toBe("academic_divisions");
    expect(getTableConfig(programmes).name).toBe("programmes");
    expect(getTableConfig(residences).name).toBe("residences");
    expect(getTableConfig(tenantAcademicYearConfig).name).toBe(
      "tenant_academic_year_config",
    );
  });

  it("declares closed lifecycle and assurance values at the database boundary", () => {
    expect(tenantLifecycleEnum.enumValues).toEqual([
      "pilot",
      "active",
      "grace",
      "suspended",
      "archived",
    ]);
    expect(membershipLifecycleEnum.enumValues).toHaveLength(10);
    expect(membershipAssuranceLevelEnum.enumValues).toEqual([
      "L0",
      "L1",
      "L2",
      "L3",
    ]);
    expect(publicationTypeEnum.enumValues).toEqual(["notice", "news"]);
    expect(publicationPriorityEnum.enumValues).toEqual([
      "standard",
      "priority",
    ]);
    expect(publicationLifecycleEnum.enumValues).toEqual([
      "draft",
      "scheduled",
      "published",
      "expired",
      "archived",
    ]);
    expect(publicationVisibilityEnum.enumValues).toEqual([
      "PUBLIC",
      "MEMBERS",
      "VERIFIED_MEMBERS",
    ]);
    expect(campusLifecycleEnum.enumValues).toEqual(["active", "inactive"]);
    expect(academicDivisionLifecycleEnum.enumValues).toEqual([
      "active",
      "inactive",
      "merged",
    ]);
    expect(programmeLifecycleEnum.enumValues).toEqual([
      "active",
      "inactive",
      "merged",
    ]);
    expect(residenceLifecycleEnum.enumValues).toEqual(["active", "inactive"]);
    expect(profileFieldProvenanceEnum.enumValues).toEqual([
      "institution_verified",
      "roster_derived",
      "self_declared",
      "optional",
    ]);
    expect(membershipResidenceStateEnum.enumValues).toEqual([
      "unknown",
      "non_resident",
      "resident",
    ]);
  });

  it("declares tenant ownership and justified tenant-first indexes", () => {
    const tenantConfig = getTableConfig(tenants);
    const membershipConfig = getTableConfig(memberships);
    const publicationConfig = getTableConfig(publications);

    expect(tenantConfig.indexes.map((index) => index.config.name)).toContain(
      "tenants_slug_unique",
    );
    expect(membershipConfig.indexes.map((index) => index.config.name)).toContain(
      "memberships_tenant_identity_unique",
    );
    expect(membershipConfig.foreignKeys[0]?.onDelete).toBe("restrict");
    expect(membershipConfig.foreignKeys).toHaveLength(5);
    expect(
      membershipConfig.foreignKeys.map((foreignKey) => {
        const reference = foreignKey.reference();
        return `${reference.columns.map((column) => column.name).join(",")} -> ${reference.foreignColumns.map((column) => column.name).join(",")}`;
      }),
    ).toEqual(
      expect.arrayContaining([
        "tenant_id -> id",
        "tenant_id,campus_id -> tenant_id,id",
        "tenant_id,academic_division_id -> tenant_id,id",
        "tenant_id,programme_id,academic_division_id -> tenant_id,id,academic_division_id",
        "tenant_id,residence_id -> tenant_id,id",
      ]),
    );
    for (const foreignKey of membershipConfig.foreignKeys) {
      expect(foreignKey.onDelete).toBe("restrict");
      expect(foreignKey.onUpdate).toBe("cascade");
    }
    expect(publicationConfig.indexes.map((index) => index.config.name)).toEqual([
      "publications_tenant_id_id",
      "publications_tenant_lifecycle",
      "publications_tenant_collection_order",
    ]);
    expect(publicationConfig.foreignKeys[0]?.onDelete).toBe("restrict");
    expect(publicationConfig.foreignKeys[0]?.onUpdate).toBe("cascade");
    expect(publicationConfig.checks.map((check) => check.name)).toEqual([
      "publications_title_nonempty",
      "publications_version_positive",
      "publications_body_nonempty",
      "publications_author_office_label_nonempty",
    ]);
  });

  it("declares typed hierarchy ownership, composite identity, and checks", () => {
    const campusConfig = getTableConfig(campuses);
    const divisionConfig = getTableConfig(academicDivisions);
    const programmeConfig = getTableConfig(programmes);
    const residenceConfig = getTableConfig(residences);
    const yearConfig = getTableConfig(tenantAcademicYearConfig);

    for (const config of [
      campusConfig,
      divisionConfig,
      programmeConfig,
      residenceConfig,
    ]) {
      expect(
        config.columns.find((column) => column.name === "tenant_id"),
      ).toBeDefined();
      expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain(
        `${config.name}_tenant_id_id_unique`,
      );
      expect(config.indexes.map((index) => index.config.name)).toContain(
        `${config.name}_tenant_status`,
      );
      expect(config.foreignKeys.length).toBeGreaterThan(0);
    }

    expect(divisionConfig.foreignKeys).toHaveLength(3);
    expect(programmeConfig.foreignKeys).toHaveLength(3);
    expect(
      yearConfig.columns.find((column) => column.name === "tenant_id")?.primary,
    ).toBe(true);
    expect(yearConfig.foreignKeys).toHaveLength(1);
    expect(divisionConfig.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "academic_divisions_level_valid",
        "academic_divisions_level_parent_shape",
        "academic_divisions_parent_not_self",
        "academic_divisions_merge_not_self",
        "academic_divisions_merge_metadata_shape",
      ]),
    );
    expect(programmeConfig.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "programmes_merge_not_self",
        "programmes_merge_metadata_shape",
      ]),
    );
    expect(
      programmeConfig.uniqueConstraints.map((constraint) => constraint.name),
    ).toContain("programmes_tenant_id_id_division_unique");
  });

  it("declares Membership affiliation columns and fail-closed shape checks", () => {
    const membershipConfig = getTableConfig(memberships);
    const column = (name: string) =>
      membershipConfig.columns.find((candidate) => candidate.name === name);

    expect(column("campus_id")?.notNull).toBe(false);
    expect(column("campus_provenance")?.notNull).toBe(false);
    expect(column("academic_division_id")?.notNull).toBe(false);
    expect(column("academic_division_provenance")?.notNull).toBe(true);
    expect(column("programme_id")?.notNull).toBe(false);
    expect(column("programme_provenance")?.notNull).toBe(true);
    expect(column("academic_year")?.notNull).toBe(false);
    expect(column("academic_year_provenance")?.notNull).toBe(true);
    expect(column("residence_state")?.notNull).toBe(true);
    expect(column("residence_id")?.notNull).toBe(false);
    expect(column("residence_provenance")?.notNull).toBe(true);
    expect(membershipConfig.checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "memberships_campus_provenance_shape",
        "memberships_academic_division_provenance_shape",
        "memberships_programme_provenance_shape",
        "memberships_academic_year_provenance_shape",
        "memberships_academic_year_positive",
        "memberships_programme_requires_division",
        "memberships_residence_shape",
      ]),
    );
  });
});
