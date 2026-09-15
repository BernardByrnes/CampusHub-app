import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { CAPABILITIES } from "@/domain/authorization/capability";
import { StaticAuditIntegrityKeyProvider } from "@/domain/audit/audit-integrity-key-provider";
import type { CreateEventInput, UpdateEventInput } from "@/domain/events/events";
import type { CampusHubDatabase } from "@/server/db/client";
import { PostgresCapabilityAuthorizer } from "@/server/authorization/postgres-capability-authorizer";
import { PostgresAuthorizedEventManagementExecutor } from "@/server/authorization/postgres-authorized-events";
import { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import { DrizzleEventRepository } from "@/server/repositories/event-repository";
import { DrizzleGuildTermRepository } from "@/server/repositories/guild-term-repository";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import { DrizzleRoleGrantRepository } from "@/server/repositories/role-grant-repository";
import { DrizzleTenantRepository } from "@/server/repositories/tenant-repository";
import {
  auditEvents,
  campuses,
  eventAudienceCriteria,
  eventLifecycleHistory,
  events,
  guildTerms,
  memberships,
  roleGrants,
  tenantAcademicYearConfig,
  tenants,
} from "@/server/db/schema";

if (process.env.CAMPUSHUB_DB_INTEGRATION !== "1") {
  throw new Error("Real database integration is opt-in. Set CAMPUSHUB_DB_INTEGRATION=1.");
}

loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL was not loaded for Event integration tests.");
}

const NOW = new Date("2026-09-20T10:00:00.000Z");
const TERM_END = new Date("2027-01-01T00:00:00.000Z");
const auditKey = new Uint8Array(Buffer.from("campushub-event-integration-audit-key"));
let pool: Pool | undefined;
let database: CampusHubDatabase | undefined;
let sequence = 0;

function getDatabase(): CampusHubDatabase {
  if (database === undefined) throw new Error("Event integration database is not initialized.");
  return database;
}

function nextSlug(label: string): string {
  sequence += 1;
  return `event-integration-${Date.now().toString(36)}-${label}-${sequence}`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function createGraph() {
  const tenantRows = await getDatabase().insert(tenants).values({
    slug: nextSlug("tenant"), displayName: "Event Integration Tenant", status: "active", timezone: "Africa/Kampala",
  }).returning({ id: tenants.id });
  const tenantId = tenantRows[0]?.id;
  if (tenantId === undefined) throw new Error("Tenant insert returned no row.");
  const campusRows = await getDatabase().insert(campuses).values({
    tenantId, label: "Event Integration Campus", status: "active",
  }).returning({ id: campuses.id });
  const campusId = campusRows[0]?.id;
  if (campusId === undefined) throw new Error("Campus insert returned no row.");
  const membershipRows = await getDatabase().insert(memberships).values({
    tenantId, identitySubjectId: nextSlug("identity"), assuranceLevel: "L2", lifecycle: "verified",
  }).returning({ id: memberships.id });
  const membershipId = membershipRows[0]?.id;
  if (membershipId === undefined) throw new Error("Membership insert returned no row.");
  const termRows = await getDatabase().insert(guildTerms).values({
    tenantId, label: "Event Integration Term", startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: TERM_END, status: "active",
  }).returning({ id: guildTerms.id });
  const guildTermId = termRows[0]?.id;
  if (guildTermId === undefined) throw new Error("Guild Term insert returned no row.");
  const grantRows = await getDatabase().insert(roleGrants).values({
    tenantId, guildTermId, membershipId, role: "publisher", capability: CAPABILITIES.EVENT_MANAGE, moduleScope: "event", expiresAt: new Date("2026-12-31T23:59:59.000Z"), revokedAt: null,
  }).returning({ id: roleGrants.id });
  const grantId = grantRows[0]?.id;
  if (grantId === undefined) throw new Error("Role Grant insert returned no row.");
  return { tenantId, campusId, membershipId, guildTermId, grantId };
}

async function setAcademicYearRange(
  graph: Awaited<ReturnType<typeof createGraph>>,
  minimumYear: number,
  maximumYear: number,
): Promise<void> {
  await getDatabase().insert(tenantAcademicYearConfig).values({
    tenantId: graph.tenantId,
    minimumYear,
    maximumYear,
  });
}

function services(
  beforeFinalAuthorityCheck?: () => Promise<void>,
  auditEventsOverride?: Pick<DrizzleAuditEventRepository, "appendEventMutationInTransaction">,
  beforeFinalClockCheck?: () => Promise<void>,
  runtimeDatabaseAuthorityVerifier: (database: Pick<CampusHubDatabase, "execute">) => Promise<boolean> = async () => true,
  applicationName?: string,
  onTransactionStarted?: (backendPid: number) => void | Promise<void>,
) {
  const repository = new DrizzleEventRepository(getDatabase());
  const membershipsRepository = new DrizzleMembershipRepository();
  const tenantsRepository = new DrizzleTenantRepository();
  const guildTermsRepository = new DrizzleGuildTermRepository();
  const roleGrantsRepository = new DrizzleRoleGrantRepository();
  const authorizer = new PostgresCapabilityAuthorizer({
    tenants: tenantsRepository,
    memberships: membershipsRepository,
    guildTerms: guildTermsRepository,
    roleGrants: roleGrantsRepository,
    clock: { now: () => NOW },
  });
  const auditRepository = auditEventsOverride ?? new DrizzleAuditEventRepository({
    database: getDatabase(),
    keyProvider: new StaticAuditIntegrityKeyProvider(1, new Map([[1, auditKey]])),
    eventIdFactory: randomUUID,
  });
  return new PostgresAuthorizedEventManagementExecutor({
    database: getDatabase(),
    authorizer,
    auditEvents: auditRepository,
    eventRepository: repository,
    runtimeDatabaseAuthorityVerifier,
    beforeFinalAuthorityCheck,
    beforeFinalClockCheck,
    applicationName,
    onTransactionStarted,
  });
}

function request(graph: Awaited<ReturnType<typeof createGraph>>) {
  return {
    actor: { identitySubjectId: "not-used-by-this-helper", tenantId: graph.tenantId, membershipId: graph.membershipId },
    context: { tenantStatus: "active" as const, membershipStatus: "verified" as const, assuranceLevel: "L2" as const },
    capability: CAPABILITIES.EVENT_MANAGE,
    scope: { tenantId: graph.tenantId, module: "event" as const, resource: "event" },
  };
}

async function identitySubjectId(graph: Awaited<ReturnType<typeof createGraph>>): Promise<string> {
  const rows = await getDatabase().select({ identitySubjectId: memberships.identitySubjectId }).from(memberships).where(eq(memberships.id, graph.membershipId));
  const value = rows[0]?.identitySubjectId;
  if (value === undefined) throw new Error("Membership identity was not found.");
  return value;
}

function input(graph: Awaited<ReturnType<typeof createGraph>>): CreateEventInput {
  return {
    title: "Orientation",
    description: "A campus event",
    venue: "Main Hall",
    startsAt: new Date("2026-09-25T10:00:00.000Z"),
    endsAt: new Date("2026-09-25T12:00:00.000Z"),
    campusId: graph.campusId,
    visibility: "MEMBERS",
    audienceMode: "entire_tenant",
    rsvpEnabled: false,
    audience: { mode: "entire_tenant", groups: [] },
  };
}

function targetedInput(
  graph: Awaited<ReturnType<typeof createGraph>>,
  expectedVersion: number,
): UpdateEventInput {
  return {
    ...input(graph),
    expectedVersion,
    title: "Targeted Orientation",
    audienceMode: "targeted",
    audience: {
      mode: "targeted",
      groups: [{
        dimension: "campus",
        provenancePolicy: "authoritative_only",
        campusIds: [graph.campusId],
      }],
    },
  };
}

function academicYearCreateInput(
  graph: Awaited<ReturnType<typeof createGraph>>,
  academicYear: number,
): CreateEventInput {
  return {
    ...input(graph),
    audienceMode: "targeted",
    audience: {
      mode: "targeted",
      groups: [{
        dimension: "academic_year",
        provenancePolicy: "authoritative_only",
        academicYears: [academicYear],
      }],
    },
  };
}

function academicYearEditInput(
  graph: Awaited<ReturnType<typeof createGraph>>,
  expectedVersion: number,
  academicYear: number,
): UpdateEventInput {
  return { ...academicYearCreateInput(graph, academicYear), expectedVersion };
}

async function prepareRequest(graph: Awaited<ReturnType<typeof createGraph>>) {
  return { ...request(graph), actor: { ...request(graph).actor, identitySubjectId: await identitySubjectId(graph) } };
}

const LOCK_WAIT_TIMEOUT_MS = 8_000;
const LOCK_POLL_DELAY_MS = 25;

function getPool(): Pool {
  if (pool === undefined) throw new Error("Event integration pool is not initialized.");
  return pool;
}

async function waitForCondition<T>(read: () => Promise<T>, ready: (value: T) => boolean, message: string): Promise<T> {
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
  while (true) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_DELAY_MS));
  }
}

async function waitForEventLockWait(blockingBackendPid: number, tableName: string): Promise<void> {
  await waitForCondition(
    async () => getDatabase().execute(sql`
      select activity.pid
      from pg_stat_activity as activity
      where activity.state = 'active'
        and activity.wait_event_type = 'Lock'
        and ${blockingBackendPid} = any(pg_blocking_pids(activity.pid))
        and activity.query ilike ${`%from "${tableName}"%`}
        and activity.query ilike '%for update%'
    `),
    (result) => result.rows.length > 0,
    `Timed out waiting for an Event transaction to wait on ${tableName} behind backend ${blockingBackendPid}.`,
  ).then(() => undefined);
}

async function waitForNamedLockWait(blockingBackendPid: number, tableName: string): Promise<void> {
  await waitForCondition(
    async () => getDatabase().execute(sql`
      select activity.pid
      from pg_stat_activity as activity
      where activity.state = 'active'
        and activity.wait_event_type = 'Lock'
        and ${blockingBackendPid} = any(pg_blocking_pids(activity.pid))
        and activity.query ilike ${`%from "${tableName}"%`}
        and activity.query ilike '%for update%'
    `),
    (result) => result.rows.length > 0,
    `Timed out waiting for an invalidation transaction to wait on ${tableName} behind backend ${blockingBackendPid}.`,
  ).then(() => undefined);
}

async function backendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ backend_pid: number }>("select pg_backend_pid() as backend_pid");
  const value = result.rows[0]?.backend_pid;
  if (!Number.isInteger(value) || value <= 0) throw new Error("PostgreSQL backend identity was unavailable.");
  return value;
}

async function waitForDatabaseTimeAtOrAfter(target: Date): Promise<void> {
  await waitForCondition(
    async () => getDatabase().execute(sql`select clock_timestamp() as database_time`),
    (result) => {
      const value = (result.rows[0] as { database_time?: unknown } | undefined)?.database_time;
      const current = value instanceof Date ? value : new Date(String(value));
      return current.getTime() >= target.getTime();
    },
    `Timed out waiting for PostgreSQL clock_timestamp() to reach ${target.toISOString()}.`,
  ).then(() => undefined);
}

type AuthorityInvalidationKind = "tenant" | "membership" | "guildTerm" | "roleGrant";

const AUTHORITY_INVALIDATIONS: readonly Readonly<{
  kind: AuthorityInvalidationKind;
  tableName: string;
}>[] = [
  { kind: "tenant", tableName: "tenants" },
  { kind: "membership", tableName: "memberships" },
  { kind: "guildTerm", tableName: "guild_terms" },
  { kind: "roleGrant", tableName: "role_grants" },
];

async function beginAuthorityInvalidation(
  graph: Awaited<ReturnType<typeof createGraph>>,
  kind: AuthorityInvalidationKind,
  applicationName: string,
): Promise<PoolClient> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('application_name', $1, true)", [applicationName]);
    if (kind === "tenant") {
      await client.query('select id from "tenants" where id = $1 for update', [graph.tenantId]);
      await client.query('update "tenants" set status = \'suspended\', updated_at = clock_timestamp() where id = $1', [graph.tenantId]);
    } else if (kind === "membership") {
      await client.query('select id from "memberships" where id = $1 for update', [graph.membershipId]);
      await client.query('update "memberships" set lifecycle = \'suspended\', updated_at = clock_timestamp() where id = $1', [graph.membershipId]);
    } else if (kind === "guildTerm") {
      await client.query('select id from "guild_terms" where id = $1 for update', [graph.guildTermId]);
      await client.query('update "guild_terms" set status = \'closed\', updated_at = clock_timestamp() where id = $1', [graph.guildTermId]);
    } else {
      await client.query('select id from "role_grants" where id = $1 for update', [graph.grantId]);
      await client.query('update "role_grants" set revoked_at = clock_timestamp(), updated_at = clock_timestamp() where id = $1', [graph.grantId]);
    }
    return client;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw error;
  }
}

async function finishClient(client: PoolClient, commit = true): Promise<void> {
  try {
    await client.query(commit ? "COMMIT" : "ROLLBACK");
  } finally {
    client.release();
  }
}

async function holdRowLock(tableName: string, id: string, applicationName: string): Promise<PoolClient> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("select set_config('application_name', $1, true)", [applicationName]);
    await client.query(`select id from "${tableName}" where id = $1 for update`, [id]);
    return client;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    throw error;
  }
}

async function eventState(tenantId: string, eventId: string) {
  const rows = await getDatabase().select({ version: events.version, lifecycle: events.lifecycle }).from(events).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId)));
  const audits = await getDatabase().select({ count: sql<number>`count(*)::int` }).from(auditEvents).where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.resourceId, eventId)));
  return { event: rows[0] ?? null, auditCount: Number(audits[0]?.count ?? 0) };
}

async function createDraft(graph: Awaited<ReturnType<typeof createGraph>>): Promise<{ eventId: string; actor: Awaited<ReturnType<typeof prepareRequest>> }> {
  const actor = await prepareRequest(graph);
  const result = await services().createEvent(actor, graph.tenantId, input(graph));
  expect(result).toMatchObject({ ok: true, record: { event: { version: 1, lifecycle: "draft" } } });
  if (!result.ok) throw new Error("Event draft fixture creation failed.");
  return { eventId: result.record.event.id, actor };
}

async function createPublished(graph: Awaited<ReturnType<typeof createGraph>>): Promise<{ eventId: string; actor: Awaited<ReturnType<typeof prepareRequest>> }> {
  const draft = await createDraft(graph);
  const result = await services().publishEvent(draft.actor, graph.tenantId, draft.eventId, { expectedVersion: 1 });
  expect(result).toMatchObject({ ok: true, changed: true, record: { event: { version: 2, lifecycle: "published" } } });
  return draft;
}

type LifecycleOperation = "postpone" | "republish" | "cancel";

async function prepareLifecycleOperation(operation: LifecycleOperation) {
  const graph = await createGraph();
  const published = await createPublished(graph);
  if (operation === "postpone") {
    return {
      graph,
      eventId: published.eventId,
      actor: published.actor,
      expectedVersion: 2,
      run: (executor: PostgresAuthorizedEventManagementExecutor) => executor.postponeEvent(published.actor, graph.tenantId, published.eventId, {
        expectedVersion: 2,
        startsAt: new Date("2026-10-01T10:00:00.000Z"),
        endsAt: new Date("2026-10-01T12:00:00.000Z"),
        reason: "Authority matrix postponement",
      }),
    };
  }
  const postponed = await services().postponeEvent(published.actor, graph.tenantId, published.eventId, {
    expectedVersion: 2,
    startsAt: new Date("2026-10-01T10:00:00.000Z"),
    endsAt: new Date("2026-10-01T12:00:00.000Z"),
    reason: "Authority matrix setup",
  });
  expect(postponed).toMatchObject({ ok: true, record: { event: { version: 3, lifecycle: "postponed" } } });
  return operation === "republish"
    ? {
        graph,
        eventId: published.eventId,
        actor: published.actor,
        expectedVersion: 3,
        run: (executor: PostgresAuthorizedEventManagementExecutor) => executor.republishEvent(published.actor, graph.tenantId, published.eventId, { expectedVersion: 3 }),
      }
    : {
        graph,
        eventId: published.eventId,
        actor: published.actor,
        expectedVersion: 3,
        run: (executor: PostgresAuthorizedEventManagementExecutor) => executor.cancelEvent(published.actor, graph.tenantId, published.eventId, { expectedVersion: 3, reason: "Authority matrix cancellation" }),
      };
}

async function lifecycleHistoryState(tenantId: string, eventId: string) {
  return getDatabase()
    .select({
      sequence: eventLifecycleHistory.sequence,
      eventVersion: eventLifecycleHistory.eventVersion,
      fromLifecycle: eventLifecycleHistory.fromLifecycle,
      toLifecycle: eventLifecycleHistory.toLifecycle,
      startsAt: eventLifecycleHistory.startsAt,
      endsAt: eventLifecycleHistory.endsAt,
      postponedFromStartsAt: eventLifecycleHistory.postponedFromStartsAt,
      reason: eventLifecycleHistory.reason,
      cancellationRetentionUntil: eventLifecycleHistory.cancellationRetentionUntil,
    })
    .from(eventLifecycleHistory)
    .where(and(eq(eventLifecycleHistory.tenantId, tenantId), eq(eventLifecycleHistory.eventId, eventId)))
    .orderBy(eventLifecycleHistory.sequence);
}

async function createAcademicYearDraft(
  graph: Awaited<ReturnType<typeof createGraph>>,
  academicYear: number,
): Promise<{ eventId: string; actor: Awaited<ReturnType<typeof prepareRequest>> }> {
  const actor = await prepareRequest(graph);
  const result = await services().createEvent(
    actor,
    graph.tenantId,
    academicYearCreateInput(graph, academicYear),
  );
  expect(result).toMatchObject({
    ok: true,
    record: { event: { version: 1, lifecycle: "draft" } },
  });
  if (!result.ok) throw new Error("Academic-year Event draft fixture creation failed.");
  return { eventId: result.record.event.id, actor };
}

beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl });
  database = drizzle({ client: pool }) as CampusHubDatabase;
  await pool.query("select 1");
});

afterAll(async () => { await pool?.end(); });

describe("real PostgreSQL Event Core", () => {
  it("creates, edits, publishes, audits, lists and isolates an Event", async () => {
    const graph = await createGraph();
    const other = await createGraph();
    const actor = await prepareRequest(graph);
    const executor = services();
    const created = await executor.createEvent(actor, graph.tenantId, input(graph));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.record.event).toMatchObject({ version: 1, lifecycle: "draft" });
    expect(await new DrizzleEventRepository(getDatabase()).findEventByIdForTenant(other.tenantId, created.record.event.id)).toBeNull();

    const edit: UpdateEventInput = { ...input(graph), title: "Changed Orientation", expectedVersion: 1 };
    const updated = await executor.updateEvent(actor, graph.tenantId, created.record.event.id, edit);
    expect(updated).toMatchObject({ ok: true, changed: true, record: { event: { version: 2, lifecycle: "draft" } } });
    const published = await executor.publishEvent(actor, graph.tenantId, created.record.event.id, { expectedVersion: 2 });
    expect(published).toMatchObject({ ok: true, changed: true, record: { event: { version: 3, lifecycle: "published" } } });

    const rows = await getDatabase().select({ eventType: auditEvents.eventType, resourceVersion: auditEvents.resourceVersion }).from(auditEvents).where(and(eq(auditEvents.tenantId, graph.tenantId), eq(auditEvents.resourceId, created.record.event.id))).orderBy(auditEvents.sequence);
    expect(rows).toEqual([
      { eventType: "event.created", resourceVersion: 1 },
      { eventType: "event.changed", resourceVersion: 2 },
      { eventType: "event.published", resourceVersion: 3 },
    ]);
    const criteria = await getDatabase().select().from(eventAudienceCriteria).where(eq(eventAudienceCriteria.eventId, created.record.event.id));
    expect(criteria).toHaveLength(0);
    const listed = await new DrizzleEventRepository(getDatabase()).listEventsForTenant(graph.tenantId, { now: NOW, limit: 10 });
    expect(listed.map((record) => record.event.id)).toContain(created.record.event.id);
  });

  it("records the complete postpone, republish and cancel history atomically", async () => {
    const graph = await createGraph();
    const draft = await createPublished(graph);
    const originalStartsAt = new Date("2026-09-25T10:00:00.000Z");
    const firstReplacementStartsAt = new Date("2026-10-01T10:00:00.000Z");
    const firstReplacementEndsAt = new Date("2026-10-01T12:00:00.000Z");
    const secondReplacementStartsAt = new Date("2026-11-01T10:00:00.000Z");
    const secondReplacementEndsAt = new Date("2026-11-01T12:00:00.000Z");

    await expect(services().postponeEvent(draft.actor, graph.tenantId, draft.eventId, {
      expectedVersion: 2,
      startsAt: firstReplacementStartsAt,
      endsAt: firstReplacementEndsAt,
      reason: "Venue unavailable",
    })).resolves.toMatchObject({ ok: true, changed: true, record: { event: { version: 3, lifecycle: "postponed" } } });
    await expect(services().republishEvent(draft.actor, graph.tenantId, draft.eventId, { expectedVersion: 3 })).resolves.toMatchObject({
      ok: true,
      changed: true,
      record: { event: { version: 4, lifecycle: "published" } },
    });
    await expect(services().postponeEvent(draft.actor, graph.tenantId, draft.eventId, {
      expectedVersion: 4,
      startsAt: secondReplacementStartsAt,
      endsAt: secondReplacementEndsAt,
      reason: "Weather delay",
    })).resolves.toMatchObject({ ok: true, changed: true, record: { event: { version: 5, lifecycle: "postponed" } } });
    const cancelled = await services().cancelEvent(draft.actor, graph.tenantId, draft.eventId, {
      expectedVersion: 5,
      reason: "Venue closed",
    });
    expect(cancelled).toMatchObject({
      ok: true,
      changed: true,
      record: {
        event: {
          version: 6,
          lifecycle: "cancelled",
          cancellationRetentionUntil: firstReplacementStartsAt,
        },
      },
    });

    const history = await lifecycleHistoryState(graph.tenantId, draft.eventId);
    expect(history).toHaveLength(5);
    expect(history.map((row) => ({ sequence: row.sequence, eventVersion: row.eventVersion, from: row.fromLifecycle, to: row.toLifecycle }))).toEqual([
      { sequence: 1, eventVersion: 2, from: "draft", to: "published" },
      { sequence: 2, eventVersion: 3, from: "published", to: "postponed" },
      { sequence: 3, eventVersion: 4, from: "postponed", to: "published" },
      { sequence: 4, eventVersion: 5, from: "published", to: "postponed" },
      { sequence: 5, eventVersion: 6, from: "postponed", to: "cancelled" },
    ]);
    expect(history[0]).toMatchObject({ startsAt: originalStartsAt, postponedFromStartsAt: null, reason: null });
    expect(history[1]).toMatchObject({ startsAt: firstReplacementStartsAt, endsAt: firstReplacementEndsAt, postponedFromStartsAt: originalStartsAt, reason: "Venue unavailable" });
    expect(history[3]).toMatchObject({ startsAt: secondReplacementStartsAt, endsAt: secondReplacementEndsAt, postponedFromStartsAt: firstReplacementStartsAt, reason: "Weather delay" });
    expect(history[4]).toMatchObject({ startsAt: secondReplacementStartsAt, endsAt: secondReplacementEndsAt, postponedFromStartsAt: null, reason: "Venue closed", cancellationRetentionUntil: firstReplacementStartsAt });

    const audits = await getDatabase()
      .select({ eventType: auditEvents.eventType, resourceVersion: auditEvents.resourceVersion, eventFacts: auditEvents.eventFacts })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, graph.tenantId), eq(auditEvents.resourceId, draft.eventId)))
      .orderBy(auditEvents.sequence);
    expect(audits.map((row) => [row.eventType, row.resourceVersion])).toEqual([
      ["event.created", 1],
      ["event.published", 2],
      ["event.postponed", 3],
      ["event.republished", 4],
      ["event.postponed", 5],
      ["event.cancelled", 6],
    ]);
    expect(audits.slice(2).map((row) => (row.eventFacts as { historySequence?: number }).historySequence)).toEqual([2, 3, 4, 5]);
  });

  it("uses the original schedule for direct cancellation retention and filters lifecycle surfaces", async () => {
    const graph = await createGraph();
    const published = await createPublished(graph);
    const cancelled = await services().cancelEvent(published.actor, graph.tenantId, published.eventId, {
      expectedVersion: 2,
      reason: "Cancelled before opening",
    });
    expect(cancelled).toMatchObject({
      ok: true,
      record: { event: { lifecycle: "cancelled", cancellationRetentionUntil: new Date("2026-09-25T12:00:00.000Z") } },
    });
    const repository = new DrizzleEventRepository(getDatabase());
    const beforeRetention = await repository.listEventsForTenant(graph.tenantId, { now: NOW, limit: 10 });
    expect(beforeRetention.some((record) => record.event.id === published.eventId && record.event.lifecycle === "cancelled")).toBe(true);
    const discover = await repository.listEventsForTenant(graph.tenantId, { now: NOW, surface: "discover", limit: 10 });
    expect(discover.some((record) => record.event.id === published.eventId)).toBe(false);
    const afterRetention = await repository.listEventsForTenant(graph.tenantId, { now: new Date("2026-09-25T12:00:00.000Z"), limit: 10 });
    expect(afterRetention.some((record) => record.event.id === published.eventId)).toBe(false);
  });

  it("rolls back lifecycle and history together when the audit append fails", async () => {
    const graph = await createGraph();
    const published = await createPublished(graph);
    const failingAudit = { appendEventMutationInTransaction: async () => { throw new Error("audit failure"); } };
    const result = await services(undefined, failingAudit).postponeEvent(published.actor, graph.tenantId, published.eventId, {
      expectedVersion: 2,
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: new Date("2026-10-01T12:00:00.000Z"),
      reason: "Audit rollback proof",
    });
    expect(result).toEqual({ ok: false, error: "PERSISTENCE_FAILED" });
    expect(await eventState(graph.tenantId, published.eventId)).toEqual({
      event: { version: 2, lifecycle: "published" },
      auditCount: 2,
    });
    expect(await lifecycleHistoryState(graph.tenantId, published.eventId)).toHaveLength(1);
  });

  it("rejects an out-of-range academic-year Event create before insertion", async () => {
    const graph = await createGraph();
    await setAcademicYearRange(graph, 1, 4);
    const actor = await prepareRequest(graph);
    const result = await services().createEvent(
      actor,
      graph.tenantId,
      academicYearCreateInput(graph, 5),
    );
    expect(result).toEqual({ ok: false, error: "NOT_READY" });

    const eventRows = await getDatabase()
      .select({ count: sql<number>`count(*)::int` })
      .from(events)
      .where(eq(events.tenantId, graph.tenantId));
    const audienceRows = await getDatabase()
      .select({ count: sql<number>`count(*)::int` })
      .from(eventAudienceCriteria)
      .where(eq(eventAudienceCriteria.tenantId, graph.tenantId));
    const auditRows = await getDatabase()
      .select({ count: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, graph.tenantId));
    expect(Number(eventRows[0]?.count ?? 0)).toBe(0);
    expect(Number(audienceRows[0]?.count ?? 0)).toBe(0);
    expect(Number(auditRows[0]?.count ?? 0)).toBe(0);
  });

  it("rejects an out-of-range academic-year Event edit without changing state", async () => {
    const graph = await createGraph();
    await setAcademicYearRange(graph, 1, 4);
    const { eventId, actor } = await createAcademicYearDraft(graph, 2);
    const beforeAudience = await getDatabase()
      .select()
      .from(eventAudienceCriteria)
      .where(eq(eventAudienceCriteria.eventId, eventId));

    const result = await services().updateEvent(
      actor,
      graph.tenantId,
      eventId,
      academicYearEditInput(graph, 1, 5),
    );
    expect(result).toEqual({ ok: false, error: "NOT_READY" });
    expect(await eventState(graph.tenantId, eventId)).toEqual({
      event: { version: 1, lifecycle: "draft" },
      auditCount: 1,
    });
    const afterAudience = await getDatabase()
      .select()
      .from(eventAudienceCriteria)
      .where(eq(eventAudienceCriteria.eventId, eventId));
    expect(afterAudience).toEqual(beforeAudience);
    const auditRows = await getDatabase()
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, graph.tenantId), eq(auditEvents.resourceId, eventId)))
      .orderBy(auditEvents.sequence);
    expect(auditRows.map((row) => row.eventType)).toEqual(["event.created"]);
  });

  it("rejects publishing when the current academic-year range no longer includes the persisted target", async () => {
    const graph = await createGraph();
    await setAcademicYearRange(graph, 1, 4);
    const { eventId, actor } = await createAcademicYearDraft(graph, 4);
    await getDatabase()
      .update(tenantAcademicYearConfig)
      .set({ maximumYear: 3, updatedAt: new Date() })
      .where(eq(tenantAcademicYearConfig.tenantId, graph.tenantId));

    const result = await services().publishEvent(
      actor,
      graph.tenantId,
      eventId,
      { expectedVersion: 1 },
    );
    expect(result).toEqual({ ok: false, error: "NOT_READY" });
    expect(await eventState(graph.tenantId, eventId)).toEqual({
      event: { version: 1, lifecycle: "draft" },
      auditCount: 1,
    });
    const auditRows = await getDatabase()
      .select({ eventType: auditEvents.eventType })
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, graph.tenantId), eq(auditEvents.resourceId, eventId)))
      .orderBy(auditEvents.sequence);
    expect(auditRows.map((row) => row.eventType)).toEqual(["event.created"]);
  });

  it("serializes Event mutations with academic-year configuration changes in both orderings", async () => {
    const configurationFirst = await createGraph();
    await setAcademicYearRange(configurationFirst, 1, 4);
    const configurationFirstDraft = await createAcademicYearDraft(configurationFirst, 2);
    const configurationHolder = await getPool().connect();
    let configurationHolderFinished = false;
    let configurationFirstAttempt: Promise<unknown> | undefined;
    try {
      await configurationHolder.query("BEGIN");
      await configurationHolder.query(
        'select tenant_id from "tenant_academic_year_config" where tenant_id = $1 for update',
        [configurationFirst.tenantId],
      );
      await configurationHolder.query(
        'update "tenant_academic_year_config" set maximum_year = 1, updated_at = clock_timestamp() where tenant_id = $1',
        [configurationFirst.tenantId],
      );
      const configurationBackendPid = await backendPid(configurationHolder);
      configurationFirstAttempt = services().publishEvent(
        configurationFirstDraft.actor,
        configurationFirst.tenantId,
        configurationFirstDraft.eventId,
        { expectedVersion: 1 },
      );
      await waitForEventLockWait(configurationBackendPid, "tenant_academic_year_config");
      await finishClient(configurationHolder, true);
      configurationHolderFinished = true;
      await expect(configurationFirstAttempt).resolves.toEqual({ ok: false, error: "NOT_READY" });
      await expect(eventState(configurationFirst.tenantId, configurationFirstDraft.eventId)).resolves.toEqual({
        event: { version: 1, lifecycle: "draft" },
        auditCount: 1,
      });
    } finally {
      if (!configurationHolderFinished) await finishClient(configurationHolder, false);
      await configurationFirstAttempt?.catch(() => undefined);
    }

    const eventFirst = await createGraph();
    await setAcademicYearRange(eventFirst, 1, 4);
    const eventFirstDraft = await createAcademicYearDraft(eventFirst, 2);
    const eventEntered = deferred<void>();
    const eventRelease = deferred<void>();
    const eventBackend = deferred<number>();
    const eventFirstExecutor = services(
      async () => {
        eventEntered.resolve();
        await eventRelease.promise;
      },
      undefined,
      undefined,
      undefined,
      `campushub-event-academic-year-event-first-${randomUUID()}`,
      (backend) => eventBackend.resolve(backend),
    );
    const eventFirstAttempt = eventFirstExecutor.publishEvent(
      eventFirstDraft.actor,
      eventFirst.tenantId,
      eventFirstDraft.eventId,
      { expectedVersion: 1 },
    );
    let configurationUpdateClient: PoolClient | undefined;
    let configurationUpdateFinished = false;
    try {
      await eventEntered.promise;
      const eventBackendPid = await eventBackend.promise;
      configurationUpdateClient = await getPool().connect();
      await configurationUpdateClient.query("BEGIN");
      await configurationUpdateClient.query(
        "select set_config('application_name', $1, true)",
        [`campushub-event-academic-year-update-${randomUUID()}`],
      );
      const configurationUpdate = configurationUpdateClient.query(
        'select tenant_id from "tenant_academic_year_config" where tenant_id = $1 for update',
        [eventFirst.tenantId],
      ).then(async () => {
        await configurationUpdateClient!.query(
          'update "tenant_academic_year_config" set maximum_year = 1, updated_at = clock_timestamp() where tenant_id = $1',
          [eventFirst.tenantId],
        );
        await configurationUpdateClient!.query("COMMIT");
      });
      await waitForNamedLockWait(eventBackendPid, "tenant_academic_year_config");
      eventRelease.resolve();
      await expect(eventFirstAttempt).resolves.toMatchObject({
        ok: true,
        changed: true,
        record: { event: { version: 2, lifecycle: "published" } },
      });
      await configurationUpdate;
      configurationUpdateFinished = true;
      await expect(eventState(eventFirst.tenantId, eventFirstDraft.eventId)).resolves.toEqual({
        event: { version: 2, lifecycle: "published" },
        auditCount: 2,
      });
    } finally {
      eventRelease.resolve();
      await eventFirstAttempt.catch(() => undefined);
      if (configurationUpdateClient !== undefined && !configurationUpdateFinished) {
        await configurationUpdateClient.query("ROLLBACK").catch(() => undefined);
        configurationUpdateClient.release();
      } else if (configurationUpdateClient !== undefined) {
        configurationUpdateClient.release();
      }
    }
  });

  it("serializes two publish contenders so only one advances the draft", async () => {
    const graph = await createGraph();
    const actor = await prepareRequest(graph);
    const created = await services().createEvent(actor, graph.tenantId, input(graph));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const entered = deferred<void>();
    const release = deferred<void>();
    const firstBackend = deferred<number>();
    let pauses = 0;
    const first = services(async () => {
      pauses += 1;
      if (pauses === 1) {
        entered.resolve();
        await release.promise;
      }
    }, undefined, undefined, undefined, undefined, (backend) => {
      firstBackend.resolve(backend);
    });
    const second = services();
    const firstAttempt = first.publishEvent(actor, graph.tenantId, created.record.event.id, { expectedVersion: 1 });
    await entered.promise;
    const firstBackendPid = await firstBackend.promise;
    const secondAttempt = second.publishEvent(actor, graph.tenantId, created.record.event.id, { expectedVersion: 1 });
    await waitForEventLockWait(firstBackendPid, "tenants");
    release.resolve();
    const [winner, loser] = await Promise.all([firstAttempt, secondAttempt]);
    expect([winner, loser].filter((result) => result.ok)).toHaveLength(1);
    expect([winner, loser].find((result) => !result.ok)).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    const row = await getDatabase().select({ version: events.version, lifecycle: events.lifecycle }).from(events).where(eq(events.id, created.record.event.id));
    expect(row[0]).toEqual({ version: 2, lifecycle: "published" });
  });

  it("rolls the Event insert back when the atomic audit append fails", async () => {
    const graph = await createGraph();
    const actor = await prepareRequest(graph);
    const failingAudit = { appendEventMutationInTransaction: async () => { throw new Error("audit failure"); } };
    const result = await services(undefined, failingAudit).createEvent(actor, graph.tenantId, input(graph));
    expect(result).toEqual({ ok: false, error: "PERSISTENCE_FAILED" });
    const rows = await getDatabase().select({ count: sql<number>`count(*)::int` }).from(events).where(eq(events.tenantId, graph.tenantId));
    expect(rows[0]?.count).toBe(0);
  });

  it.each(AUTHORITY_INVALIDATIONS)(
    "denies publish when a $kind authority invalidation commits after blocking the Event",
    async ({ kind, tableName }) => {
      const graph = await createGraph();
      const { eventId, actor } = await createDraft(graph);
      const invalidatorName = `campushub-event-invalidator-${kind}-${randomUUID()}`;
      const eventApplicationName = `campushub-event-authority-first-${kind}-${randomUUID()}`;
      const invalidator = await beginAuthorityInvalidation(graph, kind, invalidatorName);
      const invalidatorBackendPid = await backendPid(invalidator);
      let attempt: ReturnType<PostgresAuthorizedEventManagementExecutor["publishEvent"]> | undefined;
      try {
        const executor = services(undefined, undefined, undefined, undefined, eventApplicationName);
        attempt = executor.publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 });
        await waitForEventLockWait(invalidatorBackendPid, tableName);
      } catch (error) {
        await finishClient(invalidator, true);
        await attempt?.catch(() => undefined);
        throw error;
      }
      await finishClient(invalidator, true);
      await expect(attempt!).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
      await expect(eventState(graph.tenantId, eventId)).resolves.toEqual({
        event: { version: 1, lifecycle: "draft" },
        auditCount: 1,
      });
    },
  );

  it.each(AUTHORITY_INVALIDATIONS)(
    "lets Event publish win when the $kind invalidation starts after Event authority/resource locks",
    async ({ kind }) => {
      const graph = await createGraph();
      const { eventId, actor } = await createDraft(graph);
      const entered = deferred<void>();
      const release = deferred<void>();
      const eventBackend = deferred<number>();
      const eventApplicationName = `campushub-event-event-first-${kind}-${randomUUID()}`;
      const invalidatorName = `campushub-event-invalidator-after-${kind}-${randomUUID()}`;
      const executor = services(async () => {
        entered.resolve();
        await release.promise;
      }, undefined, undefined, undefined, eventApplicationName, (backend) => {
        eventBackend.resolve(backend);
      });
      const attempt = executor.publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 });
      let invalidator: PoolClient | undefined;
      let invalidatorPromise: Promise<PoolClient> | undefined;
      let invalidatorFinished = false;
      try {
        await entered.promise;
        const eventBackendPid = await eventBackend.promise;
        invalidatorPromise = beginAuthorityInvalidation(graph, kind, invalidatorName);
        await waitForNamedLockWait(
          eventBackendPid,
          AUTHORITY_INVALIDATIONS.find((item) => item.kind === kind)!.tableName,
        );
        release.resolve();
        await expect(attempt).resolves.toMatchObject({ ok: true, changed: true, record: { event: { version: 2, lifecycle: "published" } } });
        invalidator = await invalidatorPromise;
        await finishClient(invalidator, true);
        invalidatorFinished = true;
        await expect(eventState(graph.tenantId, eventId)).resolves.toEqual({
          event: { version: 2, lifecycle: "published" },
          auditCount: 2,
        });
      } finally {
        release.resolve();
        await attempt.catch(() => undefined);
        if (!invalidatorFinished && invalidator === undefined && invalidatorPromise !== undefined) {
          invalidator = await invalidatorPromise.catch(() => undefined);
        }
        if (!invalidatorFinished && invalidator !== undefined) {
          await finishClient(invalidator, false);
        }
      }
    },
  );

  it("does not pass PMAFB and then wait on a Campus resource during edit", async () => {
    const graph = await createGraph();
    const { eventId, actor } = await createDraft(graph);
    const campusHolder = await holdRowLock("campuses", graph.campusId, `campushub-event-campus-holder-${randomUUID()}`);
    const campusHolderBackendPid = await backendPid(campusHolder);
    const finalAuthorityEntered = deferred<void>();
    const releaseFinalAuthority = deferred<void>();
    const eventApplicationName = `campushub-event-resource-order-${randomUUID()}`;
    let finalAuthorityWasEntered = false;
    const executor = services(async () => {
      finalAuthorityWasEntered = true;
      finalAuthorityEntered.resolve();
      await releaseFinalAuthority.promise;
    }, undefined, undefined, undefined, eventApplicationName);
    const attempt = executor.updateEvent(actor, graph.tenantId, eventId, { ...input(graph), title: "Campus-blocked Edit", expectedVersion: 1 });
    let campusReleased = false;
    try {
      await waitForEventLockWait(campusHolderBackendPid, "campuses");
      expect(finalAuthorityWasEntered).toBe(false);
      await finishClient(campusHolder, true);
      campusReleased = true;
      await finalAuthorityEntered.promise;
      releaseFinalAuthority.resolve();
      await expect(attempt).resolves.toMatchObject({ ok: true, changed: true, record: { event: { version: 2, lifecycle: "draft" } } });
    } finally {
      releaseFinalAuthority.resolve();
      if (!campusReleased) await finishClient(campusHolder, false);
      await attempt.catch(() => undefined);
    }
  });

  it("denies a grant that expires while Event waits on the Tenant authority row", async () => {
    const graph = await createGraph();
    const { eventId, actor } = await createDraft(graph);
    const expiryRows = await getDatabase().execute(sql`
      update "role_grants"
      set expires_at = clock_timestamp() + interval '350 milliseconds', updated_at = clock_timestamp()
      where id = ${graph.grantId}
      returning expires_at
    `);
    const expiry = new Date(String((expiryRows.rows[0] as { expires_at: unknown }).expires_at));
    const tenantHolder = await holdRowLock("tenants", graph.tenantId, `campushub-event-grant-tenant-holder-${randomUUID()}`);
    const tenantHolderBackendPid = await backendPid(tenantHolder);
    const eventApplicationName = `campushub-event-grant-authority-wait-${randomUUID()}`;
    const attempt = services(undefined, undefined, undefined, undefined, eventApplicationName).publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 });
    await waitForEventLockWait(tenantHolderBackendPid, "tenants");
    await waitForDatabaseTimeAtOrAfter(expiry);
    await finishClient(tenantHolder, true);
    await expect(attempt).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
    await expect(eventState(graph.tenantId, eventId)).resolves.toEqual({ event: { version: 1, lifecycle: "draft" }, auditCount: 1 });
  });

  it("denies a grant that expires while Event waits on the Campus resource row", async () => {
    const graph = await createGraph();
    const { eventId, actor } = await createDraft(graph);
    const expiryRows = await getDatabase().execute(sql`
      update "role_grants"
      set expires_at = clock_timestamp() + interval '350 milliseconds', updated_at = clock_timestamp()
      where id = ${graph.grantId}
      returning expires_at
    `);
    const expiry = new Date(String((expiryRows.rows[0] as { expires_at: unknown }).expires_at));
    const campusHolder = await holdRowLock("campuses", graph.campusId, `campushub-event-grant-campus-holder-${randomUUID()}`);
    const campusHolderBackendPid = await backendPid(campusHolder);
    const eventApplicationName = `campushub-event-grant-resource-wait-${randomUUID()}`;
    const attempt = services(undefined, undefined, undefined, undefined, eventApplicationName).updateEvent(actor, graph.tenantId, eventId, { ...input(graph), title: "Expired Campus Edit", expectedVersion: 1 });
    await waitForEventLockWait(campusHolderBackendPid, "campuses");
    await waitForDatabaseTimeAtOrAfter(expiry);
    await finishClient(campusHolder, true);
    await expect(attempt).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
    await expect(eventState(graph.tenantId, eventId)).resolves.toEqual({ event: { version: 1, lifecycle: "draft" }, auditCount: 1 });
  });

  it("denies a Guild Term that expires while Event waits on the Tenant authority row", async () => {
    const graph = await createGraph();
    const { eventId, actor } = await createDraft(graph);
    const setupClient = await getPool().connect();
    let termEnd: Date;
    try {
      await setupClient.query("BEGIN");
      const termRows = await setupClient.query<{ ends_at: Date }>(
        'update "guild_terms" set ends_at = clock_timestamp() + interval \'350 milliseconds\', updated_at = clock_timestamp() where id = $1 returning ends_at',
        [graph.guildTermId],
      );
      termEnd = new Date(termRows.rows[0]!.ends_at);
      await setupClient.query(
        'update "role_grants" set expires_at = $1, updated_at = clock_timestamp() where id = $2',
        [termEnd, graph.grantId],
      );
      await setupClient.query("COMMIT");
    } catch (error) {
      await setupClient.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      setupClient.release();
    }
    const tenantHolder = await holdRowLock("tenants", graph.tenantId, `campushub-event-term-tenant-holder-${randomUUID()}`);
    const tenantHolderBackendPid = await backendPid(tenantHolder);
    const eventApplicationName = `campushub-event-term-authority-wait-${randomUUID()}`;
    const attempt = services(undefined, undefined, undefined, undefined, eventApplicationName).publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 });
    await waitForEventLockWait(tenantHolderBackendPid, "tenants");
    await waitForDatabaseTimeAtOrAfter(termEnd!);
    await finishClient(tenantHolder, true);
    await expect(attempt).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
    await expect(eventState(graph.tenantId, eventId)).resolves.toEqual({ event: { version: 1, lifecycle: "draft" }, auditCount: 1 });
  });

  it("applies the strict database-time expiry boundary after the final authority read", async () => {
    const graph = await createGraph();
    const { eventId, actor } = await createDraft(graph);
    const expiryRows = await getDatabase().execute(sql`
      update "role_grants"
      set expires_at = clock_timestamp() + interval '350 milliseconds', updated_at = clock_timestamp()
      where id = ${graph.grantId}
      returning expires_at
    `);
    const expiry = new Date(String((expiryRows.rows[0] as { expires_at: unknown }).expires_at));
    const executor = services(undefined, undefined, () => waitForDatabaseTimeAtOrAfter(expiry));
    await expect(executor.publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 })).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
    await expect(eventState(graph.tenantId, eventId)).resolves.toEqual({ event: { version: 1, lifecycle: "draft" }, auditCount: 1 });
  });

  it("runs the runtime authority verifier before final PMAFB and keeps the Event executor transactional", async () => {
    const graph = await createGraph();
    const { eventId, actor } = await createDraft(graph);
    const order: string[] = [];
    const executor = services(
      async () => { order.push("final-authority"); },
      undefined,
      undefined,
      async () => { order.push("runtime-verifier"); return true; },
      `campushub-event-verifier-order-${randomUUID()}`,
    );
    await expect(executor.publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 })).resolves.toMatchObject({ ok: true });
    expect(order).toEqual(["runtime-verifier", "final-authority"]);
  });

  it("serializes publish versus edit in both orderings", async () => {
    const publishFirst = await createGraph();
    const publishFirstDraft = await createDraft(publishFirst);
    const publishEntered = deferred<void>();
    const publishRelease = deferred<void>();
    const publishBackend = deferred<number>();
    const publishFirstExecutor = services(async () => { publishEntered.resolve(); await publishRelease.promise; }, undefined, undefined, undefined, `campushub-event-publish-first-${randomUUID()}`, (backend) => {
      publishBackend.resolve(backend);
    });
    const publishFirstAttempt = publishFirstExecutor.publishEvent(publishFirstDraft.actor, publishFirst.tenantId, publishFirstDraft.eventId, { expectedVersion: 1 });
    await publishEntered.promise;
    const publishBackendPid = await publishBackend.promise;
    const editAfterPublishApplicationName = `campushub-event-edit-after-publish-${randomUUID()}`;
    const editAfterPublishAttempt = services(undefined, undefined, undefined, undefined, editAfterPublishApplicationName).updateEvent(publishFirstDraft.actor, publishFirst.tenantId, publishFirstDraft.eventId, { ...input(publishFirst), title: "Stale edit", expectedVersion: 1 });
    await waitForEventLockWait(publishBackendPid, "tenants");
    publishRelease.resolve();
    const [published, edited] = await Promise.all([publishFirstAttempt, editAfterPublishAttempt]);
    expect(published).toMatchObject({ ok: true, record: { event: { version: 2, lifecycle: "published" } } });
    expect(edited).toEqual({ ok: false, error: "VERSION_CONFLICT" });

    const editFirst = await createGraph();
    const editFirstDraft = await createDraft(editFirst);
    const editEntered = deferred<void>();
    const editRelease = deferred<void>();
    const editBackend = deferred<number>();
    const editFirstExecutor = services(async () => { editEntered.resolve(); await editRelease.promise; }, undefined, undefined, undefined, `campushub-event-edit-first-${randomUUID()}`, (backend) => {
      editBackend.resolve(backend);
    });
    const editFirstAttempt = editFirstExecutor.updateEvent(editFirstDraft.actor, editFirst.tenantId, editFirstDraft.eventId, { ...input(editFirst), title: "Winning edit", expectedVersion: 1 });
    await editEntered.promise;
    const editBackendPid = await editBackend.promise;
    const publishAfterEditApplicationName = `campushub-event-publish-after-edit-${randomUUID()}`;
    const publishAfterEditAttempt = services(undefined, undefined, undefined, undefined, publishAfterEditApplicationName).publishEvent(editFirstDraft.actor, editFirst.tenantId, editFirstDraft.eventId, { expectedVersion: 1 });
    await waitForEventLockWait(editBackendPid, "tenants");
    editRelease.resolve();
    const [editedFirst, publishedAfter] = await Promise.all([editFirstAttempt, publishAfterEditAttempt]);
    expect(editedFirst).toMatchObject({ ok: true, record: { event: { version: 2, lifecycle: "draft" } } });
    expect(publishedAfter).toEqual({ ok: false, error: "VERSION_CONFLICT" });
  });

  it("serializes publish versus audience replacement in both orderings", async () => {
    const publishFirst = await createGraph();
    const publishFirstDraft = await createDraft(publishFirst);
    const publishEntered = deferred<void>();
    const publishRelease = deferred<void>();
    const publishBackend = deferred<number>();
    const publishFirstAttempt = services(async () => { publishEntered.resolve(); await publishRelease.promise; }, undefined, undefined, undefined, `campushub-event-audience-publish-first-${randomUUID()}`, (backend) => {
      publishBackend.resolve(backend);
    }).publishEvent(publishFirstDraft.actor, publishFirst.tenantId, publishFirstDraft.eventId, { expectedVersion: 1 });
    await publishEntered.promise;
    const publishBackendPid = await publishBackend.promise;
    const audienceAfterPublishApplicationName = `campushub-event-audience-edit-after-publish-${randomUUID()}`;
    const audienceAfterPublish = services(undefined, undefined, undefined, undefined, audienceAfterPublishApplicationName).updateEvent(publishFirstDraft.actor, publishFirst.tenantId, publishFirstDraft.eventId, targetedInput(publishFirst, 1));
    await waitForEventLockWait(publishBackendPid, "tenants");
    publishRelease.resolve();
    const [published, audienceEdit] = await Promise.all([publishFirstAttempt, audienceAfterPublish]);
    expect(published).toMatchObject({ ok: true, record: { event: { version: 2, lifecycle: "published" } } });
    expect(audienceEdit).toEqual({ ok: false, error: "VERSION_CONFLICT" });

    const editFirst = await createGraph();
    const editFirstDraft = await createDraft(editFirst);
    const editEntered = deferred<void>();
    const editRelease = deferred<void>();
    const editBackend = deferred<number>();
    const editFirstAttempt = services(async () => { editEntered.resolve(); await editRelease.promise; }, undefined, undefined, undefined, `campushub-event-audience-edit-first-${randomUUID()}`, (backend) => {
      editBackend.resolve(backend);
    }).updateEvent(editFirstDraft.actor, editFirst.tenantId, editFirstDraft.eventId, targetedInput(editFirst, 1));
    await editEntered.promise;
    const editBackendPid = await editBackend.promise;
    const publishAfterAudienceApplicationName = `campushub-event-audience-publish-after-edit-${randomUUID()}`;
    const publishAfterAudience = services(undefined, undefined, undefined, undefined, publishAfterAudienceApplicationName).publishEvent(editFirstDraft.actor, editFirst.tenantId, editFirstDraft.eventId, { expectedVersion: 1 });
    await waitForEventLockWait(editBackendPid, "tenants");
    editRelease.resolve();
    const [audienceWinner, publishedAfter] = await Promise.all([editFirstAttempt, publishAfterAudience]);
    expect(audienceWinner).toMatchObject({ ok: true, record: { event: { version: 2, lifecycle: "draft" } } });
    expect(publishedAfter).toEqual({ ok: false, error: "VERSION_CONFLICT" });
  });

  it("serializes competing postpone operations on the Event row and history", async () => {
    const graph = await createGraph();
    const published = await createPublished(graph);
    const entered = deferred<void>();
    const release = deferred<void>();
    const backend = deferred<number>();
    const first = services(async () => { entered.resolve(); await release.promise; }, undefined, undefined, undefined, `campushub-event-postpone-first-${randomUUID()}`, (pid) => backend.resolve(pid));
    const firstAttempt = first.postponeEvent(published.actor, graph.tenantId, published.eventId, {
      expectedVersion: 2,
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: new Date("2026-10-01T12:00:00.000Z"),
      reason: "First postponement",
    });
    await entered.promise;
    const backendPid = await backend.promise;
    const secondAttempt = services().postponeEvent(published.actor, graph.tenantId, published.eventId, {
      expectedVersion: 2,
      startsAt: new Date("2026-11-01T10:00:00.000Z"),
      endsAt: new Date("2026-11-01T12:00:00.000Z"),
      reason: "Stale postponement",
    });
    await waitForEventLockWait(backendPid, "tenants");
    release.resolve();
    const [winner, loser] = await Promise.all([firstAttempt, secondAttempt]);
    expect([winner, loser].filter((result) => result.ok)).toHaveLength(1);
    expect([winner, loser].find((result) => !result.ok)).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expect(await eventState(graph.tenantId, published.eventId)).toEqual({ event: { version: 3, lifecycle: "postponed" }, auditCount: 3 });
    expect(await lifecycleHistoryState(graph.tenantId, published.eventId)).toHaveLength(2);
  });

  it("serializes postpone versus cancel in both PostgreSQL transaction orderings", async () => {
    const postponeFirst = await createGraph();
    const postponeFirstPublished = await createPublished(postponeFirst);
    const postponeEntered = deferred<void>();
    const postponeRelease = deferred<void>();
    const postponeBackend = deferred<number>();
    const postponeExecutor = services(async () => { postponeEntered.resolve(); await postponeRelease.promise; }, undefined, undefined, undefined, `campushub-event-postpone-before-cancel-${randomUUID()}`, (pid) => postponeBackend.resolve(pid));
    const postponeAttempt = postponeExecutor.postponeEvent(postponeFirstPublished.actor, postponeFirst.tenantId, postponeFirstPublished.eventId, {
      expectedVersion: 2,
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: new Date("2026-10-01T12:00:00.000Z"),
      reason: "Schedule changed",
    });
    await postponeEntered.promise;
    const postponeBackendPid = await postponeBackend.promise;
    const cancelAfterPostpone = services().cancelEvent(postponeFirstPublished.actor, postponeFirst.tenantId, postponeFirstPublished.eventId, { expectedVersion: 2, reason: "Cancel race" });
    await waitForEventLockWait(postponeBackendPid, "tenants");
    postponeRelease.resolve();
    const [postponed, cancelledAfter] = await Promise.all([postponeAttempt, cancelAfterPostpone]);
    expect(postponed).toMatchObject({ ok: true, record: { event: { version: 3, lifecycle: "postponed" } } });
    expect(cancelledAfter).toEqual({ ok: false, error: "VERSION_CONFLICT" });

    const cancelFirst = await createGraph();
    const cancelFirstPublished = await createPublished(cancelFirst);
    const cancelEntered = deferred<void>();
    const cancelRelease = deferred<void>();
    const cancelBackend = deferred<number>();
    const cancelExecutor = services(async () => { cancelEntered.resolve(); await cancelRelease.promise; }, undefined, undefined, undefined, `campushub-event-cancel-before-postpone-${randomUUID()}`, (pid) => cancelBackend.resolve(pid));
    const cancelAttempt = cancelExecutor.cancelEvent(cancelFirstPublished.actor, cancelFirst.tenantId, cancelFirstPublished.eventId, { expectedVersion: 2, reason: "Cancellation wins" });
    await cancelEntered.promise;
    const cancelBackendPid = await cancelBackend.promise;
    const postponeAfterCancel = services().postponeEvent(cancelFirstPublished.actor, cancelFirst.tenantId, cancelFirstPublished.eventId, {
      expectedVersion: 2,
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: new Date("2026-10-01T12:00:00.000Z"),
      reason: "Stale schedule change",
    });
    await waitForEventLockWait(cancelBackendPid, "tenants");
    cancelRelease.resolve();
    const [cancelled, postponedAfter] = await Promise.all([cancelAttempt, postponeAfterCancel]);
    expect(cancelled).toMatchObject({ ok: true, record: { event: { version: 3, lifecycle: "cancelled" } } });
    expect(postponedAfter).toEqual({ ok: false, error: "VERSION_CONFLICT" });
  });

  it("rejects stale lifecycle commands and serializes republish versus cancel", async () => {
    const staleGraph = await createGraph();
    const stalePublished = await createPublished(staleGraph);
    await expect(services().postponeEvent(stalePublished.actor, staleGraph.tenantId, stalePublished.eventId, {
      expectedVersion: 1,
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: new Date("2026-10-01T12:00:00.000Z"),
      reason: "Stale postpone",
    })).resolves.toEqual({ ok: false, error: "VERSION_CONFLICT" });
    await expect(eventState(staleGraph.tenantId, stalePublished.eventId)).resolves.toEqual({ event: { version: 2, lifecycle: "published" }, auditCount: 2 });
    await expect(services().postponeEvent(stalePublished.actor, staleGraph.tenantId, stalePublished.eventId, {
      expectedVersion: 2,
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: new Date("2026-10-01T12:00:00.000Z"),
      reason: "Valid postpone",
    })).resolves.toMatchObject({ ok: true, record: { event: { version: 3, lifecycle: "postponed" } } });
    await expect(services().republishEvent(stalePublished.actor, staleGraph.tenantId, stalePublished.eventId, { expectedVersion: 2 })).resolves.toEqual({ ok: false, error: "VERSION_CONFLICT" });
    await expect(eventState(staleGraph.tenantId, stalePublished.eventId)).resolves.toEqual({ event: { version: 3, lifecycle: "postponed" }, auditCount: 3 });
    await expect(services().republishEvent(stalePublished.actor, staleGraph.tenantId, stalePublished.eventId, { expectedVersion: 3 })).resolves.toMatchObject({ ok: true, record: { event: { version: 4, lifecycle: "published" } } });
    await expect(services().cancelEvent(stalePublished.actor, staleGraph.tenantId, stalePublished.eventId, { expectedVersion: 3, reason: "Stale cancel" })).resolves.toEqual({ ok: false, error: "VERSION_CONFLICT" });
    await expect(eventState(staleGraph.tenantId, stalePublished.eventId)).resolves.toEqual({ event: { version: 4, lifecycle: "published" }, auditCount: 4 });

    const republishFirst = await createGraph();
    const republishFirstPublished = await createPublished(republishFirst);
    await expect(services().postponeEvent(republishFirstPublished.actor, republishFirst.tenantId, republishFirstPublished.eventId, {
      expectedVersion: 2,
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: new Date("2026-10-01T12:00:00.000Z"),
      reason: "Republish race setup",
    })).resolves.toMatchObject({ ok: true, record: { event: { version: 3, lifecycle: "postponed" } } });
    const republishEntered = deferred<void>();
    const republishRelease = deferred<void>();
    const republishBackend = deferred<number>();
    const republishExecutor = services(async () => { republishEntered.resolve(); await republishRelease.promise; }, undefined, undefined, undefined, `campushub-event-republish-before-cancel-${randomUUID()}`, (pid) => republishBackend.resolve(pid));
    const republishAttempt = republishExecutor.republishEvent(republishFirstPublished.actor, republishFirst.tenantId, republishFirstPublished.eventId, { expectedVersion: 3 });
    await republishEntered.promise;
    const republishBackendPid = await republishBackend.promise;
    const cancelAfterRepublish = services().cancelEvent(republishFirstPublished.actor, republishFirst.tenantId, republishFirstPublished.eventId, { expectedVersion: 3, reason: "Cancel race" });
    await waitForEventLockWait(republishBackendPid, "tenants");
    republishRelease.resolve();
    const [republished, cancelledAfterRepublish] = await Promise.all([republishAttempt, cancelAfterRepublish]);
    expect(republished).toMatchObject({ ok: true, record: { event: { version: 4, lifecycle: "published" } } });
    expect(cancelledAfterRepublish).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expect(await lifecycleHistoryState(republishFirst.tenantId, republishFirstPublished.eventId)).toHaveLength(3);

    const cancelFirst = await createGraph();
    const cancelFirstPublished = await createPublished(cancelFirst);
    await expect(services().postponeEvent(cancelFirstPublished.actor, cancelFirst.tenantId, cancelFirstPublished.eventId, {
      expectedVersion: 2,
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: new Date("2026-10-01T12:00:00.000Z"),
      reason: "Cancellation race setup",
    })).resolves.toMatchObject({ ok: true, record: { event: { version: 3, lifecycle: "postponed" } } });
    const cancelEntered = deferred<void>();
    const cancelRelease = deferred<void>();
    const cancelBackend = deferred<number>();
    const cancelExecutor = services(async () => { cancelEntered.resolve(); await cancelRelease.promise; }, undefined, undefined, undefined, `campushub-event-cancel-before-republish-${randomUUID()}`, (pid) => cancelBackend.resolve(pid));
    const cancelAttempt = cancelExecutor.cancelEvent(cancelFirstPublished.actor, cancelFirst.tenantId, cancelFirstPublished.eventId, { expectedVersion: 3, reason: "Cancel wins" });
    await cancelEntered.promise;
    const cancelBackendPid = await cancelBackend.promise;
    const republishAfterCancel = services().republishEvent(cancelFirstPublished.actor, cancelFirst.tenantId, cancelFirstPublished.eventId, { expectedVersion: 3 });
    await waitForEventLockWait(cancelBackendPid, "tenants");
    cancelRelease.resolve();
    const [cancelledFirst, republishedAfterCancel] = await Promise.all([cancelAttempt, republishAfterCancel]);
    expect(cancelledFirst).toMatchObject({ ok: true, record: { event: { version: 4, lifecycle: "cancelled" } } });
    expect(republishedAfterCancel).toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expect(await lifecycleHistoryState(cancelFirst.tenantId, cancelFirstPublished.eventId)).toHaveLength(3);
  });

  it.each(AUTHORITY_INVALIDATIONS)(
    "denies postpone, republish and cancel when the $kind authority invalidates first",
    async ({ kind, tableName }) => {
      for (const operation of ["postpone", "republish", "cancel"] as const) {
        const prepared = await prepareLifecycleOperation(operation);
        const invalidator = await beginAuthorityInvalidation(prepared.graph, kind, `campushub-event-lifecycle-invalidator-${kind}-${operation}-${randomUUID()}`);
        const invalidatorBackendPid = await backendPid(invalidator);
        let attempt: Promise<unknown> | undefined;
        try {
          attempt = prepared.run(services(undefined, undefined, undefined, undefined, `campushub-event-lifecycle-authority-first-${kind}-${operation}-${randomUUID()}`));
          await waitForEventLockWait(invalidatorBackendPid, tableName);
        } catch (error) {
          await finishClient(invalidator, false);
          await attempt?.catch(() => undefined);
          throw error;
        }
        await finishClient(invalidator, true);
        await expect(attempt!).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
        await expect(eventState(prepared.graph.tenantId, prepared.eventId)).resolves.toMatchObject({
          event: { version: prepared.expectedVersion, lifecycle: operation === "postpone" ? "published" : "postponed" },
        });
      }
    },
  );

  it.each(AUTHORITY_INVALIDATIONS)(
    "lets lifecycle mutation win while the $kind invalidation waits on its authority boundary",
    async ({ kind, tableName }) => {
      for (const operation of ["postpone", "republish", "cancel"] as const) {
        const prepared = await prepareLifecycleOperation(operation);
        const entered = deferred<void>();
        const release = deferred<void>();
        const backend = deferred<number>();
        const lifecycleApplicationName = `campushub-event-lifecycle-mutation-first-${kind}-${operation}-${randomUUID()}`;
        const attempt = prepared.run(services(async () => {
          entered.resolve();
          await release.promise;
        }, undefined, undefined, undefined, lifecycleApplicationName, (pid) => backend.resolve(pid)));
        let invalidator: PoolClient | undefined;
        let invalidatorPromise: Promise<PoolClient> | undefined;
        let invalidatorFinished = false;
        try {
          await entered.promise;
          const lifecycleBackendPid = await backend.promise;
          invalidatorPromise = beginAuthorityInvalidation(prepared.graph, kind, `campushub-event-lifecycle-invalidator-after-${kind}-${operation}-${randomUUID()}`);
          await waitForNamedLockWait(lifecycleBackendPid, tableName);
          release.resolve();
          await expect(attempt).resolves.toMatchObject({ ok: true, changed: true });
          invalidator = await invalidatorPromise;
          await finishClient(invalidator, true);
          invalidatorFinished = true;
        } finally {
          release.resolve();
          await attempt.catch(() => undefined);
          if (!invalidatorFinished && invalidator === undefined && invalidatorPromise !== undefined) {
            invalidator = await invalidatorPromise.catch(() => undefined);
          }
          if (!invalidatorFinished && invalidator !== undefined) {
            await finishClient(invalidator, false);
          }
        }
      }
    },
  );

  it("enforces append-only lifecycle history for the runtime role", async () => {
    const graph = await createGraph();
    const published = await createPublished(graph);
    const attempts: readonly { query: string; values?: readonly string[] }[] = [
      { query: 'update "event_lifecycle_history" set reason = \'tampered\' where tenant_id = $1 and event_id = $2', values: [graph.tenantId, published.eventId] },
      { query: 'delete from "event_lifecycle_history" where tenant_id = $1 and event_id = $2', values: [graph.tenantId, published.eventId] },
      { query: 'truncate "event_lifecycle_history"' },
    ];
    for (const attempt of attempts) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        await client.query('set local role "campushub_runtime"');
        const query = attempt.values === undefined
          ? client.query(attempt.query)
          : client.query(attempt.query, [...attempt.values]);
        await expect(query).rejects.toThrow();
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    }
  });
});
