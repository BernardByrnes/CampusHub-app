import { describe, expect, it, vi } from "vitest";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizer } from "@/domain/authorization/capability-authorization";
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
  capabilityAuthorizer: CapabilityAuthorizer = {
    authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
      allowed: true,
    })),
  },
): {
  service: CreatePublicationService;
  createPublication: ReturnType<typeof vi.fn>;
  authorize: CapabilityAuthorizer["authorize"];
} {
  const createPublication = vi.fn<
    CreatePublicationRepository["createPublication"]
  >(async () => result);
  return {
    service: new CreatePublicationService({
      publications: { createPublication },
      capabilityAuthorizer,
    }),
    createPublication,
    authorize: capabilityAuthorizer.authorize,
  };
}

describe("CreatePublicationService", () => {
  it("AUTH-03 rejects a Tenant B request before authorization or repository access", async () => {
    const { service, createPublication, authorize } = createService();

    await expect(
      service.createPublication(command({ requestedTenantId: tenantBId })),
    ).resolves.toEqual({
      outcome: "DENIED",
      code: "TENANT_SCOPE_NOT_FOUND",
    });
    expect(authorize).not.toHaveBeenCalled();
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

  it("AUTH-01 denies when publication.create authorization is denied", async () => {
    const { service, createPublication } = createService(publication, {
      authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
        allowed: false,
      })),
    });

    await expect(service.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    expect(createPublication).not.toHaveBeenCalled();
  });

  it("AUTH-02 creates after affirmative authorization and passes canonical input unchanged", async () => {
    const { service, createPublication } = createService();

    await expect(service.createPublication(command())).resolves.toEqual({
      outcome: "CREATED",
      publication,
    });
    expect(createPublication).toHaveBeenCalledTimes(1);
    expect(createPublication).toHaveBeenCalledWith(tenantAId, publicationInput);
  });

  it("AUTH-04 fails closed when authorization throws", async () => {
    const authorize = vi.fn<CapabilityAuthorizer["authorize"]>(async () => {
      throw new Error("authorization unavailable");
    });
    const { service, createPublication } = createService(publication, {
      authorize,
    });

    await expect(service.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    expect(createPublication).not.toHaveBeenCalled();
  });

  it("AUTH-05 fails closed on a malformed authorization response", async () => {
    const malformedAuthorizer = {
      authorize: vi.fn(async () => null),
    } as unknown as CapabilityAuthorizer;
    const { service, createPublication } = createService(
      publication,
      malformedAuthorizer,
    );

    await expect(service.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    expect(createPublication).not.toHaveBeenCalled();
  });

  it("AUTH-06, AUTH-07, and AUTH-08 request the fixed capability with trusted actor and Tenant facts", async () => {
    const { service, authorize } = createService();
    const forgedCommand = {
      ...command(),
      actor: { identitySubjectId: "attacker-supplied" },
    } as unknown as CreatePublicationCommand;

    await expect(
      service.createPublication(forgedCommand),
    ).resolves.toMatchObject({ outcome: "CREATED" });

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith({
      actor: {
        identitySubjectId: trustedContext.identitySubjectId,
        tenantId: tenantAId,
        membershipId: membershipAId,
      },
      context: {
        tenantStatus: trustedContext.tenantStatus,
        membershipStatus: trustedContext.membershipStatus,
        assuranceLevel: trustedContext.assuranceLevel,
      },
      capability: CAPABILITIES.PUBLICATION_CREATE,
      scope: {
        tenantId: tenantAId,
        module: "publication",
        resource: "publication",
      },
    });
  });

  it("AUTH-09 performs no repository write for every authorization denial path", async () => {
    const denied = createService(publication, {
      authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
        allowed: false,
      })),
    });
    await denied.service.createPublication(command());
    expect(denied.createPublication).not.toHaveBeenCalled();

    const thrown = createService(publication, {
      authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => {
        throw new Error("authorization unavailable");
      }),
    });
    await thrown.service.createPublication(command());
    expect(thrown.createPublication).not.toHaveBeenCalled();

    const malformed = createService(publication, {
      authorize: vi.fn(async () => ({ allowed: "yes" })) as never,
    });
    await malformed.service.createPublication(command());
    expect(malformed.createPublication).not.toHaveBeenCalled();
  });

  it("AUTH-10 preserves persistence failure after affirmative authorization", async () => {
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
      capabilityAuthorizer: {
        authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
          allowed: true,
        })),
      },
    });
    await expect(thrownService.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERSISTENCE_FAILED",
    });
  });
});
