import { describe, expect, it, vi } from "vitest";

import {
  CampusHomeService,
  type CampusHomeRequest,
} from "./campus-home";
import { ListPublicationsService } from "./list-publications";
import { ReadPublicationService } from "./read-publication";
import type { Publication } from "@/domain/content/publication";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { PublicationCollectionQuery } from "@/domain/content/publication-collection";

const tenantAId = "00000000-0000-4000-8000-000000000001";
const tenantBId = "00000000-0000-4000-8000-000000000002";
const membershipAId = "00000000-0000-4000-8000-000000000011";
const publicationAId = "00000000-0000-4000-8000-000000000021";
const publicationBId = "00000000-0000-4000-8000-000000000022";
const now = new Date("2026-01-15T12:00:00.000Z");

const tenantFactsA = {
  tenantId: tenantAId,
  tenantStatus: "active" as const,
  publicSurfacePermitted: true,
  onLeaveReadEnabled: true,
  alumniPublicReadEnabled: true,
};

const contextA: TrustedRequestContext = {
  identitySubjectId: "identity-a",
  tenantId: tenantAId,
  tenantStatus: "active",
  membershipId: membershipAId,
  assuranceLevel: "L2",
  membershipStatus: "verified",
};

const homeRequest: CampusHomeRequest = {
  context: contextA,
  tenantFacts: tenantFactsA,
  tenantDisplayName: "Campus A",
  tenantTimezone: "Africa/Kampala",
};

function publication(
  overrides: Partial<Publication> = {},
): Publication {
  return {
    id: publicationAId,
    tenantId: tenantAId,
    version: 1,
    type: "news",
    title: "Campus update",
    body: "A useful campus update.",
    priority: "standard",
    visibility: "PUBLIC",
    lifecycle: "published",
    audienceMode: "entire_tenant",
    authorOfficeLabel: "Communications",
    publishAt: new Date("2026-01-10T12:00:00.000Z"),
    expiresAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function createService(
  candidates: readonly Publication[],
  audienceById: ReadonlyMap<string, boolean> = new Map(),
) {
  const listCalls: Array<Readonly<{ tenantId: string; cursor: unknown }>> = [];
  const readCalls: Array<Readonly<{ tenantId: string; publicationId: string }>> = [];
  const publications = {
    listPublicationCandidatesForTenant: vi.fn(async (query: PublicationCollectionQuery) => {
      listCalls.push({ tenantId: query.tenantId, cursor: query.cursor });
      return { items: [...candidates], hasMoreCandidateRows: false };
    }),
    findPublicationByIdForTenant: vi.fn(async (tenantId: string, id: string) => {
      readCalls.push({ tenantId, publicationId: id });
      return candidates.find(
        (candidate) => candidate.tenantId === tenantId && candidate.id === id,
      ) ?? null;
    }),
  };
  const exposureResolver = {
    resolveExposure: (items: readonly Publication[]) =>
      new Map(items.map((item) => [item.id, "READABLE" as const])),
  };
  const audienceBatchResolver = {
    resolveAudienceBatch: ({ publications: items }: { publications: readonly Publication[] }) =>
      new Map(
        items.map((item) => [
          item.id,
          { evaluated: true as const, eligible: audienceById.get(item.id) ?? false },
        ]),
      ),
  };
  const audienceResolver = {
    resolveAudience: ({ publication: item }: { publication: Publication }) => ({
      evaluated: true as const,
      eligible: audienceById.get(item.id) ?? false,
    }),
  };

  const list = new ListPublicationsService({
    publications,
    exposureResolver,
    audienceBatchResolver,
  });
  const read = new ReadPublicationService({
    publications,
    exposureResolver,
    audienceResolver,
  });
  return {
    home: new CampusHomeService({
      listPublications: list,
      readPublication: read,
    }),
    listCalls,
    readCalls,
    publications,
  };
}

describe("CampusHomeService", () => {
  it("uses the trusted Tenant when listing and never exposes a foreign Publication", async () => {
    const local = publication({ title: "Local" });
    const foreign = publication({
      id: publicationBId,
      tenantId: tenantBId,
      title: "Foreign",
    });
    const { home, listCalls } = createService([foreign, local]);

    const result = await home.getFeed({ ...homeRequest, now });

    expect(result).toMatchObject({
      outcome: "READY",
      items: [expect.objectContaining({ title: "Local" })],
    });
    expect(result).not.toEqual(
      expect.objectContaining({ items: expect.arrayContaining([expect.objectContaining({ title: "Foreign" })]) }),
    );
    expect(listCalls[0]?.tenantId).toBe(tenantAId);
  });

  it("keeps visibility-hidden and targeted-ineligible Publications out of the feed", async () => {
    const hidden = publication({
      id: "00000000-0000-4000-8000-000000000023",
      visibility: "VERIFIED_MEMBERS",
      title: "Assurance hidden",
    });
    const ineligible = publication({
      id: "00000000-0000-4000-8000-000000000024",
      audienceMode: "targeted",
      title: "Targeted hidden",
    });
    const eligible = publication({
      id: "00000000-0000-4000-8000-000000000025",
      audienceMode: "targeted",
      title: "Targeted eligible",
    });
    const { home } = createService(
      [hidden, ineligible, eligible],
      new Map([[eligible.id, true]]),
    );

    const result = await home.getFeed({
      ...homeRequest,
      context: { ...contextA, assuranceLevel: "L1" },
      now,
    });

    expect(result).toMatchObject({
      outcome: "READY",
      items: [expect.objectContaining({ title: "Targeted eligible" })],
    });
  });

  it("allows an entire-Tenant Publication and preserves only a narrow authorized DTO", async () => {
    const { home } = createService([
      publication({ type: "notice", priority: "priority" }),
    ]);

    const result = await home.getFeed({ ...homeRequest, now });

    expect(result).toMatchObject({
      outcome: "READY",
      items: [
        {
          id: publicationAId,
          type: "notice",
          priority: "priority",
          title: "Campus update",
          authorOfficeLabel: "Communications",
        },
      ],
    });
    if (result.outcome === "READY") {
      expect(Object.keys(result.items[0] ?? {}).sort()).toEqual([
        "authorOfficeLabel",
        "excerpt",
        "id",
        "priority",
        "publishedAt",
        "publishedAtLabel",
        "title",
        "type",
      ]);
    }
  });

  it.each([
    ["L0", "PUBLIC", true],
    ["L0", "MEMBERS", false],
    ["L1", "MEMBERS", true],
    ["L1", "VERIFIED_MEMBERS", false],
    ["L2", "VERIFIED_MEMBERS", true],
  ] as const)("matches canonical %s/%s assurance policy", async (assuranceLevel, visibility, visible) => {
    const context: TrustedRequestContext = {
      ...contextA,
      assuranceLevel,
      membershipStatus: assuranceLevel === "L0" ? "unverified" : "verified",
    };
    const { home } = createService([publication({ visibility })]);

    const result = await home.getFeed({
      ...homeRequest,
      context,
      now,
    });

    expect(result).toMatchObject({
      outcome: "READY",
      items: visible ? [expect.anything()] : [],
    });
  });

  it("does not allow a cursor to change Tenant scope and keeps pagination server-authorized", async () => {
    const foreignCursor = Buffer.from(
      JSON.stringify({
        v: 1,
        publishAt: "2026-01-10T12:00:00.000Z",
        id: publicationBId,
      }),
      "utf8",
    ).toString("base64url");
    const { home, listCalls } = createService([publication()]);

    const result = await home.getFeed({
      ...homeRequest,
      cursor: foreignCursor,
      now,
    });

    expect(result.outcome).toBe("READY");
    expect(listCalls[0]).toMatchObject({ tenantId: tenantAId });
    expect(listCalls[0]?.cursor).toBeTruthy();
  });

  it("normalizes denied direct reads to safe not-found and rebinds the exact Tenant", async () => {
    const hidden = publication({ visibility: "VERIFIED_MEMBERS" });
    const { home, readCalls } = createService([hidden]);
    const lowAssuranceContext = {
      ...contextA,
      assuranceLevel: "L1" as const,
    };

    const result = await home.getDetail({
      ...homeRequest,
      context: lowAssuranceContext,
      publicationId: hidden.id,
      now,
    });

    expect(result).toEqual({ outcome: "NOT_FOUND" });
    expect(readCalls).toEqual([{ tenantId: tenantAId, publicationId: hidden.id }]);
  });

  it("returns a next cursor without exposing hidden-row counts", async () => {
    const first = publication({ title: "First" });
    const hidden = publication({
      id: "00000000-0000-4000-8000-000000000026",
      title: "Hidden",
      visibility: "VERIFIED_MEMBERS",
    });
    const { home } = createService([hidden, first]);

    const result = await home.getFeed({
      ...homeRequest,
      context: { ...contextA, assuranceLevel: "L1" },
      now,
      limit: 1,
    });

    expect(result).toMatchObject({
      outcome: "READY",
      items: [expect.objectContaining({ title: "First" })],
    });
    if (result.outcome === "READY") {
      expect(result.items).toHaveLength(1);
      expect(result.nextCursor).toBeNull();
    }
  });

  it("keeps the next page on the same authorized Tenant boundary", async () => {
    const first = publication({ title: "First page" });
    const second = publication({
      id: publicationBId,
      title: "Second page",
      publishAt: new Date("2026-01-09T12:00:00.000Z"),
    });
    let calls = 0;
    const observedQueries: PublicationCollectionQuery[] = [];
    const publications = {
      listPublicationCandidatesForTenant: vi.fn(
        async (query: PublicationCollectionQuery) => {
          calls += 1;
          observedQueries.push(query);
          return calls === 1
            ? { items: [first], hasMoreCandidateRows: true }
            : { items: [second], hasMoreCandidateRows: false };
        },
      ),
    };
    const exposureResolver = {
      resolveExposure: (items: readonly Publication[]) =>
        new Map(items.map((item) => [item.id, "READABLE" as const])),
    };
    const list = new ListPublicationsService({
      publications,
      exposureResolver,
    });
    const home = new CampusHomeService({
      listPublications: list,
      readPublication: {
        getPublicationForRead: async () => ({ outcome: "NOT_FOUND" as const }),
      },
    });

    const firstResult = await home.getFeed({ ...homeRequest, now, limit: 1 });
    expect(firstResult).toMatchObject({
      outcome: "READY",
      items: [expect.objectContaining({ title: "First page" })],
    });
    if (firstResult.outcome !== "READY" || firstResult.nextCursor === null) {
      throw new Error("Expected an authorized next-page cursor");
    }

    const secondResult = await home.getFeed({
      ...homeRequest,
      cursor: firstResult.nextCursor,
      now,
      limit: 1,
    });
    expect(secondResult).toMatchObject({
      outcome: "READY",
      items: [expect.objectContaining({ title: "Second page" })],
    });
    expect(publications.listPublicationCandidatesForTenant).toHaveBeenCalledTimes(2);
    expect(publications.listPublicationCandidatesForTenant.mock.calls).toHaveLength(2);
    expect(observedQueries.every((query) => query.tenantId === tenantAId)).toBe(true);
  });

  it("fails closed when trusted facts are forged or inconsistent", async () => {
    const { home, publications } = createService([publication()]);

    const result = await home.getFeed({
      ...homeRequest,
      tenantFacts: { ...tenantFactsA, tenantId: tenantBId },
      now,
    });

    expect(result).toEqual({ outcome: "UNAVAILABLE" });
    expect(publications.listPublicationCandidatesForTenant).not.toHaveBeenCalled();
  });
});
