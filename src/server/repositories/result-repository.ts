import "server-only";

import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, or, sql } from "drizzle-orm";

import {
  isResult,
  isResultRevision,
  parseResultExpectedVersion,
  parseResultHistoryLimit,
  parseResultReason,
  parseResultScore,
  parseResultLifecycle,
  type CorrectResultInput,
  type CreateResultInput,
  type Result,
  type ResultRevision,
  type UpdateResultDraftInput,
} from "@/domain/sports/results";
import { isUuid } from "@/domain/identifiers/uuid";
import { db, type CampusHubDatabase } from "@/server/db/client";
import {
  campuses,
  competitions,
  fixtures,
  resultRevisions,
  results,
  sports,
  teams,
  type ResultRevisionRow,
  type ResultRow,
} from "@/server/db/schema";
import type {
  SportRepositoryTransactionDatabase,
  SportsMutationError,
} from "./sport-repository";

export type ResultMutationResult =
  | Readonly<{ ok: true; result: Result; revision?: ResultRevision }>
  | Readonly<{ ok: false; error: SportsMutationError }>;

export type ResultHistoryReadResult =
  | Readonly<{ ok: true; items: readonly ResultRevision[] }>
  | Readonly<{ ok: false; error: "NOT_FOUND" }>;

export type ResultRepositoryTransactionDatabase =
  SportRepositoryTransactionDatabase;

export type ResultListOptions = Readonly<{
  fixtureId?: string;
  sportName?: string;
  competitionName?: string;
  teamName?: string;
  limit?: number;
}>;

export type ResultListItem = Readonly<{
  result: Result;
  revision: ResultRevision;
  sportName: string;
  competitionName: string;
  homeTeamName: string;
  awayTeamName: string;
  campusLabel: string;
  startsAt: Date;
  venue: string;
}>;

export type ManagedResultListItem = Readonly<
  Omit<ResultListItem, "revision"> & {
    revision: ResultRevision | null;
  }
>;

function toResult(row: ResultRow): Result | null {
  const lifecycle = parseResultLifecycle(row.lifecycle);
  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    fixtureId: row.fixtureId,
    lifecycle,
    draftHomeScore: row.draftHomeScore,
    draftAwayScore: row.draftAwayScore,
    currentRevisionNumber: row.currentRevisionNumber,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return lifecycle === null || !isResult(candidate) ? null : candidate;
}

function toRevision(row: ResultRevisionRow): ResultRevision | null {
  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    resultId: row.resultId,
    revisionNumber: row.revisionNumber,
    homeScore: row.homeScore,
    awayScore: row.awayScore,
    actorMembershipId: row.actorMembershipId,
    correctionReason: row.correctionReason,
    createdAt: row.createdAt,
  };
  return isResultRevision(candidate) ? candidate : null;
}

function normalizedLimit(value: unknown): number {
  return parseResultHistoryLimit(value) ?? 50;
}

function scorePair(
  homeScore: unknown,
  awayScore: unknown,
): { homeScore: number; awayScore: number } | null {
  const home = parseResultScore(homeScore);
  const away = parseResultScore(awayScore);
  return home === null || away === null
    ? null
    : { homeScore: home, awayScore: away };
}

export class DrizzleResultRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async createResultInTransaction(
    transaction: ResultRepositoryTransactionDatabase,
    tenantId: string,
    input: CreateResultInput,
  ): Promise<ResultMutationResult> {
    const scores = scorePair(input.homeScore, input.awayScore);
    if (!isUuid(tenantId) || !isUuid(input.fixtureId) || scores === null) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const fixtureRows = await transaction
        .select()
        .from(fixtures)
        .where(and(eq(fixtures.tenantId, tenantId), eq(fixtures.id, input.fixtureId)))
        .for("update")
        .limit(1);
      const fixture = fixtureRows[0];
      if (fixture === undefined) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (fixture.state !== "completed") {
        return { ok: false, error: "NOT_READY" };
      }

      const existingRows = await transaction
        .select()
        .from(results)
        .where(and(eq(results.tenantId, tenantId), eq(results.fixtureId, input.fixtureId)))
        .for("update")
        .limit(1);
      if (existingRows[0] !== undefined) {
        return { ok: false, error: "INVALID_STATE" };
      }

      const rows = await transaction
        .insert(results)
        .values({
          tenantId,
          fixtureId: input.fixtureId,
          lifecycle: "draft",
          draftHomeScore: scores.homeScore,
          draftAwayScore: scores.awayScore,
          currentRevisionNumber: null,
          version: 1,
        })
        .returning();
      const result = rows[0] ? toResult(rows[0]) : null;
      return result === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, result };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async findResultByIdForTenant(
    tenantId: string,
    resultId: string,
  ): Promise<Result | null> {
    if (!isUuid(tenantId) || !isUuid(resultId)) {
      return null;
    }
    const rows = await this.database
      .select()
      .from(results)
      .where(and(eq(results.tenantId, tenantId), eq(results.id, resultId)))
      .limit(1);
    return rows[0] ? toResult(rows[0]) : null;
  }

  public async listPublishedResultsForTenant(
    tenantId: string,
    options: ResultListOptions = {},
  ): Promise<readonly ResultListItem[]> {
    const items = await this.listResultItemsForTenant(tenantId, options, false);
    return items.flatMap((item) => {
      if (item.revision === null) return [];
      const publishedItem: ResultListItem = {
        ...item,
        revision: item.revision,
      };
      return [publishedItem];
    });
  }

  public async listManagedResultsForTenant(
    tenantId: string,
    options: ResultListOptions = {},
  ): Promise<readonly ManagedResultListItem[]> {
    return this.listResultItemsForTenant(tenantId, options, true);
  }

  private async listResultItemsForTenant(
    tenantId: string,
    options: ResultListOptions,
    includeDrafts: boolean,
  ): Promise<readonly ManagedResultListItem[]> {
    if (
      !isUuid(tenantId) ||
      (options.fixtureId !== undefined && !isUuid(options.fixtureId))
    ) {
      return [];
    }

    const homeTeams = alias(teams, "result_home_team");
    const awayTeams = alias(teams, "result_away_team");
    const clauses = [eq(results.tenantId, tenantId)];
    if (!includeDrafts) clauses.push(eq(results.lifecycle, "published"));
    if (options.fixtureId !== undefined) {
      clauses.push(eq(results.fixtureId, options.fixtureId));
    }
    if (options.sportName !== undefined) {
      clauses.push(eq(sports.name, options.sportName));
    }
    if (options.competitionName !== undefined) {
      clauses.push(eq(competitions.name, options.competitionName));
    }
    if (options.teamName !== undefined) {
      clauses.push(
        or(eq(homeTeams.name, options.teamName), eq(awayTeams.name, options.teamName))!,
      );
    }

    const rows = await this.database
      .select({
        result: results,
        revision: resultRevisions,
        sportName: sports.name,
        competitionName: competitions.name,
        homeTeamName: homeTeams.name,
        awayTeamName: awayTeams.name,
        campusLabel: campuses.label,
        startsAt: fixtures.startsAt,
        venue: fixtures.venue,
      })
      .from(results)
      .innerJoin(
        fixtures,
        and(eq(fixtures.tenantId, results.tenantId), eq(fixtures.id, results.fixtureId)),
      )
      .innerJoin(
        competitions,
        and(eq(competitions.tenantId, fixtures.tenantId), eq(competitions.id, fixtures.competitionId)),
      )
      .innerJoin(
        sports,
        and(eq(sports.tenantId, competitions.tenantId), eq(sports.id, competitions.sportId)),
      )
      .innerJoin(
        homeTeams,
        and(eq(homeTeams.tenantId, fixtures.tenantId), eq(homeTeams.id, fixtures.homeTeamId)),
      )
      .innerJoin(
        awayTeams,
        and(eq(awayTeams.tenantId, fixtures.tenantId), eq(awayTeams.id, fixtures.awayTeamId)),
      )
      .innerJoin(
        campuses,
        and(eq(campuses.tenantId, fixtures.tenantId), eq(campuses.id, fixtures.campusId)),
      )
      .leftJoin(
        resultRevisions,
        and(
          eq(resultRevisions.tenantId, results.tenantId),
          eq(resultRevisions.resultId, results.id),
          eq(resultRevisions.revisionNumber, results.currentRevisionNumber!),
        ),
      )
      .where(and(...clauses))
      .orderBy(desc(results.updatedAt), desc(results.id))
      .limit(normalizedLimit(options.limit));

    return rows.flatMap((row) => {
      const result = toResult(row.result);
      const revision = row.revision === null ? null : toRevision(row.revision);
      if (
        result === null ||
        (result.lifecycle === "published" && revision === null) ||
        (result.lifecycle === "draft" && revision !== null)
      ) {
        return [];
      }
      return [
        {
          result,
          revision,
          sportName: row.sportName,
          competitionName: row.competitionName,
          homeTeamName: row.homeTeamName,
          awayTeamName: row.awayTeamName,
          campusLabel: row.campusLabel,
          startsAt: row.startsAt,
          venue: row.venue,
        },
      ];
    });
  }

  public async listResultRevisionsForTenant(
    tenantId: string,
    resultId: string,
    limit = 50,
  ): Promise<ResultHistoryReadResult> {
    if (!isUuid(tenantId) || !isUuid(resultId)) {
      return { ok: false, error: "NOT_FOUND" };
    }
    const resultRows = await this.database
      .select({ lifecycle: results.lifecycle })
      .from(results)
      .where(and(eq(results.tenantId, tenantId), eq(results.id, resultId)))
      .limit(1);
    if (resultRows[0]?.lifecycle !== "published") {
      return { ok: false, error: "NOT_FOUND" };
    }
    const rows = await this.database
      .select()
      .from(resultRevisions)
      .where(
        and(eq(resultRevisions.tenantId, tenantId), eq(resultRevisions.resultId, resultId)),
      )
      .orderBy(desc(resultRevisions.revisionNumber))
      .limit(normalizedLimit(limit));
    const items = rows.flatMap((row) => {
      const revision = toRevision(row);
      return revision === null ? [] : [revision];
    }).reverse();
    return { ok: true, items };
  }

  public async updateDraftResultInTransaction(
    transaction: ResultRepositoryTransactionDatabase,
    tenantId: string,
    resultId: string,
    input: UpdateResultDraftInput,
  ): Promise<ResultMutationResult> {
    const scores = scorePair(input.homeScore, input.awayScore);
    if (
      !isUuid(tenantId) ||
      !isUuid(resultId) ||
      scores === null ||
      parseResultExpectedVersion(input.expectedVersion) === null
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const rows = await transaction
        .select()
        .from(results)
        .where(and(eq(results.tenantId, tenantId), eq(results.id, resultId)))
        .for("update")
        .limit(1);
      const existing = rows[0] ? toResult(rows[0]) : null;
      if (existing === null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }
      if (existing.lifecycle !== "draft") {
        return { ok: false, error: "INVALID_STATE" };
      }

      const updatedRows = await transaction
        .update(results)
        .set({
          draftHomeScore: scores.homeScore,
          draftAwayScore: scores.awayScore,
          version: sql`${results.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(results.tenantId, tenantId),
            eq(results.id, resultId),
            eq(results.version, input.expectedVersion),
          ),
        )
        .returning();
      const result = updatedRows[0] ? toResult(updatedRows[0]) : null;
      return result === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, result };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async publishResultInTransaction(
    transaction: ResultRepositoryTransactionDatabase,
    tenantId: string,
    resultId: string,
    input: { expectedVersion: number },
    actorMembershipId: string,
    occurredAt: Date,
  ): Promise<ResultMutationResult> {
    if (
      !isUuid(tenantId) ||
      !isUuid(resultId) ||
      !isUuid(actorMembershipId) ||
      parseResultExpectedVersion(input.expectedVersion) === null ||
      !(occurredAt instanceof Date) ||
      Number.isNaN(occurredAt.getTime())
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const unlockedRows = await transaction
        .select({ fixtureId: results.fixtureId })
        .from(results)
        .where(and(eq(results.tenantId, tenantId), eq(results.id, resultId)))
        .limit(1);
      const unlocked = unlockedRows[0];
      if (unlocked === undefined) {
        return { ok: false, error: "NOT_FOUND" };
      }

      const fixtureRows = await transaction
        .select()
        .from(fixtures)
        .where(and(eq(fixtures.tenantId, tenantId), eq(fixtures.id, unlocked.fixtureId)))
        .for("update")
        .limit(1);
      const fixture = fixtureRows[0];
      if (fixture === undefined) {
        return { ok: false, error: "NOT_READY" };
      }

      const resultRows = await transaction
        .select()
        .from(results)
        .where(and(eq(results.tenantId, tenantId), eq(results.id, resultId)))
        .for("update")
        .limit(1);
      const existing = resultRows[0] ? toResult(resultRows[0]) : null;
      if (existing === null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }
      if (existing.lifecycle !== "draft") {
        return { ok: false, error: "INVALID_STATE" };
      }
      if (fixture.state !== "completed") {
        return { ok: false, error: "NOT_READY" };
      }
      const scores = scorePair(existing.draftHomeScore, existing.draftAwayScore);
      if (scores === null) {
        return { ok: false, error: "NOT_READY" };
      }

      const revisionRows = await transaction
        .insert(resultRevisions)
        .values({
          tenantId,
          resultId,
          revisionNumber: 1,
          homeScore: scores.homeScore,
          awayScore: scores.awayScore,
          actorMembershipId,
          correctionReason: null,
          createdAt: occurredAt,
        })
        .returning();
      const revision = revisionRows[0] ? toRevision(revisionRows[0]) : null;
      if (revision === null) {
        return { ok: false, error: "PERSISTENCE_FAILED" };
      }

      const updatedRows = await transaction
        .update(results)
        .set({
          lifecycle: "published",
          draftHomeScore: null,
          draftAwayScore: null,
          currentRevisionNumber: 1,
          version: sql`${results.version} + 1`,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(results.tenantId, tenantId),
            eq(results.id, resultId),
            eq(results.version, input.expectedVersion),
          ),
        )
        .returning();
      const result = updatedRows[0] ? toResult(updatedRows[0]) : null;
      return result === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, result, revision };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async correctResultInTransaction(
    transaction: ResultRepositoryTransactionDatabase,
    tenantId: string,
    resultId: string,
    input: CorrectResultInput,
    actorMembershipId: string,
    occurredAt: Date,
  ): Promise<ResultMutationResult> {
    const scores = scorePair(input.homeScore, input.awayScore);
    const reason = parseResultReason(input.reason);
    if (
      !isUuid(tenantId) ||
      !isUuid(resultId) ||
      !isUuid(actorMembershipId) ||
      scores === null ||
      reason === null ||
      parseResultExpectedVersion(input.expectedVersion) === null ||
      !(occurredAt instanceof Date) ||
      Number.isNaN(occurredAt.getTime())
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const resultRows = await transaction
        .select()
        .from(results)
        .where(and(eq(results.tenantId, tenantId), eq(results.id, resultId)))
        .for("update")
        .limit(1);
      const existing = resultRows[0] ? toResult(resultRows[0]) : null;
      if (existing === null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }
      if (
        existing.lifecycle !== "published" ||
        existing.currentRevisionNumber === null
      ) {
        return { ok: false, error: "INVALID_STATE" };
      }

      const nextRevisionNumber = existing.currentRevisionNumber + 1;
      const revisionRows = await transaction
        .insert(resultRevisions)
        .values({
          tenantId,
          resultId,
          revisionNumber: nextRevisionNumber,
          homeScore: scores.homeScore,
          awayScore: scores.awayScore,
          actorMembershipId,
          correctionReason: reason,
          createdAt: occurredAt,
        })
        .returning();
      const revision = revisionRows[0] ? toRevision(revisionRows[0]) : null;
      if (revision === null) {
        return { ok: false, error: "PERSISTENCE_FAILED" };
      }

      const updatedRows = await transaction
        .update(results)
        .set({
          currentRevisionNumber: nextRevisionNumber,
          version: sql`${results.version} + 1`,
          updatedAt: occurredAt,
        })
        .where(
          and(
            eq(results.tenantId, tenantId),
            eq(results.id, resultId),
            eq(results.version, input.expectedVersion),
          ),
        )
        .returning();
      const result = updatedRows[0] ? toResult(updatedRows[0]) : null;
      return result === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, result, revision };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }
}
