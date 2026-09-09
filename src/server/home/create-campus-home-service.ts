import "server-only";

import type { PublicationExposureResolver } from "@/application/content/publication-read-resolvers";
import {
  PersistedPublicationAudienceBatchResolver,
  PersistedPublicationAudienceResolver,
} from "@/application/content/publication-read-resolvers";
import { CampusHomeService } from "@/application/content/campus-home";
import { ListPublicationsService } from "@/application/content/list-publications";
import { ReadPublicationService } from "@/application/content/read-publication";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import { DrizzlePublicationRepository } from "@/server/repositories/publication-repository";

/**
 * The foundation has no separate persisted content-exposure table. The
 * canonical Publication read services still perform all Tenant, visibility,
 * lifecycle, and audience authorization; this seam only records that the
 * hydrated candidate was not suppressed by an additional platform layer.
 */
function createPublicationExposureResolver(): PublicationExposureResolver {
  return {
    resolveExposure: (publications) =>
      new Map(
        publications.map((publication) => [publication.id, "READABLE" as const]),
      ),
  };
}

export function createCampusHomeService(): CampusHomeService {
  const publications = new DrizzlePublicationRepository();
  const memberships = new DrizzleMembershipRepository();
  const exposureResolver = createPublicationExposureResolver();
  const audienceResolver = new PersistedPublicationAudienceResolver({
    publications,
    memberships,
  });
  const audienceBatchResolver = new PersistedPublicationAudienceBatchResolver({
    publications,
    memberships,
  });

  return new CampusHomeService({
    listPublications: new ListPublicationsService({
      publications,
      exposureResolver,
      audienceBatchResolver,
    }),
    readPublication: new ReadPublicationService({
      publications,
      exposureResolver,
      audienceResolver,
    }),
  });
}
