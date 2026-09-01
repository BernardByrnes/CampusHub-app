import "server-only";

import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";

import {
  isPublication,
  parsePublicationAudienceMode,
  parsePublicationLifecycle,
  parsePublicationPriority,
  parsePublicationType,
  type Publication,
  type PublicationAudienceMode,
  type PublicationLifecycle,
  type PublicationPriority,
  type PublicationType,
} from "@/domain/content/publication";
import {
  parseResourceVisibility,
  type ResourceVisibility,
} from "@/domain/authorization/resource-visibility";
import { isUuid } from "@/domain/identifiers/uuid";
import {
  isPublicationCollectionCursor,
  MAX_PUBLICATION_CANDIDATES_SCANNED,
  parsePublicationCollectionSurface,
  type PublicationCollectionCandidatePage,
  type PublicationCollectionQuery,
} from "@/domain/content/publication-collection";
import { db, type CampusHubDatabase } from "@/server/db/client";
import {
  publications,
  type PublicationRow,
} from "@/server/db/schema/publication";

export type CreatePublicationInput = Readonly<{
  type: PublicationType;
  title: string;
  body: string;
  priority?: PublicationPriority;
  visibility?: ResourceVisibility;
  lifecycle?: PublicationLifecycle;
  audienceMode: PublicationAudienceMode;
  authorOfficeLabel: string;
  publishAt?: Date | null;
  expiresAt?: Date | null;
}>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableDate(value: unknown): value is Date | null {
  return (
    value === null ||
    (value instanceof Date && !Number.isNaN(value.getTime()))
  );
}

function toPublication(row: PublicationRow): Publication | null {
  const type = parsePublicationType(row.type);
  const priority = parsePublicationPriority(row.priority);
  const lifecycle = parsePublicationLifecycle(row.lifecycle);
  const audienceMode = parsePublicationAudienceMode(row.audienceMode);
  const visibility = parseResourceVisibility(row.visibility);

  if (
    type === null ||
    priority === null ||
    lifecycle === null ||
    audienceMode === null ||
    visibility === null
  ) {
    return null;
  }

  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    type,
    title: row.title,
    body: row.body,
    priority,
    visibility,
    lifecycle,
    audienceMode,
    authorOfficeLabel: row.authorOfficeLabel,
    publishAt: row.publishAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  return isPublication(candidate) ? candidate : null;
}

export class DrizzlePublicationRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async createPublication(
    tenantId: string,
    input: CreatePublicationInput,
  ): Promise<Publication | null> {
    if (
      !isUuid(tenantId) ||
      typeof input !== "object" ||
      input === null
    ) {
      return null;
    }

    const candidate = input as Record<string, unknown>;
    const type = parsePublicationType(candidate.type);
    const priority =
      candidate.priority === undefined
        ? "standard"
        : parsePublicationPriority(candidate.priority);
    const lifecycle =
      candidate.lifecycle === undefined
        ? "draft"
        : parsePublicationLifecycle(candidate.lifecycle);
    const audienceMode = parsePublicationAudienceMode(candidate.audienceMode);
    const visibility =
      candidate.visibility === undefined
        ? "MEMBERS"
        : parseResourceVisibility(candidate.visibility);
    const publishAt =
      candidate.publishAt === undefined ? null : candidate.publishAt;
    const expiresAt =
      candidate.expiresAt === undefined ? null : candidate.expiresAt;

    if (
      type === null ||
      priority === null ||
      lifecycle === null ||
      audienceMode === null ||
      visibility === null ||
      !isNonEmptyString(candidate.title) ||
      !isNonEmptyString(candidate.body) ||
      !isNonEmptyString(candidate.authorOfficeLabel) ||
      !isNullableDate(publishAt) ||
      !isNullableDate(expiresAt)
    ) {
      return null;
    }

    const rows = await this.database
      .insert(publications)
      .values({
        tenantId,
        type,
        title: candidate.title,
        body: candidate.body,
        priority,
        visibility,
        lifecycle,
        audienceMode,
        authorOfficeLabel: candidate.authorOfficeLabel,
        publishAt,
        expiresAt,
      })
      .returning();

    return rows[0] ? toPublication(rows[0]) : null;
  }

  public async findPublicationByIdForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<Publication | null> {
    if (!isUuid(tenantId) || !isUuid(publicationId)) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.tenantId, tenantId),
          eq(publications.id, publicationId),
        ),
      )
      .limit(1);

    return rows[0] ? toPublication(rows[0]) : null;
  }

  public async listPublicationCandidatesForTenant(
    input: PublicationCollectionQuery,
  ): Promise<PublicationCollectionCandidatePage> {
    if (
      typeof input !== "object" ||
      input === null ||
      !isUuid(input.tenantId) ||
      parsePublicationCollectionSurface(input.surface) === null ||
      !(input.now instanceof Date) ||
      Number.isNaN(input.now.getTime()) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_PUBLICATION_CANDIDATES_SCANNED ||
      (input.cursor !== null && !isPublicationCollectionCursor(input.cursor))
    ) {
      return { items: [], hasMoreCandidateRows: false };
    }

    const historicalPublishAt = and(
      isNotNull(publications.publishAt),
      lte(publications.publishAt, input.now),
    );
    const lifecycleAndTime =
      input.surface === "ACTIVE"
        ? and(
            eq(publications.lifecycle, "published"),
            historicalPublishAt,
            or(
              isNull(publications.expiresAt),
              gt(publications.expiresAt, input.now),
            ),
          )
        : and(
            historicalPublishAt,
            or(
              inArray(publications.lifecycle, ["expired", "archived"]),
              and(
                eq(publications.lifecycle, "published"),
                isNotNull(publications.expiresAt),
                lte(publications.expiresAt, input.now),
              ),
            ),
          );
    const cursorAfter =
      input.cursor === null
        ? undefined
        : or(
            lt(publications.publishAt, input.cursor.publishAt),
            and(
              eq(publications.publishAt, input.cursor.publishAt),
              lt(publications.id, input.cursor.id),
            ),
          );
    // Targeted Publications are intentionally excluded until CH-PUB-003 has
    // a real audience evaluator. Direct B.2.2 reads may consume an explicit
    // trusted audience decision; collection reads must not invent one.
    const scope = and(
      eq(publications.tenantId, input.tenantId),
      eq(publications.audienceMode, "entire_tenant"),
      lifecycleAndTime,
      cursorAfter,
    );

    const rows = await this.database
      .select()
      .from(publications)
      .where(scope)
      .orderBy(desc(publications.publishAt), desc(publications.id))
      .limit(input.limit + 1);
    const pageRows = rows.slice(0, input.limit);

    return {
      items: pageRows
        .map((row) => toPublication(row))
        .filter((publication): publication is Publication => publication !== null),
      hasMoreCandidateRows: rows.length > input.limit,
    };
  }
}
