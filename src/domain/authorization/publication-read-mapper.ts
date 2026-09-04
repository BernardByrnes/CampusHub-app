import "server-only";

import {
  isPublication,
  type Publication,
} from "@/domain/content/publication";

import type {
  ResourceAccessFacts,
  ResourceReadPreAudienceFacts,
} from "./resource-read-policy";
import {
  isPublicationAudienceDecision,
  parsePublicationContentExposure,
  isResolvedTenantReadFacts,
  type PublicationAudienceDecision,
  type PublicationContentExposure,
  type ResolvedTenantReadFacts,
} from "./publication-read-contract";

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function mapPublicationToPreAudienceFacts(
  publication: Publication,
  tenantFacts: ResolvedTenantReadFacts,
  contentExposure: PublicationContentExposure,
  now: Date,
): ResourceReadPreAudienceFacts | null {
  if (
    !isPublication(publication) ||
    !isResolvedTenantReadFacts(tenantFacts) ||
    parsePublicationContentExposure(contentExposure) === null ||
    !isValidDate(now)
  ) {
    return null;
  }

  if (publication.tenantId !== tenantFacts.tenantId) {
    return null;
  }

  const hasHistoricalPublishTime =
    publication.publishAt !== null &&
    publication.publishAt.getTime() <= now.getTime();
  const readable =
    contentExposure === "READABLE" &&
    hasHistoricalPublishTime &&
    (publication.lifecycle === "published" ||
      publication.lifecycle === "expired" ||
      publication.lifecycle === "archived");

  return {
    resourceId: publication.id,
    tenantId: publication.tenantId,
    tenantStatus: tenantFacts.tenantStatus,
    visibility: publication.visibility,
    readable,
    publicSurfacePermitted: tenantFacts.publicSurfacePermitted,
    archiveNoticeState: tenantFacts.archiveNoticeState,
    onLeaveReadEnabled: tenantFacts.onLeaveReadEnabled,
    alumniPublicReadEnabled: tenantFacts.alumniPublicReadEnabled,
  };
}

/**
 * Purely maps persisted Publication state and trusted server facts to the
 * generic pre-audience read contract. It performs no I/O, clock lookup,
 * mutation, audience evaluation, or transport work.
 */
export function mapPublicationToPreAudienceResourceAccessFacts(
  publication: Publication,
  tenantFacts: ResolvedTenantReadFacts,
  contentExposure: PublicationContentExposure,
  now: Date,
): ResourceReadPreAudienceFacts | null {
  return mapPublicationToPreAudienceFacts(
    publication,
    tenantFacts,
    contentExposure,
    now,
  );
}

/**
 * Maps the shared pre-audience Publication facts and attaches only the
 * trusted audience result established after pre-audience authorization.
 */
export function mapPublicationToResourceAccessFacts(
  publication: Publication,
  tenantFacts: ResolvedTenantReadFacts,
  contentExposure: PublicationContentExposure,
  audienceDecision: PublicationAudienceDecision | undefined,
  now: Date,
): ResourceAccessFacts | null {
  const preAudienceFacts = mapPublicationToPreAudienceFacts(
    publication,
    tenantFacts,
    contentExposure,
    now,
  );
  if (preAudienceFacts === null) {
    return null;
  }

  if (
    audienceDecision !== undefined &&
    !isPublicationAudienceDecision(audienceDecision)
  ) {
    return null;
  }

  const audience =
    publication.audienceMode === "targeted"
      ? audienceDecision === undefined
        ? null
        : { restricted: true as const, eligible: audienceDecision.eligible }
      : { restricted: false as const };

  return audience === null
    ? null
    : {
        ...preAudienceFacts,
        audience,
      };
}
