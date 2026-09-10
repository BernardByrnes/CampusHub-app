import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  isSport,
  parseSportLifecycle,
  parseSportName,
  type Sport,
  type SportLifecycle,
  type CreateSportInput,
  type UpdateSportInput,
} from "@/domain/sports/sports";
import { isUuid } from "@/domain/identifiers/uuid";
import { db, type CampusHubDatabase } from "@/server/db/client";
import { sports, type SportRow } from "@/server/db/schema";

export type SportsMutationError =
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_STATE"
  | "NOT_READY"
  | "PERSISTENCE_FAILED";

export type SportMutationResult =
  | Readonly<{ ok: true; sport: Sport }>
  | Readonly<{ ok: false; error: SportsMutationError }>;

export type SportListOptions = Readonly<{
  status?: SportLifecycle;
  limit?: number;
}>;

export type SportRepositoryTransactionDatabase = Pick<
  CampusHubDatabase,
  "select" | "insert" | "update"
>;

function toSport(row: SportRow): Sport | null {
  const status = parseSportLifecycle(row.status);
  if (
    status === null ||
    !(row.createdAt instanceof Date) ||
    Number.isNaN(row.createdAt.getTime()) ||
    !(row.updatedAt instanceof Date) ||
    Number.isNaN(row.updatedAt.getTime())
  ) {
    return null;
  }

  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isSport(candidate) ? candidate : null;
}

function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export class DrizzleSportRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async createSportInTransaction(
    transaction: SportRepositoryTransactionDatabase,
    tenantId: string,
    input: CreateSportInput,
  ): Promise<SportMutationResult> {
    const name = parseSportName(input.name);
    if (!isUuid(tenantId) || name === null) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const rows = await transaction
        .insert(sports)
        .values({ tenantId, name })
        .returning();
      const sport = rows[0] ? toSport(rows[0]) : null;
      return sport === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, sport };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async findSportByIdForTenant(
    tenantId: string,
    sportId: string,
  ): Promise<Sport | null> {
    if (!isUuid(tenantId) || !isUuid(sportId)) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(sports)
      .where(and(eq(sports.tenantId, tenantId), eq(sports.id, sportId)))
      .limit(1);
    return rows[0] ? toSport(rows[0]) : null;
  }

  public async listSportsForTenant(
    tenantId: string,
    options: SportListOptions = {},
  ): Promise<readonly Sport[]> {
    if (!isUuid(tenantId)) {
      return [];
    }

    const scope =
      options.status === undefined
        ? eq(sports.tenantId, tenantId)
        : and(
            eq(sports.tenantId, tenantId),
            eq(sports.status, options.status),
          );
    const limit =
      typeof options.limit === "number" &&
      Number.isSafeInteger(options.limit) &&
      options.limit >= 1 &&
      options.limit <= 100
        ? options.limit
        : 50;

    const rows = await this.database
      .select()
      .from(sports)
      .where(scope)
      .orderBy(asc(sports.name), asc(sports.id))
      .limit(limit);
    return rows.flatMap((row) => {
      const sport = toSport(row);
      return sport === null ? [] : [sport];
    });
  }

  public async updateSportInTransaction(
    transaction: SportRepositoryTransactionDatabase,
    tenantId: string,
    sportId: string,
    input: UpdateSportInput,
  ): Promise<SportMutationResult> {
    const name = parseSportName(input.name);
    if (
      !isUuid(tenantId) ||
      !isUuid(sportId) ||
      name === null ||
      !isPositiveVersion(input.expectedVersion)
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const existingRows = await transaction
        .select()
        .from(sports)
        .where(and(eq(sports.tenantId, tenantId), eq(sports.id, sportId)))
        .for("update")
        .limit(1);
      const existing = existingRows[0] ? toSport(existingRows[0]) : null;
      if (existing === null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }

      const rows = await transaction
        .update(sports)
        .set({
          name,
          version: sql`${sports.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sports.tenantId, tenantId),
            eq(sports.id, sportId),
            eq(sports.version, input.expectedVersion),
          ),
        )
        .returning();
      const sport = rows[0] ? toSport(rows[0]) : null;
      return sport === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, sport };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async deactivateSportInTransaction(
    transaction: SportRepositoryTransactionDatabase,
    tenantId: string,
    sportId: string,
    expectedVersion: number,
  ): Promise<SportMutationResult> {
    if (
      !isUuid(tenantId) ||
      !isUuid(sportId) ||
      !isPositiveVersion(expectedVersion)
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const existingRows = await transaction
        .select()
        .from(sports)
        .where(and(eq(sports.tenantId, tenantId), eq(sports.id, sportId)))
        .for("update")
        .limit(1);
      const existing = existingRows[0] ? toSport(existingRows[0]) : null;
      if (existing === null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (existing.version !== expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }
      if (existing.status === "inactive") {
        return { ok: false, error: "INVALID_STATE" };
      }

      const rows = await transaction
        .update(sports)
        .set({
          status: "inactive",
          version: sql`${sports.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sports.tenantId, tenantId),
            eq(sports.id, sportId),
            eq(sports.version, expectedVersion),
            eq(sports.status, "active"),
          ),
        )
        .returning();
      const sport = rows[0] ? toSport(rows[0]) : null;
      return sport === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, sport };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }
}
