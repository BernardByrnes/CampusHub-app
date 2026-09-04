import "server-only";

import type {
  PublicationAudienceDecision,
  PublicationContentExposure,
} from "@/domain/authorization/publication-read-contract";
import {
  evaluatePublicationAudience,
  isPublicationAudienceDefinition,
} from "@/domain/authorization/publication-audience";
import {
  isResourceReadViewer,
  type ResourceReadViewer,
} from "@/domain/authorization/resource-read-policy";
import { isPublication, type Publication } from "@/domain/content/publication";
import type { MembershipAudienceFacts } from "@/domain/membership/membership-audience";

export type PersistedPublicationAudienceDefinitionReader = Readonly<{
  findPublicationAudienceDefinitionForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<unknown>;
}>;

export type PersistedMembershipAudienceFactsReader = Readonly<{
  findMembershipAudienceFactsByIdForTenant(
    tenantId: string,
    membershipId: string,
  ): Promise<unknown>;
}>;

export type PersistedPublicationAudienceResolverDependencies = Readonly<{
  publications: PersistedPublicationAudienceDefinitionReader;
  memberships: PersistedMembershipAudienceFactsReader;
}>;

/** Server-owned facts required to expose a hydrated Publication to readers. */
export type PublicationExposureResolver = Readonly<{
  resolveExposure(
    publications: readonly Publication[],
  ): Promise<ReadonlyMap<string, PublicationContentExposure>> |
    ReadonlyMap<string, PublicationContentExposure>;
}>;

/** Server-owned targeted-audience evaluation; no client decision is accepted. */
export type PublicationAudienceResolver = Readonly<{
  resolveAudience(
    input: Readonly<{
      publication: Publication;
      viewer: ResourceReadViewer;
    }>,
  ): Promise<PublicationAudienceDecision> | PublicationAudienceDecision;
}>;

function ineligibleAudience(): PublicationAudienceDecision {
  return { evaluated: true, eligible: false };
}

/**
 * Resolves targeted Publication eligibility from the persisted Tenant-bound
 * definition and the current Membership's server-owned audience facts. It
 * never accepts audience facts or a decision from the caller and deliberately
 * does not consult Global User identity fields.
 */
export class PersistedPublicationAudienceResolver
  implements PublicationAudienceResolver
{
  public constructor(
    private readonly dependencies: PersistedPublicationAudienceResolverDependencies,
  ) {}

  public async resolveAudience(input: {
    publication: Publication;
    viewer: ResourceReadViewer;
  }): Promise<PublicationAudienceDecision> {
    if (
      typeof input !== "object" ||
      input === null ||
      !isPublication(input.publication) ||
      !isResourceReadViewer(input.viewer) ||
      input.publication.audienceMode !== "targeted"
    ) {
      return ineligibleAudience();
    }

    const { publication, viewer } = input;
    const viewerTenantId =
      viewer.kind === "anonymous"
        ? viewer.tenantId
        : viewer.context.tenantId;
    if (viewerTenantId !== publication.tenantId) {
      return ineligibleAudience();
    }

    let definition: unknown;
    try {
      definition =
        await this.dependencies.publications.findPublicationAudienceDefinitionForTenant(
          publication.tenantId,
          publication.id,
        );
    } catch {
      return ineligibleAudience();
    }

    if (
      !isPublicationAudienceDefinition(definition) ||
      definition.tenantId !== publication.tenantId ||
      definition.publicationId !== publication.id ||
      definition.mode !== "targeted"
    ) {
      return ineligibleAudience();
    }

    if (viewer.kind === "anonymous") {
      return ineligibleAudience();
    }

    let membershipFacts: unknown;
    try {
      membershipFacts =
        await this.dependencies.memberships.findMembershipAudienceFactsByIdForTenant(
          publication.tenantId,
          viewer.context.membershipId,
        );
    } catch {
      return ineligibleAudience();
    }

    return evaluatePublicationAudience(
      definition,
      membershipFacts as MembershipAudienceFacts | null,
    );
  }
}
