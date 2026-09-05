import { describe, expect, it, vi } from "vitest";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizer } from "@/domain/authorization/capability-authorization";
import type { Publication } from "@/domain/content/publication";
import type { CreatePublicationDraftInput } from "@/domain/content/publication-draft";

import {
  CreatePublicationService,
  type CreatePublicationCommand,
  type AuthorizedPublicationCreateGateway,
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

const publicationInput: CreatePublicationDraftInput = {
  type: "news",
  title: "Tenant A notice",
  body: "Tenant A notice body",
  audienceMode: "entire_tenant",
  authorOfficeLabel: "Communications",
};
const canonicalPublicationInput = {
  ...publicationInput,
  priority: "standard" as const,
  visibility: "MEMBERS" as const,
  expiresAt: null,
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
  createAuthorizedPublication: ReturnType<typeof vi.fn>;
  authorize: CapabilityAuthorizer["authorize"];
} {
  const createAuthorizedPublication = vi.fn<
    AuthorizedPublicationCreateGateway["createAuthorizedPublication"]
  >(async () =>
    result === null
      ? { outcome: "DENIED", code: "PERSISTENCE_FAILED" }
      : { outcome: "CREATED", publication: result },
  );
  return {
    service: new CreatePublicationService({
      capabilityAuthorizer,
      authorizedPublicationCreate: { createAuthorizedPublication },
    }),
    createAuthorizedPublication,
    authorize: capabilityAuthorizer.authorize,
  };
}

describe("CreatePublicationService", () => {
  it("AUTH-03 rejects a Tenant B request before authorization or repository access", async () => {
    const { service, createAuthorizedPublication, authorize } = createService();

    await expect(
      service.createPublication(command({ requestedTenantId: tenantBId })),
    ).resolves.toEqual({
      outcome: "DENIED",
      code: "TENANT_SCOPE_NOT_FOUND",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(createAuthorizedPublication).not.toHaveBeenCalled();
  });

  it("rejects malformed Tenant or trusted-context UUIDs before repository access", async () => {
    const first = createService();
    await expect(
      first.service.createPublication(
        command({ requestedTenantId: "not-a-uuid" }),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(first.createAuthorizedPublication).not.toHaveBeenCalled();

    const second = createService();
    await expect(
      second.service.createPublication(
        command({
          trustedContext: { ...trustedContext, tenantId: "not-a-uuid" },
        } as never),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(second.createAuthorizedPublication).not.toHaveBeenCalled();
  });

  it("AUTH-01 denies when publication.create authorization is denied", async () => {
    const { service, createAuthorizedPublication } = createService(publication, {
      authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
        allowed: false,
      })),
    });

    await expect(service.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    expect(createAuthorizedPublication).not.toHaveBeenCalled();
  });

  it("AUTH-02 creates after affirmative authorization and passes canonical draft input", async () => {
    const { service, createAuthorizedPublication } = createService();

    await expect(service.createPublication(command())).resolves.toEqual({
      outcome: "CREATED",
      publication,
    });
    expect(createAuthorizedPublication).toHaveBeenCalledTimes(1);
    expect(createAuthorizedPublication).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: expect.objectContaining({ tenantId: tenantAId }),
      }),
      tenantAId,
      canonicalPublicationInput,
    );
  });

  it("DRAFT-04 through DRAFT-06 preserve explicit visibility, priority, and expiry as draft metadata", async () => {
    const expiresAt = new Date("2026-12-01T00:00:00.000Z");
    const explicitInput = {
      ...publicationInput,
      priority: "priority" as const,
      visibility: "PUBLIC" as const,
      expiresAt,
    };
    const { service, createAuthorizedPublication } = createService();

    await expect(
      service.createPublication(command({ publication: explicitInput })),
    ).resolves.toEqual({ outcome: "CREATED", publication });
    expect(createAuthorizedPublication).toHaveBeenCalledWith(
      expect.anything(),
      tenantAId,
      explicitInput,
    );
  });

  it("DRAFT-SEC rejects forged lifecycle, publish, ownership, actor, and media fields before authorization", async () => {
    const forgedFields: readonly Record<string, unknown>[] = [
      { lifecycle: "published" },
      { lifecycle: "scheduled" },
      { lifecycle: "expired" },
      { lifecycle: "archived" },
      { publishAt: new Date("2026-10-01T00:00:00.000Z") },
      { id: publicationId },
      { tenantId: tenantBId },
      { version: 9 },
      { createdAt: new Date("2026-01-01T00:00:00.000Z") },
      { updatedAt: new Date("2026-01-01T00:00:00.000Z") },
      { actorId: "attacker" },
      { membershipId: membershipAId },
      { identitySubjectId: "attacker" },
      { role: "publisher" },
      { capability: CAPABILITIES.PUBLICATION_CREATE },
      { isPublisher: true },
      { isAdmin: true },
      { image: "image.png" },
      { attachment: "attachment.pdf" },
      { file: "file.bin" },
      { mediaUrl: "https://example.test/media" },
    ];

    for (const forgedField of forgedFields) {
      const { service, authorize, createAuthorizedPublication } =
        createService();
      await expect(
        service.createPublication(
          command({ publication: { ...publicationInput, ...forgedField } }),
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
      expect(authorize).not.toHaveBeenCalled();
      expect(createAuthorizedPublication).not.toHaveBeenCalled();
    }
  });

  it("AUTH-04 fails closed when authorization throws", async () => {
    const authorize = vi.fn<CapabilityAuthorizer["authorize"]>(async () => {
      throw new Error("authorization unavailable");
    });
    const { service, createAuthorizedPublication } = createService(publication, {
      authorize,
    });

    await expect(service.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    expect(createAuthorizedPublication).not.toHaveBeenCalled();
  });

  it("AUTH-05 fails closed on a malformed authorization response", async () => {
    const malformedAuthorizer = {
      authorize: vi.fn(async () => null),
    } as unknown as CapabilityAuthorizer;
    const { service, createAuthorizedPublication } = createService(
      publication,
      malformedAuthorizer,
    );

    await expect(service.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    expect(createAuthorizedPublication).not.toHaveBeenCalled();
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
    expect(denied.createAuthorizedPublication).not.toHaveBeenCalled();

    const thrown = createService(publication, {
      authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => {
        throw new Error("authorization unavailable");
      }),
    });
    await thrown.service.createPublication(command());
    expect(thrown.createAuthorizedPublication).not.toHaveBeenCalled();

    const malformed = createService(publication, {
      authorize: vi.fn(async () => ({ allowed: "yes" })) as never,
    });
    await malformed.service.createPublication(command());
    expect(malformed.createAuthorizedPublication).not.toHaveBeenCalled();
  });

  it("AUTH-10 preserves persistence failure after affirmative authorization", async () => {
    const nullResult = createService(null);
    await expect(nullResult.service.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERSISTENCE_FAILED",
    });

    const thrownGateway: AuthorizedPublicationCreateGateway = {
      createAuthorizedPublication: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };
    const thrownService = new CreatePublicationService({
      capabilityAuthorizer: {
        authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
          allowed: true,
        })),
      },
      authorizedPublicationCreate: thrownGateway,
    });
    await expect(thrownService.createPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERSISTENCE_FAILED",
    });
  });
});
