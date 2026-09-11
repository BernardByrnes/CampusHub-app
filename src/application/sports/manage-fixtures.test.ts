import { describe, expect, it, vi } from "vitest";

import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { Fixture } from "@/domain/sports/fixtures";

import {
  FixtureManagementService,
  type AuthorizedFixtureManagementGateway,
} from "./manage-fixtures";

const tenantId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";
const fixtureId = "00000000-0000-4000-8000-000000000003";
const date = new Date("2026-09-10T12:00:00.000Z");
const context: TrustedRequestContext = {
  identitySubjectId: "identity-a",
  tenantId,
  membershipId,
  tenantStatus: "active",
  membershipStatus: "verified",
  assuranceLevel: "L2",
};
const fixture: Fixture = {
  id: fixtureId,
  tenantId,
  competitionId: "00000000-0000-4000-8000-000000000004",
  homeTeamId: "00000000-0000-4000-8000-000000000005",
  awayTeamId: "00000000-0000-4000-8000-000000000006",
  campusId: "00000000-0000-4000-8000-000000000007",
  startsAt: date,
  venue: "Main pitch",
  state: "scheduled",
  reason: null,
  version: 1,
  createdAt: date,
  updatedAt: date,
};

function createService() {
  const gateway: AuthorizedFixtureManagementGateway = {
    createFixture: vi.fn(async () => ({ ok: true as const, fixture })),
    updateFixture: vi.fn(async () => ({ ok: true as const, fixture })),
    postponeFixture: vi.fn(async () => ({ ok: true as const, fixture })),
    cancelFixture: vi.fn(async () => ({ ok: true as const, fixture })),
    completeFixture: vi.fn(async () => ({ ok: true as const, fixture })),
    abandonFixture: vi.fn(async () => ({ ok: true as const, fixture })),
  };
  const authorize = vi.fn(async () => ({ allowed: true as const }));
  return {
    service: new FixtureManagementService({
      capabilityAuthorizer: { authorize },
      gateway,
      fixtures: { listFixturesForTenant: vi.fn(async () => []) },
    }),
    gateway,
    authorize,
  };
}

describe("FixtureManagementService", () => {
  it("uses trusted Tenant scope, sport.manage, and narrow create input", async () => {
    const { service, gateway } = createService();
    await expect(
      service.createFixture({
        trustedContext: context,
        requestedTenantId: tenantId,
        fixture: {
          competitionId: fixture.competitionId,
          homeTeamId: fixture.homeTeamId,
          awayTeamId: fixture.awayTeamId,
          campusId: fixture.campusId,
          startsAt: date.toISOString(),
          venue: " Main pitch ",
        },
      }),
    ).resolves.toEqual({ outcome: "CREATED", fixture });
    expect(gateway.createFixture).toHaveBeenCalledWith(
      expect.objectContaining({ capability: "sport.manage" }),
      tenantId,
      expect.objectContaining({ venue: "Main pitch" }),
    );
  });

  it("rejects forged and cross-Tenant commands before authorization", async () => {
    const first = createService();
    await expect(
      first.service.createFixture({
        trustedContext: context,
        requestedTenantId: tenantId,
        fixture: { ...fixture, tenantId },
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(first.authorize).not.toHaveBeenCalled();

    const second = createService();
    await expect(
      second.service.createFixture({
        trustedContext: context,
        requestedTenantId: "00000000-0000-4000-8000-000000000099",
        fixture: {},
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(second.authorize).not.toHaveBeenCalled();
  });

  it("requires the expected version for transitions", async () => {
    const { service, gateway } = createService();
    await expect(
      service.cancelFixture({
        trustedContext: context,
        requestedTenantId: tenantId,
        fixtureId,
        transition: { expectedVersion: 1, reason: "Weather" },
      }),
    ).resolves.toEqual({ outcome: "CANCELLED", fixture });
    expect(gateway.cancelFixture).toHaveBeenCalled();
    await expect(
      service.completeFixture({
        trustedContext: context,
        requestedTenantId: tenantId,
        fixtureId,
        transition: {},
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  });
});
