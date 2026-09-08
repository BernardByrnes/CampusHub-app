import { describe, expect, it, vi } from "vitest";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizer } from "@/domain/authorization/capability-authorization";
import type { Publication } from "@/domain/content/publication";

import {
  PublishPublicationService,
  type AuthorizedPublicationPublishGateway,
  type PublishPublicationCommand,
} from "./publish-publication";

const tenantAId = "00000000-0000-4000-8000-000000000001";
const tenantBId = "00000000-0000-4000-8000-000000000002";
const membershipAId = "00000000-0000-4000-8000-000000000003";
const publicationId = "00000000-0000-4000-8000-000000000004";

const trustedContext = {
  identitySubjectId: "identity-a",
  tenantId: tenantAId,
  tenantStatus: "active" as const,
  membershipId: membershipAId,
  assuranceLevel: "L2" as const,
  membershipStatus: "verified" as const,
};

const publishInput = {
  expectedVersion: 1,
  confirmedRecipientCount: 12,
};

const publication: Publication = {
  id: publicationId,
  tenantId: tenantAId,
  version: 2,
  type: "news",
  title: "Published title",
  body: "Published body",
  priority: "standard",
  visibility: "MEMBERS",
  lifecycle: "published",
  audienceMode: "entire_tenant",
  authorOfficeLabel: "Communications",
  publishAt: new Date("2026-06-01T12:00:00.000Z"),
  expiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T12:00:00.000Z"),
};

function command(
  overrides: Partial<PublishPublicationCommand> = {},
): PublishPublicationCommand {
  return {
    trustedContext,
    requestedTenantId: tenantAId,
    publicationId,
    publish: publishInput,
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
) {
  const publishAuthorizedPublication = vi.fn<
    AuthorizedPublicationPublishGateway["publishAuthorizedPublication"]
  >(async () =>
    result === null
      ? { outcome: "DENIED", code: "PERSISTENCE_FAILED" }
      : { outcome: "PUBLISHED", publication: result },
  );
  return {
    service: new PublishPublicationService({
      capabilityAuthorizer,
      authorizedPublicationPublish: { publishAuthorizedPublication },
    }),
    publishAuthorizedPublication,
    authorize: capabilityAuthorizer.authorize,
  };
}

describe("PublishPublicationService", () => {
  it("builds publication.publish authority and passes exact confirmation", async () => {
    const { service, publishAuthorizedPublication, authorize } = createService();

    await expect(service.publishPublication(command())).resolves.toEqual({
      outcome: "PUBLISHED",
      publication,
    });
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
      capability: CAPABILITIES.PUBLICATION_PUBLISH,
      scope: {
        tenantId: tenantAId,
        module: "publication",
        resource: "publication",
      },
    });
    expect(publishAuthorizedPublication).toHaveBeenCalledWith(
      expect.objectContaining({ capability: CAPABILITIES.PUBLICATION_PUBLISH }),
      tenantAId,
      publicationId,
      publishInput,
    );
  });

  it("rejects a Tenant mismatch before authorization or persistence", async () => {
    const { service, authorize, publishAuthorizedPublication } = createService();

    await expect(
      service.publishPublication(command({ requestedTenantId: tenantBId })),
    ).resolves.toEqual({
      outcome: "DENIED",
      code: "TENANT_SCOPE_NOT_FOUND",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(publishAuthorizedPublication).not.toHaveBeenCalled();
  });

  it("rejects forged lifecycle and audience fields before authorization", async () => {
    for (const forgedField of [
      { lifecycle: "published" },
      { publishAt: new Date() },
      { audienceMode: "targeted" },
      { tenantId: tenantBId },
      { actorId: "attacker" },
      { capability: CAPABILITIES.PUBLICATION_CREATE },
    ]) {
      const { service, authorize, publishAuthorizedPublication } = createService();
      await expect(
        service.publishPublication(
          command({ publish: { ...publishInput, ...forgedField } }),
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
      expect(authorize).not.toHaveBeenCalled();
      expect(publishAuthorizedPublication).not.toHaveBeenCalled();
    }
  });

  it("maps preflight and atomic denials without returning a forged publication", async () => {
    const denied = createService(publication, {
      authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
        allowed: false,
      })),
    });
    await expect(denied.service.publishPublication(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    expect(denied.publishAuthorizedPublication).not.toHaveBeenCalled();

    for (const code of [
      "NOT_FOUND",
      "VERSION_CONFLICT",
      "RECONFIRM_REQUIRED",
      "NOT_READY",
      "INVALID_STATE",
      "PERSISTENCE_FAILED",
    ] as const) {
      const gateway: AuthorizedPublicationPublishGateway = {
        publishAuthorizedPublication: vi.fn(async () => ({
          outcome: "DENIED" as const,
          code,
        })),
      };
      const service = new PublishPublicationService({
        capabilityAuthorizer: {
          authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
            allowed: true,
          })),
        },
        authorizedPublicationPublish: gateway,
      });
      await expect(service.publishPublication(command())).resolves.toEqual({
        outcome: "DENIED",
        code,
      });
    }
  });
});
