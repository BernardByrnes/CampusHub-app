import { describe, expect, it, vi } from "vitest";

import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";

import { ListFixturesService } from "./list-fixtures";

const tenantId = "00000000-0000-4000-8000-000000000001";
const context: TrustedRequestContext = {
  identitySubjectId: "identity-a",
  tenantId,
  membershipId: "00000000-0000-4000-8000-000000000002",
  tenantStatus: "active",
  membershipStatus: "verified",
  assuranceLevel: "L2",
};

describe("ListFixturesService", () => {
  it("does not call the repository for a cross-Tenant request", async () => {
    const listFixturesForTenant = vi.fn(async () => []);
    const service = new ListFixturesService({ fixtures: { listFixturesForTenant } });
    await expect(
      service.listFixtures({
        trustedContext: context,
        requestedTenantId: "00000000-0000-4000-8000-000000000003",
        filters: {},
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(listFixturesForTenant).not.toHaveBeenCalled();
  });

  it("passes only bounded name filters to the Tenant-local repository", async () => {
    const listFixturesForTenant = vi.fn(async () => []);
    const service = new ListFixturesService({ fixtures: { listFixturesForTenant } });
    await expect(
      service.listFixtures({
        trustedContext: context,
        requestedTenantId: tenantId,
        filters: { sportName: " Football ", teamName: "Campus United" },
      }),
    ).resolves.toEqual({ outcome: "READY", items: [] });
    expect(listFixturesForTenant).toHaveBeenCalledWith(tenantId, {
      sportName: "Football",
      teamName: "Campus United",
      limit: 50,
    });
  });

  it("denies suspended members and unavailable Tenants", async () => {
    const service = new ListFixturesService({
      fixtures: { listFixturesForTenant: vi.fn(async () => []) },
    });
    await expect(
      service.listFixtures({
        trustedContext: { ...context, membershipStatus: "suspended" },
        requestedTenantId: tenantId,
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "MEMBERSHIP_NOT_ELIGIBLE" });
    await expect(
      service.listFixtures({
        trustedContext: { ...context, tenantStatus: "suspended" },
        requestedTenantId: tenantId,
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "TENANT_UNAVAILABLE" });
  });
});
