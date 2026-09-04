import "server-only";

import type {
  PublicationAudienceDecision,
  PublicationContentExposure,
} from "@/domain/authorization/publication-read-contract";
import {
  evaluatePublicationAudience,
  isPublicationAudienceDefinition,
  type PublicationAudienceDefinition,
} from "@/domain/authorization/publication-audience";
import { isPublicationAudienceDecision } from "@/domain/authorization/publication-read-contract";
import {
  isResourceReadViewer,
  type ResourceReadViewer,
} from "@/domain/authorization/resource-read-policy";
import { isPublication, type Publication } from "@/domain/content/publication";
import { MAX_PUBLICATION_CANDIDATES_SCANNED } from "@/domain/content/publication-collection";
import { isUuid } from "@/domain/identifiers/uuid";
import type { MembershipAudienceFacts } from "@/domain/membership/membership-audience";
import { isMembershipAudienceFacts } from "@/domain/membership/membership-audience";

export type PersistedPublicationAudienceDefinitionReader = Readonly<{
  findPublicationAudienceDefinitionForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<unknown>;
}>;

export type PersistedPublicationAudienceDefinitionBatchReader = Readonly<{
  findPublicationAudienceDefinitionsForTenant(
    tenantId: string,
    publicationIds: readonly string[],
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

export type PersistedPublicationAudienceBatchResolverDependencies = Readonly<{
  publications: PersistedPublicationAudienceDefinitionBatchReader;
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

export type PublicationAudienceBatchInput = Readonly<{
  tenantId: string;
  publications: readonly Publication[];
  viewer: ResourceReadViewer;
}>;

export type PublicationAudienceBatchResolver = Readonly<{
  resolveAudienceBatch(
    input: PublicationAudienceBatchInput,
  ): Promise<ReadonlyMap<string, PublicationAudienceDecision>> |
    ReadonlyMap<string, PublicationAudienceDecision>;
}>;

function ineligibleAudience(): PublicationAudienceDecision {
  return { evaluated: true, eligible: false };
}

function viewerTenantId(viewer: ResourceReadViewer): string {
  return viewer.kind === "anonymous"
    ? viewer.tenantId
    : viewer.context.tenantId;
}

function ineligibleAudienceBatch(
  publications: readonly Publication[],
): Map<string, PublicationAudienceDecision> {
  const decisions = new Map<string, PublicationAudienceDecision>();
  for (const publication of publications) {
    if (publication.audienceMode === "targeted") {
      decisions.set(publication.id, ineligibleAudience());
    }
  }
  return decisions;
}

function isPublicationAudienceBatchInput(
  value: unknown,
): value is PublicationAudienceBatchInput {
  if (
    typeof value !== "object" ||
    value === null ||
    !isUuid((value as Record<string, unknown>).tenantId) ||
    !isResourceReadViewer((value as Record<string, unknown>).viewer)
  ) {
    return false;
  }

  const publications = (value as Record<string, unknown>).publications;
  return (
    Array.isArray(publications) &&
    publications.length <= MAX_PUBLICATION_CANDIDATES_SCANNED &&
    publications.every(isPublication)
  );
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
    if (viewerTenantId(viewer) !== publication.tenantId) {
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

/**
 * Resolves all targeted candidates in one bounded persistence batch. The
 * resolver owns the viewer and Tenant binding, loads Membership audience
 * facts at most once, and leaves missing or malformed definitions ineligible.
 */
export class PersistedPublicationAudienceBatchResolver
  implements PublicationAudienceBatchResolver
{
  public constructor(
    private readonly dependencies: PersistedPublicationAudienceBatchResolverDependencies,
  ) {}

  public async resolveAudienceBatch(
    input: PublicationAudienceBatchInput,
  ): Promise<ReadonlyMap<string, PublicationAudienceDecision>> {
    if (!isPublicationAudienceBatchInput(input)) {
      return new Map();
    }

    const { tenantId, publications, viewer } = input;
    if (
      viewerTenantId(viewer) !== tenantId ||
      publications.some((publication) => publication.tenantId !== tenantId) ||
      new Set(publications.map((publication) => publication.id)).size !==
        publications.length
    ) {
      return new Map();
    }

    const targetedPublications = publications.filter(
      (publication) => publication.audienceMode === "targeted",
    );
    const decisions = ineligibleAudienceBatch(targetedPublications);
    if (targetedPublications.length === 0) {
      return decisions;
    }

    if (viewer.kind === "anonymous") {
      return decisions;
    }

    let definitionByPublicationId: unknown;
    try {
      definitionByPublicationId =
        await this.dependencies.publications.findPublicationAudienceDefinitionsForTenant(
          tenantId,
          targetedPublications.map((publication) => publication.id),
        );
    } catch {
      return decisions;
    }

    if (!(definitionByPublicationId instanceof Map)) {
      return decisions;
    }

    const validDefinitions: PublicationAudienceDefinition[] = [];
    for (const publication of targetedPublications) {
      let definition: unknown;
      try {
        definition = definitionByPublicationId.get(publication.id);
      } catch {
        continue;
      }

      if (
        isPublicationAudienceDefinition(definition) &&
        definition.tenantId === tenantId &&
        definition.publicationId === publication.id &&
        definition.mode === "targeted"
      ) {
        validDefinitions.push(definition);
      }
    }

    if (validDefinitions.length === 0) {
      return decisions;
    }

    let membershipFacts: unknown;
    try {
      membershipFacts =
        await this.dependencies.memberships.findMembershipAudienceFactsByIdForTenant(
          tenantId,
          viewer.context.membershipId,
        );
    } catch {
      return decisions;
    }

    if (
      !isMembershipAudienceFacts(membershipFacts) ||
      membershipFacts.tenantId !== tenantId ||
      membershipFacts.membershipId !== viewer.context.membershipId
    ) {
      return decisions;
    }

    for (const definition of validDefinitions) {
      let decision: unknown;
      try {
        decision = evaluatePublicationAudience(definition, membershipFacts);
      } catch {
        continue;
      }

      if (isPublicationAudienceDecision(decision)) {
        decisions.set(definition.publicationId, decision);
      }
    }

    return decisions;
  }
}
