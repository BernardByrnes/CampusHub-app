import { describe, expect, it } from "vitest";

import type { Membership } from "@/domain/membership/membership";
import type { Tenant } from "@/domain/tenancy/tenant";

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

  it("denies an inactive tenant before issuing context", () => {
    expect(resolve({ tenant: { ...tenantAlpha, status: "suspended" } })).toEqual({
      allowed: false,
      code: "TENANT_INACTIVE",
    });
    expect(resolve({ tenant: { ...tenantAlpha, status: "archived" } })).toEqual({
      allowed: false,
      code: "TENANT_INACTIVE",
    });
  });

  it("denies absent, foreign-tenant, and foreign-identity memberships", () => {
    expect(resolve({ membership: null })).toEqual({
      allowed: false,
      code: "MEMBERSHIP_REQUIRED",
    });
    expect(
      resolve({
        membership: { ...membershipAlpha, tenantId: "tenant-beta" },
      }),
    ).toEqual({ allowed: false, code: "CONTEXT_MISMATCH" });
    expect(
      resolve({
        identitySubjectId: "identity-b",
      }),
    ).toEqual({ allowed: false, code: "CONTEXT_MISMATCH" });
  });

  it("denies malformed assurance and lifecycle values", () => {
    expect(
      resolve({
        membership: { ...membershipAlpha, assuranceLevel: "L4" },
      }),
    ).toEqual({ allowed: false, code: "INVALID_ASSURANCE" });
    expect(
      resolve({
        membership: { ...membershipAlpha, lifecycle: "unknown" },
      }),
    ).toEqual({ allowed: false, code: "MEMBERSHIP_INACTIVE" });
  });

  it("denies non-actionable membership states and accepts on-leave per frozen default", () => {
    for (const lifecycle of [
      "unverified",
      "pending_review",
      "stale",
      "alumni",
      "transferred_out",
      "participation_suspended",
      "suspended",
      "closed",
    ] as const) {
      expect(resolve({ membership: { ...membershipAlpha, lifecycle } })).toEqual({
        allowed: false,
        code: "MEMBERSHIP_INACTIVE",
      });
    }

    expect(
      resolve({ membership: { ...membershipAlpha, lifecycle: "on_leave" } }),
    ).toEqual({
      allowed: true,
      context: expect.objectContaining({ membershipStatus: "on_leave" }),
    });
  });

  it("fails closed without identity or tenant and never returns partial context", () => {
    expect(resolve({ identitySubjectId: "" })).toEqual({
      allowed: false,
      code: "IDENTITY_REQUIRED",
    });
    expect(resolve({ tenant: null })).toEqual({
      allowed: false,
      code: "TENANT_UNAVAILABLE",
    });
  });
});
