import { describe, expect, it, vi } from "vitest";

import type { Publication } from "@/domain/content/publication";
import type { CreatePublicationInput } from "@/server/repositories/publication-repository";

import {
  CreatePublicationService,
  type CreatePublicationCommand,
  type CreatePublicationRepository,
} from "./create-publication";

const tenantAId = "00000000-0000-4000-8000-000000000001";
const tenantBId = "00000000-0000-4000-8000-000000000002";
const membershipAId = "00000000-0000-4000-8000-000000000011";
const publicationId = "00000000-0000-4000-8000-000000000021";

const trustedContext = {
  identitySubjectId: "identity-a",
  tenantId: tenantAId,
  tenantStatus: "active" as const,
  membershipId: membershipAId,
  assuranceLevel: "L2" as const,
  membershipStatus: "verified" as const,
};

const publicationInput: CreatePublicationInput = {
  type: "news",
  title: "Tenant A notice",
  body: "Tenant A notice body",
  audienceMode: "entire_tenant",
  authorOfficeLabel: "Communications",
};

const publication: Publication = {
  id: publicationId,
  tenantId: tenantAId,
  version: 1,
  type: "news",
  title: publicationInput.title,
  body: publicationInput.body,
  priority: "standard",
  visibility: "MEMBERS",
  lifecycle: "draft",
  audienceMode: "entire_tenant",
  authorOfficeLabel: publicationInput.authorOfficeLabel,
  publishAt: null,
  expiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function command(
  overrides: Partial<CreatePublicationCommand> = {},
): CreatePublicationCommand {
  return {
    trustedContext,
    requestedTenantId: tenantAId,
    publication: publicationInput,
    ...overrides,
  };
}

function createService(
  result: Publication | null = publication,
): {
  service: CreatePublicationService;
  createPublication: ReturnType<typeof vi.fn>;
} {
  const createPublication = vi.fn<
    CreatePublicationRepository["createPublication"]
  >(async () => result);
  return {
    service: new CreatePublicationService({ publications: { createPublication } }),
    createPublication,
  };
}

describe("CreatePublicationService", () => {
  it("rejects a Tenant B request from a trusted Tenant A context before repository access", async () => {
    const { service, createPublication } = createService();

    await expect(
      service.createPublication(command({ requestedTenantId: tenantBId })),
    ).resolves.toEqual({
      outcome: "DENIED",
      code: "TENANT_SCOPE_NOT_FOUND",
    });
    expect(createPublication).not.toHaveBeenCalled();
  });

  it("rejects malformed Tenant or trusted-context UUIDs before repository access", async () => {
    const first = createService();
    await expect(
      first.service.createPublication(
        command({ requestedTenantId: "not-a-uuid" }),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(first.createPublication).not.toHaveBeenCalled();

    const second = createService();
    await expect(
      second.service.createPublication(
        command({
          trustedContext: { ...trustedContext, tenantId: "not-a-uuid" },
        } as never),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(second.createPublication).not.toHaveBeenCalled();
  });

  it("creates with a matching trusted Tenant and passes the canonical input to the repository", async () => {
    const { service, createPublication } = createService();

    await expect(service.createPublication(command())).resolves.toEqual({
      outcome: "CREATED",
      publication,
    });
    expect(createPublication).toHaveBeenCalledTimes(1);
    expect(createPublication).toHaveBeenCalledWith(tenantAId, publicationInput);
  });

  it("normalizes a repository null or exception to persistence failure", async () => {
    const nullResult = createService(null);
    await expect(nullResult.service.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERSISTENCE_FAILED",
    });

    const thrownRepository: CreatePublicationRepository = {
      createPublication: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };
    const thrownService = new CreatePublicationService({
      publications: thrownRepository,
    });
    await expect(thrownService.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERSISTENCE_FAILED",
    });
  });
});
