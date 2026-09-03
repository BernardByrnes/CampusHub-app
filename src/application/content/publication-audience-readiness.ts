import "server-only";

import {
  isPublicationAudienceDefinition,
  type PublicationAudienceDefinition,
} from "@/domain/authorization/publication-audience";
import {
  validatePublicationAudienceConfirmation,
  type PublicationAudienceConfirmationResult,
} from "@/domain/authorization/publication-audience-confirmation";
import type { PublicationAudienceReadiness } from "@/domain/authorization/publication-audience-readiness";
import type { Publication } from "@/domain/content/publication";
import { isUuid } from "@/domain/identifiers/uuid";

export type PublicationAudienceReadinessRepository = Readonly<{
  findPublicationByIdForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<Publication | null>;
  findPublicationAudienceDefinitionForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<PublicationAudienceDefinition | null>;
  arePublicationAudienceTargetsCurrentlyValidForTenant(
    tenantId: string,
    definition: unknown,
  ): Promise<boolean>;
  countPublicationAudienceMembershipsForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<number | null>;
}>;

export type PublicationAudienceReadinessServiceDependencies = Readonly<{
  publications: PublicationAudienceReadinessRepository;
}>;

function isValidIdentifierPair(
  tenantId: unknown,
  publicationId: unknown,
): tenantId is string {
  return isUuid(tenantId) && isUuid(publicationId);
}

function invalidReadiness(
  publication: Publication,
  tenantId: string,
  publicationId: string,
): PublicationAudienceReadiness {
  return {
    tenantId,
    publicationId,
    publicationVersion: publication.version,
    audienceMode: publication.audienceMode,
    estimatedRecipientCount: null,
    audienceDefinitionValid: false,
    targetsCurrentlyValid: false,
    requiresAudienceSizeConfirmation: false,
  };
}

/**
 * Internal server-side readiness calculation. It returns scalar readiness
 * facts only; publication reads and collections intentionally do not consume
 * this seam yet.
 */
export async function getPublicationAudienceReadinessForTenant(
  dependencies: PublicationAudienceReadinessServiceDependencies,
  tenantId: string,
  publicationId: string,
): Promise<PublicationAudienceReadiness | null> {
  if (!isValidIdentifierPair(tenantId, publicationId)) {
    return null;
  }

  let publication: Publication | null;
  try {
    publication = await dependencies.publications.findPublicationByIdForTenant(
      tenantId,
      publicationId,
    );
  } catch {
    return null;
  }
  if (publication === null) {
    return null;
  }

  let definition: PublicationAudienceDefinition | null;
  try {
    definition =
      await dependencies.publications.findPublicationAudienceDefinitionForTenant(
        tenantId,
        publicationId,
      );
  } catch {
    return null;
  }
  if (
    definition === null ||
    !isPublicationAudienceDefinition(definition) ||
    definition.tenantId !== tenantId ||
    definition.publicationId !== publicationId ||
    definition.mode !== publication.audienceMode
  ) {
    return invalidReadiness(publication, tenantId, publicationId);
  }

  let targetsCurrentlyValid: boolean;
  try {
    targetsCurrentlyValid =
      definition.mode === "entire_tenant"
        ? true
        : await dependencies.publications.arePublicationAudienceTargetsCurrentlyValidForTenant(
            tenantId,
            definition,
          );
  } catch {
    targetsCurrentlyValid = false;
  }
  if (!targetsCurrentlyValid) {
    return {
      ...invalidReadiness(publication, tenantId, publicationId),
      audienceDefinitionValid: true,
    };
  }

  let estimatedRecipientCount: number | null;
  try {
    estimatedRecipientCount =
      await dependencies.publications.countPublicationAudienceMembershipsForTenant(
        tenantId,
        publicationId,
      );
  } catch {
    estimatedRecipientCount = null;
  }

  return {
    tenantId,
    publicationId,
    publicationVersion: publication.version,
    audienceMode: publication.audienceMode,
    estimatedRecipientCount,
    audienceDefinitionValid: true,
    targetsCurrentlyValid: true,
    requiresAudienceSizeConfirmation: estimatedRecipientCount !== null,
  };
}

/**
 * Re-reads readiness immediately before validating a future publish command.
 * A missing or foreign publication is intentionally represented as absence.
 */
export async function validatePublicationAudienceConfirmationForTenant(
  dependencies: PublicationAudienceReadinessServiceDependencies,
  tenantId: string,
  publicationId: string,
  input: unknown,
): Promise<PublicationAudienceConfirmationResult | null> {
  const readiness = await getPublicationAudienceReadinessForTenant(
    dependencies,
    tenantId,
    publicationId,
  );
  return readiness === null
    ? null
    : validatePublicationAudienceConfirmation(input, readiness);
}
