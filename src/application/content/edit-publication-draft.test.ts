import { describe, expect, it, vi } from "vitest";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizer } from "@/domain/authorization/capability-authorization";
import type { Publication } from "@/domain/content/publication";
import type { UpdatePublicationDraftInput } from "@/domain/content/publication-draft-edit";

import {
  EditPublicationDraftService,
  type AuthorizedPublicationDraftEditGateway,
  type EditPublicationDraftCommand,
} from "./edit-publication-draft";

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

const editInput: UpdatePublicationDraftInput = {
  expectedVersion: 1,
  type: "notice",
  title: "Edited title",
  body: "Edited body",
  priority: "priority",
  visibility: "PUBLIC",
  authorOfficeLabel: "Communications",
  expiresAt: new Date("2026-12-01T00:00:00.000Z"),
};

const publication: Publication = {
  id: publicationId,
  tenantId: tenantAId,
  version: 2,
  type: editInput.type,
  title: editInput.title,
  body: editInput.body,
  priority: editInput.priority,
  visibility: editInput.visibility,
  lifecycle: "draft",
  audienceMode: "targeted",
  authorOfficeLabel: editInput.authorOfficeLabel,
  publishAt: null,
  expiresAt: editInput.expiresAt,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-02-01T00:00:00.000Z"),
};

function command(
  overrides: Partial<EditPublicationDraftCommand> = {},
): EditPublicationDraftCommand {
  return {
    trustedContext,
    requestedTenantId: tenantAId,
    publicationId,
    edit: editInput,
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
  const editAuthorizedPublication = vi.fn<
    AuthorizedPublicationDraftEditGateway["editAuthorizedPublication"]
  >(async () =>
    result === null
      ? { outcome: "DENIED", code: "PERSISTENCE_FAILED" }
      : { outcome: "UPDATED", publication: result },
  );
  return {
    service: new EditPublicationDraftService({
      capabilityAuthorizer,
      authorizedPublicationDraftEdit: { editAuthorizedPublication },
    }),
    editAuthorizedPublication,
    authorize: capabilityAuthorizer.authorize,
  };
}

describe("EditPublicationDraftService", () => {
  it("EDIT-01 builds publication.edit authority and passes the complete replacement", async () => {
    const { service, editAuthorizedPublication, authorize } = createService();

    await expect(service.editPublicationDraft(command())).resolves.toEqual({
      outcome: "UPDATED",
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
      capability: CAPABILITIES.PUBLICATION_EDIT,
      scope: {
        tenantId: tenantAId,
        module: "publication",
        resource: "publication",
      },
    });
    expect(editAuthorizedPublication).toHaveBeenCalledWith(
      expect.objectContaining({ capability: CAPABILITIES.PUBLICATION_EDIT }),
      tenantAId,
      publicationId,
      editInput,
    );
  });

  it("rejects a Tenant mismatch before authorization or persistence", async () => {
    const { service, authorize, editAuthorizedPublication } = createService();

    await expect(
      service.editPublicationDraft(command({ requestedTenantId: tenantBId })),
    ).resolves.toEqual({
      outcome: "DENIED",
      code: "TENANT_SCOPE_NOT_FOUND",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(editAuthorizedPublication).not.toHaveBeenCalled();
  });

  it("EDIT-SEC rejects malformed versions and forbidden fields before authorization", async () => {
    const forgedFields: readonly Record<string, unknown>[] = [
      { expectedVersion: 0 },
      { expectedVersion: 1.5 },
      { expectedVersion: "1" },
      { lifecycle: "published" },
      { publishAt: new Date() },
      { audienceMode: "targeted" },
      { audience: {} },
      { criteria: [] },
      { tenantId: tenantBId },
      { actorId: "attacker" },
      { capability: CAPABILITIES.PUBLICATION_CREATE },
      { mediaUrl: "https://example.test/media" },
    ];

    for (const forgedField of forgedFields) {
      const { service, authorize, editAuthorizedPublication } = createService();
      await expect(
        service.editPublicationDraft(
          command({ edit: { ...editInput, ...forgedField } }),
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
      expect(authorize).not.toHaveBeenCalled();
      expect(editAuthorizedPublication).not.toHaveBeenCalled();
    }
  });

  it("maps preflight denial and atomic resource outcomes without writing", async () => {
    const denied = createService(publication, {
      authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
        allowed: false,
      })),
    });
    await expect(denied.service.editPublicationDraft(command())).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    expect(denied.editAuthorizedPublication).not.toHaveBeenCalled();

    for (const code of [
      "NOT_FOUND",
      "VERSION_CONFLICT",
      "INVALID_STATE",
    ] as const) {
      const gateway: AuthorizedPublicationDraftEditGateway = {
        editAuthorizedPublication: vi.fn(async () => ({
          outcome: "DENIED" as const,
          code,
        })),
      };
      const service = new EditPublicationDraftService({
        capabilityAuthorizer: {
          authorize: vi.fn<CapabilityAuthorizer["authorize"]>(async () => ({
            allowed: true,
          })),
        },
        authorizedPublicationDraftEdit: gateway,
      });
      await expect(service.editPublicationDraft(command())).resolves.toEqual({
        outcome: "DENIED",
        code,
      });
    }
  });
});
