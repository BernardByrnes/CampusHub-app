import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import { DrizzleFixtureRepository } from "@/server/repositories/fixture-repository";
import { StaticAuditIntegrityKeyProvider } from "@/domain/audit/audit-integrity-key-provider";
import type { FixtureAuditEventType } from "@/domain/audit/audit-event";
import {
  auditEvents,
  campuses,
  competitions,
  fixtures,
  memberships,
  sports,
  teams,
  tenants,
} from "@/server/db/schema";

if (process.env.CAMPUSHUB_DB_INTEGRATION !== "1") {
  throw new Error(
    "Real database integration is opt-in. Set CAMPUSHUB_DB_INTEGRATION=1.",
  );
}

loadEnvConfig(process.cwd());

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (typeof configuredDatabaseUrl !== "string" || configuredDatabaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL was not loaded for integration tests.");
}

const runPrefix = "campushub-fixtures-" + Date.now().toString(36) + "-" + randomUUID().slice(0, 8);
const auditKey = new Uint8Array(Buffer.from("campushub-fixture-integration-audit-key"));
let sequence = 0;
let database: ReturnType<typeof drizzle> | undefined;
let pool: Pool | undefined;

function getDatabase(): ReturnType<typeof drizzle> {
  if (database === undefined) throw new Error("Fixture integration database was not initialized.");
  return database;
}

function nextSlug(label: string): string {
  sequence += 1;
  return `${runPrefix}-${label}-${sequence}`;
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  return typeof candidate.code === "string" ? candidate.code : postgresCode(candidate.cause);
}

async function expectPostgresCode(operation: () => Promise<unknown>, expected: string): Promise<void> {
  let caught: unknown;
  try { await operation(); } catch (error) { caught = error; }
  expect(caught).toBeDefined();
  expect(postgresCode(caught)).toBe(expected);
}

async function createTenant(): Promise<string> {
  const rows = await getDatabase().insert(tenants).values({
    slug: nextSlug("tenant"),
    displayName: "Fixture integration Tenant",
    status: "active",
    timezone: "Africa/Kampala",
  }).returning({ id: tenants.id });
  if (rows[0] === undefined) throw new Error("Fixture Tenant insert returned no row.");
  return rows[0].id;
}

async function createCampus(tenantId: string): Promise<string> {
  const rows = await getDatabase().insert(campuses).values({
    tenantId, label: "Fixture integration Campus", status: "active",
  }).returning({ id: campuses.id });
  if (rows[0] === undefined) throw new Error("Fixture Campus insert returned no row.");
  return rows[0].id;
}

async function createMembership(tenantId: string): Promise<string> {
  const rows = await getDatabase().insert(memberships).values({
    tenantId, identitySubjectId: nextSlug("identity"), assuranceLevel: "L2", lifecycle: "verified",
  }).returning({ id: memberships.id });
  if (rows[0] === undefined) throw new Error("Fixture Membership insert returned no row.");
  return rows[0].id;
}

async function createSport(tenantId: string): Promise<string> {
  const rows = await getDatabase().insert(sports).values({ tenantId, name: nextSlug("sport") }).returning({ id: sports.id });
  if (rows[0] === undefined) throw new Error("Fixture Sport insert returned no row.");
  return rows[0].id;
}

async function createCompetition(tenantId: string, sportId: string, campusId: string): Promise<string> {
  const rows = await getDatabase().insert(competitions).values({
    tenantId, sportId, name: nextSlug("competition"), seasonLabel: "2026", campusId, tableMode: "none",
  }).returning({ id: competitions.id });
  if (rows[0] === undefined) throw new Error("Fixture Competition insert returned no row.");
  return rows[0].id;
}

async function createTeam(tenantId: string, sportId: string, label: string): Promise<string> {
  const rows = await getDatabase().insert(teams).values({
    tenantId, sportId, name: nextSlug(label), affiliationLabel: null,
  }).returning({ id: teams.id });
  if (rows[0] === undefined) throw new Error("Fixture Team insert returned no row.");
  return rows[0].id;
}

async function createFixtureGraph() {
  const tenantId = await createTenant();
  const campusId = await createCampus(tenantId);
  const membershipId = await createMembership(tenantId);
  const sportId = await createSport(tenantId);
  const competitionId = await createCompetition(tenantId, sportId, campusId);
  const homeTeamId = await createTeam(tenantId, sportId, "home");
  const awayTeamId = await createTeam(tenantId, sportId, "away");
  return { tenantId, campusId, membershipId, sportId, competitionId, homeTeamId, awayTeamId };
}

function auditRepository() {
  return new DrizzleAuditEventRepository({
    database: getDatabase() as never,
    keyProvider: new StaticAuditIntegrityKeyProvider(1, new Map([[1, auditKey]])),
    eventIdFactory: randomUUID,
  });
}

async function appendAudit(
  graph: Awaited<ReturnType<typeof createFixtureGraph>>,
  fixture: { id: string; version: number; state: "scheduled" | "postponed" | "cancelled" | "completed" | "abandoned"; startsAt: Date; venue: string; reason: string | null; },
  action: "created" | "changed" | "postponed" | "cancelled" | "completed" | "abandoned",
) {
  await getDatabase().transaction((transaction) => auditRepository().appendFixtureMutationInTransaction(transaction, {
    tenantId: graph.tenantId,
    actorMembershipId: graph.membershipId,
    resourceType: "fixture",
    resourceId: fixture.id,
    resourceVersion: fixture.version,
    occurredAt: fixture.startsAt,
    eventType: `fixture.${action}` as FixtureAuditEventType,
    eventFacts: {
      action,
      state: fixture.state,
      version: fixture.version,
      competitionId: graph.competitionId,
      homeTeamId: graph.homeTeamId,
      awayTeamId: graph.awayTeamId,
      campusId: graph.campusId,
      startsAt: fixture.startsAt.toISOString(),
      venue: fixture.venue,
      reason: fixture.reason,
    },
  }));
}

beforeAll(async () => {
  pool = new Pool({ connectionString: configuredDatabaseUrl });
  database = drizzle({ client: pool });
  await pool.query("select 1");
});

afterAll(async () => { await pool?.end(); });

describe("real PostgreSQL Tenant-owned Fixture structure", () => {
  it("persists, lists, filters, and isolates Fixture rows", async () => {
    const graph = await createFixtureGraph();
    const otherTenantId = await createTenant();
    const otherCampusId = await createCampus(otherTenantId);
    const otherSportId = await createSport(otherTenantId);
    const otherCompetitionId = await createCompetition(otherTenantId, otherSportId, otherCampusId);
    const otherHome = await createTeam(otherTenantId, otherSportId, "other-home");
    const otherAway = await createTeam(otherTenantId, otherSportId, "other-away");
    const repository = new DrizzleFixtureRepository(getDatabase() as never);
    const created = await getDatabase().transaction((transaction) => repository.createFixtureInTransaction(transaction, graph.tenantId, {
      competitionId: graph.competitionId,
      homeTeamId: graph.homeTeamId,
      awayTeamId: graph.awayTeamId,
      campusId: graph.campusId,
      startsAt: new Date("2026-10-01T12:00:00.000Z"),
      venue: "Main pitch",
    }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await appendAudit(graph, created.fixture, "created");
    const auditRows = await getDatabase()
      .select({
        eventType: auditEvents.eventType,
        resourceType: auditEvents.resourceType,
        resourceId: auditEvents.resourceId,
        sequence: auditEvents.sequence,
        previousHash: auditEvents.previousHash,
        currentHash: auditEvents.currentHash,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, graph.tenantId),
          eq(auditEvents.resourceId, created.fixture.id),
        ),
      )
      .limit(1);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      eventType: "fixture.created",
      resourceType: "fixture",
      resourceId: created.fixture.id,
      sequence: expect.any(Number),
      previousHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      currentHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const foreign = await getDatabase().transaction((transaction) => repository.createFixtureInTransaction(transaction, otherTenantId, {
      competitionId: otherCompetitionId, homeTeamId: otherHome, awayTeamId: otherAway, campusId: otherCampusId,
      startsAt: new Date("2026-10-02T12:00:00.000Z"), venue: "Away pitch",
    }));
    expect(foreign.ok).toBe(true);
    expect(await repository.findFixtureByIdForTenant(otherTenantId, created.fixture.id)).toBeNull();
    const list = await repository.listFixturesForTenant(graph.tenantId, { sportName: "", limit: 10 });
    expect(list).toEqual([]);
    const filtered = await repository.listFixturesForTenant(graph.tenantId, { sportId: graph.sportId, teamId: graph.homeTeamId, limit: 10 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.fixture.id).toBe(created.fixture.id);
  });

  it("enforces relational invariants and rejects inactive dependencies", async () => {
    const graph = await createFixtureGraph();
    const foreignTenant = await createTenant();
    const foreignCampus = await createCampus(foreignTenant);
    const foreignSport = await createSport(foreignTenant);
    const foreignCompetition = await createCompetition(foreignTenant, foreignSport, foreignCampus);
    const foreignHome = await createTeam(foreignTenant, foreignSport, "foreign-home");
    const foreignAway = await createTeam(foreignTenant, foreignSport, "foreign-away");
    const repository = new DrizzleFixtureRepository(getDatabase() as never);
    await expect(getDatabase().transaction((transaction) => repository.createFixtureInTransaction(transaction, graph.tenantId, {
      competitionId: foreignCompetition, homeTeamId: graph.homeTeamId, awayTeamId: graph.awayTeamId, campusId: graph.campusId,
      startsAt: new Date("2026-10-03T12:00:00.000Z"), venue: "Main pitch",
    }))).resolves.toEqual({ ok: false, error: "NOT_READY" });
    await expect(getDatabase().transaction((transaction) => repository.createFixtureInTransaction(transaction, graph.tenantId, {
      competitionId: graph.competitionId, homeTeamId: foreignHome, awayTeamId: foreignAway, campusId: graph.campusId,
      startsAt: new Date("2026-10-03T12:00:00.000Z"), venue: "Main pitch",
    }))).resolves.toEqual({ ok: false, error: "NOT_READY" });
    await expectPostgresCode(() => getDatabase().insert(fixtures).values({
      tenantId: graph.tenantId, competitionId: foreignCompetition, homeTeamId: graph.homeTeamId, awayTeamId: graph.awayTeamId,
      campusId: graph.campusId, startsAt: new Date("2026-10-03T12:00:00.000Z"), venue: "Main pitch",
    }), "23503");
    await expectPostgresCode(() => getDatabase().insert(fixtures).values({
      tenantId: graph.tenantId, competitionId: graph.competitionId, homeTeamId: graph.homeTeamId, awayTeamId: graph.homeTeamId,
      campusId: graph.campusId, startsAt: new Date("2026-10-03T12:00:00.000Z"), venue: "Main pitch",
    }), "23514");
    await getDatabase().update(sports).set({ status: "inactive" }).where(sql`${sports.id} = ${graph.sportId}`);
    await expect(getDatabase().transaction((transaction) => repository.createFixtureInTransaction(transaction, graph.tenantId, {
      competitionId: graph.competitionId, homeTeamId: graph.homeTeamId, awayTeamId: graph.awayTeamId, campusId: graph.campusId,
      startsAt: new Date("2026-10-03T12:00:00.000Z"), venue: "Main pitch",
    }))).resolves.toEqual({ ok: false, error: "NOT_READY" });
  });

  it("versions lifecycle transitions and allows exactly one stale-writer winner", async () => {
    const graph = await createFixtureGraph();
    const repository = new DrizzleFixtureRepository(getDatabase() as never);
    const created = await getDatabase().transaction((transaction) => repository.createFixtureInTransaction(transaction, graph.tenantId, {
      competitionId: graph.competitionId, homeTeamId: graph.homeTeamId, awayTeamId: graph.awayTeamId, campusId: graph.campusId,
      startsAt: new Date("2026-11-01T12:00:00.000Z"), venue: "Main pitch",
    }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updates = await Promise.all([
      getDatabase().transaction((transaction) => repository.updateFixtureInTransaction(transaction, graph.tenantId, created.fixture.id, {
        expectedVersion: 1, startsAt: new Date("2026-11-01T13:00:00.000Z"), venue: "North pitch",
      })),
      getDatabase().transaction((transaction) => repository.updateFixtureInTransaction(transaction, graph.tenantId, created.fixture.id, {
        expectedVersion: 1, startsAt: new Date("2026-11-01T14:00:00.000Z"), venue: "South pitch",
      })),
    ]);
    expect(updates.filter((result) => result.ok)).toHaveLength(1);
    expect(updates.filter((result) => !result.ok && result.error === "VERSION_CONFLICT")).toHaveLength(1);
    const current = await repository.findFixtureByIdForTenant(graph.tenantId, created.fixture.id);
    expect(current).toMatchObject({ state: "scheduled", version: 2 });
    if (current === null) return;
    const postponed = await getDatabase().transaction((transaction) => repository.postponeFixtureInTransaction(transaction, graph.tenantId, current.id, {
      expectedVersion: 2, startsAt: new Date("2026-11-08T12:00:00.000Z"), reason: "Weather",
    }));
    expect(postponed).toMatchObject({ ok: true, fixture: { state: "postponed", version: 3, reason: "Weather" } });
    const cancelled = postponed.ok ? await getDatabase().transaction((transaction) => repository.cancelFixtureInTransaction(transaction, graph.tenantId, current.id, { expectedVersion: 3, reason: "Venue unavailable" })) : null;
    expect(cancelled).toMatchObject({ ok: true, fixture: { state: "cancelled", version: 4 } });
    const reopened = await getDatabase().transaction((transaction) => repository.completeFixtureInTransaction(transaction, graph.tenantId, current.id, { expectedVersion: 4 }));
    expect(reopened).toEqual({ ok: false, error: "INVALID_STATE" });
  });
});
