import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { DrizzleEventRsvpRepository } from "@/server/repositories/event-rsvp-repository";
import type { CampusHubDatabase } from "@/server/db/client";
import * as tables from "@/server/db/schema";
import {
  eventRsvpIdempotency,
  eventRsvps,
  events,
  memberships,
  tenantModuleStates,
  tenants,
} from "@/server/db/schema";

if (process.env.CAMPUSHUB_DB_INTEGRATION !== "1") {
  throw new Error("Real database integration is opt-in. Set CAMPUSHUB_DB_INTEGRATION=1.");
}

loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL was not loaded for Event RSVP integration tests.");
}
const configuredDatabaseUrl = databaseUrl;

const FUTURE_START = new Date("2099-09-20T10:00:00.000Z");
const FUTURE_END = new Date("2099-09-20T12:00:00.000Z");
const LOCK_WAIT_TIMEOUT_MS = 8_000;
const LOCK_POLL_DELAY_MS = 25;

let pool: Pool | undefined;
let database: CampusHubDatabase | undefined;

type Graph = Readonly<{
  tenantId: string;
  campusId: string;
  membershipId: string;
  identitySubjectId: string;
  eventId: string;
}>;

function getPool(): Pool {
  if (pool === undefined) throw new Error("Event RSVP integration pool is not initialized.");
  return pool;
}

function getDatabase(): CampusHubDatabase {
  if (database === undefined) throw new Error("Event RSVP integration database is not initialized.");
  return database;
}

function nextSlug(label: string): string {
  return `event-rsvp-${label}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

async function createGraph(options: Readonly<{ module?: "enabled" | "disabled" | "missing" }> = {}): Promise<Graph> {
  const tenantRows = await getDatabase().insert(tenants).values({
    slug: nextSlug("tenant"),
    displayName: "Event RSVP Integration Tenant",
    status: "active",
    timezone: "Africa/Kampala",
  }).returning({ id: tenants.id });
  const tenantId = tenantRows[0]?.id;
  if (tenantId === undefined) throw new Error("Tenant fixture insert returned no row.");

  const campusRows = await getDatabase().insert(tables.campuses).values({
    tenantId,
    label: "RSVP Campus",
    status: "active",
  }).returning({ id: tables.campuses.id });
  const campusId = campusRows[0]?.id;
  if (campusId === undefined) throw new Error("Campus fixture insert returned no row.");

  const identitySubjectId = nextSlug("identity");
  const membershipRows = await getDatabase().insert(memberships).values({
    tenantId,
    identitySubjectId,
    assuranceLevel: "L1",
    lifecycle: "verified",
    campusId,
    campusProvenance: "institution_verified",
    residenceState: "non_resident",
    residenceProvenance: "institution_verified",
  }).returning({ id: memberships.id });
  const membershipId = membershipRows[0]?.id;
  if (membershipId === undefined) throw new Error("Membership fixture insert returned no row.");

  const eventRows = await getDatabase().insert(events).values({
    tenantId,
    version: 1,
    title: "RSVP Integration Event",
    description: "An Event used by the real RSVP integration suite.",
    venue: "Main Hall",
    startsAt: FUTURE_START,
    endsAt: FUTURE_END,
    campusId,
    visibility: "MEMBERS",
    audienceMode: "entire_tenant",
    rsvpEnabled: true,
    lifecycle: "published",
  }).returning({ id: events.id });
  const eventId = eventRows[0]?.id;
  if (eventId === undefined) throw new Error("Event fixture insert returned no row.");

  if (options.module !== "missing") {
    await getDatabase().insert(tenantModuleStates).values({
      tenantId,
      module: "event",
      enabled: options.module !== "disabled",
      version: 1,
    });
  }
  return { tenantId, campusId, membershipId, identitySubjectId, eventId };
}

function repository(targetDatabase: CampusHubDatabase = getDatabase()): DrizzleEventRsvpRepository {
  return new DrizzleEventRsvpRepository(targetDatabase, {
    runtimeDatabaseAuthorityVerifier: async () => true,
  });
}

function command(graph: Graph, requestedState: "going" | "interested" | "withdrawn", expectedParticipationVersion: number, idempotencyKey: string) {
  return {
    eventId: graph.eventId,
    requestedState,
    expectedParticipationVersion,
    idempotencyKey,
  } as const;
}

async function change(
  graph: Graph,
  requestedState: "going" | "interested" | "withdrawn",
  expectedParticipationVersion: number,
  idempotencyKey: string,
  targetDatabase: CampusHubDatabase = getDatabase(),
  targetRepository: DrizzleEventRsvpRepository | undefined = undefined,
) {
  return (targetRepository ?? repository(targetDatabase)).changeParticipation(
    graph.tenantId,
    graph.membershipId,
    graph.identitySubjectId,
    command(graph, requestedState, expectedParticipationVersion, idempotencyKey),
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function backendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ backend_pid: number }>("select pg_backend_pid() as backend_pid");
  const pid = result.rows[0]?.backend_pid;
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("PostgreSQL backend PID was unavailable.");
  return pid;
}

async function waitForBlocked(blockingPid: number, lockQueryFragment: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await getPool().query<{ pid: number }>(
      `select activity.pid
         from pg_stat_activity as activity
        where activity.state = 'active'
          and activity.wait_event_type = 'Lock'
          and $1 = any(pg_blocking_pids(activity.pid))
          and activity.query ilike $2`,
      [blockingPid, `%${lockQueryFragment}%`],
    );
    if (result.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_DELAY_MS));
  }
  throw new Error(`Timed out waiting for PostgreSQL lock evidence: ${lockQueryFragment}`);
}

type RestrictedRuntime = Readonly<{
  database: CampusHubDatabase;
  pool: Pool;
  roleName: string;
}>;

async function createRestrictedRuntime(): Promise<RestrictedRuntime> {
  const adminPool = getPool();
  const roleName = `campushub_evt003_runtime_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const quotedRole = `"${roleName}"`;
  await adminPool.query(`create role ${quotedRole} login password '${password}'`);
  try {
    await adminPool.query(`grant usage on schema public to ${quotedRole}`);
    await adminPool.query(`revoke create on schema public from ${quotedRole}`);
    await adminPool.query(`grant "campushub_runtime" to ${quotedRole}`);
    await adminPool.query(
      `grant select, update, references on "tenants", "memberships", "events" to ${quotedRole}`,
    );
    await adminPool.query(
      `grant select, references on "event_audience_criteria" to ${quotedRole}`,
    );
    const connectionUrl = new URL(configuredDatabaseUrl);
    connectionUrl.username = roleName;
    connectionUrl.password = password;
    const restrictedPool = new Pool({ connectionString: connectionUrl.toString(), max: 1 });
    await restrictedPool.query("select 1");
    return {
      database: drizzle({ client: restrictedPool, schema: tables }) as CampusHubDatabase,
      pool: restrictedPool,
      roleName,
    };
  } catch (error) {
    await adminPool.query(`revoke "campushub_runtime" from ${quotedRole}`).catch(() => undefined);
    await adminPool.query(`revoke all privileges on schema public from ${quotedRole}`).catch(() => undefined);
    await adminPool.query(`revoke all privileges on all tables in schema public from ${quotedRole}`).catch(() => undefined);
    await adminPool.query(`drop role ${quotedRole}`).catch(() => undefined);
    throw error;
  }
}

async function destroyRestrictedRuntime(runtime: RestrictedRuntime): Promise<void> {
  await runtime.pool.end();
  const quotedRole = `"${runtime.roleName}"`;
  await getPool().query(`revoke "campushub_runtime" from ${quotedRole}`).catch(() => undefined);
  await getPool().query(`revoke all privileges on schema public from ${quotedRole}`).catch(() => undefined);
  await getPool().query(`revoke all privileges on all tables in schema public from ${quotedRole}`).catch(() => undefined);
  await getPool().query(`drop role ${quotedRole}`);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl, max: 8 });
  database = drizzle({ client: pool, schema: tables }) as CampusHubDatabase;
  await getPool().query("select 1");
});

afterAll(async () => {
  await pool?.end();
});

describe("real PostgreSQL Event RSVP Core", () => {
  it("creates, replays, conflicts, withdraws, reactivates, reads, and counts one Tenant RSVP", async () => {
    const graph = await createGraph();
    const rsvps = repository();

    await expect(change(graph, "going", 0, "rsvp-going")).resolves.toMatchObject({
      ok: true,
      value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true },
    });
    await expect(change(graph, "going", 0, "rsvp-going")).resolves.toMatchObject({
      ok: true,
      value: { outcome: "NOOP", state: "going", participationVersion: 1, changed: false },
    });
    await expect(change(graph, "interested", 0, "rsvp-going")).resolves.toEqual({
      ok: false,
      error: "IDEMPOTENCY_CONFLICT",
    });
    await expect(change(graph, "interested", 1, "rsvp-interested")).resolves.toMatchObject({
      ok: true,
      value: { state: "interested", participationVersion: 2, changed: true },
    });
    await expect(change(graph, "withdrawn", 2, "rsvp-withdrawn")).resolves.toMatchObject({
      ok: true,
      value: { state: "withdrawn", participationVersion: 3, changed: true },
    });
    await expect(change(graph, "going", 3, "rsvp-reactivate")).resolves.toMatchObject({
      ok: true,
      value: { state: "going", participationVersion: 4, changed: true },
    });

    await expect(rsvps.findOwnParticipation(
      graph.tenantId,
      graph.eventId,
      graph.membershipId,
      graph.identitySubjectId,
    )).resolves.toEqual({ ok: true, state: "going", participationVersion: 4 });
    await expect(rsvps.findOwnParticipation(
      graph.tenantId,
      graph.eventId,
      graph.membershipId,
      "wrong-identity",
    )).resolves.toEqual({ ok: false, error: "TENANT_SCOPE_NOT_FOUND" });
    await expect(rsvps.getAggregateCounts(graph.tenantId, graph.eventId)).resolves.toEqual({
      ok: true,
      goingCount: 1,
      interestedCount: 0,
    });
  });

  it("fails closed when the durable Event module row is missing or disabled", async () => {
    const disabled = await createGraph({ module: "disabled" });
    const missing = await createGraph({ module: "missing" });
    await expect(change(disabled, "going", 0, "module-disabled")).resolves.toEqual({
      ok: false,
      error: "MODULE_DISABLED",
    });
    await expect(change(missing, "going", 0, "module-missing")).resolves.toEqual({
      ok: false,
      error: "MODULE_DISABLED",
    });
    await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, disabled.tenantId))).resolves.toHaveLength(0);
    await expect(getDatabase().select().from(eventRsvpIdempotency).where(eq(eventRsvpIdempotency.tenantId, missing.tenantId))).resolves.toHaveLength(0);
  });

  it("enforces real PostgreSQL runtime table privileges through the approved role boundary", async () => {
    const graph = await createGraph();
    const runtime = await createRestrictedRuntime();
    try {
      const privilegeRows = await getPool().query<{
        module_select: boolean;
        module_insert: boolean;
        rsvp_select: boolean;
        rsvp_insert: boolean;
        rsvp_update: boolean;
        rsvp_delete: boolean;
        idempotency_delete: boolean;
      }>(`
        select
          has_table_privilege('campushub_runtime', 'public.tenant_module_states', 'SELECT') as module_select,
          has_table_privilege('campushub_runtime', 'public.tenant_module_states', 'INSERT') as module_insert,
          has_table_privilege('campushub_runtime', 'public.event_rsvps', 'SELECT') as rsvp_select,
          has_table_privilege('campushub_runtime', 'public.event_rsvps', 'INSERT') as rsvp_insert,
          has_table_privilege('campushub_runtime', 'public.event_rsvps', 'UPDATE') as rsvp_update,
          has_table_privilege('campushub_runtime', 'public.event_rsvps', 'DELETE') as rsvp_delete,
          has_table_privilege('campushub_runtime', 'public.event_rsvp_idempotency', 'DELETE') as idempotency_delete
      `);
      expect(privilegeRows.rows[0]).toEqual({
        module_select: true,
        module_insert: false,
        rsvp_select: true,
        rsvp_insert: true,
        rsvp_update: true,
        rsvp_delete: false,
        idempotency_delete: false,
      });
      const persistenceErrors: string[] = [];
      const runtimeRepository = new DrizzleEventRsvpRepository(runtime.database, {
        onPersistenceError: (error: unknown) => {
          const candidate = error as { code?: unknown; message?: unknown };
          persistenceErrors.push(JSON.stringify({ code: candidate.code, message: candidate.message }));
        },
      });
      const restrictedResult = await change(graph, "going", 0, "restricted-runtime", runtime.database, runtimeRepository);
      if (!restrictedResult.ok) {
        const bypassRepository = new DrizzleEventRsvpRepository(runtime.database, {
          runtimeDatabaseAuthorityVerifier: async () => true,
          onPersistenceError: (error: unknown) => {
            const candidate = error as { code?: unknown; message?: unknown };
            persistenceErrors.push(JSON.stringify({ bypassCode: candidate.code, bypassMessage: candidate.message }));
          },
        });
        const bypassResult = await change(graph, "going", 0, "restricted-runtime-bypass", runtime.database, bypassRepository);
        throw new Error(`Restricted RSVP diagnostic: ${JSON.stringify({ restrictedResult, bypassResult, persistenceErrors })}`);
      }
      expect(restrictedResult).toEqual({
        ok: true,
        value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true },
      });
    } finally {
      await destroyRestrictedRuntime(runtime);
    }
  });

  it("serializes two first RSVP writes at the Tenant/Event/Membership row", async () => {
    const graph = await createGraph();
    const results = await Promise.all([
      change(graph, "going", 0, "race-going"),
      change(graph, "interested", 0, "race-interested"),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "VERSION_CONFLICT" }]);
    const rows = await getDatabase().select().from(eventRsvps).where(and(
      eq(eventRsvps.tenantId, graph.tenantId),
      eq(eventRsvps.eventId, graph.eventId),
      eq(eventRsvps.membershipId, graph.membershipId),
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(1);
  });

  it("proves RSVP Event FOR SHARE blocks a competing Event FOR UPDATE", async () => {
    const graph = await createGraph();
    const entered = deferred<void>();
    const release = deferred<void>();
    let rsvpBackendPid = 0;
    const rsvpRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { rsvpBackendPid = pid; },
      beforeFinalClockCheck: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    const rsvpPromise = change(graph, "going", 0, "share-lock", getDatabase(), rsvpRepository);
    await entered.promise;
    const competingClient = await getPool().connect();
    try {
      await competingClient.query("begin");
      const competingUpdate = competingClient.query(
        'select id from "events" where id = $1 for update',
        [graph.eventId],
      );
      await waitForBlocked(rsvpBackendPid, 'for update');
      release.resolve();
      await expect(rsvpPromise).resolves.toMatchObject({ ok: true, value: { state: "going" } });
      await competingUpdate;
      await competingClient.query("rollback");
    } finally {
      await competingClient.query("rollback").catch(() => undefined);
      competingClient.release();
    }
  });

  it("lets an Event cancellation committed behind FOR UPDATE win before RSVP evaluates", async () => {
    const graph = await createGraph();
    const lockClient = await getPool().connect();
    try {
      await lockClient.query("begin");
      const lockPid = await backendPid(lockClient);
      await lockClient.query('select id from "events" where id = $1 for update', [graph.eventId]);
      const rsvpPromise = change(graph, "going", 0, "cancel-lock");
      await waitForBlocked(lockPid, 'for share');
      await lockClient.query(
        'update "events" set lifecycle = \'cancelled\', cancellation_retention_until = $2, version = version + 1, updated_at = clock_timestamp() where id = $1',
        [graph.eventId, FUTURE_END],
      );
      await lockClient.query("commit");
      await expect(rsvpPromise).resolves.toEqual({ ok: false, error: "INVALID_STATE" });
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
    }
  });
});
