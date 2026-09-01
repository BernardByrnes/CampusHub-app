import { describe, expect, it } from "vitest";

import type { Membership } from "@/domain/membership/membership";
import type { Tenant } from "@/domain/tenancy/tenant";

import {
  RequestContextService,
  type ResolveRequestContextDependencies,
} from "./resolve-request-context";

const tenantAlpha: Tenant = {
  id: "tenant-alpha",
  slug: "tenant-alpha",
  displayName: "Tenant Alpha",
  status: "active",
  timezone: "Africa/Kampala",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const membershipAlpha: Membership = {
  id: "membership-alpha-a",
  tenantId: "tenant-alpha",
  identitySubjectId: "identity-a",
  assuranceLevel: "L2",
  lifecycle: "verified",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function serviceFor(
  tenant: Tenant | null = tenantAlpha,
  membership: Membership | null = membershipAlpha,
) {
  const dependencies: ResolveRequestContextDependencies = {
    tenants: {
      findTenantById: async () => tenant,
      findTenantBySlug: async () => tenant,
    },
    memberships: {
      findMembershipById: async () => membership,
      findMembershipForIdentityAndTenant: async () => membership,
    },
  };

  return new RequestContextService(dependencies);
}

describe("RequestContextService", () => {
  it("resolves through an untrusted tenant hint and identity-bound membership lookup", async () => {
    const result = await serviceFor().resolveRequestContext(
      { identitySubjectId: "identity-a" },
      { slug: "tenant-alpha" },
    );

    expect(result).toEqual({
      allowed: true,
      context: {
        identitySubjectId: "identity-a",
        tenantId: "tenant-alpha",
        membershipId: "membership-alpha-a",
        assuranceLevel: "L2",
        membershipStatus: "verified",
      },
    });
  });

  it("returns safe denials when tenant selection or membership resolution is absent", async () => {
    await expect(
      serviceFor().resolveRequestContext({ identitySubjectId: "identity-a" }),
    ).resolves.toEqual({ allowed: false, code: "TENANT_REQUIRED" });

    await expect(
      serviceFor(tenantAlpha, null).resolveRequestContext(
        { identitySubjectId: "identity-a" },
        { tenantId: "tenant-alpha" },
      ),
    ).resolves.toEqual({ allowed: false, code: "MEMBERSHIP_REQUIRED" });
  });

  it("does not accept two competing client tenant hints", async () => {
    await expect(
      serviceFor().resolveRequestContext(
        { identitySubjectId: "identity-a" },
        { tenantId: "tenant-alpha", slug: "tenant-alpha" },
      ),
    ).resolves.toEqual({ allowed: false, code: "CONTEXT_MISMATCH" });
  });
});
