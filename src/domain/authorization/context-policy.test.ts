import { describe, expect, it } from "vitest";

import {
  MEMBERSHIP_LIFECYCLE_STATUSES,
  type Membership,
} from "@/domain/membership/membership";
import {
  TENANT_LIFECYCLE_STATUSES,
  type Tenant,
} from "@/domain/tenancy/tenant";

import { validateRequestContext } from "./context-policy";

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

function resolve(overrides: Partial<Parameters<typeof validateRequestContext>[0]> = {}) {
  return validateRequestContext({
    identitySubjectId: "identity-a",
    tenant: tenantAlpha,
    membership: membershipAlpha,
    ...overrides,
  });
}

describe("trusted request-context validation", () => {
  it("returns only a complete trusted context for matching records", () => {
    expect(resolve()).toEqual({
      resolved: true,
      context: {
        identitySubjectId: "identity-a",
        tenantId: "tenant-alpha",
        tenantStatus: "active",
        membershipId: "membership-alpha-a",
        assuranceLevel: "L2",
        membershipStatus: "verified",
      },
    });
  });

  it("resolves every recognized tenant lifecycle as a trusted fact", () => {
    for (const status of TENANT_LIFECYCLE_STATUSES) {
      expect(
        resolve({ tenant: { ...tenantAlpha, status } }),
      ).toEqual({
        resolved: true,
        context: {
          identitySubjectId: "identity-a",
          tenantId: "tenant-alpha",
          tenantStatus: status,
          membershipId: "membership-alpha-a",
          assuranceLevel: "L2",
          membershipStatus: "verified",
        },
      });
    }
  });

  it("denies absent, foreign-tenant, and foreign-identity memberships", () => {
    expect(resolve({ membership: null })).toEqual({
      resolved: false,
      code: "MEMBERSHIP_REQUIRED",
    });
    expect(
      resolve({
        membership: { ...membershipAlpha, tenantId: "tenant-beta" },
      }),
    ).toEqual({ resolved: false, code: "CONTEXT_MISMATCH" });
    expect(
      resolve({
        identitySubjectId: "identity-b",
      }),
    ).toEqual({ resolved: false, code: "CONTEXT_MISMATCH" });
  });

  it("fails closed for malformed tenant, assurance, and lifecycle values", () => {
    expect(
      resolve({ tenant: { ...tenantAlpha, status: "unknown" } }),
    ).toEqual({ resolved: false, code: "INVALID_TENANT" });
    expect(
      resolve({ tenant: { ...tenantAlpha, status: "constructor" } }),
    ).toEqual({ resolved: false, code: "INVALID_TENANT" });
    expect(
      resolve({
        membership: { ...membershipAlpha, assuranceLevel: "L4" },
      }),
    ).toEqual({ resolved: false, code: "INVALID_ASSURANCE" });
    expect(
      resolve({
        membership: { ...membershipAlpha, lifecycle: "unknown" },
      }),
    ).toEqual({ resolved: false, code: "INVALID_MEMBERSHIP" });
    expect(
      resolve({
        membership: { ...membershipAlpha, lifecycle: "toString" },
      }),
    ).toEqual({ resolved: false, code: "INVALID_MEMBERSHIP" });
  });

  it("resolves every recognized membership lifecycle as a trusted fact", () => {
    for (const lifecycle of MEMBERSHIP_LIFECYCLE_STATUSES) {
      expect(
        resolve({ membership: { ...membershipAlpha, lifecycle } }),
      ).toEqual({
        resolved: true,
        context: {
          identitySubjectId: "identity-a",
          tenantId: "tenant-alpha",
          tenantStatus: "active",
          membershipId: "membership-alpha-a",
          assuranceLevel: "L2",
          membershipStatus: lifecycle,
        },
      });
    }
  });

  it("fails closed without identity or tenant and never returns partial context", () => {
    expect(resolve({ identitySubjectId: "" })).toEqual({
      resolved: false,
      code: "IDENTITY_REQUIRED",
    });
    expect(resolve({ tenant: null })).toEqual({
      resolved: false,
      code: "TENANT_UNAVAILABLE",
    });
  });
});
