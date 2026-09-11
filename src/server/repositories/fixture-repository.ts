import "server-only";

import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";

import {
  canTransitionFixture,
  isFixture,
  parseFixtureExpectedVersion,
  parseFixtureReason,
  parseFixtureState,
  parseFixtureTimestamp,
  parseFixtureVenue,
  type CreateFixtureInput,
  type Fixture,
  type FixtureState,
  type PostponeFixtureInput,
  type TransitionFixtureInput,
  type UpdateFixtureInput,
} from "@/domain/sports/fixtures";
import { isUuid } from "@/domain/identifiers/uuid";
import { db, type CampusHubDatabase } from "@/server/db/client";
import {
  campuses,
  competitions,
  fixtures,
  sports,
  teams,
  type FixtureRow,
} from "@/server/db/schema";
import type {
  SportRepositoryTransactionDatabase,
  SportsMutationError,
} from "./sport-repository";

export type FixtureMutationResult =
  | Readonly<{ ok: true; fixture: Fixture }>
  | Readonly<{ ok: false; error: SportsMutationError }>;

export type FixtureListOptions = Readonly<{
  state?: FixtureState;
  sportId?: string;
  competitionId?: string;
  teamId?: string;
  sportName?: string;
  competitionName?: string;
  teamName?: string;
  limit?: number;
  order?: "upcoming" | "recent";
}>;

export type FixtureListItem = Readonly<{
  fixture: Fixture;
  sportName: string;
  competitionName: string;
  homeTeamName: string;
  awayTeamName: string;
  campusLabel: string;
}>;

export type FixtureRepositoryTransactionDatabase =
  SportRepositoryTransactionDatabase;

function toFixture(row: FixtureRow): Fixture | null {
  const state = parseFixtureState(row.state);
  const startsAt = parseFixtureTimestamp(row.startsAt);
  const venue = parseFixtureVenue(row.venue);
  if (
    state === null ||
    startsAt === null ||
    venue === null ||
    (row.reason !== null && parseFixtureReason(row.reason) === null) ||
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
    competitionId: row.competitionId,
    homeTeamId: row.homeTeamId,
    awayTeamId: row.awayTeamId,
    campusId: row.campusId,
    startsAt,
    venue,
    state,
    reason: row.reason === null ? null : parseFixtureReason(row.reason),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isFixture(candidate) ? candidate : null;
}

function isPositiveVersion(value: unknown): value is number {
  return parseFixtureExpectedVersion(value) !== null;
}

function normalizedTeamIds(homeTeamId: string, awayTeamId: string): string[] {
  return [homeTeamId, awayTeamId].sort((left, right) => left.localeCompare(right));
}

export class DrizzleFixtureRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async createFixtureInTransaction(
    transaction: FixtureRepositoryTransactionDatabase,
    tenantId: string,
    input: CreateFixtureInput,
  ): Promise<FixtureMutationResult> {
    const startsAt = parseFixtureTimestamp(input.startsAt);
    const venue = parseFixtureVenue(input.venue);
    if (
      !isUuid(tenantId) ||
      !isUuid(input.competitionId) ||
      !isUuid(input.homeTeamId) ||
      !isUuid(input.awayTeamId) ||
      input.homeTeamId === input.awayTeamId ||
      !isUuid(input.campusId) ||
      startsAt === null ||
      venue === null
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }

    try {
      const competitionRows = await transaction
        .select()
        .from(competitions)
        .where(
          and(
            eq(competitions.tenantId, tenantId),
            eq(competitions.id, input.competitionId),
          ),
        )
        .for("update")
        .limit(1);
      const competition = competitionRows[0];
      if (
        competition === undefined ||
        competition.status !== "active" ||
        competition.campusId !== input.campusId
      ) {
        return { ok: false, error: "NOT_READY" };
      }

      const sportRows = await transaction
        .select()
        .from(sports)
        .where(
          and(
            eq(sports.tenantId, tenantId),
            eq(sports.id, competition.sportId),
          ),
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
          and(eq(campuses.tenantId, tenantId), eq(campuses.id, input.campusId)),
        )
        .for("update")
        .limit(1);
      if (campusRows[0] === undefined || campusRows[0].status !== "active") {
        return { ok: false, error: "NOT_READY" };
      }

      const teamRows = await transaction
        .select()
        .from(teams)
        .where(
          and(
            eq(teams.tenantId, tenantId),
            inArray(
              teams.id,
              normalizedTeamIds(input.homeTeamId, input.awayTeamId),
            ),
          ),
        )
        .for("update");
      const homeTeam = teamRows.find((team) => team.id === input.homeTeamId);
      const awayTeam = teamRows.find((team) => team.id === input.awayTeamId);
      if (
        homeTeam === undefined ||
        awayTeam === undefined ||
        homeTeam.status !== "active" ||
        awayTeam.status !== "active" ||
        homeTeam.sportId !== competition.sportId ||
        awayTeam.sportId !== competition.sportId
      ) {
        return { ok: false, error: "NOT_READY" };
      }

      const rows = await transaction
        .insert(fixtures)
        .values({
          tenantId,
          competitionId: input.competitionId,
          homeTeamId: input.homeTeamId,
          awayTeamId: input.awayTeamId,
          campusId: input.campusId,
          startsAt,
          venue,
          state: "scheduled",
          reason: null,
        })
        .returning();
      const fixture = rows[0] ? toFixture(rows[0]) : null;
      return fixture === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, fixture };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async findFixtureByIdForTenant(
    tenantId: string,
    fixtureId: string,
  ): Promise<Fixture | null> {
    if (!isUuid(tenantId) || !isUuid(fixtureId)) {
      return null;
    }
    const rows = await this.database
      .select()
      .from(fixtures)
      .where(and(eq(fixtures.tenantId, tenantId), eq(fixtures.id, fixtureId)))
      .limit(1);
    return rows[0] ? toFixture(rows[0]) : null;
  }

  public async listFixturesForTenant(
    tenantId: string,
    options: FixtureListOptions = {},
  ): Promise<readonly FixtureListItem[]> {
    if (
      !isUuid(tenantId) ||
      (options.sportId !== undefined && !isUuid(options.sportId)) ||
      (options.competitionId !== undefined && !isUuid(options.competitionId)) ||
      (options.teamId !== undefined && !isUuid(options.teamId))
    ) {
      return [];
    }
    const homeTeams = alias(teams, "fixture_home_team");
    const awayTeams = alias(teams, "fixture_away_team");
    const clauses = [eq(fixtures.tenantId, tenantId)];
    if (options.state !== undefined) {
      clauses.push(eq(fixtures.state, options.state));
    }
    if (options.sportId !== undefined) {
      clauses.push(eq(competitions.sportId, options.sportId));
    }
    if (options.competitionId !== undefined) {
      clauses.push(eq(fixtures.competitionId, options.competitionId));
    }
    if (options.teamId !== undefined) {
      clauses.push(
        or(eq(fixtures.homeTeamId, options.teamId), eq(fixtures.awayTeamId, options.teamId))!,
      );
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
    const limit =
      typeof options.limit === "number" &&
      Number.isSafeInteger(options.limit) &&
      options.limit >= 1 &&
      options.limit <= 100
        ? options.limit
        : 50;
    const order = options.order ?? "upcoming";
    const rows = await this.database
      .select({
        fixture: fixtures,
        sportName: sports.name,
        competitionName: competitions.name,
        homeTeamName: homeTeams.name,
        awayTeamName: awayTeams.name,
        campusLabel: campuses.label,
      })
      .from(fixtures)
      .innerJoin(
        competitions,
        and(
          eq(competitions.tenantId, fixtures.tenantId),
          eq(competitions.id, fixtures.competitionId),
        ),
      )
      .innerJoin(
        sports,
        and(
          eq(sports.tenantId, competitions.tenantId),
          eq(sports.id, competitions.sportId),
        ),
      )
      .innerJoin(
        homeTeams,
        and(
          eq(homeTeams.tenantId, fixtures.tenantId),
          eq(homeTeams.id, fixtures.homeTeamId),
        ),
      )
      .innerJoin(
        awayTeams,
        and(
          eq(awayTeams.tenantId, fixtures.tenantId),
          eq(awayTeams.id, fixtures.awayTeamId),
        ),
      )
      .innerJoin(
        campuses,
        and(
          eq(campuses.tenantId, fixtures.tenantId),
          eq(campuses.id, fixtures.campusId),
        ),
      )
      .where(and(...clauses))
      .orderBy(
        order === "recent" ? desc(fixtures.startsAt) : asc(fixtures.startsAt),
        order === "recent" ? desc(fixtures.id) : asc(fixtures.id),
      )
      .limit(limit);
    return rows.flatMap((row) => {
      const fixture = toFixture(row.fixture);
      return fixture === null
        ? []
        : [{
            fixture,
            sportName: row.sportName,
            competitionName: row.competitionName,
            homeTeamName: row.homeTeamName,
            awayTeamName: row.awayTeamName,
            campusLabel: row.campusLabel,
          }];
    });
  }

  public async updateFixtureInTransaction(
    transaction: FixtureRepositoryTransactionDatabase,
    tenantId: string,
    fixtureId: string,
    input: UpdateFixtureInput,
  ): Promise<FixtureMutationResult> {
    const startsAt = parseFixtureTimestamp(input.startsAt);
    const venue = parseFixtureVenue(input.venue);
    if (
      !isUuid(tenantId) ||
      !isUuid(fixtureId) ||
      startsAt === null ||
      venue === null ||
      !isPositiveVersion(input.expectedVersion)
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
    try {
      const existingRows = await transaction
        .select()
        .from(fixtures)
        .where(and(eq(fixtures.tenantId, tenantId), eq(fixtures.id, fixtureId)))
        .for("update")
        .limit(1);
      const existing = existingRows[0] ? toFixture(existingRows[0]) : null;
      if (existing === null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }
      if (existing.state !== "scheduled" && existing.state !== "postponed") {
        return { ok: false, error: "INVALID_STATE" };
      }
      const rows = await transaction
        .update(fixtures)
        .set({ startsAt, venue, version: sql`${fixtures.version} + 1`, updatedAt: new Date() })
        .where(
          and(
            eq(fixtures.tenantId, tenantId),
            eq(fixtures.id, fixtureId),
            eq(fixtures.version, input.expectedVersion),
          ),
        )
        .returning();
      const fixture = rows[0] ? toFixture(rows[0]) : null;
      return fixture === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, fixture };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  private async transitionFixtureInTransaction(
    transaction: FixtureRepositoryTransactionDatabase,
    tenantId: string,
    fixtureId: string,
    targetState: Exclude<FixtureState, "scheduled">,
    input: TransitionFixtureInput,
    replacementStartsAt?: Date,
  ): Promise<FixtureMutationResult> {
    const reason =
      targetState === "completed" ? null : parseFixtureReason(input.reason);
    if (
      !isUuid(tenantId) ||
      !isUuid(fixtureId) ||
      !isPositiveVersion(input.expectedVersion) ||
      (targetState !== "completed" && reason === null)
    ) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
    try {
      const existingRows = await transaction
        .select()
        .from(fixtures)
        .where(and(eq(fixtures.tenantId, tenantId), eq(fixtures.id, fixtureId)))
        .for("update")
        .limit(1);
      const existing = existingRows[0] ? toFixture(existingRows[0]) : null;
      if (existing === null) {
        return { ok: false, error: "NOT_FOUND" };
      }
      if (existing.version !== input.expectedVersion) {
        return { ok: false, error: "VERSION_CONFLICT" };
      }
      if (!canTransitionFixture(existing.state, targetState)) {
        return { ok: false, error: "INVALID_STATE" };
      }
      const rows = await transaction
        .update(fixtures)
        .set({
          startsAt: replacementStartsAt ?? existing.startsAt,
          state: targetState,
          reason,
          version: sql`${fixtures.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(fixtures.tenantId, tenantId),
            eq(fixtures.id, fixtureId),
            eq(fixtures.version, input.expectedVersion),
          ),
        )
        .returning();
      const fixture = rows[0] ? toFixture(rows[0]) : null;
      return fixture === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, fixture };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async postponeFixtureInTransaction(
    transaction: FixtureRepositoryTransactionDatabase,
    tenantId: string,
    fixtureId: string,
    input: PostponeFixtureInput,
  ): Promise<FixtureMutationResult> {
    const startsAt = parseFixtureTimestamp(input.startsAt);
    if (startsAt === null) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
    return this.transitionFixtureInTransaction(
      transaction,
      tenantId,
      fixtureId,
      "postponed",
      input,
      startsAt,
    );
  }

  public async cancelFixtureInTransaction(
    transaction: FixtureRepositoryTransactionDatabase,
    tenantId: string,
    fixtureId: string,
    input: TransitionFixtureInput,
  ): Promise<FixtureMutationResult> {
    return this.transitionFixtureInTransaction(transaction, tenantId, fixtureId, "cancelled", input);
  }

  public async completeFixtureInTransaction(
    transaction: FixtureRepositoryTransactionDatabase,
    tenantId: string,
    fixtureId: string,
    input: TransitionFixtureInput,
  ): Promise<FixtureMutationResult> {
    return this.transitionFixtureInTransaction(transaction, tenantId, fixtureId, "completed", input);
  }

  public async abandonFixtureInTransaction(
    transaction: FixtureRepositoryTransactionDatabase,
    tenantId: string,
    fixtureId: string,
    input: TransitionFixtureInput,
  ): Promise<FixtureMutationResult> {
    return this.transitionFixtureInTransaction(transaction, tenantId, fixtureId, "abandoned", input);
  }
}
