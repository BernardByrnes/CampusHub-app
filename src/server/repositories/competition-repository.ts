import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  isCompetition,
  parseCompetitionTableMode,
  parseSeasonLabel,
  parseSportLifecycle,
  parseSportName,
  type Competition,
  type CompetitionTableMode,
  type CreateCompetitionInput,
  type UpdateCompetitionInput,
} from "@/domain/sports/sports";
import { isUuid } from "@/domain/identifiers/uuid";
import { db, type CampusHubDatabase } from "@/server/db/client";
import {
  campuses,
  competitions,
  fixtures,
  sports,
  type CompetitionRow,
} from "@/server/db/schema";
import type {
  SportRepositoryTransactionDatabase,
  SportsMutationError,
} from "./sport-repository";

export type CompetitionMutationResult =
  | Readonly<{ ok: true; competition: Competition }>
  | Readonly<{ ok: false; error: SportsMutationError }>;

export type CompetitionListOptions = Readonly<{
  status?: "active" | "inactive";
  sportId?: string;
  campusId?: string;
  limit?: number;
}>;

export type CompetitionRepositoryTransactionDatabase =
  SportRepositoryTransactionDatabase;

function toCompetition(row: CompetitionRow): Competition | null {
  const tableMode = parseCompetitionTableMode(row.tableMode);
  const status = parseSportLifecycle(row.status);
  if (
    tableMode === null ||
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
    sportId: row.sportId,
    name: row.name,
    seasonLabel: row.seasonLabel,
    campusId: row.campusId,
    tableMode,
    status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isCompetition(candidate) ? candidate : null;
}

function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isValidTableMode(value: unknown): value is CompetitionTableMode {
  return parseCompetitionTableMode(value) !== null;
}

export class DrizzleCompetitionRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async createCompetitionInTransaction(
    transaction: CompetitionRepositoryTransactionDatabase,
    tenantId: string,
    input: CreateCompetitionInput,
  ): Promise<CompetitionMutationResult> {
    const name = parseSportName(input.name);
    const seasonLabel = parseSeasonLabel(input.seasonLabel);
    if (
      !isUuid(tenantId) ||
      !isUuid(input.sportId) ||
      !isUuid(input.campusId) ||
      name === null ||
      seasonLabel === null ||
      !isValidTableMode(input.tableMode)
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const sportRows = await transaction
        .select()
        .from(sports)
        .where(
          and(eq(sports.tenantId, tenantId), eq(sports.id, input.sportId)),
        )
        .for("update")
        .limit(1);
      const sport = sportRows[0];
      if (sport === undefined || sport.status !== "active") {
        return { ok: false, error: "NOT_READY" };
      }

      const campusRows = await transaction
        .select()
        .from(campuses)
        .where(
          and(
            eq(campuses.tenantId, tenantId),
            eq(campuses.id, input.campusId),
          ),
        )
        .for("update")
        .limit(1);
      const campus = campusRows[0];
      if (campus === undefined || campus.status !== "active") {
        return { ok: false, error: "NOT_READY" };
      }

      const rows = await transaction
        .insert(competitions)
        .values({
          tenantId,
          sportId: input.sportId,
          name,
          seasonLabel,
          campusId: input.campusId,
          tableMode: input.tableMode,
        })
        .returning();
      const competition = rows[0] ? toCompetition(rows[0]) : null;
      return competition === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, competition };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async findCompetitionByIdForTenant(
    tenantId: string,
    competitionId: string,
  ): Promise<Competition | null> {
    if (!isUuid(tenantId) || !isUuid(competitionId)) {
      return null;
    }
    const rows = await this.database
      .select()
      .from(competitions)
      .where(
        and(
          eq(competitions.tenantId, tenantId),
          eq(competitions.id, competitionId),
        ),
      )
      .limit(1);
    return rows[0] ? toCompetition(rows[0]) : null;
  }

  public async listCompetitionsForTenant(
    tenantId: string,
    options: CompetitionListOptions = {},
  ): Promise<readonly Competition[]> {
    if (
      !isUuid(tenantId) ||
      (options.sportId !== undefined && !isUuid(options.sportId)) ||
      (options.campusId !== undefined && !isUuid(options.campusId))
    ) {
      return [];
    }
    const clauses = [eq(competitions.tenantId, tenantId)];
    if (options.status !== undefined) {
      clauses.push(eq(competitions.status, options.status));
    }
    if (options.sportId !== undefined) {
      clauses.push(eq(competitions.sportId, options.sportId));
    }
    if (options.campusId !== undefined) {
      clauses.push(eq(competitions.campusId, options.campusId));
    }
    const limit =
      typeof options.limit === "number" &&
      Number.isSafeInteger(options.limit) &&
      options.limit >= 1 &&
      options.limit <= 100
        ? options.limit
        : 50;
    const rows = await this.database
      .select()
      .from(competitions)
      .where(and(...clauses))
      .orderBy(asc(competitions.name), asc(competitions.id))
      .limit(limit);
    return rows.flatMap((row) => {
      const competition = toCompetition(row);
      return competition === null ? [] : [competition];
    });
  }

  public async updateCompetitionInTransaction(
    transaction: CompetitionRepositoryTransactionDatabase,
    tenantId: string,
    competitionId: string,
    input: UpdateCompetitionInput,
  ): Promise<CompetitionMutationResult> {
    const name = parseSportName(input.name);
    const seasonLabel = parseSeasonLabel(input.seasonLabel);
    if (
      !isUuid(tenantId) ||
      !isUuid(competitionId) ||
      !isUuid(input.sportId) ||
      !isUuid(input.campusId) ||
      name === null ||
      seasonLabel === null ||
      !isValidTableMode(input.tableMode) ||
      !isPositiveVersion(input.expectedVersion)
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const existingRows = await transaction
        .select()
        .from(competitions)
        .where(
          and(
            eq(competitions.tenantId, tenantId),
            eq(competitions.id, competitionId),
          ),
        )
        .for("update")
        .limit(1);
      const existing = existingRows[0] ? toCompetition(existingRows[0]) : null;
      if (existing === null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }
      if (
        existing.sportId !== input.sportId ||
        existing.campusId !== input.campusId
      ) {
        const fixtureReferences = await transaction
          .select({ id: fixtures.id })
          .from(fixtures)
          .where(
            and(
              eq(fixtures.tenantId, tenantId),
              eq(fixtures.competitionId, competitionId),
            ),
          )
          .limit(1);
        if (fixtureReferences.length > 0) {
          return { ok: false, error: "INVALID_STATE" };
        }
      }

      const sportRows = await transaction
        .select()
        .from(sports)
        .where(
          and(eq(sports.tenantId, tenantId), eq(sports.id, input.sportId)),
        )
        .for("update")
        .limit(1);
      if (sportRows[0] === undefined || sportRows[0].status !== "active") {
        return { ok: false, error: "NOT_READY" };
      }

      const campusRows = await transaction
        .select()
        .from(campuses)
        .where(
          and(
            eq(campuses.tenantId, tenantId),
            eq(campuses.id, input.campusId),
          ),
        )
        .for("update")
        .limit(1);
      if (
        campusRows[0] === undefined ||
        campusRows[0].status !== "active"
      ) {
        return { ok: false, error: "NOT_READY" };
      }

      const rows = await transaction
        .update(competitions)
        .set({
          sportId: input.sportId,
          name,
          seasonLabel,
          campusId: input.campusId,
          tableMode: input.tableMode,
          version: sql`${competitions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(competitions.tenantId, tenantId),
            eq(competitions.id, competitionId),
            eq(competitions.version, input.expectedVersion),
          ),
        )
        .returning();
      const competition = rows[0] ? toCompetition(rows[0]) : null;
      return competition === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, competition };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async deactivateCompetitionInTransaction(
    transaction: CompetitionRepositoryTransactionDatabase,
    tenantId: string,
    competitionId: string,
    expectedVersion: number,
  ): Promise<CompetitionMutationResult> {
    if (
      !isUuid(tenantId) ||
      !isUuid(competitionId) ||
      !isPositiveVersion(expectedVersion)
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const existingRows = await transaction
        .select()
        .from(competitions)
        .where(
          and(
            eq(competitions.tenantId, tenantId),
            eq(competitions.id, competitionId),
          ),
        )
        .for("update")
        .limit(1);
      const existing = existingRows[0] ? toCompetition(existingRows[0]) : null;
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
        .update(competitions)
        .set({
          status: "inactive",
          version: sql`${competitions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(competitions.tenantId, tenantId),
            eq(competitions.id, competitionId),
            eq(competitions.version, expectedVersion),
            eq(competitions.status, "active"),
          ),
        )
        .returning();
      const competition = rows[0] ? toCompetition(rows[0]) : null;
      return competition === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, competition };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }
}
