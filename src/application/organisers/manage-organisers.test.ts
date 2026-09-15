import { describe, expect, it, vi } from "vitest";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import { OrganiserManagementService } from "./manage-organisers";

const tenantId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";
const organiserId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-09-20T10:00:00.000Z");
const context: TrustedRequestContext = {
  identitySubjectId: "subject-organiser",
  tenantId,
  tenantStatus: "active",
  membershipId,
  assuranceLevel: "L2",
  membershipStatus: "verified",
};

const organiser = {
  id: organiserId,
  tenantId,
  version: 1,
  name: "Student Affairs",
  createdAt: now,
  updatedAt: now,
};

describe("OrganiserManagementService", () => {
  it("rejects a mismatched requested Tenant before the gateway", async () => {
    const createOrganiser = vi.fn();
    const service = new OrganiserManagementService({
      capabilityAuthorizer: { authorize: async () => ({ allowed: true }) },
      gateway: { createOrganiser, updateOrganiser: async () => ({ ok: true as const, organiser, changed: true }) },
      organisers: { listOrganisersForTenant: async () => [] },
    });
    await expect(service.createOrganiser({
      trustedContext: context,
      requestedTenantId: "44444444-4444-4444-8444-444444444444",
      organiser: { name: "Student Affairs" },
    })).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(createOrganiser).not.toHaveBeenCalled();
  });

  it("uses the distinct organiser.manage capability and returns a bounded list", async () => {
    const authorize = vi.fn(async (request: CapabilityAuthorizationRequest) => {
      expect(request.capability).toBe(CAPABILITIES.ORGANISER_MANAGE);
      expect(request.scope).toEqual({ module: "tenant", resource: "organiser", tenantId });
      return { allowed: true };
    });
    const service = new OrganiserManagementService({
      capabilityAuthorizer: { authorize },
      gateway: { createOrganiser: async () => ({ ok: true as const, organiser, changed: true }), updateOrganiser: async () => ({ ok: true as const, organiser, changed: true }) },
      organisers: { listOrganisersForTenant: async (_tenant, limit) => limit === 1 ? [organiser] : [] },
    });
    await expect(service.listOrganisers({ trustedContext: context, requestedTenantId: tenantId, limit: 1 })).resolves.toEqual({ outcome: "LISTED", organisers: [organiser] });
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown fields instead of widening the mutation contract", async () => {
    const service = new OrganiserManagementService({
      capabilityAuthorizer: { authorize: async () => ({ allowed: true }) },
      gateway: { createOrganiser: async () => ({ ok: true as const, organiser, changed: true }), updateOrganiser: async () => ({ ok: true as const, organiser, changed: true }) },
      organisers: { listOrganisersForTenant: async () => [] },
    });
    await expect(service.createOrganiser({ trustedContext: context, requestedTenantId: tenantId, organiser: { name: "x", tenantId } })).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  });
});
