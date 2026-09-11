import { describe, expect, it, vi } from "vitest";

import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { ResultListItem } from "@/server/repositories/result-repository";

import { ListResultsService } from "./list-results";

const tenantId = "00000000-0000-4000-8000-000000000001";
const context: TrustedRequestContext = {
  identitySubjectId: "identity-a",
  tenantId,
  membershipId: "00000000-0000-4000-8000-000000000002",
  tenantStatus: "active",
  membershipStatus: "verified",
  assuranceLevel: "L2",
};
const date = new Date("2026-09-10T12:00:00.000Z");
const item: ResultListItem = {
  result: {
    id: "00000000-0000-4000-8000-000000000003",
    tenantId,
    fixtureId: "00000000-0000-4000-8000-000000000004",
    lifecycle: "published",
    draftHomeScore: null,
    draftAwayScore: null,
    currentRevisionNumber: 1,
    version: 2,
    createdAt: date,
    updatedAt: date,
  },
  revision: {
    id: "00000000-0000-4000-8000-000000000005",
    tenantId,
    resultId: "00000000-0000-4000-8000-000000000003",
    revisionNumber: 1,
    homeScore: 0,
    awayScore: 0,
    actorMembershipId: "00000000-0000-4000-8000-000000000002",
    correctionReason: null,
    createdAt: date,
  },
  sportName: "Football",
  competitionName: "Campus League",
  homeTeamName: "Home",
  awayTeamName: "Away",
  campusLabel: "Main Campus",
  startsAt: date,
  venue: "Main pitch",
};

describe("ListResultsService", () => {
  it("reads published results with normalized bounded filters and redacts actor identity", async () => {
    const listPublishedResultsForTenant = vi.fn(async () => [item]);
    const service = new ListResultsService({
      results: {
        listPublishedResultsForTenant,
        listResultRevisionsForTenant: vi.fn(async () => ({ ok: true as const, items: [item.revision] })),
      },
    });
    await expect(
      service.listResults({
        trustedContext: context,
        requestedTenantId: tenantId,
        filters: { sportName: " Football ", teamName: "  " },
      }),
    ).resolves.toMatchObject({ outcome: "READY", items: [{ resultId: item.result.id, homeScore: 0, awayScore: 0, venue: "Main pitch" }] });
    expect(listPublishedResultsForTenant).toHaveBeenCalledWith(tenantId, {
      sportName: "Football",
      competitionName: undefined,
      teamName: undefined,
      fixtureId: undefined,
      limit: 50,
    });
    const readResult = await service.listResults({ trustedContext: context, requestedTenantId: tenantId });
    expect(JSON.stringify(readResult)).not.toContain(item.revision.actorMembershipId);
  });

  it("does not call the repository for a wrong Tenant or unbounded filters", async () => {
    const listPublishedResultsForTenant = vi.fn(async () => [item]);
    const listResultRevisionsForTenant = vi.fn(async () => ({ ok: true as const, items: [item.revision] }));
    const service = new ListResultsService({ results: { listPublishedResultsForTenant, listResultRevisionsForTenant } });
    await expect(service.listResults({ trustedContext: context, requestedTenantId: "00000000-0000-4000-8000-000000000099", filters: {} })).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    await expect(service.listResults({ trustedContext: context, requestedTenantId: tenantId, filters: { limit: 101 } })).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    await expect(service.listCorrectionHistory({ trustedContext: context, requestedTenantId: tenantId, resultId: item.result.id, limit: 50 })).resolves.toMatchObject({ outcome: "HISTORY", items: [{ revisionNumber: 1 }] });
    expect(listPublishedResultsForTenant).toHaveBeenCalledTimes(0);
    expect(listResultRevisionsForTenant).toHaveBeenCalledTimes(1);
  });

  it("maps an unpublished or missing history to NOT_FOUND", async () => {
    const service = new ListResultsService({
      results: {
        listPublishedResultsForTenant: vi.fn(async () => []),
        listResultRevisionsForTenant: vi.fn(async () => ({ ok: false as const, error: "NOT_FOUND" as const })),
      },
    });
    await expect(
      service.listCorrectionHistory({
        trustedContext: context,
        requestedTenantId: tenantId,
        resultId: item.result.id,
        limit: 50,
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "NOT_FOUND" });
  });
});
