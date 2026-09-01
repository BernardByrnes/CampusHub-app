import { describe, expect, it } from "vitest";

import {
  MEMBERSHIP_LIFECYCLE_STATUSES,
  type Membership,
} from "@/domain/membership/membership";
import {
  TENANT_LIFECYCLE_STATUSES,
  type Tenant,
} from "@/domain/tenancy/tenant";

import {
  RequestContextService,
  type ResolveRequestContextDependencies,
} from "./resolve-request-context";

const tenantAlpha: Tenant = {
  id: "00000000-0000-4000-8000-000000000001",
  slug: "tenant-alpha",
  displayName: "Tenant Alpha",
  status: "active",
  timezone: "Africa/Kampala",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const membershipAlpha: Membership = {
  id: "00000000-0000-4000-8000-000000000011",
  tenantId: tenantAlpha.id,
  identitySubjectId: "identity-a",
  assuranceLevel: "L2",
  lifecycle: "verified",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function serviceFor(
  tenant: Tenant | null = tenantAlpha,
  membership: Membership | null = membershipAlpha,
  tenantIdCalls: string[] = [],
) {
  const dependencies: ResolveRequestContextDependencies = {
    tenants: {
      findTenantById: async (id) => {
        tenantIdCalls.push(id);
        return tenant;
      },
      findTenantBySlug: async () => tenant,
    },
    memberships: {
      findMembershipByIdForTenant: async () => membership,
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
      resolved: true,
      context: {
        identitySubjectId: "identity-a",
        tenantId: tenantAlpha.id,
        tenantStatus: "active",
        membershipId: membershipAlpha.id,
        assuranceLevel: "L2",
        membershipStatus: "verified",
      },
    });
  });

  it("returns safe denials when tenant selection or membership resolution is absent", async () => {
    await expect(
      serviceFor().resolveRequestContext({ identitySubjectId: "identity-a" }),
    ).resolves.toEqual({ resolved: false, code: "TENANT_REQUIRED" });

    await expect(
      serviceFor(tenantAlpha, null).resolveRequestContext(
        { identitySubjectId: "identity-a" },
        { tenantId: tenantAlpha.id },
      ),
    ).resolves.toEqual({ resolved: false, code: "TENANT_SCOPE_NOT_FOUND" });
  });

  it("equates an existing Tenant without Membership with a nonexistent Tenant", async () => {
    const existingWithoutMembership = await serviceFor(
      tenantAlpha,
      null,
    ).resolveRequestContext(
      { identitySubjectId: "identity-a" },
      { tenantId: tenantAlpha.id },
    );
    const nonexistentTenant = await serviceFor(
      null,
      null,
    ).resolveRequestContext(
      { identitySubjectId: "identity-a" },
      { tenantId: tenantAlpha.id },
    );

    expect(existingWithoutMembership).toEqual({
      resolved: false,
      code: "TENANT_SCOPE_NOT_FOUND",
    });
    expect(nonexistentTenant).toEqual(existingWithoutMembership);
  });

  it("rejects malformed Tenant identifiers before the Tenant repository", async () => {
    const tenantIdCalls: string[] = [];
    const service = serviceFor(tenantAlpha, membershipAlpha, tenantIdCalls);

    await expect(
      service.resolveRequestContext(
        { identitySubjectId: "identity-a" },
        { tenantId: "banana" },
      ),
    ).resolves.toEqual({
      resolved: false,
      code: "TENANT_SCOPE_NOT_FOUND",
    });
    await expect(
      service.resolveRequestContext(
        { identitySubjectId: "identity-a" },
        { slug: "not_a_slug" },
      ),
    ).resolves.toEqual({
      resolved: false,
      code: "TENANT_SCOPE_NOT_FOUND",
    });
    expect(tenantIdCalls).toEqual([]);
  });

  it("does not accept two competing client tenant hints", async () => {
    await expect(
      serviceFor().resolveRequestContext(
        { identitySubjectId: "identity-a" },
        { tenantId: tenantAlpha.id, slug: "tenant-alpha" },
      ),
    ).resolves.toEqual({ resolved: false, code: "CONTEXT_MISMATCH" });
  });

  it("resolves every recognized tenant lifecycle without deciding access", async () => {
    for (const status of TENANT_LIFECYCLE_STATUSES) {
      await expect(
        serviceFor({ ...tenantAlpha, status }).resolveRequestContext(
          { identitySubjectId: "identity-a" },
          { tenantId: tenantAlpha.id },
        ),
      ).resolves.toEqual({
        resolved: true,
        context: {
          identitySubjectId: "identity-a",
        tenantId: tenantAlpha.id,
          tenantStatus: status,
        membershipId: membershipAlpha.id,
          assuranceLevel: "L2",
          membershipStatus: "verified",
        },
      });
    }
  });

  it("resolves every recognized membership lifecycle without deciding participation", async () => {
    for (const lifecycle of MEMBERSHIP_LIFECYCLE_STATUSES) {
      await expect(
        serviceFor(tenantAlpha, { ...membershipAlpha, lifecycle }).resolveRequestContext(
          { identitySubjectId: "identity-a" },
          { tenantId: tenantAlpha.id },
        ),
      ).resolves.toEqual({
        resolved: true,
        context: {
          identitySubjectId: "identity-a",
        tenantId: tenantAlpha.id,
          tenantStatus: "active",
        membershipId: membershipAlpha.id,
          assuranceLevel: "L2",
          membershipStatus: lifecycle,
        },
      });
    }
  });
});
