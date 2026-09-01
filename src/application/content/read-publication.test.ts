import { describe, expect, it, vi } from "vitest";

import type { ResolvedTenantReadFacts } from "@/domain/authorization/publication-read-contract";
import type { ResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import type { Publication } from "@/domain/content/publication";

import {
  ReadPublicationService,
  type ReadPublicationInput,
} from "./read-publication";

const now = new Date("2026-01-15T12:00:00.000Z");
const tenantAlphaId = "00000000-0000-4000-8000-000000000001";
const tenantBetaId = "00000000-0000-4000-8000-000000000002";
const publicationAlphaId = "00000000-0000-4000-8000-000000000011";
const missingPublicationId = "00000000-0000-4000-8000-000000000099";

const publication: Publication = {
  id: publicationAlphaId,
  tenantId: tenantAlphaId,
  type: "news",
  title: "Campus update",
  body: "The campus update body.",
  priority: "standard",
  visibility: "MEMBERS",
  lifecycle: "published",
  audienceMode: "entire_tenant",
  authorOfficeLabel: "Guild Communications Office",
  publishAt: new Date("2026-01-10T12:00:00.000Z"),
  expiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const tenantFacts: ResolvedTenantReadFacts = {
  tenantId: tenantAlphaId,
  tenantStatus: "active",
  publicSurfacePermitted: true,
  onLeaveReadEnabled: true,
  alumniPublicReadEnabled: true,
};

const viewer: ResourceReadViewer = {
  kind: "membership",
  context: {
    identitySubjectId: "identity-alpha",
    tenantId: tenantAlphaId,
    tenantStatus: "active",
    membershipId: "membership-alpha",
    assuranceLevel: "L2",
    membershipStatus: "verified",
  },
};

function input(overrides: Partial<ReadPublicationInput> = {}): ReadPublicationInput {
  return {
    tenantId: tenantAlphaId,
    publicationId: publication.id,
    viewer,
    tenantFacts,
    contentExposure: "READABLE",
    now,
    ...overrides,
  };
}

function createService(
  found: Publication | null = publication,
  calls: Array<readonly [string, string]> = [],
) {
  return new ReadPublicationService({
    publications: {
      findPublicationByIdForTenant: vi.fn(async (tenantId, publicationId) => {
        calls.push([tenantId, publicationId]);
        return found;
      }),
    },
  });
}

describe("ReadPublicationService", () => {
  it("scopes the repository lookup and returns the Publication only when policy allows", async () => {
    const calls: Array<readonly [string, string]> = [];
    const service = createService(publication, calls);

    await expect(service.getPublicationForRead(input())).resolves.toEqual({
      outcome: "FOUND",
      publication,
    });
    expect(calls).toEqual([[tenantAlphaId, publicationAlphaId]]);
  });

  it.each([
    [
      { lifecycle: "draft" },
      "RESOURCE_NOT_AVAILABLE",
    ],
    [
      { contentExposure: "SUPPRESSED" },
      "RESOURCE_NOT_AVAILABLE",
    ],
    [
      {
        viewer: {
          ...viewer,
          context: { ...viewer.context, assuranceLevel: "L0" },
        },
      },
      "ASSURANCE_INSUFFICIENT",
    ],
  ] as const)("returns a code-only denial for %o", async (overrides, code) => {
    const foundPublication =
      "lifecycle" in overrides
        ? {
            ...publication,
            lifecycle: overrides.lifecycle as Publication["lifecycle"],
          }
        : publication;
    const service = createService(foundPublication);
    const result = await service.getPublicationForRead(
      input(overrides as Partial<ReadPublicationInput>),
    );

    expect(result).toEqual({ outcome: "DENIED", code });
    expect(result).not.toHaveProperty("publication");
  });

  it("returns NOT_FOUND for nonexistent and foreign tenant-scoped lookups", async () => {
    const service = new ReadPublicationService({
      publications: {
        findPublicationByIdForTenant: vi.fn(async (tenantId, publicationId) =>
          tenantId === publication.tenantId && publicationId === publication.id
            ? publication
            : null,
        ),
      },
    });

    await expect(
      service.getPublicationForRead(input({ publicationId: missingPublicationId })),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
    await expect(
      service.getPublicationForRead({
        ...input(),
        tenantId: tenantBetaId,
        publicationId: publication.id,
        viewer: {
          kind: "anonymous",
          tenantId: tenantBetaId,
        },
        tenantFacts: { ...tenantFacts, tenantId: tenantBetaId },
      }),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
  });

  it("returns NOT_FOUND before lookup for a misbound Membership viewer", async () => {
    const calls: Array<readonly [string, string]> = [];
    const service = createService(publication, calls);
    const misboundViewer: ResourceReadViewer = {
      kind: "membership",
      context: { ...viewer.context, tenantId: tenantAlphaId },
    };
    const betaFacts = { ...tenantFacts, tenantId: tenantBetaId };

    await expect(
      service.getPublicationForRead({
        ...input(),
        tenantId: tenantBetaId,
        publicationId: publication.id,
        viewer: misboundViewer,
        tenantFacts: betaFacts,
      }),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
    await expect(
      service.getPublicationForRead({
        ...input(),
        tenantId: tenantBetaId,
        publicationId: missingPublicationId,
        viewer: misboundViewer,
        tenantFacts: betaFacts,
      }),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
    expect(calls).toEqual([]);
  });

  it("returns NOT_FOUND before lookup for a misbound anonymous viewer", async () => {
    const calls: Array<readonly [string, string]> = [];
    const service = createService(publication, calls);

    await expect(
      service.getPublicationForRead({
        ...input(),
        tenantId: tenantBetaId,
        viewer: { kind: "anonymous", tenantId: tenantAlphaId },
        tenantFacts: { ...tenantFacts, tenantId: tenantBetaId },
      }),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
    expect(calls).toEqual([]);
  });

  it("rejects misbound Tenant facts and membership status before lookup", async () => {
    const calls: Array<readonly [string, string]> = [];
    const service = createService(publication, calls);

    await expect(
      service.getPublicationForRead(
        input({
          tenantFacts: { ...tenantFacts, tenantId: tenantBetaId },
        }),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    await expect(
      service.getPublicationForRead({
        ...input(),
        viewer: { kind: "anonymous", tenantId: tenantAlphaId },
        tenantFacts: { ...tenantFacts, tenantId: tenantBetaId },
      }),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    await expect(
      service.getPublicationForRead(
        input({
          viewer: {
            ...viewer,
            context: { ...viewer.context, tenantStatus: "archived" },
          },
        }),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(calls).toEqual([]);
  });

  it("rejects malformed viewers before lookup through the canonical viewer validator", async () => {
    const calls: Array<readonly [string, string]> = [];
    const service = createService(publication, calls);
    const malformedViewers = [
      {},
      { kind: "membership" },
      { kind: "anonymous", tenantId: "" },
      { kind: "unknown", tenantId: tenantAlphaId },
    ];

    for (const malformedViewer of malformedViewers) {
      await expect(
        service.getPublicationForRead(
          input({ viewer: malformedViewer as never }),
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    }

    expect(calls).toEqual([]);
  });

  it("requires an evaluated audience decision for targeted Publications", async () => {
    const service = createService({ ...publication, audienceMode: "targeted" });

    await expect(service.getPublicationForRead(input())).resolves.toEqual({
      outcome: "DENIED",
      code: "INVALID_INPUT",
    });
    await expect(
      service.getPublicationForRead(
        input({ audienceDecision: { evaluated: true, eligible: false } }),
      ),
    ).resolves.toEqual({
      outcome: "DENIED",
      code: "AUDIENCE_INELIGIBLE",
    });
    await expect(
      service.getPublicationForRead(
        input({ audienceDecision: { evaluated: true, eligible: true } }),
      ),
    ).resolves.toEqual({ outcome: "FOUND", publication: { ...publication, audienceMode: "targeted" } });
  });

  it("fails closed before repository access for malformed identifiers", async () => {
    const calls: Array<readonly [string, string]> = [];
    const service = createService(publication, calls);

    await expect(
      service.getPublicationForRead({ ...input(), tenantId: " " } as ReadPublicationInput),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    await expect(
      service.getPublicationForRead(
        input({ publicationId: "banana" } as Partial<ReadPublicationInput>),
      ),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
    await expect(
      service.getPublicationForRead(
        input({ tenantId: "banana" } as Partial<ReadPublicationInput>),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(calls).toEqual([]);
  });

  it("validates trusted read facts before repository access", async () => {
    const calls: Array<readonly [string, string]> = [];
    const service = createService(publication, calls);

    await expect(
      service.getPublicationForRead({
        ...input(),
        contentExposure: "UNKNOWN",
      } as unknown as ReadPublicationInput),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    await expect(
      service.getPublicationForRead({
        ...input(),
        tenantFacts: { ...tenantFacts, onLeaveReadEnabled: "yes" },
      } as unknown as ReadPublicationInput),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(calls).toEqual([]);
  });
});
