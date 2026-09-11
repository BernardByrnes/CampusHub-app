import { describe, expect, it, vi } from "vitest";

import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { Result, ResultRevision } from "@/domain/sports/results";
import type {
  ManagedResultListItem,
  ResultHistoryReadResult,
} from "@/server/repositories/result-repository";

import {
  ResultManagementService,
  type AuthorizedResultManagementGateway,
} from "./manage-results";

const tenantId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";
const fixtureId = "00000000-0000-4000-8000-000000000003";
const resultId = "00000000-0000-4000-8000-000000000004";
const date = new Date("2026-09-10T12:00:00.000Z");
const context: TrustedRequestContext = {
  identitySubjectId: "identity-a",
  tenantId,
  membershipId,
  tenantStatus: "active",
  membershipStatus: "verified",
  assuranceLevel: "L2",
};
const draft: Result = {
  id: resultId,
  tenantId,
  fixtureId,
  lifecycle: "draft",
  draftHomeScore: 2,
  draftAwayScore: 1,
  currentRevisionNumber: null,
  version: 1,
  createdAt: date,
  updatedAt: date,
};
const revision: ResultRevision = {
  id: "00000000-0000-4000-8000-000000000005",
  tenantId,
  resultId,
  revisionNumber: 1,
  homeScore: 2,
  awayScore: 1,
  actorMembershipId: membershipId,
  correctionReason: null,
  createdAt: date,
};

function createService() {
  const gateway: AuthorizedResultManagementGateway = {
    createResult: vi.fn(async () => ({ ok: true as const, result: draft })),
    updateResultDraft: vi.fn(async () => ({ ok: true as const, result: draft })),
    publishResult: vi.fn(async () => ({ ok: true as const, result: { ...draft, lifecycle: "published" as const, version: 2 }, revision })),
    correctResult: vi.fn(async () => ({ ok: true as const, result: { ...draft, lifecycle: "published" as const, version: 3, currentRevisionNumber: 2 }, revision: { ...revision, revisionNumber: 2, correctionReason: "Official correction" } })),
  };
  const authorize = vi.fn(async () => ({ allowed: true as const }));
  const listManagedResultsForTenant = vi.fn(
    async (): Promise<readonly ManagedResultListItem[]> => [],
  );
  const listResultRevisionsForTenant = vi.fn(
    async (): Promise<ResultHistoryReadResult> => ({ ok: true, items: [] }),
  );
  return {
    service: new ResultManagementService({
      capabilityAuthorizer: { authorize },
      gateway,
      results: {
        listManagedResultsForTenant,
        listResultRevisionsForTenant,
      },
    }),
    gateway,
    authorize,
    listManagedResultsForTenant,
    listResultRevisionsForTenant,
  };
}

describe("ResultManagementService", () => {
  it("uses sport.manage and narrow inputs for the Result lifecycle", async () => {
    const { service, gateway } = createService();
    await expect(
      service.createDraftResult({
        trustedContext: context,
        requestedTenantId: tenantId,
        result: { fixtureId, homeScore: 2, awayScore: 1 },
      }),
    ).resolves.toEqual({ outcome: "CREATED", result: draft });
    await expect(
      service.publishResult({
        trustedContext: context,
        requestedTenantId: tenantId,
        resultId,
        expectedVersion: 1,
      }),
    ).resolves.toMatchObject({ outcome: "PUBLISHED", revision: { revisionNumber: 1 } });
    await expect(
      service.correctPublishedResult({
        trustedContext: context,
        requestedTenantId: tenantId,
        resultId,
        correction: { expectedVersion: 2, homeScore: 3, awayScore: 1, reason: "Official correction" },
      }),
    ).resolves.toMatchObject({ outcome: "CORRECTED", revision: { revisionNumber: 2 } });
    expect(gateway.createResult).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "sport.manage",
        scope: expect.objectContaining({ resource: "result" }),
      }),
      tenantId,
      expect.objectContaining({ fixtureId, homeScore: 2, awayScore: 1 }),
    );
    expect(gateway.publishResult).toHaveBeenCalled();
    expect(gateway.correctResult).toHaveBeenCalled();
  });

  it("rejects forged, cross-Tenant, malformed, and blank-reason commands before authority", async () => {
    const first = createService();
    await expect(
      first.service.createDraftResult({
        trustedContext: context,
        requestedTenantId: tenantId,
        result: { fixtureId, homeScore: 1, awayScore: 0, tenantId },
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(first.authorize).not.toHaveBeenCalled();

    const second = createService();
    await expect(
      second.service.publishResult({
        trustedContext: context,
        requestedTenantId: "00000000-0000-4000-8000-000000000099",
        resultId,
        expectedVersion: 1,
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(second.authorize).not.toHaveBeenCalled();

    const third = createService();
    await expect(
      third.service.correctPublishedResult({
        trustedContext: context,
        requestedTenantId: tenantId,
        resultId,
        correction: { expectedVersion: 2, homeScore: 3, awayScore: 1, reason: "   " },
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(third.authorize).not.toHaveBeenCalled();
  });

  it("rejects unreviewed management filters instead of silently widening reads", async () => {
    const { service, authorize, listManagedResultsForTenant } = createService();
    await expect(
      service.listResults({
        trustedContext: context,
        requestedTenantId: tenantId,
        filters: { unknown: "value" },
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(authorize).toHaveBeenCalledTimes(1);

    await expect(
      service.listResults({
        trustedContext: context,
        requestedTenantId: tenantId,
      }),
    ).resolves.toEqual({ outcome: "LISTED", items: [] });
    expect(listManagedResultsForTenant).toHaveBeenCalledWith(tenantId, {});
  });

  it("maps missing or unpublished history to NOT_FOUND", async () => {
    const { service, listResultRevisionsForTenant } = createService();
    listResultRevisionsForTenant.mockResolvedValueOnce({ ok: false, error: "NOT_FOUND" });
    await expect(
      service.inspectResultHistory({
        trustedContext: context,
        requestedTenantId: tenantId,
        resultId,
        limit: 50,
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "NOT_FOUND" });
  });
});
