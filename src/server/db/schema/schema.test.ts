import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  membershipAssuranceLevelEnum,
  membershipLifecycleEnum,
  memberships,
  publicationLifecycleEnum,
  publicationTypeEnum,
  publicationVisibilityEnum,
  publications,
  tenantLifecycleEnum,
  tenants,
} from "./index";

describe("Tenant, Membership, and Publication Drizzle schema", () => {
  it("contains the B.1 tables and the first concrete B.2.1 resource table", () => {
    expect(getTableConfig(tenants).name).toBe("tenants");
    expect(getTableConfig(memberships).name).toBe("memberships");
    expect(getTableConfig(publications).name).toBe("publications");
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
    ]);
    expect(publicationConfig.foreignKeys[0]?.onDelete).toBe("restrict");
    expect(publicationConfig.foreignKeys[0]?.onUpdate).toBe("cascade");
    expect(publicationConfig.checks.map((check) => check.name)).toEqual([
      "publications_title_nonempty",
      "publications_body_nonempty",
    ]);
  });
});
