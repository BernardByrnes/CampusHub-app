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
  eventAudienceCriteria,
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

async function createGraph(options: Readonly<{
  module?: "enabled" | "disabled" | "missing";
  startsAt?: Date;
  endsAt?: Date | null;
  lifecycle?: "draft" | "published" | "postponed" | "cancelled";
  visibility?: "PUBLIC" | "MEMBERS" | "VERIFIED_MEMBERS";
  membershipLifecycle?: "unverified" | "pending_review" | "verified" | "stale" | "on_leave" | "alumni" | "transferred_out" | "participation_suspended" | "suspended" | "closed";
  assuranceLevel?: "L0" | "L1" | "L2" | "L3";
}> = {}): Promise<Graph> {
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
    assuranceLevel: options.assuranceLevel ?? "L1",
    lifecycle: options.membershipLifecycle ?? "verified",
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
    startsAt: options.startsAt ?? FUTURE_START,
    endsAt: options.endsAt === undefined ? FUTURE_END : options.endsAt,
    campusId,
    visibility: options.visibility ?? "MEMBERS",
    audienceMode: "entire_tenant",
    rsvpEnabled: true,
    lifecycle: options.lifecycle ?? "published",
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

async function waitForBlockedBy(waitingPid: number, blockingPid: number, lockQueryFragment: string): Promise<number[]> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await getPool().query<{ blockers: number[] }>(
      `select pg_blocking_pids(activity.pid) as blockers
         from pg_stat_activity as activity
        where activity.pid = $1
          and activity.wait_event_type = 'Lock'
          and $2 = any(pg_blocking_pids(activity.pid))
          and activity.query ilike $3`,
      [waitingPid, blockingPid, `%${lockQueryFragment}%`],
    );
    const blockers = result.rows[0]?.blockers;
    if (blockers !== undefined) return blockers;
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_DELAY_MS));
  }
  throw new Error(`Timed out waiting for PostgreSQL PID ${waitingPid} to block on PID ${blockingPid}: ${lockQueryFragment}`);
}

function sqlIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

type RsvpWriteBarrier = Readonly<{
  ownerPid: number;
  tableName: string;
  release: () => Promise<void>;
  cleanup: () => Promise<void>;
}>;

async function createRsvpWriteBarrier(graph: Graph): Promise<RsvpWriteBarrier> {
  const barrierClient = await getPool().connect();
  const suffix = randomUUID().replaceAll("-", "");
  const tableName = `evt003_rsvp_barrier_${suffix}`;
  const functionName = `evt003_rsvp_barrier_trigger_${suffix}`;
  const triggerName = `evt003_rsvp_barrier_${suffix}`;
  const barrierKey = randomUUID();
  const table = `public.${sqlIdentifier(tableName)}`;
  const functionNameSql = `public.${sqlIdentifier(functionName)}`;
  const trigger = sqlIdentifier(triggerName);
  let transactionHeld = false;
  let released = false;

  try {
    await barrierClient.query(`create table ${table} (barrier_key text primary key, released boolean not null default false)`);
    await barrierClient.query(`insert into ${table} (barrier_key) values ($1)`, [barrierKey]);
    await barrierClient.query(`
      create function ${functionNameSql}()
      returns trigger
      language plpgsql
      as $function$
      declare
        barrier_released boolean;
      begin
        if new.tenant_id::text = tg_argv[2]
           and new.event_id::text = tg_argv[3]
           and new.membership_id::text = tg_argv[4] then
          execute format('select released from %I where barrier_key = $1 for update', tg_argv[0])
             into barrier_released
            using tg_argv[1];
          if barrier_released is distinct from true then
            raise exception 'RSVP test barrier did not release';
          end if;
        end if;
        return new;
      end;
      $function$
    `);
    await barrierClient.query(`
      create trigger ${trigger}
      after insert or update on public."event_rsvps"
      for each row
      execute function ${functionNameSql}(
        ${sqlLiteral(tableName)},
        ${sqlLiteral(barrierKey)},
        ${sqlLiteral(graph.tenantId)},
        ${sqlLiteral(graph.eventId)},
        ${sqlLiteral(graph.membershipId)}
      )
    `);
    await barrierClient.query("begin");
    await barrierClient.query(`select barrier_key from ${table} where barrier_key = $1 for update`, [barrierKey]);
    const ownerPid = await backendPid(barrierClient);
    transactionHeld = true;

    return {
      ownerPid,
      tableName,
      release: async () => {
        if (!transactionHeld || released) return;
        await barrierClient.query(`update ${table} set released = true where barrier_key = $1`, [barrierKey]);
        await barrierClient.query("commit");
        released = true;
        transactionHeld = false;
      },
      cleanup: async () => {
        if (transactionHeld && !released) {
          await barrierClient.query(`update ${table} set released = true where barrier_key = $1`, [barrierKey]);
          await barrierClient.query("commit");
          transactionHeld = false;
          released = true;
        }
        await barrierClient.query(`drop trigger if exists ${trigger} on public."event_rsvps"`);
        await barrierClient.query(`drop function if exists ${functionNameSql}()`);
        await barrierClient.query(`drop table if exists ${table}`);
        barrierClient.release();
      },
    };
  } catch (error) {
    await barrierClient.query("rollback").catch(() => undefined);
    await barrierClient.query(`drop trigger if exists ${trigger} on public."event_rsvps"`).catch(() => undefined);
    await barrierClient.query(`drop function if exists ${functionNameSql}()`).catch(() => undefined);
    await barrierClient.query(`drop table if exists ${table}`).catch(() => undefined);
    barrierClient.release();
    throw error;
  }
}

async function waitForDatabaseTime(target: Date): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await getPool().query<{ crossed: boolean }>(
      "select clock_timestamp() >= $1::timestamptz as crossed",
      [target],
    );
    if (result.rows[0]?.crossed === true) return;
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_DELAY_MS));
  }
  throw new Error("Timed out waiting for authoritative PostgreSQL time to cross starts_at.");
}

type RestrictedRuntime = Readonly<{
  database: CampusHubDatabase;
  pool: Pool;
  roleName: string;
}>;

async function createRestrictedRuntime(options: Readonly<{ withApprovedRuntimeRole?: boolean }> = {}): Promise<RestrictedRuntime> {
  const adminPool = getPool();
  const roleName = `campushub_evt003_runtime_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const quotedRole = `"${roleName}"`;
  await adminPool.query(`create role ${quotedRole} login inherit password '${password}'`);
  try {
    await adminPool.query(`grant usage on schema public to ${quotedRole}`);
    await adminPool.query(`revoke create on schema public from ${quotedRole}`);
    if (options.withApprovedRuntimeRole !== false) {
      await adminPool.query(`grant "campushub_runtime" to ${quotedRole}`);
    }
    await adminPool.query(
      `grant select, update, references on "tenants", "memberships", "events" to ${quotedRole}`,
    );
    await adminPool.query(
      `grant select, references on "event_audience_criteria" to ${quotedRole}`,
    );
    await adminPool.query(
      `grant select on "tenant_module_states" to ${quotedRole}`,
    );
    await adminPool.query(
      `grant update ("updated_at") on "tenant_module_states" to ${quotedRole}`,
    );
    await adminPool.query(
      `grant select, insert, update on "event_rsvps", "event_rsvp_idempotency" to ${quotedRole}`,
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
  await getPool().query(`revoke update ("updated_at") on "tenant_module_states" from ${quotedRole}`).catch(() => undefined);
  await getPool().query(`drop owned by ${quotedRole}`);
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
  it("RSVP-PG-07/08/10 creates, replays, conflicts, withdraws, reactivates, reads, and counts one Tenant RSVP", async () => {
    const graph = await createGraph();
    const rsvps = repository();

    await expect(change(graph, "going", 0, "rsvp-going")).resolves.toMatchObject({
      ok: true,
      value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true },
    });
    await expect(change(graph, "going", 0, "rsvp-going")).resolves.toMatchObject({
      ok: true,
      value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true },
    });
    await expect(change(graph, "interested", 0, "rsvp-going")).resolves.toEqual({
      ok: false,
      error: "IDEMPOTENCY_CONFLICT",
    });
    await expect(change(graph, "interested", 1, "rsvp-interested")).resolves.toMatchObject({
      ok: true,
      value: { state: "interested", participationVersion: 2, changed: true },
    });
    await expect(change(graph, "going", 0, "rsvp-going")).resolves.toEqual({
      ok: true,
      value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true },
    });
    const replayedRows = await getDatabase().select().from(eventRsvps).where(and(
      eq(eventRsvps.tenantId, graph.tenantId),
      eq(eventRsvps.eventId, graph.eventId),
      eq(eventRsvps.membershipId, graph.membershipId),
    ));
    expect(replayedRows[0]).toMatchObject({ state: "interested", version: 2 });
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

  it("RSVP-PG-11 fails closed when the durable Event module row is missing or disabled", async () => {
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

  it("RSVP-PG-11 proves the real PostgreSQL runtime module-version privilege boundary", async () => {
    const graph = await createGraph();
    const runtime = await createRestrictedRuntime({ withApprovedRuntimeRole: false });
    try {
      const privilegeRows = await getPool().query<{
        module_select: boolean;
        module_insert: boolean;
        rsvp_select: boolean;
        rsvp_insert: boolean;
        rsvp_update: boolean;
         rsvp_delete: boolean;
         idempotency_delete: boolean;
         module_tenant_id_update: boolean;
         module_scope_update: boolean;
         module_enabled_update: boolean;
         module_version_update: boolean;
         module_updated_at_update: boolean;
      }>(`
        select
          has_table_privilege('campushub_runtime', 'public.tenant_module_states', 'SELECT') as module_select,
          has_table_privilege('campushub_runtime', 'public.tenant_module_states', 'INSERT') as module_insert,
          has_table_privilege('campushub_runtime', 'public.event_rsvps', 'SELECT') as rsvp_select,
          has_table_privilege('campushub_runtime', 'public.event_rsvps', 'INSERT') as rsvp_insert,
          has_table_privilege('campushub_runtime', 'public.event_rsvps', 'UPDATE') as rsvp_update,
          has_table_privilege('campushub_runtime', 'public.event_rsvps', 'DELETE') as rsvp_delete,
           has_table_privilege('campushub_runtime', 'public.event_rsvp_idempotency', 'DELETE') as idempotency_delete,
           has_column_privilege('campushub_runtime', 'public.tenant_module_states', 'tenant_id', 'UPDATE') as module_tenant_id_update,
           has_column_privilege('campushub_runtime', 'public.tenant_module_states', 'module', 'UPDATE') as module_scope_update,
           has_column_privilege('campushub_runtime', 'public.tenant_module_states', 'enabled', 'UPDATE') as module_enabled_update,
           has_column_privilege('campushub_runtime', 'public.tenant_module_states', 'version', 'UPDATE') as module_version_update,
           has_column_privilege('campushub_runtime', 'public.tenant_module_states', 'updated_at', 'UPDATE') as module_updated_at_update
      `);
      expect(privilegeRows.rows[0]).toEqual({
        module_select: true,
        module_insert: false,
        rsvp_select: true,
        rsvp_insert: true,
        rsvp_update: true,
        rsvp_delete: false,
        idempotency_delete: false,
        module_tenant_id_update: false,
        module_scope_update: false,
        module_enabled_update: false,
        module_version_update: false,
        module_updated_at_update: true,
      });
      const runtimeRepository = new DrizzleEventRsvpRepository(runtime.database, {});
      await expect(change(graph, "going", 0, "restricted-runtime", runtime.database, runtimeRepository)).resolves.toEqual({
        ok: true,
        value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true },
      });
      await expect(runtime.pool.query(
        'select enabled, version from "tenant_module_states" where tenant_id = $1 and module = \'event\' for share',
        [graph.tenantId],
      )).resolves.toMatchObject({ rows: [{ enabled: true, version: 1 }] });
      await expect(runtime.pool.query(
        'update "tenant_module_states" set enabled = false where tenant_id = $1 and module = \'event\'',
        [graph.tenantId],
      )).rejects.toThrow();
      await expect(runtime.pool.query(
        'update "tenant_module_states" set version = version + 1 where tenant_id = $1 and module = \'event\'',
        [graph.tenantId],
      )).rejects.toThrow();
    } finally {
      await destroyRestrictedRuntime(runtime);
    }
  });

  it("RSVP-PG-01 proves the first-row uniqueness race is real PostgreSQL blocking", async () => {
    const graph = await createGraph();
    const barrier = await createRsvpWriteBarrier(graph);
    let firstPromise: ReturnType<typeof change> | undefined;
    let secondPromise: ReturnType<typeof change> | undefined;
    try {
      const firstStarted = deferred<number>();
      const firstRepository = new DrizzleEventRsvpRepository(getDatabase(), {
        runtimeDatabaseAuthorityVerifier: async () => true,
        onTransactionStarted: async (pid) => { firstStarted.resolve(pid); },
      });
      firstPromise = change(graph, "going", 0, "race-going", getDatabase(), firstRepository);
      const firstPid = await firstStarted.promise;
      await waitForBlockedBy(firstPid, barrier.ownerPid, barrier.tableName);

      const secondStarted = deferred<number>();
      const secondRepository = new DrizzleEventRsvpRepository(getDatabase(), {
        runtimeDatabaseAuthorityVerifier: async () => true,
        onTransactionStarted: async (pid) => { secondStarted.resolve(pid); },
      });
      secondPromise = change(graph, "interested", 0, "race-interested", getDatabase(), secondRepository);
      const secondPid = await secondStarted.promise;
      expect(secondPid).not.toBe(firstPid);
      const blockers = await waitForBlockedBy(secondPid, firstPid, "event_rsvps");
      expect(blockers).toContain(firstPid);

      await barrier.release();
      const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
      expect(firstResult).toEqual({ ok: true, value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true } });
      expect(secondResult).toEqual({ ok: false, error: "VERSION_CONFLICT" });
      const rows = await getDatabase().select().from(eventRsvps).where(and(
        eq(eventRsvps.tenantId, graph.tenantId),
        eq(eventRsvps.eventId, graph.eventId),
        eq(eventRsvps.membershipId, graph.membershipId),
      ));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: "going", version: 1 });
    } finally {
      await barrier.release().catch(() => undefined);
      await Promise.allSettled([firstPromise, secondPromise].filter((promise): promise is ReturnType<typeof change> => promise !== undefined));
      await barrier.cleanup();
    }
  });

  it("RSVP-PG-02 proves same-state concurrent updates block and resolve to CHANGED plus NOOP", async () => {
    const graph = await createGraph();
    await expect(change(graph, "going", 0, "same-state-seed")).resolves.toMatchObject({
      ok: true,
      value: { state: "going", participationVersion: 1 },
    });
    const barrier = await createRsvpWriteBarrier(graph);
    let firstPromise: ReturnType<typeof change> | undefined;
    let secondPromise: ReturnType<typeof change> | undefined;
    try {
      const firstStarted = deferred<number>();
      const firstRepository = new DrizzleEventRsvpRepository(getDatabase(), {
        runtimeDatabaseAuthorityVerifier: async () => true,
        onTransactionStarted: async (pid) => { firstStarted.resolve(pid); },
      });
      firstPromise = change(graph, "interested", 1, "same-state-a", getDatabase(), firstRepository);
      const firstPid = await firstStarted.promise;
      await waitForBlockedBy(firstPid, barrier.ownerPid, barrier.tableName);

      const secondStarted = deferred<number>();
      const secondRepository = new DrizzleEventRsvpRepository(getDatabase(), {
        runtimeDatabaseAuthorityVerifier: async () => true,
        onTransactionStarted: async (pid) => { secondStarted.resolve(pid); },
      });
      secondPromise = change(graph, "interested", 1, "same-state-b", getDatabase(), secondRepository);
      const secondPid = await secondStarted.promise;
      expect(secondPid).not.toBe(firstPid);
      const blockers = await waitForBlockedBy(secondPid, firstPid, "event_rsvps");
      expect(blockers).toContain(firstPid);

      await barrier.release();
      const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
      expect(firstResult).toEqual({ ok: true, value: { outcome: "CHANGED", state: "interested", participationVersion: 2, changed: true } });
      expect(secondResult).toEqual({ ok: true, value: { outcome: "NOOP", state: "interested", participationVersion: 2, changed: false } });
      const rows = await getDatabase().select().from(eventRsvps).where(and(
        eq(eventRsvps.tenantId, graph.tenantId),
        eq(eventRsvps.eventId, graph.eventId),
        eq(eventRsvps.membershipId, graph.membershipId),
      ));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: "interested", version: 2 });
    } finally {
      await barrier.release().catch(() => undefined);
      await Promise.allSettled([firstPromise, secondPromise].filter((promise): promise is ReturnType<typeof change> => promise !== undefined));
      await barrier.cleanup();
    }
  });

  it("RSVP-PG-03 proves materially different existing-row intents block and stale loser conflicts", async () => {
    const graph = await createGraph();
    await expect(change(graph, "going", 0, "different-state-seed")).resolves.toMatchObject({
      ok: true,
      value: { state: "going", participationVersion: 1 },
    });
    const barrier = await createRsvpWriteBarrier(graph);
    let firstPromise: ReturnType<typeof change> | undefined;
    let secondPromise: ReturnType<typeof change> | undefined;
    try {
      const firstStarted = deferred<number>();
      const firstRepository = new DrizzleEventRsvpRepository(getDatabase(), {
        runtimeDatabaseAuthorityVerifier: async () => true,
        onTransactionStarted: async (pid) => { firstStarted.resolve(pid); },
      });
      firstPromise = change(graph, "interested", 1, "different-state-a", getDatabase(), firstRepository);
      const firstPid = await firstStarted.promise;
      await waitForBlockedBy(firstPid, barrier.ownerPid, barrier.tableName);

      const secondStarted = deferred<number>();
      const secondRepository = new DrizzleEventRsvpRepository(getDatabase(), {
        runtimeDatabaseAuthorityVerifier: async () => true,
        onTransactionStarted: async (pid) => { secondStarted.resolve(pid); },
      });
      secondPromise = change(graph, "withdrawn", 1, "different-state-b", getDatabase(), secondRepository);
      const secondPid = await secondStarted.promise;
      expect(secondPid).not.toBe(firstPid);
      const blockers = await waitForBlockedBy(secondPid, firstPid, "event_rsvps");
      expect(blockers).toContain(firstPid);

      await barrier.release();
      const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
      expect(firstResult).toEqual({ ok: true, value: { outcome: "CHANGED", state: "interested", participationVersion: 2, changed: true } });
      expect(secondResult).toEqual({ ok: false, error: "VERSION_CONFLICT" });
      const rows = await getDatabase().select().from(eventRsvps).where(and(
        eq(eventRsvps.tenantId, graph.tenantId),
        eq(eventRsvps.eventId, graph.eventId),
        eq(eventRsvps.membershipId, graph.membershipId),
      ));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ state: "interested", version: 2 });
    } finally {
      await barrier.release().catch(() => undefined);
      await Promise.allSettled([firstPromise, secondPromise].filter((promise): promise is ReturnType<typeof change> => promise !== undefined));
      await barrier.cleanup();
    }
  });

  it("RSVP-PG-09 rejects foreign Event, foreign Membership, and wrong identity without a write", async () => {
    const graphA = await createGraph();
    const graphB = await createGraph();
    const rsvps = repository();
    await expect(rsvps.changeParticipation(
      graphA.tenantId,
      graphA.membershipId,
      graphA.identitySubjectId,
      command({ ...graphA, eventId: graphB.eventId }, "going", 0, "foreign-event"),
    )).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
    await expect(rsvps.changeParticipation(
      graphA.tenantId,
      graphB.membershipId,
      graphB.identitySubjectId,
      command(graphA, "going", 0, "foreign-membership"),
    )).resolves.toEqual({ ok: false, error: "TENANT_SCOPE_NOT_FOUND" });
    await expect(rsvps.changeParticipation(
      graphA.tenantId,
      graphA.membershipId,
      "wrong-identity",
      command(graphA, "going", 0, "wrong-identity"),
    )).resolves.toEqual({ ok: false, error: "TENANT_SCOPE_NOT_FOUND" });
    await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, graphA.tenantId))).resolves.toHaveLength(0);
    await expect(getDatabase().select().from(eventRsvpIdempotency).where(eq(eventRsvpIdempotency.tenantId, graphA.tenantId))).resolves.toHaveLength(0);
  });

  it("RSVP-PG-10 keeps aggregate counts isolated by Tenant", async () => {
    const graphA = await createGraph();
    const graphB = await createGraph();
    await expect(change(graphA, "going", 0, "aggregate-a")).resolves.toMatchObject({ ok: true });
    await expect(change(graphB, "going", 0, "aggregate-b")).resolves.toMatchObject({ ok: true });
    await expect(repository().getAggregateCounts(graphA.tenantId, graphA.eventId)).resolves.toEqual({
      ok: true,
      goingCount: 1,
      interestedCount: 0,
    });
    await expect(repository().getAggregateCounts(graphB.tenantId, graphB.eventId)).resolves.toEqual({
      ok: true,
      goingCount: 1,
      interestedCount: 0,
    });
  });

  it("RSVP-PG-06 re-evaluates authoritative database time after a deterministic lock barrier", async () => {
    const graph = await createGraph();
    const target = (await getPool().query<{ starts_at: Date }>(
      'update "events" set starts_at = clock_timestamp() + interval \'1 second\', ends_at = clock_timestamp() + interval \'2 seconds\' where id = $1 returning starts_at',
      [graph.eventId],
    )).rows[0]?.starts_at;
    if (!(target instanceof Date)) throw new Error("PostgreSQL starts_at target was unavailable.");
    const lockClient = await getPool().connect();
    try {
      await lockClient.query("begin");
      const lockPid = await backendPid(lockClient);
      await lockClient.query('select id from "events" where id = $1 for update', [graph.eventId]);
      const rsvpPromise = change(graph, "going", 0, "starts-at-crossing");
      await waitForBlocked(lockPid, "for share");
      await waitForDatabaseTime(target);
      await lockClient.query("commit");
      await expect(rsvpPromise).resolves.toEqual({ ok: false, error: "RESOURCE_NOT_ACTIVE" });
      await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, graph.tenantId))).resolves.toHaveLength(0);
    } finally {
      await lockClient.query("rollback").catch(() => undefined);
      lockClient.release();
    }
  });

  it("RSVP-PG-04 proves RSVP-first Event FOR SHARE blocks cancellation FOR UPDATE", async () => {
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

  it("RSVP-PG-04 proves cancellation-first Event FOR UPDATE makes RSVP fail closed", async () => {
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

  it("RSVP-PG-04 preserves the RSVP-first result after cancellation is unblocked", async () => {
    const graph = await createGraph();
    const entered = deferred<void>();
    const release = deferred<void>();
    let rsvpPid = 0;
    const rsvpRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { rsvpPid = pid; },
      beforeFinalClockCheck: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    const rsvpPromise = change(graph, "going", 0, "cancel-after-rsvp", getDatabase(), rsvpRepository);
    await entered.promise;
    const cancellationClient = await getPool().connect();
    try {
      await cancellationClient.query("begin");
      const cancellation = cancellationClient.query(
        'update "events" set lifecycle = \'cancelled\', cancellation_retention_until = $2, version = version + 1, updated_at = clock_timestamp() where id = $1',
        [graph.eventId, FUTURE_END],
      );
      await waitForBlocked(rsvpPid, 'update "events"');
      release.resolve();
      await expect(rsvpPromise).resolves.toMatchObject({ ok: true, value: { state: "going", participationVersion: 1 } });
      await cancellation;
      await cancellationClient.query("commit");
    } finally {
      await cancellationClient.query("rollback").catch(() => undefined);
      cancellationClient.release();
    }
    await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, graph.tenantId))).resolves.toHaveLength(1);
  });

  it("RSVP-PG-05 proves postpone-first denial and preserves RSVP-first writes", async () => {
    const postponedFirst = await createGraph();
    const postponeLock = await getPool().connect();
    try {
      await postponeLock.query("begin");
      const lockPid = await backendPid(postponeLock);
      await postponeLock.query('select id from "events" where id = $1 for update', [postponedFirst.eventId]);
      const rsvpPromise = change(postponedFirst, "going", 0, "postpone-first");
      await waitForBlocked(lockPid, "for share");
      await postponeLock.query(
        'update "events" set lifecycle = \'postponed\', version = version + 1, starts_at = $2, ends_at = $3, updated_at = clock_timestamp() where id = $1',
        [postponedFirst.eventId, new Date("2099-09-21T10:00:00.000Z"), new Date("2099-09-21T12:00:00.000Z")],
      );
      await postponeLock.query("commit");
      await expect(rsvpPromise).resolves.toEqual({ ok: false, error: "RESOURCE_NOT_ACTIVE" });
    } finally {
      await postponeLock.query("rollback").catch(() => undefined);
      postponeLock.release();
    }

    const rsvpFirst = await createGraph();
    const entered = deferred<void>();
    const release = deferred<void>();
    let rsvpPid = 0;
    const rsvpRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { rsvpPid = pid; },
      beforeFinalClockCheck: async () => {
        entered.resolve();
        await release.promise;
      },
    });
    const rsvpPromise = change(rsvpFirst, "going", 0, "rsvp-before-postpone", getDatabase(), rsvpRepository);
    await entered.promise;
    const postponeClient = await getPool().connect();
    try {
      await postponeClient.query("begin");
      const postponement = postponeClient.query(
        'update "events" set lifecycle = \'postponed\', version = version + 1, starts_at = $2, ends_at = $3, updated_at = clock_timestamp() where id = $1',
        [rsvpFirst.eventId, new Date("2099-09-21T10:00:00.000Z"), new Date("2099-09-21T12:00:00.000Z")],
      );
      await waitForBlocked(rsvpPid, 'update "events"');
      release.resolve();
      await expect(rsvpPromise).resolves.toMatchObject({ ok: true, value: { state: "going", participationVersion: 1 } });
      await postponement;
      await postponeClient.query("commit");
    } finally {
      await postponeClient.query("rollback").catch(() => undefined);
      postponeClient.release();
    }
    await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, rsvpFirst.tenantId))).resolves.toHaveLength(1);
  });

  it("RSVP-PG-12 preserves RSVP across postponement and permits it after republish", async () => {
    const graph = await createGraph();
    await expect(change(graph, "going", 0, "before-postpone")).resolves.toMatchObject({ ok: true, value: { participationVersion: 1 } });
    await getPool().query(
      'update "events" set lifecycle = \'postponed\', version = version + 1, starts_at = $2, ends_at = $3, updated_at = clock_timestamp() where id = $1',
      [graph.eventId, new Date("2099-09-21T10:00:00.000Z"), new Date("2099-09-21T12:00:00.000Z")],
    );
    await expect(change(graph, "interested", 1, "while-postponed")).resolves.toEqual({ ok: false, error: "RESOURCE_NOT_ACTIVE" });
    await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, graph.tenantId))).resolves.toHaveLength(1);
    await getPool().query(
      'update "events" set lifecycle = \'published\', version = version + 1, updated_at = clock_timestamp() where id = $1',
      [graph.eventId],
    );
    await expect(change(graph, "interested", 1, "after-republish")).resolves.toMatchObject({
      ok: true,
      value: { outcome: "CHANGED", state: "interested", participationVersion: 2, changed: true },
    });
  });

  it("RSVP-PG-07/08 persists exact CHANGED and NOOP replays and rejects fingerprint conflicts", async () => {
    const graph = await createGraph();
    await expect(change(graph, "going", 0, "exact-replay")).resolves.toEqual({
      ok: true,
      value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true },
    });
    await expect(change(graph, "going", 0, "exact-replay")).resolves.toEqual({
      ok: true,
      value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true },
    });
    await expect(change(graph, "interested", 1, "same-state-noop")).resolves.toEqual({
      ok: true,
      value: { outcome: "CHANGED", state: "interested", participationVersion: 2, changed: true },
    });
    await expect(change(graph, "interested", 2, "noop-replay")).resolves.toEqual({
      ok: true,
      value: { outcome: "NOOP", state: "interested", participationVersion: 2, changed: false },
    });
    await expect(change(graph, "interested", 0, "exact-replay")).resolves.toEqual({ ok: false, error: "IDEMPOTENCY_CONFLICT" });
    const rows = await getDatabase().select().from(eventRsvpIdempotency).where(eq(eventRsvpIdempotency.tenantId, graph.tenantId));
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.idempotencyKey === "exact-replay")).toMatchObject({ completedOutcome: "CHANGED", completedChanged: true, completedState: "going", completedParticipationVersion: 1 });
    expect(rows.find((row) => row.idempotencyKey === "noop-replay")).toMatchObject({ completedOutcome: "NOOP", completedChanged: false, completedState: "interested", completedParticipationVersion: 2 });
  });

  it("enforces the bounded idempotency completion shape at PostgreSQL", async () => {
    const graph = await createGraph();
    const inserted = (await getDatabase().insert(eventRsvpIdempotency).values({
      tenantId: graph.tenantId,
      eventId: graph.eventId,
      membershipId: graph.membershipId,
      operationFamily: "participation",
      idempotencyKey: "completion-shape",
      requestedState: "going",
      expectedParticipationVersion: 0,
    }).returning({ id: eventRsvpIdempotency.id }))[0];
    if (inserted === undefined) throw new Error("Idempotency fixture insert returned no row.");
    await expect(getPool().query(
      'update "event_rsvp_idempotency" set completed_outcome = \'CHANGED\', completed_state = \'going\', completed_participation_version = 1, completed_changed = false, completed_at = clock_timestamp() where id = $1',
      [inserted.id],
    )).rejects.toThrow();
    await expect(getPool().query(
      'update "event_rsvp_idempotency" set completed_outcome = \'CHANGED\', completed_state = \'going\', completed_participation_version = 1, completed_at = clock_timestamp() where id = $1',
      [inserted.id],
    )).rejects.toThrow();
    await expect(getDatabase().select().from(eventRsvpIdempotency).where(eq(eventRsvpIdempotency.id, inserted.id))).resolves.toMatchObject([{ completedOutcome: null, completedState: null, completedParticipationVersion: null, completedChanged: null, completedAt: null }]);
  });

  it("proves Tenant suspension invalidation both before and after an RSVP lock", async () => {
    const invalidatorFirst = await createGraph();
    const invalidator = await getPool().connect();
    try {
      await invalidator.query("begin");
      const invalidatorPid = await backendPid(invalidator);
      await invalidator.query('update "tenants" set status = \'suspended\' where id = $1', [invalidatorFirst.tenantId]);
      const blockedRsvp = change(invalidatorFirst, "going", 0, "tenant-invalidator-first");
      await waitForBlocked(invalidatorPid, "for share");
      await invalidator.query("commit");
      await expect(blockedRsvp).resolves.toEqual({ ok: false, error: "TENANT_SUSPENDED" });
      await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, invalidatorFirst.tenantId))).resolves.toHaveLength(0);
    } finally {
      await invalidator.query("rollback").catch(() => undefined);
      invalidator.release();
    }

    const rsvpFirst = await createGraph();
    const entered = deferred<void>();
    const release = deferred<void>();
    let rsvpPid = 0;
    const rsvpRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { rsvpPid = pid; },
      beforeFinalClockCheck: async () => { entered.resolve(); await release.promise; },
    });
    const rsvp = change(rsvpFirst, "going", 0, "tenant-rsvp-first", getDatabase(), rsvpRepository);
    await entered.promise;
    const tenantWriter = await getPool().connect();
    try {
      await tenantWriter.query("begin");
      const update = tenantWriter.query('update "tenants" set status = \'suspended\' where id = $1', [rsvpFirst.tenantId]);
      await waitForBlocked(rsvpPid, 'update "tenants"');
      release.resolve();
      await expect(rsvp).resolves.toMatchObject({ ok: true, value: { state: "going", participationVersion: 1 } });
      await update;
      await tenantWriter.query("commit");
    } finally {
      await tenantWriter.query("rollback").catch(() => undefined);
      tenantWriter.release();
    }
    await expect(change(rsvpFirst, "interested", 1, "tenant-after-invalidation")).resolves.toEqual({ ok: false, error: "TENANT_SUSPENDED" });
  });

  it("proves Event-module disable invalidation both before and after an RSVP lock", async () => {
    const invalidatorFirst = await createGraph();
    const invalidator = await getPool().connect();
    try {
      await invalidator.query("begin");
      const invalidatorPid = await backendPid(invalidator);
      await invalidator.query('update "tenant_module_states" set enabled = false, version = version + 1 where tenant_id = $1 and module = \'event\'', [invalidatorFirst.tenantId]);
      const blockedRsvp = change(invalidatorFirst, "going", 0, "module-invalidator-first");
      await waitForBlocked(invalidatorPid, "for share");
      await invalidator.query("commit");
      await expect(blockedRsvp).resolves.toEqual({ ok: false, error: "MODULE_DISABLED" });
      await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, invalidatorFirst.tenantId))).resolves.toHaveLength(0);
    } finally {
      await invalidator.query("rollback").catch(() => undefined);
      invalidator.release();
    }

    const rsvpFirst = await createGraph();
    const entered = deferred<void>();
    const release = deferred<void>();
    let rsvpPid = 0;
    const rsvpRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { rsvpPid = pid; },
      beforeFinalClockCheck: async () => { entered.resolve(); await release.promise; },
    });
    const rsvp = change(rsvpFirst, "going", 0, "module-rsvp-first", getDatabase(), rsvpRepository);
    await entered.promise;
    const moduleWriter = await getPool().connect();
    try {
      await moduleWriter.query("begin");
      const update = moduleWriter.query('update "tenant_module_states" set enabled = false, version = version + 1 where tenant_id = $1 and module = \'event\'', [rsvpFirst.tenantId]);
      await waitForBlocked(rsvpPid, 'update "tenant_module_states"');
      release.resolve();
      await expect(rsvp).resolves.toMatchObject({ ok: true, value: { state: "going", participationVersion: 1 } });
      await update;
      await moduleWriter.query("commit");
    } finally {
      await moduleWriter.query("rollback").catch(() => undefined);
      moduleWriter.release();
    }
    await expect(change(rsvpFirst, "interested", 1, "module-after-invalidation")).resolves.toEqual({ ok: false, error: "MODULE_DISABLED" });
  });

  it("proves Membership participation invalidation both before and after an RSVP lock", async () => {
    const invalidatorFirst = await createGraph();
    const invalidator = await getPool().connect();
    try {
      await invalidator.query("begin");
      const invalidatorPid = await backendPid(invalidator);
      await invalidator.query('update "memberships" set lifecycle = \'participation_suspended\' where tenant_id = $1 and id = $2', [invalidatorFirst.tenantId, invalidatorFirst.membershipId]);
      const blockedRsvp = change(invalidatorFirst, "going", 0, "membership-invalidator-first");
      await waitForBlocked(invalidatorPid, "for share");
      await invalidator.query("commit");
      await expect(blockedRsvp).resolves.toEqual({ ok: false, error: "MEMBERSHIP_STATE_INELIGIBLE" });
      await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, invalidatorFirst.tenantId))).resolves.toHaveLength(0);
    } finally {
      await invalidator.query("rollback").catch(() => undefined);
      invalidator.release();
    }

    const rsvpFirst = await createGraph();
    const entered = deferred<void>();
    const release = deferred<void>();
    let rsvpPid = 0;
    const rsvpRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { rsvpPid = pid; },
      beforeFinalClockCheck: async () => { entered.resolve(); await release.promise; },
    });
    const rsvp = change(rsvpFirst, "going", 0, "membership-rsvp-first", getDatabase(), rsvpRepository);
    await entered.promise;
    const membershipWriter = await getPool().connect();
    try {
      await membershipWriter.query("begin");
      const update = membershipWriter.query('update "memberships" set lifecycle = \'participation_suspended\' where tenant_id = $1 and id = $2', [rsvpFirst.tenantId, rsvpFirst.membershipId]);
      await waitForBlocked(rsvpPid, 'update "memberships"');
      release.resolve();
      await expect(rsvp).resolves.toMatchObject({ ok: true, value: { state: "going", participationVersion: 1 } });
      await update;
      await membershipWriter.query("commit");
    } finally {
      await membershipWriter.query("rollback").catch(() => undefined);
      membershipWriter.release();
    }
    await expect(change(rsvpFirst, "interested", 1, "membership-after-invalidation")).resolves.toEqual({ ok: false, error: "MEMBERSHIP_STATE_INELIGIBLE" });
  });

  it("reauthorizes own RSVP reads through canonical Event detail visibility and audience policy", async () => {
    const accessible = await createGraph();
    await expect(change(accessible, "going", 0, "readable-rsvp")).resolves.toMatchObject({ ok: true });
    await expect(repository().findOwnParticipation(accessible.tenantId, accessible.eventId, accessible.membershipId, accessible.identitySubjectId)).resolves.toEqual({ ok: true, state: "going", participationVersion: 1 });

    const empty = await createGraph();
    await expect(repository().findOwnParticipation(empty.tenantId, empty.eventId, empty.membershipId, empty.identitySubjectId)).resolves.toEqual({ ok: true, state: null, participationVersion: 0 });

    const draft = await createGraph({ lifecycle: "draft" });
    await getDatabase().insert(eventRsvps).values({ tenantId: draft.tenantId, eventId: draft.eventId, membershipId: draft.membershipId, state: "going", version: 1 });
    await expect(repository().findOwnParticipation(draft.tenantId, draft.eventId, draft.membershipId, draft.identitySubjectId)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });

    const retentionHidden = await createGraph({ lifecycle: "cancelled" });
    await getDatabase().insert(eventRsvps).values({ tenantId: retentionHidden.tenantId, eventId: retentionHidden.eventId, membershipId: retentionHidden.membershipId, state: "going", version: 1 });
    await expect(repository().findOwnParticipation(retentionHidden.tenantId, retentionHidden.eventId, retentionHidden.membershipId, retentionHidden.identitySubjectId)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });

    const assurance = await createGraph();
    await getDatabase().insert(eventRsvps).values({ tenantId: assurance.tenantId, eventId: assurance.eventId, membershipId: assurance.membershipId, state: "going", version: 1 });
    await getDatabase().update(memberships).set({ assuranceLevel: "L0" }).where(and(eq(memberships.tenantId, assurance.tenantId), eq(memberships.id, assurance.membershipId)));
    await expect(repository().findOwnParticipation(assurance.tenantId, assurance.eventId, assurance.membershipId, assurance.identitySubjectId)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });

    const targeted = await createGraph();
    const otherCampus = (await getDatabase().insert(tables.campuses).values({ tenantId: targeted.tenantId, label: "Other RSVP Campus", status: "active" }).returning({ id: tables.campuses.id }))[0]?.id;
    if (otherCampus === undefined) throw new Error("Targeted read campus fixture was unavailable.");
    await getDatabase().update(events).set({ audienceMode: "targeted" }).where(and(eq(events.tenantId, targeted.tenantId), eq(events.id, targeted.eventId)));
    await getDatabase().insert(eventAudienceCriteria).values({ tenantId: targeted.tenantId, eventId: targeted.eventId, dimension: "campus", provenancePolicy: "authoritative_only", campusId: otherCampus });
    await getDatabase().insert(eventRsvps).values({ tenantId: targeted.tenantId, eventId: targeted.eventId, membershipId: targeted.membershipId, state: "going", version: 1 });
    await expect(repository().findOwnParticipation(targeted.tenantId, targeted.eventId, targeted.membershipId, targeted.identitySubjectId)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });

    const wrongIdentity = await repository().findOwnParticipation(accessible.tenantId, accessible.eventId, accessible.membershipId, "wrong-read-identity");
    expect(wrongIdentity).toEqual({ ok: false, error: "TENANT_SCOPE_NOT_FOUND" });
    const foreign = await createGraph();
    await expect(repository().findOwnParticipation(accessible.tenantId, foreign.eventId, accessible.membershipId, accessible.identitySubjectId)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("rolls back RSVP-PG failure paths without a partial participation or idempotency success", async () => {
    const graph = await createGraph();
    await expect(change(graph, "going", 0, "atomic-seed")).resolves.toMatchObject({ ok: true });
    await expect(change(graph, "interested", 0, "stale-version")).resolves.toEqual({ ok: false, error: "VERSION_CONFLICT" });
    await expect(change(graph, "interested", 0, "atomic-seed")).resolves.toEqual({ ok: false, error: "IDEMPOTENCY_CONFLICT" });
    await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, graph.tenantId))).resolves.toHaveLength(1);

    const updateGraph = await createGraph();
    await expect(change(updateGraph, "going", 0, "atomic-update-seed")).resolves.toMatchObject({ ok: true });
    const beforeUpdate = (await getDatabase().select().from(eventRsvps).where(and(
      eq(eventRsvps.tenantId, updateGraph.tenantId),
      eq(eventRsvps.eventId, updateGraph.eventId),
      eq(eventRsvps.membershipId, updateGraph.membershipId),
    )))[0];
    if (beforeUpdate === undefined) throw new Error("Atomicity update fixture was unavailable.");

    const insertGraph = await createGraph();
    const runtime = await createRestrictedRuntime({ withApprovedRuntimeRole: false });
    try {
      await getPool().query(`revoke update on "event_rsvp_idempotency" from "${runtime.roleName}"`);
      const runtimeRepository = new DrizzleEventRsvpRepository(runtime.database, { runtimeDatabaseAuthorityVerifier: async () => true });
      await expect(change(updateGraph, "interested", 1, "finalization-update-failure", runtime.database, runtimeRepository)).resolves.toEqual({ ok: false, error: "PERSISTENCE_FAILED" });
      const afterUpdate = (await getDatabase().select().from(eventRsvps).where(and(
        eq(eventRsvps.tenantId, updateGraph.tenantId),
        eq(eventRsvps.eventId, updateGraph.eventId),
        eq(eventRsvps.membershipId, updateGraph.membershipId),
      )))[0];
      expect(afterUpdate).toMatchObject({ state: "going", version: 1 });
      expect(afterUpdate?.updatedAt.toISOString()).toBe(beforeUpdate.updatedAt.toISOString());
      await expect(getDatabase().select().from(eventRsvpIdempotency).where(and(
        eq(eventRsvpIdempotency.tenantId, updateGraph.tenantId),
        eq(eventRsvpIdempotency.idempotencyKey, "finalization-update-failure"),
      ))).resolves.toHaveLength(0);

      await expect(change(insertGraph, "going", 0, "finalization-insert-failure", runtime.database, runtimeRepository)).resolves.toEqual({ ok: false, error: "PERSISTENCE_FAILED" });
      await expect(getDatabase().select().from(eventRsvps).where(and(
        eq(eventRsvps.tenantId, insertGraph.tenantId),
        eq(eventRsvps.eventId, insertGraph.eventId),
        eq(eventRsvps.membershipId, insertGraph.membershipId),
      ))).resolves.toHaveLength(0);
      await expect(getDatabase().select().from(eventRsvpIdempotency).where(and(
        eq(eventRsvpIdempotency.tenantId, insertGraph.tenantId),
        eq(eventRsvpIdempotency.idempotencyKey, "finalization-insert-failure"),
      ))).resolves.toHaveLength(0);
    } finally {
      await destroyRestrictedRuntime(runtime);
    }
  });
});
