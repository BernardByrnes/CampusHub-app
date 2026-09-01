import "server-only";

import { and, eq } from "drizzle-orm";

import {
  isPublication,
  parsePublicationLifecycle,
  parsePublicationType,
  type Publication,
  type PublicationLifecycle,
  type PublicationType,
} from "@/domain/content/publication";
import {
  parseResourceVisibility,
  type ResourceVisibility,
} from "@/domain/authorization/resource-visibility";
import { db, type CampusHubDatabase } from "@/server/db/client";
import {
  publications,
  type PublicationRow,
} from "@/server/db/schema/publication";

export type CreatePublicationInput = Readonly<{
  type: PublicationType;
  title: string;
  body: string;
  visibility?: ResourceVisibility;
  lifecycle?: PublicationLifecycle;
}>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toPublication(row: PublicationRow): Publication | null {
  const type = parsePublicationType(row.type);
  const lifecycle = parsePublicationLifecycle(row.lifecycle);
  const visibility = parseResourceVisibility(row.visibility);

  if (type === null || lifecycle === null || visibility === null) {
    return null;
  }

  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    type,
    title: row.title,
    body: row.body,
    visibility,
    lifecycle,
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
      !isNonEmptyString(tenantId) ||
      typeof input !== "object" ||
      input === null
    ) {
      return null;
    }

    const candidate = input as Record<string, unknown>;
    const type = parsePublicationType(candidate.type);
    const lifecycle =
      candidate.lifecycle === undefined
        ? "draft"
        : parsePublicationLifecycle(candidate.lifecycle);
    const visibility =
      candidate.visibility === undefined
        ? "MEMBERS"
        : parseResourceVisibility(candidate.visibility);

    if (
      type === null ||
      lifecycle === null ||
      visibility === null ||
      !isNonEmptyString(candidate.title) ||
      !isNonEmptyString(candidate.body)
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
        visibility,
        lifecycle,
      })
      .returning();

    return rows[0] ? toPublication(rows[0]) : null;
  }

  public async findPublicationByIdForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<Publication | null> {
    if (!isNonEmptyString(tenantId) || !isNonEmptyString(publicationId)) {
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
}
