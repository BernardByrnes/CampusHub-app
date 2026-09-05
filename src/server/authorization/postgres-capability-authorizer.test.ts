import { describe, expect, it } from "vitest";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import type { Membership } from "@/domain/membership/membership";
import type { Tenant } from "@/domain/tenancy/tenant";
import type { GuildTerm } from "@/domain/governance/guild-term";
import type { RoleGrant } from "@/domain/governance/role-grant";

import { PostgresCapabilityAuthorizer } from "./postgres-capability-authorizer";

const tenantId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";
const termId = "00000000-0000-4000-8000-000000000003";
const now = new Date("2026-06-01T12:00:00.000Z");
const createdAt = new Date("2026-01-01T00:00:00.000Z");
const endsAt = new Date("2026-12-31T23:59:59.000Z");

const tenant: Tenant = {
  id: tenantId,
  slug: "tenant-a",
  displayName: "Tenant A",
  status: "active",
  timezone: "Africa/Kampala",
  createdAt,
  updatedAt: createdAt,
};

const membership: Membership = {
  id: membershipId,
  tenantId,
  identitySubjectId: "identity-a",
  assuranceLevel: "L2",
  lifecycle: "verified",
  createdAt,
  updatedAt: createdAt,
};

const term: GuildTerm = {
  id: termId,
  tenantId,
  label: "Guild Term 2026",
  startsAt: new Date("2026-01-01T00:00:00.000Z"),
  endsAt,
  status: "active",
  createdAt,
  updatedAt: createdAt,
};

const grant: RoleGrant = {
  id: "00000000-0000-4000-8000-000000000004",
  tenantId,
  guildTermId: termId,
  membershipId,
  role: "publisher",
  capability: CAPABILITIES.PUBLICATION_CREATE,
  moduleScope: "publication",
  expiresAt: new Date("2026-12-01T00:00:00.000Z"),
  revokedAt: null,
  createdAt,
  updatedAt: createdAt,
};

function request(
  overrides: Partial<CapabilityAuthorizationRequest> = {},
): CapabilityAuthorizationRequest {
  return {
    actor: {
      identitySubjectId: "identity-a",
      tenantId,
      membershipId,
    },
    context: {
      tenantStatus: "active",
      membershipStatus: "verified",
      assuranceLevel: "L2",
    },
    capability: CAPABILITIES.PUBLICATION_CREATE,
    scope: {
      tenantId,
      module: "publication",
      resource: "publication",
    },
    ...overrides,
  };
}

function createAuthorizer(state: {
  currentTenant?: Tenant | null;
  currentMembership?: Membership | null;
  currentTerm?: GuildTerm | null;
  currentGrant?: RoleGrant | null;
  fail?: boolean;
}) {
  return new PostgresCapabilityAuthorizer({
    tenants: {
      findTenantById: async () => {
        if (state.fail) throw new Error("database unavailable");
        return state.currentTenant === undefined ? tenant : state.currentTenant;
      },
    },
    memberships: {
      findMembershipByIdForTenant: async () =>
        state.currentMembership === undefined
          ? membership
          : state.currentMembership,
    },
    guildTerms: {
      findActiveGuildTermForTenant: async () =>
        state.currentTerm === undefined ? term : state.currentTerm,
    },
    roleGrants: {
      findCapabilityGrantForTenant: async () =>
        state.currentGrant === undefined ? grant : state.currentGrant,
    },
    clock: { now: () => now },
  });
}

describe("PostgresCapabilityAuthorizer", () => {
  it("allows only the current Tenant Membership with a current grant", async () => {
    await expect(
      createAuthorizer({}).authorize(request()),
    ).resolves.toEqual({ allowed: true });
  });

  it("allows publication.edit only when the current grant contains publication.edit", async () => {
    await expect(
      createAuthorizer({
        currentGrant: {
          ...grant,
          capability: CAPABILITIES.PUBLICATION_EDIT,
        },
      }).authorize(
        request({ capability: CAPABILITIES.PUBLICATION_EDIT }),
      ),
    ).resolves.toEqual({ allowed: true });
    await expect(
      createAuthorizer({
        currentGrant: {
          ...grant,
          capability: CAPABILITIES.PUBLICATION_PUBLISH,
        },
      }).authorize(
        request({ capability: CAPABILITIES.PUBLICATION_PUBLISH }),
      ),
    ).resolves.toEqual({ allowed: false });
  });

  it("denies wrong Tenant, identity, capability, and module scope", async () => {
    await expect(
      createAuthorizer({}).authorize(
        request({ scope: { tenantId: "00000000-0000-4000-8000-000000000005", module: "publication" } }),
      ),
    ).resolves.toEqual({ allowed: false });
    await expect(
      createAuthorizer({}).authorize(
        request({ actor: { identitySubjectId: "identity-b", tenantId, membershipId } }),
      ),
    ).resolves.toEqual({ allowed: false });
    await expect(
      createAuthorizer({}).authorize(
        request({ capability: CAPABILITIES.PUBLICATION_EDIT }),
      ),
    ).resolves.toEqual({ allowed: false });
    await expect(
      createAuthorizer({}).authorize(
        request({ scope: { tenantId, module: "event" } }),
      ),
    ).resolves.toEqual({ allowed: false });
  });

  it("denies stale lifecycle, revoked, expired, and term-mismatched grants", async () => {
    await expect(
      createAuthorizer({ currentTenant: { ...tenant, status: "suspended" } }).authorize(request()),
    ).resolves.toEqual({ allowed: false });
    await expect(
      createAuthorizer({ currentMembership: { ...membership, lifecycle: "stale" } }).authorize(request()),
    ).resolves.toEqual({ allowed: false });
    await expect(
      createAuthorizer({ currentGrant: { ...grant, revokedAt: now } }).authorize(request()),
    ).resolves.toEqual({ allowed: false });
    await expect(
      createAuthorizer({ currentGrant: { ...grant, expiresAt: new Date("2026-05-31T23:59:59.000Z") } }).authorize(request()),
    ).resolves.toEqual({ allowed: false });
    await expect(
      createAuthorizer({ currentTerm: { ...term, status: "closed" } }).authorize(request()),
    ).resolves.toEqual({ allowed: false });
    await expect(
      createAuthorizer({ currentGrant: { ...grant, expiresAt: new Date("2027-01-01T00:00:00.000Z") } }).authorize(request()),
    ).resolves.toEqual({ allowed: false });
  });

  it("fails closed on repository errors and malformed requests", async () => {
    await expect(
      createAuthorizer({ fail: true }).authorize(request()),
    ).resolves.toEqual({ allowed: false });
    await expect(
      createAuthorizer({}).authorize({} as CapabilityAuthorizationRequest),
    ).resolves.toEqual({ allowed: false });
  });
});
