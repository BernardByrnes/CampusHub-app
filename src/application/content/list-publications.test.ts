import { describe, expect, it, vi } from "vitest";

import type {
  PublicationAudienceDecision,
  ResolvedTenantReadFacts,
} from "@/domain/authorization/publication-read-contract";
import type { ResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import type { Publication } from "@/domain/content/publication";
import {
  decodePublicationCursor,
  encodePublicationCursor,
  type PublicationCollectionCandidatePage,
  type PublicationCollectionQuery,
} from "@/domain/content/publication-collection";

import {
  ListPublicationsService,
  type ListPublicationsInput,
  type PublicationCollectionRepository,
  type PublicationExposureResolver,
} from "./list-publications";
import type { PublicationAudienceBatchResolver } from "./publication-read-resolvers";

const now = new Date("2026-01-15T12:00:00.000Z");
const tenantAlphaId = "00000000-0000-4000-8000-000000000001";
const tenantBetaId = "00000000-0000-4000-8000-000000000002";

const tenantFacts: ResolvedTenantReadFacts = {
  tenantId: tenantAlphaId,
  tenantStatus: "active",
  publicSurfacePermitted: true,
  onLeaveReadEnabled: true,
  alumniPublicReadEnabled: true,
};

const membershipViewer: ResourceReadViewer = {
  kind: "membership",
  context: {
    identitySubjectId: "identity-alpha",
    tenantId: tenantAlphaId,
    tenantStatus: "active",
    membershipId: "membership-alpha",
    assuranceLevel: "L1",
    membershipStatus: "verified",
  },
};

const anonymousViewer: ResourceReadViewer = {
  kind: "anonymous",
  tenantId: tenantAlphaId,
};

function publication(
  id: string,
  overrides: Partial<Publication> = {},
): Publication {
  return {
    id,
    tenantId: tenantAlphaId,
    version: 1,
    type: "news",
    title: `Publication ${id}`,
    body: "Publication body",
    priority: "standard",
    visibility: "MEMBERS",
    lifecycle: "published",
    audienceMode: "entire_tenant",
    authorOfficeLabel: "Guild Communications Office",
    publishAt: new Date("2026-01-10T12:00:00.000Z"),
    expiresAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function input(
  viewer: ResourceReadViewer = membershipViewer,
  overrides: Partial<ListPublicationsInput> = {},
): ListPublicationsInput {
  return {
    tenantId: tenantAlphaId,
    surface: "ACTIVE",
    viewer,
    tenantFacts,
    now,
    ...overrides,
  };
}

function createService(
  pages: PublicationCollectionCandidatePage[],
  exposureById: ReadonlyMap<string, "READABLE" | "SUPPRESSED"> = new Map(),
  queries: PublicationCollectionQuery[] = [],
  exposureCalls: Publication[][] = [],
  audienceBatchResolver?: PublicationAudienceBatchResolver,
) {
  const repository: PublicationCollectionRepository = {
    listPublicationCandidatesForTenant: vi.fn(async (query) => {
      queries.push(query);
      return pages.shift() ?? { items: [], hasMoreCandidateRows: false };
    }),
  };
  const exposureResolver: PublicationExposureResolver = {
    resolveExposure: vi.fn(
      async (
        candidates: readonly Publication[],
      ): Promise<ReadonlyMap<string, "READABLE" | "SUPPRESSED">> => {
        exposureCalls.push([...candidates]);
        return new Map<string, "READABLE" | "SUPPRESSED">(
          candidates.map((candidate) => [
            candidate.id,
            exposureById.get(candidate.id) ?? "READABLE",
          ]),
        );
      },
    ),
  };

  return {
    service: new ListPublicationsService({
      publications: repository,
      exposureResolver,
      audienceBatchResolver,
    }),
    repository,
    exposureResolver,
  };
}

describe("ListPublicationsService", () => {
  it("omits denied and suppressed candidates while preserving the trusted batch seam", async () => {
    const denied = publication("00000000-0000-4000-8000-000000000011", {
      visibility: "VERIFIED_MEMBERS",
    });
    const suppressed = publication("00000000-0000-4000-8000-000000000012", {
      visibility: "PUBLIC",
    });
    const allowed = publication("00000000-0000-4000-8000-000000000013", {
      visibility: "PUBLIC",
    });
    const exposureCalls: Publication[][] = [];
    const { service, exposureResolver } = createService(
      [{ items: [denied, suppressed, allowed], hasMoreCandidateRows: false }],
      new Map([[suppressed.id, "SUPPRESSED"]]),
      [],
      exposureCalls,
    );

    await expect(
      service.listPublications(input(anonymousViewer, { limit: 20 })),
    ).resolves.toEqual({
      outcome: "OK",
      items: [allowed],
      nextCursor: null,
    });
    expect(exposureResolver.resolveExposure).toHaveBeenCalledTimes(1);
    expect(exposureCalls).toEqual([[denied, suppressed, allowed]]);
  });

  it("uses the last scanned candidate as the next cursor after a bounded page", async () => {
    const first = publication("00000000-0000-4000-8000-000000000021", {
      visibility: "PUBLIC",
    });
    const second = publication("00000000-0000-4000-8000-000000000022", {
      visibility: "PUBLIC",
    });
    const queries: PublicationCollectionQuery[] = [];
    const { service } = createService(
      [{ items: [first, second], hasMoreCandidateRows: true }],
      undefined,
      queries,
    );

    const result = await service.listPublications(
      input(anonymousViewer, { limit: 1 }),
    );

    expect(result.outcome).toBe("OK");
    if (result.outcome !== "OK") {
      return;
    }

    expect(result.items).toEqual([first]);
    expect(decodePublicationCursor(result.nextCursor)).toEqual({
      publishAt: first.publishAt,
      id: first.id,
    });
    expect(queries).toEqual([
      expect.objectContaining({
        tenantId: tenantAlphaId,
        surface: "ACTIVE",
        cursor: null,
        limit: 25,
      }),
    ]);
  });

  it("fails closed before PostgreSQL when the exposure resolver is absent", async () => {
    const repository = {
      listPublicationCandidatesForTenant: vi.fn(),
    };
    const service = new ListPublicationsService({ publications: repository });

    await expect(service.listPublications(input())).resolves.toEqual({
      outcome: "DENIED",
      code: "EXPOSURE_UNAVAILABLE",
    });
    expect(repository.listPublicationCandidatesForTenant).not.toHaveBeenCalled();
  });

  it("rejects malformed cursors before PostgreSQL", async () => {
    const { service, repository } = createService([]);

    await expect(
      service.listPublications(input(membershipViewer, { cursor: "garbage" })),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_CURSOR" });
    expect(repository.listPublicationCandidatesForTenant).not.toHaveBeenCalled();
  });

  it("returns an empty collection without querying for a foreign Tenant viewer", async () => {
    const { service, repository } = createService([]);
    const foreignViewer: ResourceReadViewer = {
      kind: "anonymous",
      tenantId: tenantBetaId,
    };

    await expect(service.listPublications(input(foreignViewer))).resolves.toEqual({
      outcome: "OK",
      items: [],
      nextCursor: null,
    });
    expect(repository.listPublicationCandidatesForTenant).not.toHaveBeenCalled();
  });

  it("rejects malformed trusted facts before PostgreSQL", async () => {
    const { service, repository } = createService([]);

    await expect(
      service.listPublications(
        input(membershipViewer, {
          tenantFacts: { ...tenantFacts, tenantId: tenantBetaId },
        }),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(repository.listPublicationCandidatesForTenant).not.toHaveBeenCalled();
  });

  it("keeps a cursor from another Tenant inside the requested Tenant scope", async () => {
    const foreignCursorPublishAt = new Date("2026-01-09T12:00:00.000Z");
    const foreignCursorPublication = publication(
      "00000000-0000-4000-8000-000000000301",
      {
        tenantId: tenantBetaId,
        publishAt: foreignCursorPublishAt,
      },
    );
    const foreignCandidate = publication(
      "00000000-0000-4000-8000-000000000302",
      { tenantId: tenantBetaId },
    );
    const queries: PublicationCollectionQuery[] = [];
    const { service } = createService(
      [{ items: [foreignCandidate], hasMoreCandidateRows: false }],
      undefined,
      queries,
    );
    const cursor = encodePublicationCursor({
      publishAt: foreignCursorPublishAt,
      id: foreignCursorPublication.id,
    });

    await expect(
      service.listPublications(input(anonymousViewer, { cursor })),
    ).resolves.toEqual({ outcome: "OK", items: [], nextCursor: null });
    expect(queries[0]).toMatchObject({
      tenantId: tenantAlphaId,
      cursor: {
        publishAt: foreignCursorPublishAt,
        id: foreignCursorPublication.id,
      },
    });
  });

  it("stops after the 150-candidate scan budget", async () => {
    const pages: PublicationCollectionCandidatePage[] = Array.from(
      { length: 6 },
      (_, page) => ({
        items: Array.from({ length: 25 }, (_, index) =>
          publication(
            `00000000-0000-4000-8000-${String(page * 25 + index + 100)
              .padStart(12, "0")}`,
            { visibility: "VERIFIED_MEMBERS" },
          ),
        ),
        hasMoreCandidateRows: true,
      }),
    );
    const queries: PublicationCollectionQuery[] = [];
    const exposureCalls: Publication[][] = [];
    const { service } = createService(
      pages,
      undefined,
      queries,
      exposureCalls,
    );

    const result = await service.listPublications(
      input(anonymousViewer, { limit: 1 }),
    );
    expect(result).toMatchObject({ outcome: "OK", items: [] });
    if (result.outcome !== "OK") {
      return;
    }

    expect(queries).toHaveLength(6);
    expect(exposureCalls.flat()).toHaveLength(150);
    expect(result.nextCursor).not.toBeNull();
    expect(decodePublicationCursor(result.nextCursor)).not.toBeNull();
  });

  it("uses bounded candidate batches for larger page sizes", async () => {
    const first = publication("00000000-0000-4000-8000-000000000201", {
      visibility: "PUBLIC",
    });
    const second = publication("00000000-0000-4000-8000-000000000202", {
      visibility: "PUBLIC",
    });

    const queries20: PublicationCollectionQuery[] = [];
    const twenty = createService(
      [{ items: [first], hasMoreCandidateRows: false }],
      undefined,
      queries20,
    );
    await twenty.service.listPublications(input(anonymousViewer, { limit: 20 }));

    const queries50: PublicationCollectionQuery[] = [];
    const fifty = createService(
      [{ items: [second], hasMoreCandidateRows: false }],
      undefined,
      queries50,
    );
    await fifty.service.listPublications(input(anonymousViewer, { limit: 50 }));

    expect(queries20[0]?.limit).toBe(60);
    expect(queries50[0]?.limit).toBe(150);
  });

  it("includes eligible targeted candidates while preserving mixed ordering", async () => {
    const entire = publication("00000000-0000-4000-8000-000000000401", {
      visibility: "PUBLIC",
    });
    const targetedEligible = publication(
      "00000000-0000-4000-8000-000000000402",
      { audienceMode: "targeted" },
    );
    const targetedIneligible = publication(
      "00000000-0000-4000-8000-000000000403",
      { audienceMode: "targeted" },
    );
    const resolver: PublicationAudienceBatchResolver = {
      resolveAudienceBatch: vi.fn(
        async ({ publications }: { publications: readonly Publication[] }): Promise<
          ReadonlyMap<string, PublicationAudienceDecision>
        > =>
          new Map<string, PublicationAudienceDecision>(
            publications.map((candidate) => [
              candidate.id,
              {
                evaluated: true as const,
                eligible: candidate.id === targetedEligible.id,
              },
            ]),
          ),
      ),
    };
    const { service } = createService(
      [{
        items: [entire, targetedEligible, targetedIneligible],
        hasMoreCandidateRows: false,
      }],
      new Map(),
      [],
      [],
      resolver,
    );

    await expect(
      service.listPublications(input(membershipViewer, { limit: 10 })),
    ).resolves.toEqual({
      outcome: "OK",
      items: [entire, targetedEligible],
      nextCursor: null,
    });
    expect(resolver.resolveAudienceBatch).toHaveBeenCalledTimes(1);
    expect(resolver.resolveAudienceBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: tenantAlphaId,
        publications: [targetedEligible, targetedIneligible],
        viewer: membershipViewer,
      }),
    );
  });

  it("does not send pre-audience-denied or entire-Tenant candidates to the audience batch", async () => {
    const deniedTargeted = publication("00000000-0000-4000-8000-000000000411", {
      audienceMode: "targeted",
      visibility: "VERIFIED_MEMBERS",
    });
    const allowedEntire = publication("00000000-0000-4000-8000-000000000412", {
      audienceMode: "entire_tenant",
      visibility: "PUBLIC",
    });
    const resolver: PublicationAudienceBatchResolver = {
      resolveAudienceBatch: vi.fn(
        async (): Promise<ReadonlyMap<string, PublicationAudienceDecision>> =>
          new Map(),
      ),
    };
    const { service } = createService(
      [{ items: [deniedTargeted, allowedEntire], hasMoreCandidateRows: false }],
      new Map(),
      [],
      [],
      resolver,
    );

    await expect(
      service.listPublications(input(anonymousViewer, { limit: 10 })),
    ).resolves.toEqual({
      outcome: "OK",
      items: [allowedEntire],
      nextCursor: null,
    });
    expect(resolver.resolveAudienceBatch).not.toHaveBeenCalled();
  });

  it("advances past hidden targeted candidates without duplicate or skipped visible rows", async () => {
    const candidates = [
      publication("00000000-0000-4000-8000-000000000421", {
        audienceMode: "targeted",
      }),
      publication("00000000-0000-4000-8000-000000000422", {
        audienceMode: "targeted",
      }),
      publication("00000000-0000-4000-8000-000000000423", {
        visibility: "PUBLIC",
      }),
      publication("00000000-0000-4000-8000-000000000424", {
        audienceMode: "targeted",
      }),
      publication("00000000-0000-4000-8000-000000000425", {
        visibility: "PUBLIC",
      }),
    ];
    const queries: PublicationCollectionQuery[] = [];
    const resolver: PublicationAudienceBatchResolver = {
      resolveAudienceBatch: vi.fn(
        async ({ publications }: { publications: readonly Publication[] }): Promise<
          ReadonlyMap<string, PublicationAudienceDecision>
        > =>
          new Map<string, PublicationAudienceDecision>(
            publications.map((candidate) => [
              candidate.id,
              {
                evaluated: true as const,
                eligible: candidate.id === candidates[3]?.id,
              },
            ]),
          ),
      ),
    };
    const repository: PublicationCollectionRepository = {
      listPublicationCandidatesForTenant: vi.fn(async (query) => {
        queries.push(query);
        const start =
          query.cursor === null
            ? 0
            : candidates.findIndex(
                (candidate) => candidate.id === query.cursor?.id,
              ) + 1;
        const items = candidates.slice(start, start + query.limit);
        return {
          items,
          hasMoreCandidateRows: start + items.length < candidates.length,
        };
      }),
    };
    const service = new ListPublicationsService({
      publications: repository,
      exposureResolver: {
        resolveExposure: (items) =>
          new Map(items.map((candidate) => [candidate.id, "READABLE" as const])),
      },
      audienceBatchResolver: resolver,
    });

    const firstPage = await service.listPublications(
      input(membershipViewer, { limit: 2 }),
    );
    expect(firstPage.outcome).toBe("OK");
    if (firstPage.outcome !== "OK" || firstPage.nextCursor === null) {
      throw new Error("Expected first-page cursor after hidden candidates.");
    }
    expect(firstPage.items).toEqual([candidates[2], candidates[3]]);
    expect(decodePublicationCursor(firstPage.nextCursor)).toEqual({
      publishAt: candidates[3]?.publishAt,
      id: candidates[3]?.id,
    });

    const secondPage = await service.listPublications(
      input(membershipViewer, { limit: 2, cursor: firstPage.nextCursor }),
    );
    expect(secondPage).toEqual({
      outcome: "OK",
      items: [candidates[4]],
      nextCursor: null,
    });
    expect(queries).toHaveLength(2);
    expect(new Set([...firstPage.items, ...(secondPage.outcome === "OK" ? secondPage.items : [])].map((item) => item.id)).size).toBe(3);
  });
});
