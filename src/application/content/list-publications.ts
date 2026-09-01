import "server-only";

import {
  authorizeResourceRead,
  isResourceReadViewer,
  type ResourceReadDenialCode,
  type ResourceReadViewer,
} from "@/domain/authorization/resource-read-policy";
import {
  isResolvedTenantReadFacts,
  parsePublicationContentExposure,
  type PublicationContentExposure,
  type ResolvedTenantReadFacts,
} from "@/domain/authorization/publication-read-contract";
import { mapPublicationToResourceAccessFacts } from "@/domain/authorization/publication-read-mapper";
import {
  decodePublicationCursor,
  encodePublicationCursor,
  isPublicationCollectionCursor,
  MAX_PUBLICATION_CANDIDATES_SCANNED,
  MAX_PUBLICATION_COLLECTION_QUERY_ROUNDS,
  MIN_PUBLICATION_CANDIDATE_BATCH_SIZE,
  normalizePublicationPageSize,
  parsePublicationCollectionSurface,
  PUBLICATION_COLLECTION_OVERFETCH_FACTOR,
  type PublicationCollectionCandidatePage,
  type PublicationCollectionCursor,
  type PublicationCollectionQuery,
  type PublicationCollectionSurface,
} from "@/domain/content/publication-collection";
import type { Publication } from "@/domain/content/publication";
import { isUuid } from "@/domain/identifiers/uuid";
import type { PublicationExposureResolver } from "./publication-read-resolvers";

export type { PublicationExposureResolver } from "./publication-read-resolvers";

export type PublicationCollectionRepository = Readonly<{
  listPublicationCandidatesForTenant(
    input: PublicationCollectionQuery,
  ): Promise<PublicationCollectionCandidatePage>;
}>;

export type ListPublicationsServiceDependencies = Readonly<{
  publications: PublicationCollectionRepository;
  exposureResolver?: PublicationExposureResolver;
}>;

export type ListPublicationsInput = Readonly<{
  tenantId: string;
  surface: PublicationCollectionSurface;
  viewer: ResourceReadViewer;
  tenantFacts: ResolvedTenantReadFacts;
  cursor?: string | null;
  limit?: number;
  now: Date;
}>;

export const PUBLICATION_COLLECTION_DENIAL_CODES = [
  "INVALID_INPUT",
  "INVALID_CURSOR",
  "EXPOSURE_UNAVAILABLE",
] as const;

export type PublicationCollectionDenialCode =
  (typeof PUBLICATION_COLLECTION_DENIAL_CODES)[number];

export type ListPublicationsResult =
  | Readonly<{
      outcome: "OK";
      items: Publication[];
      nextCursor: string | null;
    }>
  | Readonly<{
      outcome: "DENIED";
      code: PublicationCollectionDenialCode | ResourceReadDenialCode;
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isListInput(value: unknown): value is ListPublicationsInput {
  return (
    isRecord(value) &&
    isUuid(value.tenantId) &&
    parsePublicationCollectionSurface(value.surface) !== null &&
    isResourceReadViewer(value.viewer) &&
    isResolvedTenantReadFacts(value.tenantFacts) &&
    isValidDate(value.now) &&
    (value.cursor === undefined ||
      value.cursor === null ||
      typeof value.cursor === "string")
  );
}

function ok(
  items: Publication[],
  nextCursor: string | null,
): ListPublicationsResult {
  return { outcome: "OK", items, nextCursor };
}

function denied(
  code: PublicationCollectionDenialCode | ResourceReadDenialCode,
): ListPublicationsResult {
  return { outcome: "DENIED", code };
}

function viewerTenantId(viewer: ResourceReadViewer): string {
  return viewer.kind === "anonymous"
    ? viewer.tenantId
    : viewer.context.tenantId;
}

function cursorForPublication(
  publication: Publication,
): PublicationCollectionCursor | null {
  if (publication.publishAt === null) {
    return null;
  }

  const cursor = { publishAt: publication.publishAt, id: publication.id };
  return isPublicationCollectionCursor(cursor) ? cursor : null;
}

function isExposureMap(
  value: unknown,
): value is ReadonlyMap<string, PublicationContentExposure> {
  return value instanceof Map;
}

/**
 * Server-side collection orchestration. Trust binding and cursor validation
 * happen before PostgreSQL; candidates are tenant-scoped, exposure-resolved
 * in batches, mapped, and then passed to the canonical resource-read policy.
 */
export class ListPublicationsService {
  public constructor(
    private readonly dependencies: ListPublicationsServiceDependencies,
  ) {}

  public async listPublications(
    input: ListPublicationsInput,
  ): Promise<ListPublicationsResult> {
    if (!isListInput(input)) {
      return denied("INVALID_INPUT");
    }

    const requestedViewerTenantId = viewerTenantId(input.viewer);
    if (requestedViewerTenantId !== input.tenantId) {
      return ok([], null);
    }

    if (
      input.tenantFacts.tenantId !== input.tenantId ||
      (input.viewer.kind === "membership" &&
        input.viewer.context.tenantStatus !== input.tenantFacts.tenantStatus)
    ) {
      return denied("INVALID_INPUT");
    }

    let cursor: PublicationCollectionCursor | null = null;
    if (input.cursor !== undefined && input.cursor !== null) {
      cursor = decodePublicationCursor(input.cursor);
      if (cursor === null) {
        return denied("INVALID_CURSOR");
      }
    }

    if (this.dependencies.exposureResolver === undefined) {
      return denied("EXPOSURE_UNAVAILABLE");
    }

    const pageSize = normalizePublicationPageSize(input.limit);
    const candidateBatchSize = Math.min(
      Math.max(
        pageSize * PUBLICATION_COLLECTION_OVERFETCH_FACTOR,
        MIN_PUBLICATION_CANDIDATE_BATCH_SIZE,
      ),
      MAX_PUBLICATION_CANDIDATES_SCANNED,
    );
    const authorizedItems: Publication[] = [];
    let scannedCandidates = 0;
    let lastScanned: Publication | null = null;
    let hasMoreAfterScan = false;
    let queryRounds = 0;

    while (
      scannedCandidates < MAX_PUBLICATION_CANDIDATES_SCANNED &&
      authorizedItems.length < pageSize &&
      queryRounds < MAX_PUBLICATION_COLLECTION_QUERY_ROUNDS
    ) {
      queryRounds += 1;
      const remainingScanBudget =
        MAX_PUBLICATION_CANDIDATES_SCANNED - scannedCandidates;
      const batchLimit = Math.min(candidateBatchSize, remainingScanBudget);
      const query: PublicationCollectionQuery = {
        tenantId: input.tenantId,
        surface: input.surface,
        now: input.now,
        cursor,
        limit: batchLimit,
      };
      const candidatePage =
        await this.dependencies.publications.listPublicationCandidatesForTenant(
          query,
        );

      if (candidatePage.items.length === 0) {
        hasMoreAfterScan = false;
        break;
      }

      let exposureById: unknown;
      try {
        exposureById = await this.dependencies.exposureResolver.resolveExposure(
          candidatePage.items,
        );
      } catch {
        return denied("EXPOSURE_UNAVAILABLE");
      }

      if (!isExposureMap(exposureById)) {
        return denied("EXPOSURE_UNAVAILABLE");
      }

      let stoppedInsideBatch = false;
      for (
        let index = 0;
        index < candidatePage.items.length &&
        scannedCandidates < MAX_PUBLICATION_CANDIDATES_SCANNED;
        index += 1
      ) {
        const candidate = candidatePage.items[index];
        scannedCandidates += 1;
        lastScanned = candidate;

        const contentExposure = parsePublicationContentExposure(
          exposureById.get(candidate.id),
        );
        if (contentExposure === null) {
          continue;
        }

        const resource = mapPublicationToResourceAccessFacts(
          candidate,
          input.tenantFacts,
          contentExposure,
          undefined,
          input.now,
        );
        if (resource === null) {
          continue;
        }

        const decision = authorizeResourceRead({
          resource,
          viewer: input.viewer,
        });
        if (!decision.allowed) {
          continue;
        }

        authorizedItems.push(candidate);
        if (authorizedItems.length >= pageSize) {
          stoppedInsideBatch = true;
          hasMoreAfterScan =
            index < candidatePage.items.length - 1 ||
            candidatePage.hasMoreCandidateRows;
          break;
        }
      }

      if (stoppedInsideBatch || authorizedItems.length >= pageSize) {
        break;
      }

      if (scannedCandidates >= MAX_PUBLICATION_CANDIDATES_SCANNED) {
        hasMoreAfterScan = candidatePage.hasMoreCandidateRows;
        break;
      }

      if (queryRounds >= MAX_PUBLICATION_COLLECTION_QUERY_ROUNDS) {
        hasMoreAfterScan = candidatePage.hasMoreCandidateRows;
        break;
      }

      if (!candidatePage.hasMoreCandidateRows) {
        hasMoreAfterScan = false;
        break;
      }

      if (lastScanned === null) {
        return denied("INVALID_INPUT");
      }

      cursor = cursorForPublication(lastScanned);
      if (cursor === null) {
        return denied("INVALID_INPUT");
      }
    }

    if (!hasMoreAfterScan || lastScanned === null) {
      return ok(authorizedItems, null);
    }

    const nextCursorValue = cursorForPublication(lastScanned);
    if (nextCursorValue === null) {
      return denied("INVALID_INPUT");
    }

    const nextCursor = encodePublicationCursor(nextCursorValue);
    return nextCursor === null
      ? denied("INVALID_INPUT")
      : ok(authorizedItems, nextCursor);
  }
}
