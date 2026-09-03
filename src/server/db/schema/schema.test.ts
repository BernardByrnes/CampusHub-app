import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  membershipAssuranceLevelEnum,
  membershipLifecycleEnum,
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
    expect(publicationConfig.indexes.map((index) => index.config.name)).toEqual([
      "publications_tenant_id_id",
      "publications_tenant_lifecycle",
      "publications_tenant_collection_order",
    ]);
    expect(publicationConfig.foreignKeys[0]?.onDelete).toBe("restrict");
    expect(publicationConfig.foreignKeys[0]?.onUpdate).toBe("cascade");
    expect(publicationConfig.checks.map((check) => check.name)).toEqual([
      "publications_title_nonempty",
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
  });
});
