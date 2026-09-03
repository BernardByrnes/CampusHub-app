import { describe, expect, it, vi } from "vitest";

import type { PublicationAudienceDefinition } from "@/domain/authorization/publication-audience";
import type { Publication } from "@/domain/content/publication";

import {
  getPublicationAudienceReadinessForTenant,
  validatePublicationAudienceConfirmationForTenant,
  type PublicationAudienceReadinessRepository,
} from "./publication-audience-readiness";

const tenantId = "00000000-0000-4000-8000-000000000001";
const foreignTenantId = "00000000-0000-4000-8000-000000000002";
const publicationId = "00000000-0000-4000-8000-000000000011";

const publication: Publication = {
  id: publicationId,
  tenantId,
  version: 4,
  type: "news",
  title: "Readiness publication",
  body: "Readiness body",
  priority: "standard",
  visibility: "MEMBERS",
  lifecycle: "scheduled",
  audienceMode: "entire_tenant",
  authorOfficeLabel: "Communications",
  publishAt: null,
  expiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const entireDefinition: PublicationAudienceDefinition = {
  tenantId,
  publicationId,
  mode: "entire_tenant",
  groups: [],
};

function repositoryFor(
  overrides: Partial<PublicationAudienceReadinessRepository> = {},
): PublicationAudienceReadinessRepository {
  return {
    findPublicationByIdForTenant: vi.fn(async (requestedTenantId, requestedPublicationId) =>
      requestedTenantId === tenantId && requestedPublicationId === publicationId
        ? publication
        : null,
    ),
    findPublicationAudienceDefinitionForTenant: vi.fn(async () => entireDefinition),
    arePublicationAudienceTargetsCurrentlyValidForTenant: vi.fn(async () => true),
    countPublicationAudienceMembershipsForTenant: vi.fn(async () => 7),
    ...overrides,
  };
}

describe("publication audience readiness", () => {
  it("returns an entire-Tenant scalar readiness estimate", async () => {
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: repositoryFor() },
        tenantId,
        publicationId,
      ),
    ).resolves.toEqual({
      tenantId,
      publicationId,
      publicationVersion: 4,
      audienceMode: "entire_tenant",
      estimatedRecipientCount: 7,
      audienceDefinitionValid: true,
      targetsCurrentlyValid: true,
      requiresAudienceSizeConfirmation: true,
    });
  });

  it("returns safe absence for a foreign Publication", async () => {
    const repository = repositoryFor();
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: repository },
        foreignTenantId,
        publicationId,
      ),
    ).resolves.toBeNull();
    expect(repository.findPublicationAudienceDefinitionForTenant).not.toHaveBeenCalled();
  });

  it("does not count an invalid or missing canonical definition", async () => {
    const count = vi.fn(async () => 7);
    const repository = repositoryFor({
      findPublicationAudienceDefinitionForTenant: vi.fn(async () => null),
      countPublicationAudienceMembershipsForTenant: count,
    });
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: repository },
        tenantId,
        publicationId,
      ),
    ).resolves.toMatchObject({
      audienceDefinitionValid: false,
      targetsCurrentlyValid: false,
      estimatedRecipientCount: null,
      requiresAudienceSizeConfirmation: false,
    });
    expect(count).not.toHaveBeenCalled();
  });

  it("does not estimate a targeted audience whose current target is invalid", async () => {
    const targeted: PublicationAudienceDefinition = {
      tenantId,
      publicationId,
      mode: "targeted",
      groups: [
        {
          dimension: "academic_year",
          provenancePolicy: "authoritative_only",
          academicYears: [2026],
        },
      ],
    };
    const count = vi.fn(async () => 7);
    const targetedPublication = { ...publication, audienceMode: "targeted" as const };
    const repository = repositoryFor({
      findPublicationByIdForTenant: vi.fn(async () => targetedPublication),
      findPublicationAudienceDefinitionForTenant: vi.fn(async () => targeted),
      arePublicationAudienceTargetsCurrentlyValidForTenant: vi.fn(async () => false),
      countPublicationAudienceMembershipsForTenant: count,
    });
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: repository },
        tenantId,
        publicationId,
      ),
    ).resolves.toMatchObject({
      audienceMode: "targeted",
      audienceDefinitionValid: true,
      targetsCurrentlyValid: false,
      estimatedRecipientCount: null,
    });
    expect(count).not.toHaveBeenCalled();
  });

  it("re-evaluates the scalar estimate for confirmation", async () => {
    const repository = repositoryFor({
      countPublicationAudienceMembershipsForTenant: vi.fn(async () => 7),
    });
    await expect(
      validatePublicationAudienceConfirmationForTenant(
        { publications: repository },
        tenantId,
        publicationId,
        { expectedPublicationVersion: 4, confirmedRecipientCount: 6 },
      ),
    ).resolves.toEqual({ ok: false, error: "RECONFIRM_REQUIRED" });
  });
});
