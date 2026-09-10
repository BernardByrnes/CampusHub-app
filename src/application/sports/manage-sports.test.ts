import { describe, expect, it, vi } from "vitest";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type {
  CapabilityAuthorizationRequest,
  CapabilityAuthorizer,
} from "@/domain/authorization/capability-authorization";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { Competition, Sport, Team } from "@/domain/sports/sports";

import {
  SportsManagementService,
  type AuthorizedSportsManagementGateway,
  type SportsManagementServiceDependencies,
} from "./manage-sports";

const tenantAId = "00000000-0000-4000-8000-000000000001";
const tenantBId = "00000000-0000-4000-8000-000000000002";
const membershipId = "00000000-0000-4000-8000-000000000003";
const sportId = "00000000-0000-4000-8000-000000000004";
const competitionId = "00000000-0000-4000-8000-000000000005";
const teamId = "00000000-0000-4000-8000-000000000006";
const campusId = "00000000-0000-4000-8000-000000000007";
const date = new Date("2026-01-01T00:00:00.000Z");

const trustedContext: TrustedRequestContext = {
  identitySubjectId: "identity-a",
  tenantId: tenantAId,
  membershipId,
  tenantStatus: "active",
  membershipStatus: "verified",
  assuranceLevel: "L2",
};

const sport: Sport = {
  id: sportId,
  tenantId: tenantAId,
  name: "Football",
  status: "active",
  version: 1,
  createdAt: date,
  updatedAt: date,
};

const competition: Competition = {
  id: competitionId,
  tenantId: tenantAId,
  sportId,
  name: "Campus League",
  seasonLabel: "2026",
  campusId,
  tableMode: "none",
  status: "active",
  version: 1,
  createdAt: date,
  updatedAt: date,
};

const team: Team = {
  id: teamId,
  tenantId: tenantAId,
  sportId,
  name: "Campus United",
  affiliationLabel: null,
  status: "active",
  version: 1,
  createdAt: date,
  updatedAt: date,
};

function command<T extends Record<string, unknown>>(
  value: T,
): T & { trustedContext: TrustedRequestContext; requestedTenantId: string } {
  return {
    trustedContext,
    requestedTenantId: tenantAId,
    ...value,
  };
}

function createService(
  overrides: Partial<{
    authorize: CapabilityAuthorizer["authorize"];
    gateway: AuthorizedSportsManagementGateway;
  }> = {},
) {
  const authorize = vi.fn<CapabilityAuthorizer["authorize"]>(
    overrides.authorize ?? (async () => ({ allowed: true })),
  );
  const gateway = overrides.gateway ?? ({
    createSport: vi.fn(async () => ({ ok: true, sport })),
    updateSport: vi.fn(async () => ({ ok: true, sport })),
    deactivateSport: vi.fn(async () => ({ ok: true, sport: { ...sport, status: "inactive" } })),
    createCompetition: vi.fn(async () => ({ ok: true, competition })),
    updateCompetition: vi.fn(async () => ({ ok: true, competition })),
    deactivateCompetition: vi.fn(async () => ({ ok: true, competition: { ...competition, status: "inactive" } })),
    createTeam: vi.fn(async () => ({ ok: true, team })),
    updateTeam: vi.fn(async () => ({ ok: true, team })),
    deactivateTeam: vi.fn(async () => ({ ok: true, team: { ...team, status: "inactive" } })),
  } as unknown as AuthorizedSportsManagementGateway);
  const dependencies: SportsManagementServiceDependencies = {
    capabilityAuthorizer: { authorize },
    gateway,
    sports: {
      listSportsForTenant: vi.fn(async () => [sport]),
    },
    competitions: {
      listCompetitionsForTenant: vi.fn(async () => [competition]),
    },
    teams: {
      listTeamsForTenant: vi.fn(async () => [team]),
    },
  };
  return {
    service: new SportsManagementService(dependencies),
    authorize,
    gateway,
  };
}

describe("SportsManagementService", () => {
  it("uses the distinct sports module and sport.manage capability", async () => {
    const { service, authorize, gateway } = createService();

    await expect(
      service.createSport(command({ sport: { name: " Football " } })),
    ).resolves.toEqual({ outcome: "CREATED", sport });
    expect(authorize).toHaveBeenCalledWith({
      actor: {
        identitySubjectId: "identity-a",
        tenantId: tenantAId,
        membershipId,
      },
      context: {
        tenantStatus: "active",
        membershipStatus: "verified",
        assuranceLevel: "L2",
      },
      capability: CAPABILITIES.SPORT_MANAGE,
      scope: {
        tenantId: tenantAId,
        module: "sports",
        resource: "sport",
      },
    } satisfies CapabilityAuthorizationRequest);
    expect(gateway.createSport).toHaveBeenCalledWith(
      expect.anything(),
      tenantAId,
      { name: "Football" },
    );
  });

  it("rejects forged or cross-Tenant commands before authorization or mutation", async () => {
    const first = createService();
    await expect(
      first.service.createSport(
        command({ sport: { name: "Football", tenantId: tenantAId } }),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(first.authorize).not.toHaveBeenCalled();

    const second = createService();
    await expect(
      second.service.createSport({
        trustedContext,
        requestedTenantId: tenantBId,
        sport: { name: "Football" },
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(second.authorize).not.toHaveBeenCalled();
    expect(second.gateway.createSport).not.toHaveBeenCalled();
  });

  it("fails closed when sport.manage authorization is denied or malformed", async () => {
    const denied = createService({
      authorize: vi.fn(async () => ({ allowed: false })),
    });
    await expect(
      denied.service.createTeam(
        command({
          team: { sportId, name: "Campus United", affiliationLabel: null },
        }),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });
    expect(denied.gateway.createTeam).not.toHaveBeenCalled();

    const malformed = createService({
      authorize: vi.fn(async () => null) as never,
    });
    await expect(
      malformed.service.listSports(command({ limit: 101 })),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(malformed.authorize).not.toHaveBeenCalled();
  });

  it("parses and bounds competition/team commands and uses expected versions", async () => {
    const { service, gateway } = createService();

    await expect(
      service.createCompetition(
        command({
          competition: {
            sportId,
            name: "League",
            seasonLabel: "2026",
            campusId,
            tableMode: "none",
          },
        }),
      ),
    ).resolves.toEqual({ outcome: "CREATED", competition });
    await expect(
      service.editTeam(
        command({
          teamId,
          edit: {
            expectedVersion: 1,
            sportId,
            name: "Campus United",
            affiliationLabel: null,
          },
        }),
      ),
    ).resolves.toEqual({ outcome: "UPDATED", team });
    expect(gateway.updateTeam).toHaveBeenCalledWith(
      expect.anything(),
      tenantAId,
      teamId,
      { expectedVersion: 1, sportId, name: "Campus United", affiliationLabel: null },
    );
  });

  it("rejects invalid affiliation labels instead of converting them to null", async () => {
    const { service, gateway } = createService();

    await expect(
      service.createTeam(
        command({
          team: { sportId, name: "Campus United", affiliationLabel: " " },
        }),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    await expect(
      service.editTeam(
        command({
          teamId,
          edit: {
            expectedVersion: 1,
            sportId,
            name: "Campus United",
            affiliationLabel: "x".repeat(161),
          },
        }),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(gateway.createTeam).not.toHaveBeenCalled();
    expect(gateway.updateTeam).not.toHaveBeenCalled();
  });

  it("lists only through the explicitly Tenant-scoped repository seam", async () => {
    const { service } = createService();

    await expect(
      service.listTeams(command({ status: "active", sportId, limit: 10 })),
    ).resolves.toEqual({ outcome: "LISTED", resource: "teams", items: [team] });
  });
});
