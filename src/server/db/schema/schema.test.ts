import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  membershipAssuranceLevelEnum,
  membershipLifecycleEnum,
  memberships,
  tenantLifecycleEnum,
  tenants,
} from "./index";

describe("Tenant and Membership Drizzle schema", () => {
  it("contains only the B.1 business tables", () => {
    expect(getTableConfig(tenants).name).toBe("tenants");
    expect(getTableConfig(memberships).name).toBe("memberships");
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
  });

  it("declares slug and tenant-identity uniqueness", () => {
    const tenantConfig = getTableConfig(tenants);
    const membershipConfig = getTableConfig(memberships);

    expect(tenantConfig.indexes.map((index) => index.config.name)).toContain(
      "tenants_slug_unique",
    );
    expect(membershipConfig.indexes.map((index) => index.config.name)).toContain(
      "memberships_tenant_identity_unique",
    );
    expect(membershipConfig.foreignKeys[0]?.onDelete).toBe("restrict");
  });
});
