import "server-only";

import {
  authorizeResourceRead,
  type ResourceReadDenialCode,
  type ResourceReadViewer,
} from "@/domain/authorization/resource-read-policy";
import { mapPublicationToResourceAccessFacts } from "@/domain/authorization/publication-read-mapper";
import type {
  PublicationAudienceDecision,
  PublicationContentExposure,
  ResolvedTenantReadFacts,
} from "@/domain/authorization/publication-read-contract";
import {
  isPublicationAudienceDecision,
  isResolvedTenantReadFacts,
  parsePublicationContentExposure,
} from "@/domain/authorization/publication-read-contract";
import type { Publication } from "@/domain/content/publication";

export type PublicationReadRepository = Readonly<{
  findPublicationByIdForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<Publication | null>;
}>;

export type ReadPublicationServiceDependencies = Readonly<{
  publications: PublicationReadRepository;
}>;

export type ReadPublicationInput = Readonly<{
  tenantId: string;
  publicationId: string;
  viewer: ResourceReadViewer;
  tenantFacts: ResolvedTenantReadFacts;
  contentExposure: PublicationContentExposure;
  audienceDecision?: PublicationAudienceDecision;
  now: Date;
}>;

export type ReadPublicationResult =
  | Readonly<{ outcome: "FOUND"; publication: Publication }>
  | Readonly<{ outcome: "NOT_FOUND" }>
  | Readonly<{ outcome: "DENIED"; code: ResourceReadDenialCode }>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isReadInput(value: unknown): value is ReadPublicationInput {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.tenantId) ||
    !isNonEmptyString(value.publicationId) ||
    !isResolvedTenantReadFacts(value.tenantFacts) ||
    parsePublicationContentExposure(value.contentExposure) === null ||
    !isValidDate(value.now)
  ) {
    return false;
  }

  return (
    value.audienceDecision === undefined ||
    isPublicationAudienceDecision(value.audienceDecision)
  );
}

function denied(code: ResourceReadDenialCode): ReadPublicationResult {
  return { outcome: "DENIED", code };
}

/**
 * Server-side read orchestration. Repository scope is established before the
 * canonical generic policy sees a hydrated Publication; denied results never
 * carry Publication data and this service performs no read-time mutation.
 */
export class ReadPublicationService {
  public constructor(
    private readonly dependencies: ReadPublicationServiceDependencies,
  ) {}

  public async getPublicationForRead(
    input: ReadPublicationInput,
  ): Promise<ReadPublicationResult> {
    if (!isReadInput(input)) {
      return denied("INVALID_INPUT");
    }

    const publication =
      await this.dependencies.publications.findPublicationByIdForTenant(
        input.tenantId,
        input.publicationId,
      );

    if (publication === null) {
      return { outcome: "NOT_FOUND" };
    }

    const resource = mapPublicationToResourceAccessFacts(
      publication,
      input.tenantFacts,
      input.contentExposure,
      input.audienceDecision,
      input.now,
    );

    if (resource === null) {
      return denied("INVALID_INPUT");
    }

    const decision = authorizeResourceRead({
      resource,
      viewer: input.viewer,
    });

    if (!decision.allowed) {
      return denied(decision.code);
    }

    return { outcome: "FOUND", publication };
  }
}
