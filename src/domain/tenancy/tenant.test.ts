import { describe, expect, it } from "vitest";

import {
  isTenant,
  isValidIanaTimezone,
  isValidTenantSlug,
  parseTenantLifecycle,
  TENANT_LIFECYCLE_STATUSES,
  tenantHasFullFunctionality,
  type Tenant,
} from "./tenant";

const baseTenant: Tenant = {
  id: "tenant-alpha",
  slug: "tenant-alpha",
  displayName: "Tenant Alpha",
  status: "active",
  timezone: "Africa/Kampala",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("Tenant domain", () => {
  it("accepts a valid tenant and frozen lifecycle statuses", () => {
    expect(isTenant(baseTenant)).toBe(true);
    expect(TENANT_LIFECYCLE_STATUSES).toEqual([
      "pilot",
      "active",
      "grace",
      "suspended",
      "archived",
    ]);
    expect(parseTenantLifecycle("active")).toBe("active");
    expect(parseTenantLifecycle("INACTIVE")).toBeNull();
    expect(parseTenantLifecycle("banned")).toBeNull();
  });

  it("validates URL-safe slugs and IANA timezones", () => {
    expect(isValidTenantSlug("tenant-alpha")).toBe(true);
    expect(isValidTenantSlug("Tenant Alpha")).toBe(false);
    expect(isValidTenantSlug("tenant_alpha")).toBe(false);
    expect(isValidIanaTimezone("Africa/Kampala")).toBe(true);
    expect(isValidIanaTimezone("Not/A_Timezone")).toBe(false);
    expect(isValidIanaTimezone(" Africa/Kampala")).toBe(false);
  });

  it("keeps full-functionality classification narrow for future policies", () => {
    expect(tenantHasFullFunctionality("pilot")).toBe(true);
    expect(tenantHasFullFunctionality("active")).toBe(true);
    expect(tenantHasFullFunctionality("grace")).toBe(true);
    expect(tenantHasFullFunctionality("suspended")).toBe(false);
    expect(tenantHasFullFunctionality("archived")).toBe(false);
    expect(tenantHasFullFunctionality("unknown")).toBe(false);
  });

  it("rejects malformed tenants", () => {
    expect(isTenant({ ...baseTenant, status: "unknown" })).toBe(false);
    expect(isTenant({ ...baseTenant, timezone: "Mars/Olympus" })).toBe(false);
    expect(isTenant({ ...baseTenant, slug: "bad slug" })).toBe(false);
  });
});
