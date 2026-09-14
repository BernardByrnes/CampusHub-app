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
  events,
  guildTerms,
  memberships,
  roleGrants,
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

function services(
  beforeFinalAuthorityCheck?: () => Promise<void>,
  auditEventsOverride?: Pick<DrizzleAuditEventRepository, "appendEventMutationInTransaction">,
  beforeFinalClockCheck?: () => Promise<void>,
  runtimeDatabaseAuthorityVerifier: (database: Pick<CampusHubDatabase, "execute">) => Promise<boolean> = async () => true,
  applicationName?: string,
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

async function waitForEventLockWait(applicationName: string, tableName: string): Promise<void> {
  await waitForCondition(
    async () => getDatabase().execute(sql`
      select 1
      from pg_stat_activity
      where application_name = ${applicationName}
        and state = 'active'
        and wait_event_type = 'Lock'
        and query ilike ${`%from "${tableName}"%`}
        and query ilike '%for update%'
    `),
    (result) => result.rows.length > 0,
    `Timed out waiting for Event ${applicationName} to wait on ${tableName}.`,
  ).then(() => undefined);
}

async function waitForNamedLockWait(applicationName: string): Promise<void> {
  await waitForCondition(
    async () => getDatabase().execute(sql`
      select 1
      from pg_stat_activity
      where application_name = ${applicationName}
        and state = 'active'
        and wait_event_type = 'Lock'
    `),
    (result) => result.rows.length > 0,
    `Timed out waiting for ${applicationName} to be blocked by the Event transaction.`,
  ).then(() => undefined);
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

  it("serializes two publish contenders so only one advances the draft", async () => {
    const graph = await createGraph();
    const actor = await prepareRequest(graph);
    const created = await services().createEvent(actor, graph.tenantId, input(graph));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const entered = deferred<void>();
    const release = deferred<void>();
    let pauses = 0;
    const first = services(async () => {
      pauses += 1;
      if (pauses === 1) {
        entered.resolve();
        await release.promise;
      }
    });
    const second = services();
    const firstAttempt = first.publishEvent(actor, graph.tenantId, created.record.event.id, { expectedVersion: 1 });
    await entered.promise;
    const secondAttempt = second.publishEvent(actor, graph.tenantId, created.record.event.id, { expectedVersion: 1 });
    const activityDeadline = Date.now() + 5_000;
    let observedLockWait = false;
    while (Date.now() < activityDeadline && !observedLockWait) {
      const activity = await getDatabase().execute(sql`
        select 1
        from pg_stat_activity
        where wait_event_type = 'Lock'
          and query ilike '%for update%'
          and query ilike '%tenants%'
      `);
      observedLockWait = activity.rows.length > 0;
      if (!observedLockWait) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(observedLockWait).toBe(true);
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
      let attempt: ReturnType<PostgresAuthorizedEventManagementExecutor["publishEvent"]>;
      try {
        const executor = services(undefined, undefined, undefined, undefined, eventApplicationName);
        attempt = executor.publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 });
        await waitForEventLockWait(eventApplicationName, tableName);
      } finally {
        await finishClient(invalidator, true);
      }
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
      const eventApplicationName = `campushub-event-event-first-${kind}-${randomUUID()}`;
      const invalidatorName = `campushub-event-invalidator-after-${kind}-${randomUUID()}`;
      const executor = services(async () => {
        entered.resolve();
        await release.promise;
      }, undefined, undefined, undefined, eventApplicationName);
      const attempt = executor.publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 });
      await entered.promise;
      const invalidatorPromise = beginAuthorityInvalidation(graph, kind, invalidatorName);
      await waitForNamedLockWait(invalidatorName);
      release.resolve();
      await expect(attempt).resolves.toMatchObject({ ok: true, changed: true, record: { event: { version: 2, lifecycle: "published" } } });
      const invalidator = await invalidatorPromise;
      await finishClient(invalidator, true);
      await expect(eventState(graph.tenantId, eventId)).resolves.toEqual({
        event: { version: 2, lifecycle: "published" },
        auditCount: 2,
      });
    },
  );

  it("does not pass PMAFB and then wait on a Campus resource during edit", async () => {
    const graph = await createGraph();
    const { eventId, actor } = await createDraft(graph);
    const campusHolder = await holdRowLock("campuses", graph.campusId, `campushub-event-campus-holder-${randomUUID()}`);
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
    await waitForEventLockWait(eventApplicationName, "campuses");
    expect(finalAuthorityWasEntered).toBe(false);
    await finishClient(campusHolder, true);
    await finalAuthorityEntered.promise;
    releaseFinalAuthority.resolve();
    await expect(attempt).resolves.toMatchObject({ ok: true, changed: true, record: { event: { version: 2, lifecycle: "draft" } } });
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
    const eventApplicationName = `campushub-event-grant-authority-wait-${randomUUID()}`;
    const attempt = services(undefined, undefined, undefined, undefined, eventApplicationName).publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 });
    await waitForEventLockWait(eventApplicationName, "tenants");
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
    const eventApplicationName = `campushub-event-grant-resource-wait-${randomUUID()}`;
    const attempt = services(undefined, undefined, undefined, undefined, eventApplicationName).updateEvent(actor, graph.tenantId, eventId, { ...input(graph), title: "Expired Campus Edit", expectedVersion: 1 });
    await waitForEventLockWait(eventApplicationName, "campuses");
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
    const eventApplicationName = `campushub-event-term-authority-wait-${randomUUID()}`;
    const attempt = services(undefined, undefined, undefined, undefined, eventApplicationName).publishEvent(actor, graph.tenantId, eventId, { expectedVersion: 1 });
    await waitForEventLockWait(eventApplicationName, "tenants");
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
    const publishFirstExecutor = services(async () => { publishEntered.resolve(); await publishRelease.promise; }, undefined, undefined, undefined, `campushub-event-publish-first-${randomUUID()}`);
    const publishFirstAttempt = publishFirstExecutor.publishEvent(publishFirstDraft.actor, publishFirst.tenantId, publishFirstDraft.eventId, { expectedVersion: 1 });
    await publishEntered.promise;
    const editAfterPublishApplicationName = `campushub-event-edit-after-publish-${randomUUID()}`;
    const editAfterPublishAttempt = services(undefined, undefined, undefined, undefined, editAfterPublishApplicationName).updateEvent(publishFirstDraft.actor, publishFirst.tenantId, publishFirstDraft.eventId, { ...input(publishFirst), title: "Stale edit", expectedVersion: 1 });
    await waitForEventLockWait(editAfterPublishApplicationName, "tenants");
    publishRelease.resolve();
    const [published, edited] = await Promise.all([publishFirstAttempt, editAfterPublishAttempt]);
    expect(published).toMatchObject({ ok: true, record: { event: { version: 2, lifecycle: "published" } } });
    expect(edited).toEqual({ ok: false, error: "VERSION_CONFLICT" });

    const editFirst = await createGraph();
    const editFirstDraft = await createDraft(editFirst);
    const editEntered = deferred<void>();
    const editRelease = deferred<void>();
    const editFirstExecutor = services(async () => { editEntered.resolve(); await editRelease.promise; }, undefined, undefined, undefined, `campushub-event-edit-first-${randomUUID()}`);
    const editFirstAttempt = editFirstExecutor.updateEvent(editFirstDraft.actor, editFirst.tenantId, editFirstDraft.eventId, { ...input(editFirst), title: "Winning edit", expectedVersion: 1 });
    await editEntered.promise;
    const publishAfterEditApplicationName = `campushub-event-publish-after-edit-${randomUUID()}`;
    const publishAfterEditAttempt = services(undefined, undefined, undefined, undefined, publishAfterEditApplicationName).publishEvent(editFirstDraft.actor, editFirst.tenantId, editFirstDraft.eventId, { expectedVersion: 1 });
    await waitForEventLockWait(publishAfterEditApplicationName, "tenants");
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
    const publishFirstAttempt = services(async () => { publishEntered.resolve(); await publishRelease.promise; }, undefined, undefined, undefined, `campushub-event-audience-publish-first-${randomUUID()}`).publishEvent(publishFirstDraft.actor, publishFirst.tenantId, publishFirstDraft.eventId, { expectedVersion: 1 });
    await publishEntered.promise;
    const audienceAfterPublishApplicationName = `campushub-event-audience-edit-after-publish-${randomUUID()}`;
    const audienceAfterPublish = services(undefined, undefined, undefined, undefined, audienceAfterPublishApplicationName).updateEvent(publishFirstDraft.actor, publishFirst.tenantId, publishFirstDraft.eventId, targetedInput(publishFirst, 1));
    await waitForEventLockWait(audienceAfterPublishApplicationName, "tenants");
    publishRelease.resolve();
    const [published, audienceEdit] = await Promise.all([publishFirstAttempt, audienceAfterPublish]);
    expect(published).toMatchObject({ ok: true, record: { event: { version: 2, lifecycle: "published" } } });
    expect(audienceEdit).toEqual({ ok: false, error: "VERSION_CONFLICT" });

    const editFirst = await createGraph();
    const editFirstDraft = await createDraft(editFirst);
    const editEntered = deferred<void>();
    const editRelease = deferred<void>();
    const editFirstAttempt = services(async () => { editEntered.resolve(); await editRelease.promise; }, undefined, undefined, undefined, `campushub-event-audience-edit-first-${randomUUID()}`).updateEvent(editFirstDraft.actor, editFirst.tenantId, editFirstDraft.eventId, targetedInput(editFirst, 1));
    await editEntered.promise;
    const publishAfterAudienceApplicationName = `campushub-event-audience-publish-after-edit-${randomUUID()}`;
    const publishAfterAudience = services(undefined, undefined, undefined, undefined, publishAfterAudienceApplicationName).publishEvent(editFirstDraft.actor, editFirst.tenantId, editFirstDraft.eventId, { expectedVersion: 1 });
    await waitForEventLockWait(publishAfterAudienceApplicationName, "tenants");
    editRelease.resolve();
    const [audienceWinner, publishedAfter] = await Promise.all([editFirstAttempt, publishAfterAudience]);
    expect(audienceWinner).toMatchObject({ ok: true, record: { event: { version: 2, lifecycle: "draft" } } });
    expect(publishedAfter).toEqual({ ok: false, error: "VERSION_CONFLICT" });
  });
});
