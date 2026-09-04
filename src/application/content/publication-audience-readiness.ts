import "server-only";

import { isPublicationAudienceDefinition } from "@/domain/authorization/publication-audience";
import type { PublicationAudienceConfirmationResult } from "@/domain/authorization/publication-audience-confirmation";
import type {
  PublicationAudienceReadiness,
  PublicationAudienceReadinessSnapshot,
} from "@/domain/authorization/publication-audience-readiness";
import { isPublication, type Publication } from "@/domain/content/publication";
import { isUuid } from "@/domain/identifiers/uuid";

export type PublicationAudienceReadinessRepository = Readonly<{
  readPublicationAudienceReadinessSnapshotForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<PublicationAudienceReadinessSnapshot | null>;
  validatePublicationAudienceConfirmationAtomicallyForTenant(
    tenantId: string,
    publicationId: string,
    input: unknown,
  ): Promise<PublicationAudienceConfirmationResult | null>;
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function readinessFromSnapshot(
  snapshot: unknown,
  tenantId: string,
  publicationId: string,
): PublicationAudienceReadiness | null {
  if (typeof snapshot !== "object" || snapshot === null) {
    return null;
  }

  const candidate = snapshot as Record<string, unknown>;
  const publication = candidate.publication;
  if (
    !isPublication(publication) ||
    publication.tenantId !== tenantId ||
    publication.id !== publicationId
  ) {
    return null;
  }

  const definition = candidate.definition;
  if (
    definition === null ||
    !isPublicationAudienceDefinition(definition) ||
    definition.tenantId !== tenantId ||
    definition.publicationId !== publicationId ||
    definition.mode !== publication.audienceMode
  ) {
    return invalidReadiness(publication, tenantId, publicationId);
  }

  const targetsCurrentlyValid = candidate.targetsCurrentlyValid;
  const estimatedRecipientCount = candidate.estimatedRecipientCount;
  if (
    typeof targetsCurrentlyValid !== "boolean" ||
    (estimatedRecipientCount !== null &&
      !isNonNegativeInteger(estimatedRecipientCount))
  ) {
    return {
      ...invalidReadiness(publication, tenantId, publicationId),
      audienceDefinitionValid: true,
    };
  }

  if (!targetsCurrentlyValid) {
    return {
      ...invalidReadiness(publication, tenantId, publicationId),
      audienceDefinitionValid: true,
    };
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
 * Internal server-side readiness calculation. It consumes one repository-owned
 * transaction snapshot; publication, definition, target validity, and count
 * are never composed from independent reads here.
 */
export async function getPublicationAudienceReadinessForTenant(
  dependencies: PublicationAudienceReadinessServiceDependencies,
  tenantId: string,
  publicationId: string,
): Promise<PublicationAudienceReadiness | null> {
  if (!isValidIdentifierPair(tenantId, publicationId)) {
    return null;
  }

  let snapshot: PublicationAudienceReadinessSnapshot | null;
  try {
    snapshot =
      await dependencies.publications.readPublicationAudienceReadinessSnapshotForTenant(
        tenantId,
        publicationId,
      );
  } catch {
    return null;
  }

  return snapshot === null
    ? null
    : readinessFromSnapshot(snapshot, tenantId, publicationId);
}

/**
 * Confirmation is evaluated inside the repository's row-locked transaction,
 * so the expected version and scalar count come from the same authoritative
 * snapshot.
 */
export async function validatePublicationAudienceConfirmationForTenant(
  dependencies: PublicationAudienceReadinessServiceDependencies,
  tenantId: string,
  publicationId: string,
  input: unknown,
): Promise<PublicationAudienceConfirmationResult | null> {
  if (!isValidIdentifierPair(tenantId, publicationId)) {
    return null;
  }

  try {
    return await dependencies.publications.validatePublicationAudienceConfirmationAtomicallyForTenant(
      tenantId,
      publicationId,
      input,
    );
  } catch {
    return null;
  }
}
