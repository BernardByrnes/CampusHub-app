import "server-only";

import { isUuid } from "@/domain/identifiers/uuid";
import {
  isResourceReadViewer,
  type ResourceReadViewer,
} from "@/domain/authorization/resource-read-policy";
import {
  isResolvedTenantReadFacts,
  type ResolvedTenantReadFacts,
} from "@/domain/authorization/publication-read-contract";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { Publication } from "@/domain/content/publication";
import { isValidIanaTimezone } from "@/domain/tenancy/tenant";
import {
  ListPublicationsService,
  type ListPublicationsInput,
  type ListPublicationsResult,
} from "./list-publications";
import {
  ReadPublicationService,
  type ReadPublicationInput,
  type ReadPublicationResult,
} from "./read-publication";

export type CampusHomeRequest = Readonly<{
  context: TrustedRequestContext;
  tenantFacts: ResolvedTenantReadFacts;
  tenantDisplayName: string;
  tenantTimezone: string;
}>;

export type CampusHomeFeedInput = CampusHomeRequest &
  Readonly<{
    cursor?: string | null;
    limit?: number;
    now: Date;
  }>;

export type CampusHomeDetailInput = CampusHomeRequest &
  Readonly<{
    publicationId: string;
    now: Date;
  }>;

export type CampusHomePublicationCard = Readonly<{
  id: string;
  type: Publication["type"];
  priority: Publication["priority"];
  title: string;
  excerpt: string;
  authorOfficeLabel: string;
  publishedAt: Date;
  publishedAtLabel: string;
}>;

export type CampusHomePublicationDetail = CampusHomePublicationCard &
  Readonly<{
    body: string;
  }>;

export type CampusHomeFeedResult =
  | Readonly<{
      outcome: "READY";
      tenantDisplayName: string;
      items: readonly CampusHomePublicationCard[];
      nextCursor: string | null;
    }>
  | Readonly<{ outcome: "UNAVAILABLE" }>;

export type CampusHomeDetailResult =
  | Readonly<{
      outcome: "FOUND";
      publication: CampusHomePublicationDetail;
    }>
  | Readonly<{ outcome: "NOT_FOUND" }>;

export type CampusHomeServiceDependencies = Readonly<{
  listPublications: Pick<ListPublicationsService, "listPublications">;
  readPublication: Pick<ReadPublicationService, "getPublicationForRead">;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isCampusHomeRequest(value: unknown): value is CampusHomeRequest {
  if (!isRecord(value) || !isRecord(value.context)) {
    return false;
  }

  const context = value.context as TrustedRequestContext;
  const viewer: ResourceReadViewer = {
    kind: "membership",
    context,
  };

  return (
    isResourceReadViewer(viewer) &&
    isResolvedTenantReadFacts(value.tenantFacts) &&
    value.tenantFacts.tenantId === context.tenantId &&
    value.tenantFacts.tenantStatus === context.tenantStatus &&
    isUuid(context.tenantId) &&
    isUuid(context.membershipId) &&
    isNonEmptyString(value.tenantDisplayName) &&
    isValidIanaTimezone(value.tenantTimezone)
  );
}

function isCampusHomeFeedInput(value: unknown): value is CampusHomeFeedInput {
  if (!isCampusHomeRequest(value) || !isRecord(value)) {
    return false;
  }

  const candidate = value as CampusHomeFeedInput;
  return (
    isValidDate(candidate.now) &&
    (candidate.cursor === undefined ||
      candidate.cursor === null ||
      typeof candidate.cursor === "string")
  );
}

function isCampusHomeDetailInput(
  value: unknown,
): value is CampusHomeDetailInput {
  return (
    isCampusHomeRequest(value) &&
    isRecord(value) &&
    isUuid((value as CampusHomeDetailInput).publicationId) &&
    isValidDate((value as CampusHomeDetailInput).now)
  );
}

function excerptFromBody(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length > 180
    ? `${compact.slice(0, 177).trimEnd()}…`
    : compact;
}

function formatPublicationTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(date);
}

function mapPublicationToCard(
  publication: Publication,
  timezone: string,
): CampusHomePublicationCard | null {
  if (publication.publishAt === null) {
    return null;
  }

  return {
    id: publication.id,
    type: publication.type,
    priority: publication.priority,
    title: publication.title,
    excerpt: excerptFromBody(publication.body),
    authorOfficeLabel: publication.authorOfficeLabel,
    publishedAt: publication.publishAt,
    publishedAtLabel: formatPublicationTime(publication.publishAt, timezone),
  };
}

function mapPublicationToDetail(
  publication: Publication,
  timezone: string,
): CampusHomePublicationDetail | null {
  const card = mapPublicationToCard(publication, timezone);
  return card === null ? null : { ...card, body: publication.body };
}

function membershipViewer(context: TrustedRequestContext): ResourceReadViewer {
  return { kind: "membership", context };
}

export class CampusHomeService {
  public constructor(
    private readonly dependencies: CampusHomeServiceDependencies,
  ) {}

  public async getFeed(
    input: CampusHomeFeedInput,
  ): Promise<CampusHomeFeedResult> {
    if (!isCampusHomeFeedInput(input)) {
      return { outcome: "UNAVAILABLE" };
    }

    const listInput: ListPublicationsInput = {
      tenantId: input.context.tenantId,
      surface: "ACTIVE",
      viewer: membershipViewer(input.context),
      tenantFacts: input.tenantFacts,
      cursor: input.cursor ?? null,
      limit: input.limit,
      now: input.now,
    };
    const result: ListPublicationsResult =
      await this.dependencies.listPublications.listPublications(listInput);

    if (result.outcome !== "OK") {
      return { outcome: "UNAVAILABLE" };
    }

    const items = result.items
      .filter((publication) =>
        publication.type === "notice" || publication.type === "news",
      )
      .map((publication) =>
        mapPublicationToCard(publication, input.tenantTimezone),
      )
      .filter(
        (publication): publication is CampusHomePublicationCard =>
          publication !== null,
      );

    return {
      outcome: "READY",
      tenantDisplayName: input.tenantDisplayName,
      items,
      nextCursor: result.nextCursor,
    };
  }

  public async getDetail(
    input: CampusHomeDetailInput,
  ): Promise<CampusHomeDetailResult> {
    if (!isCampusHomeDetailInput(input)) {
      return { outcome: "NOT_FOUND" };
    }

    const readInput: ReadPublicationInput = {
      tenantId: input.context.tenantId,
      publicationId: input.publicationId,
      viewer: membershipViewer(input.context),
      tenantFacts: input.tenantFacts,
      now: input.now,
    };
    const result: ReadPublicationResult =
      await this.dependencies.readPublication.getPublicationForRead(readInput);

    if (result.outcome !== "FOUND") {
      return { outcome: "NOT_FOUND" };
    }

    const publication = mapPublicationToDetail(
      result.publication,
      input.tenantTimezone,
    );
    return publication === null
      ? { outcome: "NOT_FOUND" }
      : { outcome: "FOUND", publication };
  }
}
