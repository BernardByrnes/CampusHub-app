import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  isTeam,
  parseAffiliationLabel,
  parseSportLifecycle,
  parseSportName,
  type CreateTeamInput,
  type SportLifecycle,
  type Team,
  type UpdateTeamInput,
} from "@/domain/sports/sports";
import { isUuid } from "@/domain/identifiers/uuid";
import { db, type CampusHubDatabase } from "@/server/db/client";
import { sports, teams, type TeamRow } from "@/server/db/schema";
import type {
  SportRepositoryTransactionDatabase,
  SportsMutationError,
} from "./sport-repository";

export type TeamMutationResult =
  | Readonly<{ ok: true; team: Team }>
  | Readonly<{ ok: false; error: SportsMutationError }>;

export type TeamListOptions = Readonly<{
  status?: SportLifecycle;
  sportId?: string;
  limit?: number;
}>;

export type TeamRepositoryTransactionDatabase =
  SportRepositoryTransactionDatabase;

function toTeam(row: TeamRow): Team | null {
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
    sportId: row.sportId,
    name: row.name,
    affiliationLabel: row.affiliationLabel,
    status,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isTeam(candidate) ? candidate : null;
}

function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export class DrizzleTeamRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async createTeamInTransaction(
    transaction: TeamRepositoryTransactionDatabase,
    tenantId: string,
    input: CreateTeamInput,
  ): Promise<TeamMutationResult> {
    const name = parseSportName(input.name);
    const affiliationLabel = parseAffiliationLabel(input.affiliationLabel);
    if (
      !isUuid(tenantId) ||
      !isUuid(input.sportId) ||
      name === null ||
      affiliationLabel === undefined
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
      if (sportRows[0] === undefined || sportRows[0].status !== "active") {
        return { ok: false, error: "NOT_READY" };
      }

      const rows = await transaction
        .insert(teams)
        .values({
          tenantId,
          sportId: input.sportId,
          name,
          affiliationLabel,
        })
        .returning();
      const team = rows[0] ? toTeam(rows[0]) : null;
      return team === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, team };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async findTeamByIdForTenant(
    tenantId: string,
    teamId: string,
  ): Promise<Team | null> {
    if (!isUuid(tenantId) || !isUuid(teamId)) {
      return null;
    }
    const rows = await this.database
      .select()
      .from(teams)
      .where(and(eq(teams.tenantId, tenantId), eq(teams.id, teamId)))
      .limit(1);
    return rows[0] ? toTeam(rows[0]) : null;
  }

  public async listTeamsForTenant(
    tenantId: string,
    options: TeamListOptions = {},
  ): Promise<readonly Team[]> {
    if (
      !isUuid(tenantId) ||
      (options.sportId !== undefined && !isUuid(options.sportId))
    ) {
      return [];
    }
    const clauses = [eq(teams.tenantId, tenantId)];
    if (options.status !== undefined) {
      clauses.push(eq(teams.status, options.status));
    }
    if (options.sportId !== undefined) {
      clauses.push(eq(teams.sportId, options.sportId));
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
      .from(teams)
      .where(and(...clauses))
      .orderBy(asc(teams.name), asc(teams.id))
      .limit(limit);
    return rows.flatMap((row) => {
      const team = toTeam(row);
      return team === null ? [] : [team];
    });
  }

  public async updateTeamInTransaction(
    transaction: TeamRepositoryTransactionDatabase,
    tenantId: string,
    teamId: string,
    input: UpdateTeamInput,
  ): Promise<TeamMutationResult> {
    const name = parseSportName(input.name);
    const affiliationLabel = parseAffiliationLabel(input.affiliationLabel);
    if (
      !isUuid(tenantId) ||
      !isUuid(teamId) ||
      !isUuid(input.sportId) ||
      name === null ||
      affiliationLabel === undefined ||
      !isPositiveVersion(input.expectedVersion)
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const existingRows = await transaction
        .select()
        .from(teams)
        .where(and(eq(teams.tenantId, tenantId), eq(teams.id, teamId)))
        .for("update")
        .limit(1);
      const existing = existingRows[0] ? toTeam(existingRows[0]) : null;
      if (existing === null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
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

      const rows = await transaction
        .update(teams)
        .set({
          sportId: input.sportId,
          name,
          affiliationLabel,
          version: sql`${teams.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(teams.tenantId, tenantId),
            eq(teams.id, teamId),
            eq(teams.version, input.expectedVersion),
          ),
        )
        .returning();
      const team = rows[0] ? toTeam(rows[0]) : null;
      return team === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, team };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async deactivateTeamInTransaction(
    transaction: TeamRepositoryTransactionDatabase,
    tenantId: string,
    teamId: string,
    expectedVersion: number,
  ): Promise<TeamMutationResult> {
    if (
      !isUuid(tenantId) ||
      !isUuid(teamId) ||
      !isPositiveVersion(expectedVersion)
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const existingRows = await transaction
        .select()
        .from(teams)
        .where(and(eq(teams.tenantId, tenantId), eq(teams.id, teamId)))
        .for("update")
        .limit(1);
      const existing = existingRows[0] ? toTeam(existingRows[0]) : null;
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
        .update(teams)
        .set({
          status: "inactive",
          version: sql`${teams.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(teams.tenantId, tenantId),
            eq(teams.id, teamId),
            eq(teams.version, expectedVersion),
            eq(teams.status, "active"),
          ),
        )
        .returning();
      const team = rows[0] ? toTeam(rows[0]) : null;
      return team === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, team };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }
}
