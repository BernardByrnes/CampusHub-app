import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { StaticAuditIntegrityKeyProvider } from "@/domain/audit/audit-integrity-key-provider";
import type { ResultAuditEventType } from "@/domain/audit/audit-event";
import { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import { DrizzleResultRepository } from "@/server/repositories/result-repository";
import {
  auditEvents,
  campuses,
  competitions,
  fixtures,
  memberships,
  resultRevisions,
  results,
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
if (
  typeof configuredDatabaseUrl !== "string" ||
  configuredDatabaseUrl.trim().length === 0
) {
  throw new Error("DATABASE_URL was not loaded for integration tests.");
}

const runPrefix =
  "campushub-results-" + Date.now().toString(36) + "-" + randomUUID().slice(0, 8);
const auditKey = new Uint8Array(
  Buffer.from("campushub-result-integration-audit-key"),
);
let sequence = 0;
let database: ReturnType<typeof drizzle> | undefined;
let pool: Pool | undefined;

function getDatabase(): ReturnType<typeof drizzle> {
  if (database === undefined) {
    throw new Error("Result integration database was not initialized.");
  }
  return database;
}

function nextLabel(label: string): string {
  sequence += 1;
  return `${runPrefix}-${label}-${sequence}`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function postgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  return typeof candidate.code === "string"
    ? candidate.code
    : postgresCode(candidate.cause);
}

async function expectPostgresCode(
  operation: () => Promise<unknown>,
  expected: string,
): Promise<void> {
  let caught: unknown;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  expect(postgresCode(caught)).toBe(expected);
}

async function createTenant(): Promise<string> {
  const rows = await getDatabase()
    .insert(tenants)
    .values({
      slug: nextLabel("tenant"),
      displayName: "Result integration Tenant",
      status: "active",
      timezone: "Africa/Kampala",
    })
    .returning({ id: tenants.id });
  if (rows[0] === undefined) throw new Error("Tenant insert returned no row.");
  return rows[0].id;
}

async function createCampus(tenantId: string): Promise<string> {
  const rows = await getDatabase()
    .insert(campuses)
    .values({ tenantId, label: nextLabel("campus"), status: "active" })
    .returning({ id: campuses.id });
  if (rows[0] === undefined) throw new Error("Campus insert returned no row.");
  return rows[0].id;
}

async function createMembership(tenantId: string): Promise<string> {
  const rows = await getDatabase()
    .insert(memberships)
    .values({
      tenantId,
      identitySubjectId: nextLabel("identity"),
      assuranceLevel: "L2",
      lifecycle: "verified",
    })
    .returning({ id: memberships.id });
  if (rows[0] === undefined) {
    throw new Error("Membership insert returned no row.");
  }
  return rows[0].id;
}

async function createSport(tenantId: string): Promise<string> {
  const rows = await getDatabase()
    .insert(sports)
    .values({ tenantId, name: nextLabel("sport") })
    .returning({ id: sports.id });
  if (rows[0] === undefined) throw new Error("Sport insert returned no row.");
  return rows[0].id;
}

async function createCompetition(
  tenantId: string,
  sportId: string,
  campusId: string,
): Promise<string> {
  const rows = await getDatabase()
    .insert(competitions)
    .values({
      tenantId,
      sportId,
      name: nextLabel("competition"),
      seasonLabel: "2026",
      campusId,
      tableMode: "none",
    })
    .returning({ id: competitions.id });
  if (rows[0] === undefined) {
    throw new Error("Competition insert returned no row.");
  }
  return rows[0].id;
}

async function createTeam(
  tenantId: string,
  sportId: string,
  label: string,
): Promise<string> {
  const rows = await getDatabase()
    .insert(teams)
    .values({
      tenantId,
      sportId,
      name: nextLabel(label),
      affiliationLabel: null,
    })
    .returning({ id: teams.id });
  if (rows[0] === undefined) throw new Error("Team insert returned no row.");
  return rows[0].id;
}

async function createFixtureGraph(
  state: "scheduled" | "completed" = "completed",
) {
  const tenantId = await createTenant();
  const campusId = await createCampus(tenantId);
  const membershipId = await createMembership(tenantId);
  const sportId = await createSport(tenantId);
  const competitionId = await createCompetition(tenantId, sportId, campusId);
  const homeTeamId = await createTeam(tenantId, sportId, "home");
  const awayTeamId = await createTeam(tenantId, sportId, "away");
  const fixtureRows = await getDatabase()
    .insert(fixtures)
    .values({
      tenantId,
      competitionId,
      homeTeamId,
      awayTeamId,
      campusId,
      startsAt: new Date("2026-10-01T12:00:00.000Z"),
      venue: "Result integration pitch",
      state,
    })
    .returning({ id: fixtures.id });
  if (fixtureRows[0] === undefined) {
    throw new Error("Fixture insert returned no row.");
  }
  return {
    tenantId,
    campusId,
    membershipId,
    sportId,
    competitionId,
    homeTeamId,
    awayTeamId,
    fixtureId: fixtureRows[0].id,
  };
}

function auditRepository() {
  return new DrizzleAuditEventRepository({
    database: getDatabase() as never,
    keyProvider: new StaticAuditIntegrityKeyProvider(
      1,
      new Map([[1, auditKey]]),
    ),
    eventIdFactory: randomUUID,
  });
}

async function appendResultAudit(
  transaction: Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0],
  graph: Awaited<ReturnType<typeof createFixtureGraph>>,
  mutation: {
    ok: true;
    result: {
      id: string;
      version: number;
      lifecycle: "draft" | "published";
      fixtureId: string;
      draftHomeScore: number | null;
      draftAwayScore: number | null;
    };
    revision?: {
      revisionNumber: number;
      homeScore: number;
      awayScore: number;
      correctionReason: string | null;
    };
  },
  action: "draft_created" | "draft_changed" | "published" | "corrected",
): Promise<void> {
  const homeScore = mutation.revision?.homeScore ?? mutation.result.draftHomeScore;
  const awayScore = mutation.revision?.awayScore ?? mutation.result.draftAwayScore;
  if (homeScore === null || awayScore === null) {
    throw new Error("Result audit helper received no scores.");
  }
  await auditRepository().appendResultMutationInTransaction(transaction, {
    tenantId: graph.tenantId,
    actorMembershipId: graph.membershipId,
    resourceId: mutation.result.id,
    resourceVersion: mutation.result.version,
    occurredAt: new Date("2026-10-01T12:30:00.000Z"),
    eventType: `result.${action}` as ResultAuditEventType,
    eventFacts: {
      action,
      lifecycle: mutation.result.lifecycle,
      version: mutation.result.version,
      fixtureId: mutation.result.fixtureId,
      revisionNumber: mutation.revision?.revisionNumber ?? null,
      homeScore,
      awayScore,
      correctionReason: mutation.revision?.correctionReason ?? null,
    },
  });
}

beforeAll(async () => {
  pool = new Pool({ connectionString: configuredDatabaseUrl });
  database = drizzle({ client: pool });
  await pool.query("select 1");
});

afterAll(async () => {
  await pool?.end();
});

describe("real PostgreSQL Tenant-owned Sports Result structure", () => {
  it("creates drafts only for completed Fixtures and rejects duplicate or unavailable rows", async () => {
    const graph = await createFixtureGraph("completed");
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const created = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, graph.tenantId, {
        fixtureId: graph.fixtureId,
        homeScore: 1001,
        awayScore: 1,
      }),
    );
    expect(created).toMatchObject({
      ok: true,
      result: {
        fixtureId: graph.fixtureId,
        lifecycle: "draft",
        draftHomeScore: 1001,
        draftAwayScore: 1,
        currentRevisionNumber: null,
        version: 1,
      },
    });
    await expect(
      getDatabase().transaction((transaction) =>
        repository.createResultInTransaction(transaction, graph.tenantId, {
          fixtureId: graph.fixtureId,
          homeScore: 3,
          awayScore: 0,
        }),
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_STATE" });

    const scheduled = await createFixtureGraph("scheduled");
    await expect(
      getDatabase().transaction((transaction) =>
        repository.createResultInTransaction(transaction, scheduled.tenantId, {
          fixtureId: scheduled.fixtureId,
          homeScore: 0,
          awayScore: 0,
        }),
      ),
    ).resolves.toEqual({ ok: false, error: "NOT_READY" });
    const invalidScoreGraph = await createFixtureGraph("completed");
    await expectPostgresCode(
      () =>
        getDatabase().insert(results).values({
          tenantId: invalidScoreGraph.tenantId,
          fixtureId: invalidScoreGraph.fixtureId,
          lifecycle: "draft",
          draftHomeScore: -1,
          draftAwayScore: 0,
          version: 1,
        }),
      "23514",
    );
  });

  it("rejects direct Fixture state changes for draft and published Results", async () => {
    const draftGraph = await createFixtureGraph("completed");
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const draft = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, draftGraph.tenantId, {
        fixtureId: draftGraph.fixtureId,
        homeScore: 1,
        awayScore: 0,
      }),
    );
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;

    for (const state of ["cancelled", "abandoned", "postponed", "scheduled"] as const) {
      await expectPostgresCode(
        () =>
          getDatabase()
            .update(fixtures)
            .set({ state, reason: "Result is attached", version: sql`${fixtures.version} + 1`, updatedAt: new Date() })
            .where(and(eq(fixtures.tenantId, draftGraph.tenantId), eq(fixtures.id, draftGraph.fixtureId))),
        "23514",
      );
    }
    await expect(getDatabase().select({ state: fixtures.state }).from(fixtures).where(eq(fixtures.id, draftGraph.fixtureId))).resolves.toEqual([{ state: "completed" }]);
    await expect(repository.findResultByIdForTenant(draftGraph.tenantId, draft.result.id)).resolves.toMatchObject({ lifecycle: "draft" });

    const publishedGraph = await createFixtureGraph("completed");
    const publishedDraft = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, publishedGraph.tenantId, {
        fixtureId: publishedGraph.fixtureId,
        homeScore: 2,
        awayScore: 1,
      }),
    );
    expect(publishedDraft.ok).toBe(true);
    if (!publishedDraft.ok) return;
    const published = await getDatabase().transaction((transaction) =>
      repository.publishResultInTransaction(
        transaction,
        publishedGraph.tenantId,
        publishedDraft.result.id,
        { expectedVersion: 1 },
        publishedGraph.membershipId,
        new Date("2026-10-01T12:30:00.000Z"),
      ),
    );
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    await expectPostgresCode(
      () =>
        getDatabase()
          .update(fixtures)
          .set({ state: "cancelled", reason: "Result is attached", version: sql`${fixtures.version} + 1`, updatedAt: new Date() })
          .where(and(eq(fixtures.tenantId, publishedGraph.tenantId), eq(fixtures.id, publishedGraph.fixtureId))),
      "23514",
    );
    await expect(repository.findResultByIdForTenant(publishedGraph.tenantId, publishedDraft.result.id)).resolves.toMatchObject({ lifecycle: "published", currentRevisionNumber: 1 });
    await expect(getDatabase().select({ revisionNumber: resultRevisions.revisionNumber }).from(resultRevisions).where(eq(resultRevisions.resultId, publishedDraft.result.id))).resolves.toEqual([{ revisionNumber: 1 }]);
  });

  it("serializes Result creation and Fixture state changes in both transaction orderings", async () => {
    const resultFirstGraph = await createFixtureGraph("completed");
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const resultLockHeld = deferred<void>();
    const releaseResult = deferred<void>();
    const resultFirst = getDatabase().transaction(async (transaction) => {
      await transaction
        .select({ id: fixtures.id })
        .from(fixtures)
        .where(and(eq(fixtures.tenantId, resultFirstGraph.tenantId), eq(fixtures.id, resultFirstGraph.fixtureId)))
        .for("update");
      resultLockHeld.resolve();
      await releaseResult.promise;
      return repository.createResultInTransaction(transaction, resultFirstGraph.tenantId, {
        fixtureId: resultFirstGraph.fixtureId,
        homeScore: 1,
        awayScore: 0,
      });
    });
    await resultLockHeld.promise;
    const fixtureAfterResult = getDatabase().transaction((transaction) =>
      transaction
        .update(fixtures)
        .set({ state: "cancelled", reason: "Result is attached", version: sql`${fixtures.version} + 1`, updatedAt: new Date() })
        .where(and(eq(fixtures.tenantId, resultFirstGraph.tenantId), eq(fixtures.id, resultFirstGraph.fixtureId)))
        .returning(),
    );
    releaseResult.resolve();
    const [resultFirstOutcome, fixtureAfterResultOutcome] = await Promise.all([
      resultFirst,
      fixtureAfterResult.catch((error) => error),
    ]);
    expect(resultFirstOutcome).toMatchObject({ ok: true, result: { lifecycle: "draft" } });
    expect(postgresCode(fixtureAfterResultOutcome)).toBe("23514");
    await expect(getDatabase().select({ state: fixtures.state }).from(fixtures).where(eq(fixtures.id, resultFirstGraph.fixtureId))).resolves.toEqual([{ state: "completed" }]);
    await expect(getDatabase().select({ id: results.id }).from(results).where(eq(results.fixtureId, resultFirstGraph.fixtureId))).resolves.toHaveLength(1);

    const fixtureFirstGraph = await createFixtureGraph("completed");
    const fixtureLockHeld = deferred<void>();
    const releaseFixture = deferred<void>();
    const fixtureFirst = getDatabase().transaction(async (transaction) => {
      await transaction
        .select({ id: fixtures.id })
        .from(fixtures)
        .where(and(eq(fixtures.tenantId, fixtureFirstGraph.tenantId), eq(fixtures.id, fixtureFirstGraph.fixtureId)))
        .for("update");
      fixtureLockHeld.resolve();
      await releaseFixture.promise;
      return transaction
        .update(fixtures)
        .set({ state: "cancelled", reason: "No Result exists", version: sql`${fixtures.version} + 1`, updatedAt: new Date() })
        .where(and(eq(fixtures.tenantId, fixtureFirstGraph.tenantId), eq(fixtures.id, fixtureFirstGraph.fixtureId)))
        .returning();
    });
    await fixtureLockHeld.promise;
    const resultAfterFixture = getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, fixtureFirstGraph.tenantId, {
        fixtureId: fixtureFirstGraph.fixtureId,
        homeScore: 3,
        awayScore: 2,
      }),
    );
    releaseFixture.resolve();
    const [fixtureFirstOutcome, resultAfterFixtureOutcome] = await Promise.all([fixtureFirst, resultAfterFixture]);
    expect(fixtureFirstOutcome).toHaveLength(1);
    expect(fixtureFirstOutcome[0]?.state).toBe("cancelled");
    expect(resultAfterFixtureOutcome).toEqual({ ok: false, error: "NOT_READY" });
    await expect(getDatabase().select({ state: fixtures.state }).from(fixtures).where(eq(fixtures.id, fixtureFirstGraph.fixtureId))).resolves.toEqual([{ state: "cancelled" }]);
    await expect(getDatabase().select({ id: results.id }).from(results).where(eq(results.fixtureId, fixtureFirstGraph.fixtureId))).resolves.toHaveLength(0);
  });

  it("publishes one immutable revision atomically and reads only published Results", async () => {
    const graph = await createFixtureGraph();
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const created = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, graph.tenantId, {
        fixtureId: graph.fixtureId,
        homeScore: 2,
        awayScore: 2,
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(
      repository.listPublishedResultsForTenant(graph.tenantId, { limit: 10 }),
    ).resolves.toEqual([]);
    await expect(
      repository.listManagedResultsForTenant(graph.tenantId, { limit: 10 }),
    ).resolves.toMatchObject([
      {
        result: { id: created.result.id, lifecycle: "draft", version: 1 },
        revision: null,
      },
    ]);

    const published = await getDatabase().transaction(async (transaction) => {
      const mutation = await repository.publishResultInTransaction(
        transaction,
        graph.tenantId,
        created.result.id,
        { expectedVersion: 1 },
        graph.membershipId,
        new Date("2026-10-01T12:30:00.000Z"),
      );
      if (mutation.ok) await appendResultAudit(transaction, graph, mutation, "published");
      return mutation;
    });
    expect(published).toMatchObject({
      ok: true,
      result: {
        lifecycle: "published",
        currentRevisionNumber: 1,
        draftHomeScore: null,
        draftAwayScore: null,
        version: 2,
      },
      revision: { revisionNumber: 1, homeScore: 2, awayScore: 2 },
    });

    const list = await repository.listPublishedResultsForTenant(graph.tenantId, {
      limit: 1,
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      result: { id: created.result.id, lifecycle: "published", version: 2 },
      revision: { revisionNumber: 1, homeScore: 2, awayScore: 2 },
      sportName: expect.any(String),
      competitionName: expect.any(String),
      startsAt: new Date("2026-10-01T12:00:00.000Z"),
      venue: "Result integration pitch",
    });
    await expect(repository.listResultRevisionsForTenant(graph.tenantId, created.result.id, 10)).resolves.toMatchObject({
      ok: true,
      items: [{ revisionNumber: 1, homeScore: 2, awayScore: 2, correctionReason: null }],
    });
    const auditRows = await getDatabase()
      .select({ eventType: auditEvents.eventType, resourceType: auditEvents.resourceType })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, graph.tenantId),
          eq(auditEvents.resourceId, created.result.id),
        ),
      );
    expect(auditRows).toEqual([{ eventType: "result.published", resourceType: "result" }]);
  });

  it("appends corrections, requires reasons, and rejects revision mutation or truncation", async () => {
    const graph = await createFixtureGraph();
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const created = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, graph.tenantId, {
        fixtureId: graph.fixtureId,
        homeScore: 1,
        awayScore: 0,
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const published = await getDatabase().transaction((transaction) =>
      repository.publishResultInTransaction(
        transaction,
        graph.tenantId,
        created.result.id,
        { expectedVersion: 1 },
        graph.membershipId,
        new Date("2026-10-01T12:30:00.000Z"),
      ),
    );
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    await expectPostgresCode(
      () =>
        getDatabase().transaction(async (transaction) => {
          await transaction.insert(resultRevisions).values({
            tenantId: graph.tenantId,
            resultId: created.result.id,
            revisionNumber: 3,
            homeScore: 2,
            awayScore: 0,
            actorMembershipId: graph.membershipId,
            correctionReason: "Skipped revision",
          });
          await transaction
            .update(results)
            .set({ currentRevisionNumber: 3, version: 3 })
            .where(and(eq(results.tenantId, graph.tenantId), eq(results.id, created.result.id)));
        }),
      "42501",
    );

    await expect(
      getDatabase().transaction((transaction) =>
        repository.correctResultInTransaction(
          transaction,
          graph.tenantId,
          created.result.id,
          { expectedVersion: 2, homeScore: 1, awayScore: 1, reason: "Official correction" },
          graph.membershipId,
          new Date("2026-10-01T12:45:00.000Z"),
        ),
      ),
    ).resolves.toMatchObject({ ok: true, result: { version: 3, currentRevisionNumber: 2 } });
    await expect(
      getDatabase().transaction((transaction) =>
        repository.correctResultInTransaction(
          transaction,
          graph.tenantId,
          created.result.id,
          { expectedVersion: 3, homeScore: 2, awayScore: 1, reason: "   " },
          graph.membershipId,
          new Date("2026-10-01T12:50:00.000Z"),
        ),
      ),
    ).resolves.toEqual({ ok: false, error: "PERSISTENCE_FAILED" });

    await expect(
      getDatabase().transaction((transaction) =>
        repository.correctResultInTransaction(
          transaction,
          graph.tenantId,
          created.result.id,
          { expectedVersion: 3, homeScore: 2, awayScore: 1, reason: "Second correction" },
          graph.membershipId,
          new Date("2026-10-01T12:55:00.000Z"),
        ),
      ),
    ).resolves.toMatchObject({ ok: true, result: { version: 4, currentRevisionNumber: 3 } });
    await expect(
      getDatabase().transaction((transaction) =>
        repository.correctResultInTransaction(
          transaction,
          graph.tenantId,
          created.result.id,
          { expectedVersion: 4, homeScore: 3, awayScore: 1, reason: "Third correction" },
          graph.membershipId,
          new Date("2026-10-01T13:00:00.000Z"),
        ),
      ),
    ).resolves.toMatchObject({ ok: true, result: { version: 5, currentRevisionNumber: 4 } });

    const history = await repository.listResultRevisionsForTenant(graph.tenantId, created.result.id, 10);
    expect(history).toMatchObject({
      ok: true,
      items: [
        { revisionNumber: 1, homeScore: 1, awayScore: 0, correctionReason: null },
        { revisionNumber: 2, homeScore: 1, awayScore: 1, correctionReason: "Official correction" },
        { revisionNumber: 3, homeScore: 2, awayScore: 1, correctionReason: "Second correction" },
        { revisionNumber: 4, homeScore: 3, awayScore: 1, correctionReason: "Third correction" },
      ],
    });
    await expect(repository.listResultRevisionsForTenant(graph.tenantId, created.result.id, 2)).resolves.toMatchObject({
      ok: true,
      items: [
        { revisionNumber: 3, correctionReason: "Second correction" },
        { revisionNumber: 4, correctionReason: "Third correction" },
      ],
    });
    if (!history.ok) return;
    const revisionId = history.items[0]?.id;
    if (revisionId === undefined) throw new Error("Expected revision id.");
    await expectPostgresCode(
      () =>
        getDatabase()
          .update(resultRevisions)
          .set({ homeScore: 9 })
          .where(eq(resultRevisions.id, revisionId)),
      "42501",
    );
    await expectPostgresCode(
      () =>
        getDatabase()
          .delete(resultRevisions)
          .where(eq(resultRevisions.id, revisionId)),
      "42501",
    );
    await expectPostgresCode(
      () => getDatabase().execute(sql`TRUNCATE TABLE "result_revisions"`),
      "42501",
    );
  });

  it("enforces same-Tenant structural constraints and published pointer integrity", async () => {
    const graph = await createFixtureGraph();
    const foreign = await createFixtureGraph();
    const repository = new DrizzleResultRepository(getDatabase() as never);
    await expect(
      getDatabase().transaction((transaction) =>
        repository.createResultInTransaction(transaction, graph.tenantId, {
          fixtureId: foreign.fixtureId,
          homeScore: 0,
          awayScore: 0,
        }),
      ),
    ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
    await expectPostgresCode(
      () =>
        getDatabase().insert(results).values({
          tenantId: graph.tenantId,
          fixtureId: foreign.fixtureId,
          lifecycle: "draft",
          draftHomeScore: 0,
          draftAwayScore: 0,
          version: 1,
        }),
      "23503",
    );
    const created = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, graph.tenantId, {
        fixtureId: graph.fixtureId,
        homeScore: 0,
        awayScore: 0,
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expectPostgresCode(
      () =>
        getDatabase().insert(resultRevisions).values({
          tenantId: graph.tenantId,
          resultId: created.result.id,
          revisionNumber: 1,
          homeScore: 0,
          awayScore: 0,
          actorMembershipId: foreign.membershipId,
          correctionReason: null,
        }),
      "23503",
    );
    await expectPostgresCode(
      () =>
        getDatabase().insert(resultRevisions).values({
          tenantId: graph.tenantId,
          resultId: created.result.id,
          revisionNumber: 1,
          homeScore: 0,
          awayScore: 0,
          actorMembershipId: graph.membershipId,
          correctionReason: null,
        }),
      "23514",
    );
  });

  it("keeps direct and collection Result reads Tenant-local", async () => {
    const graph = await createFixtureGraph();
    const foreign = await createFixtureGraph();
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const first = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, graph.tenantId, {
        fixtureId: graph.fixtureId,
        homeScore: 1,
        awayScore: 0,
      }),
    );
    const second = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, foreign.tenantId, {
        fixtureId: foreign.fixtureId,
        homeScore: 0,
        awayScore: 1,
      }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    await expect(getDatabase().transaction((transaction) =>
      repository.publishResultInTransaction(transaction, graph.tenantId, first.result.id, { expectedVersion: 1 }, graph.membershipId, new Date("2026-10-01T12:30:00.000Z")),
    )).resolves.toMatchObject({ ok: true });
    await expect(getDatabase().transaction((transaction) =>
      repository.publishResultInTransaction(transaction, foreign.tenantId, second.result.id, { expectedVersion: 1 }, foreign.membershipId, new Date("2026-10-01T12:30:00.000Z")),
    )).resolves.toMatchObject({ ok: true });
    await expect(repository.findResultByIdForTenant(graph.tenantId, second.result.id)).resolves.toBeNull();
    await expect(repository.listResultRevisionsForTenant(graph.tenantId, second.result.id, 10)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
    await expect(repository.listPublishedResultsForTenant(graph.tenantId, { limit: 10 })).resolves.toMatchObject([
      { result: { id: first.result.id } },
    ]);
  });

  it("serializes publish-vs-publish with one version winner", async () => {
    const graph = await createFixtureGraph();
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const created = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, graph.tenantId, {
        fixtureId: graph.fixtureId,
        homeScore: 3,
        awayScore: 2,
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const lockHeld = deferred<void>();
    const release = deferred<void>();
    const first = getDatabase().transaction(async (transaction) => {
      await transaction
        .select({ id: fixtures.id })
        .from(fixtures)
        .where(and(eq(fixtures.tenantId, graph.tenantId), eq(fixtures.id, graph.fixtureId)))
        .for("update");
      await transaction
        .select({ id: results.id })
        .from(results)
        .where(and(eq(results.tenantId, graph.tenantId), eq(results.id, created.result.id)))
        .for("update");
      lockHeld.resolve();
      await release.promise;
      return repository.publishResultInTransaction(
        transaction,
        graph.tenantId,
        created.result.id,
        { expectedVersion: 1 },
        graph.membershipId,
        new Date("2026-10-01T12:30:00.000Z"),
      );
    });
    await lockHeld.promise;
    const second = getDatabase().transaction((transaction) =>
      repository.publishResultInTransaction(
        transaction,
        graph.tenantId,
        created.result.id,
        { expectedVersion: 1 },
        graph.membershipId,
        new Date("2026-10-01T12:31:00.000Z"),
      ),
    );
    release.resolve();
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok && outcome.error === "VERSION_CONFLICT")).toHaveLength(1);
    await expect(repository.findResultByIdForTenant(graph.tenantId, created.result.id)).resolves.toMatchObject({
      lifecycle: "published",
      version: 2,
      currentRevisionNumber: 1,
    });
  });

  it("serializes concurrent corrections with one revision-number winner", async () => {
    const graph = await createFixtureGraph();
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const created = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, graph.tenantId, {
        fixtureId: graph.fixtureId,
        homeScore: 1,
        awayScore: 0,
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const published = await getDatabase().transaction((transaction) =>
      repository.publishResultInTransaction(
        transaction,
        graph.tenantId,
        created.result.id,
        { expectedVersion: 1 },
        graph.membershipId,
        new Date("2026-10-01T12:30:00.000Z"),
      ),
    );
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    const lockHeld = deferred<void>();
    const release = deferred<void>();
    const first = getDatabase().transaction(async (transaction) => {
      await transaction
        .select({ id: results.id })
        .from(results)
        .where(and(eq(results.tenantId, graph.tenantId), eq(results.id, created.result.id)))
        .for("update");
      lockHeld.resolve();
      await release.promise;
      return repository.correctResultInTransaction(
        transaction,
        graph.tenantId,
        created.result.id,
        { expectedVersion: 2, homeScore: 2, awayScore: 0, reason: "First correction" },
        graph.membershipId,
        new Date("2026-10-01T12:45:00.000Z"),
      );
    });
    await lockHeld.promise;
    const second = getDatabase().transaction((transaction) =>
      repository.correctResultInTransaction(
        transaction,
        graph.tenantId,
        created.result.id,
        { expectedVersion: 2, homeScore: 1, awayScore: 1, reason: "Second correction" },
        graph.membershipId,
        new Date("2026-10-01T12:46:00.000Z"),
      ),
    );
    release.resolve();
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ok && outcome.error === "VERSION_CONFLICT")).toHaveLength(1);
    const history = await repository.listResultRevisionsForTenant(graph.tenantId, created.result.id, 10);
    expect(history).toMatchObject({ ok: true });
    if (!history.ok) return;
    expect(history.items).toHaveLength(2);
    await expect(repository.findResultByIdForTenant(graph.tenantId, created.result.id)).resolves.toMatchObject({ lifecycle: "published", version: 3, currentRevisionNumber: 2 });
  });

  it("serializes publish-vs-edit in both orderings without overwriting content", async () => {
    const publishFirstGraph = await createFixtureGraph();
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const publishFirstCreated = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, publishFirstGraph.tenantId, {
        fixtureId: publishFirstGraph.fixtureId,
        homeScore: 1,
        awayScore: 0,
      }),
    );
    expect(publishFirstCreated.ok).toBe(true);
    if (!publishFirstCreated.ok) return;
    const publishLockHeld = deferred<void>();
    const releasePublish = deferred<void>();
    const publishFirst = getDatabase().transaction(async (transaction) => {
      await transaction
        .select({ id: results.id })
        .from(results)
        .where(and(eq(results.tenantId, publishFirstGraph.tenantId), eq(results.id, publishFirstCreated.result.id)))
        .for("update");
      await transaction
        .select({ id: fixtures.id })
        .from(fixtures)
        .where(and(eq(fixtures.tenantId, publishFirstGraph.tenantId), eq(fixtures.id, publishFirstGraph.fixtureId)))
        .for("update");
      publishLockHeld.resolve();
      await releasePublish.promise;
      return repository.publishResultInTransaction(transaction, publishFirstGraph.tenantId, publishFirstCreated.result.id, { expectedVersion: 1 }, publishFirstGraph.membershipId, new Date("2026-10-01T12:30:00.000Z"));
    });
    await publishLockHeld.promise;
    const editAfterPublish = getDatabase().transaction((transaction) =>
      repository.updateDraftResultInTransaction(transaction, publishFirstGraph.tenantId, publishFirstCreated.result.id, { expectedVersion: 1, homeScore: 9, awayScore: 9 }),
    );
    releasePublish.resolve();
    const [publishedFirst, editedAfter] = await Promise.all([publishFirst, editAfterPublish]);
    expect(publishedFirst).toMatchObject({ ok: true, result: { lifecycle: "published", version: 2 } });
    expect(editedAfter).toEqual({ ok: false, error: "VERSION_CONFLICT" });

    const editFirstGraph = await createFixtureGraph();
    const editFirstCreated = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, editFirstGraph.tenantId, {
        fixtureId: editFirstGraph.fixtureId,
        homeScore: 1,
        awayScore: 0,
      }),
    );
    expect(editFirstCreated.ok).toBe(true);
    if (!editFirstCreated.ok) return;
    const editLockHeld = deferred<void>();
    const releaseEdit = deferred<void>();
    const editFirst = getDatabase().transaction(async (transaction) => {
      const edited = await repository.updateDraftResultInTransaction(transaction, editFirstGraph.tenantId, editFirstCreated.result.id, { expectedVersion: 1, homeScore: 4, awayScore: 3 });
      expect(edited).toMatchObject({ ok: true, result: { version: 2, lifecycle: "draft" } });
      editLockHeld.resolve();
      await releaseEdit.promise;
      return edited;
    });
    await editLockHeld.promise;
    const publishAfterEdit = getDatabase().transaction((transaction) =>
      repository.publishResultInTransaction(transaction, editFirstGraph.tenantId, editFirstCreated.result.id, { expectedVersion: 1 }, editFirstGraph.membershipId, new Date("2026-10-01T12:30:00.000Z")),
    );
    releaseEdit.resolve();
    const [editedFirst, publishedAfter] = await Promise.all([editFirst, publishAfterEdit]);
    expect(editedFirst).toMatchObject({ ok: true, result: { version: 2, draftHomeScore: 4, draftAwayScore: 3 } });
    expect(publishedAfter).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    await expect(repository.findResultByIdForTenant(editFirstGraph.tenantId, editFirstCreated.result.id)).resolves.toMatchObject({ lifecycle: "draft", version: 2, draftHomeScore: 4, draftAwayScore: 3 });
  });

  it("rolls back a Result and its audit event together when the transaction fails", async () => {
    const graph = await createFixtureGraph();
    const repository = new DrizzleResultRepository(getDatabase() as never);
    const created = await getDatabase().transaction((transaction) =>
      repository.createResultInTransaction(transaction, graph.tenantId, {
        fixtureId: graph.fixtureId,
        homeScore: 2,
        awayScore: 1,
      }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await expect(
      getDatabase().transaction(async (transaction) => {
        const published = await repository.publishResultInTransaction(
          transaction,
          graph.tenantId,
          created.result.id,
          { expectedVersion: 1 },
          graph.membershipId,
          new Date("2026-10-01T12:30:00.000Z"),
        );
        expect(published.ok).toBe(true);
        if (published.ok) await appendResultAudit(transaction, graph, published, "published");
        throw new Error("forced transaction rollback");
      }),
    ).rejects.toThrow("forced transaction rollback");
    await expect(repository.findResultByIdForTenant(graph.tenantId, created.result.id)).resolves.toMatchObject({ lifecycle: "draft", version: 1, draftHomeScore: 2, draftAwayScore: 1 });
    await expect(getDatabase().select().from(resultRevisions).where(eq(resultRevisions.resultId, created.result.id))).resolves.toHaveLength(0);
    await expect(getDatabase().select().from(auditEvents).where(eq(auditEvents.resourceId, created.result.id))).resolves.toHaveLength(0);
  });
});
