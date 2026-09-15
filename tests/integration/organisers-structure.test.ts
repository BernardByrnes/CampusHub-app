import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { CAPABILITIES } from "@/domain/authorization/capability";
import { StaticAuditIntegrityKeyProvider } from "@/domain/audit/audit-integrity-key-provider";
import type { CreateEventInput } from "@/domain/events/events";
import type { CampusHubDatabase } from "@/server/db/client";
import { PostgresCapabilityAuthorizer } from "@/server/authorization/postgres-capability-authorizer";
import { PostgresAuthorizedEventManagementExecutor } from "@/server/authorization/postgres-authorized-events";
import { PostgresAuthorizedOrganiserManagementExecutor } from "@/server/authorization/postgres-authorized-organisers";
import { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import { DrizzleEventRepository } from "@/server/repositories/event-repository";
import { DrizzleGuildTermRepository } from "@/server/repositories/guild-term-repository";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import { DrizzleOrganiserRepository } from "@/server/repositories/organiser-repository";
import { DrizzleRoleGrantRepository } from "@/server/repositories/role-grant-repository";
import { DrizzleTenantRepository } from "@/server/repositories/tenant-repository";
import {
  auditEvents,
  campuses,
  guildTerms,
  memberships,
  organisers,
  roleGrants,
  tenants,
} from "@/server/db/schema";

if (process.env.CAMPUSHUB_DB_INTEGRATION !== "1") {
  throw new Error("Real database integration is opt-in. Set CAMPUSHUB_DB_INTEGRATION=1.");
}

loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL was not loaded for Organiser integration tests.");
}

const NOW = new Date("2026-09-20T10:00:00.000Z");
const TERM_END = new Date("2027-01-01T00:00:00.000Z");
const auditKey = new Uint8Array(Buffer.from("campushub-organiser-integration-audit-key"));
let pool: Pool | undefined;
let database: CampusHubDatabase | undefined;
let sequence = 0;

function getDatabase(): CampusHubDatabase {
  if (database === undefined) throw new Error("Organiser integration database is not initialized.");
  return database;
}

function getPool(): Pool {
  if (pool === undefined) throw new Error("Organiser integration pool is not initialized.");
  return pool;
}

function nextSlug(label: string): string {
  sequence += 1;
  return `organiser-integration-${Date.now().toString(36)}-${label}-${sequence}`;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function createGraph() {
  const tenant = await getDatabase().insert(tenants).values({
    slug: nextSlug("tenant"), displayName: "Organiser Integration Tenant", status: "active", timezone: "Africa/Kampala",
  }).returning({ id: tenants.id });
  const tenantId = tenant[0]?.id;
  if (tenantId === undefined) throw new Error("Tenant insert returned no row.");
  const campus = await getDatabase().insert(campuses).values({ tenantId, label: "Organiser Campus", status: "active" }).returning({ id: campuses.id });
  const campusId = campus[0]?.id;
  if (campusId === undefined) throw new Error("Campus insert returned no row.");
  const membership = await getDatabase().insert(memberships).values({ tenantId, identitySubjectId: nextSlug("identity"), assuranceLevel: "L2", lifecycle: "verified" }).returning({ id: memberships.id, identitySubjectId: memberships.identitySubjectId });
  const membershipId = membership[0]?.id;
  const identitySubjectId = membership[0]?.identitySubjectId;
  if (membershipId === undefined || identitySubjectId === undefined) throw new Error("Membership insert returned no row.");
  const term = await getDatabase().insert(guildTerms).values({ tenantId, label: "Organiser Term", startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: TERM_END, status: "active" }).returning({ id: guildTerms.id });
  const guildTermId = term[0]?.id;
  if (guildTermId === undefined) throw new Error("Guild Term insert returned no row.");
  const organiserGrant = await getDatabase().insert(roleGrants).values({ tenantId, guildTermId, membershipId, role: "publisher", capability: CAPABILITIES.ORGANISER_MANAGE, moduleScope: "tenant", expiresAt: new Date("2026-12-31T23:59:59.000Z"), revokedAt: null }).returning({ id: roleGrants.id });
  const eventGrant = await getDatabase().insert(roleGrants).values({ tenantId, guildTermId, membershipId, role: "publisher", capability: CAPABILITIES.EVENT_MANAGE, moduleScope: "event", expiresAt: new Date("2026-12-31T23:59:59.000Z"), revokedAt: null }).returning({ id: roleGrants.id });
  const organiserGrantId = organiserGrant[0]?.id;
  const eventGrantId = eventGrant[0]?.id;
  if (organiserGrantId === undefined || eventGrantId === undefined) throw new Error("Role Grant insert returned no row.");
  return { tenantId, campusId, membershipId, identitySubjectId, guildTermId, organiserGrantId, eventGrantId };
}

function request(graph: Awaited<ReturnType<typeof createGraph>>, capability: typeof CAPABILITIES.ORGANISER_MANAGE | typeof CAPABILITIES.EVENT_MANAGE) {
  return {
    actor: { identitySubjectId: graph.identitySubjectId, tenantId: graph.tenantId, membershipId: graph.membershipId },
    context: { tenantStatus: "active" as const, membershipStatus: "verified" as const, assuranceLevel: "L2" as const },
    capability,
    scope: capability === CAPABILITIES.ORGANISER_MANAGE
      ? { tenantId: graph.tenantId, module: "tenant" as const, resource: "organiser" }
      : { tenantId: graph.tenantId, module: "event" as const, resource: "event" },
  };
}

function auditRepository(): DrizzleAuditEventRepository {
  return new DrizzleAuditEventRepository({
    database: getDatabase(),
    keyProvider: new StaticAuditIntegrityKeyProvider(1, new Map([[1, auditKey]])),
    eventIdFactory: randomUUID,
  });
}

function authorizer() {
  return new PostgresCapabilityAuthorizer({
    tenants: new DrizzleTenantRepository(getDatabase()),
    memberships: new DrizzleMembershipRepository(getDatabase()),
    guildTerms: new DrizzleGuildTermRepository(getDatabase()),
    roleGrants: new DrizzleRoleGrantRepository(getDatabase()),
    clock: { now: () => NOW },
  });
}

function organiserExecutor(
  beforeFinalAuthorityCheck?: () => Promise<void>,
  auditEventsOverride?: Pick<DrizzleAuditEventRepository, "appendOrganiserMutationInTransaction">,
) {
  const audit = auditEventsOverride ?? auditRepository();
  return new PostgresAuthorizedOrganiserManagementExecutor({
    database: getDatabase(),
    auditEvents: audit,
    organiserRepository: new DrizzleOrganiserRepository(getDatabase()),
    runtimeDatabaseAuthorityVerifier: async () => true,
    beforeFinalAuthorityCheck,
  });
}

function eventExecutor(
  beforeFinalAuthorityCheck?: () => Promise<void>,
  onTransactionStarted?: (backendPid: number) => void | Promise<void>,
) {
  return new PostgresAuthorizedEventManagementExecutor({
    database: getDatabase(),
    authorizer: authorizer(),
    auditEvents: auditRepository(),
    eventRepository: new DrizzleEventRepository(getDatabase()),
    runtimeDatabaseAuthorityVerifier: async () => true,
    beforeFinalAuthorityCheck,
    onTransactionStarted,
  });
}

function eventInput(graph: Awaited<ReturnType<typeof createGraph>>, organiserId: string | null = null): CreateEventInput {
  return {
    title: "Organiser Event",
    description: "Event with an optional organiser",
    venue: "Main Hall",
    startsAt: new Date("2026-09-25T10:00:00.000Z"),
    endsAt: new Date("2026-09-25T12:00:00.000Z"),
    campusId: graph.campusId,
    organiserId,
    visibility: "MEMBERS",
    audienceMode: "entire_tenant",
    rsvpEnabled: false,
    audience: { mode: "entire_tenant", groups: [] },
  };
}

async function waitForLock(blockingBackendPid: number, tableName: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const result = await getDatabase().execute(sql`
      select activity.pid
      from pg_stat_activity as activity
      where activity.state = 'active'
        and activity.wait_event_type = 'Lock'
        and ${blockingBackendPid} = any(pg_blocking_pids(activity.pid))
        and activity.query ilike ${`%${tableName}%`}
        and activity.query ilike '%for update%'
    `);
    if (result.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for a PostgreSQL ${tableName} row lock.`);
}

async function lockAndRevoke(client: PoolClient, table: string, id: string): Promise<void> {
  await client.query("BEGIN");
  await client.query(`select id from "${table}" where id = $1 for update`, [id]);
  if (table === "role_grants") {
    await client.query("update role_grants set revoked_at = clock_timestamp(), updated_at = clock_timestamp() where id = $1", [id]);
  }
}

async function finish(client: PoolClient, commit = true): Promise<void> {
  try { await client.query(commit ? "COMMIT" : "ROLLBACK"); } finally { client.release(); }
}

async function backendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ backend_pid: number }>("select pg_backend_pid() as backend_pid");
  const value = result.rows[0]?.backend_pid;
  if (!Number.isInteger(value) || value <= 0) throw new Error("PostgreSQL backend identity was unavailable.");
  return value;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl });
  database = drizzle({ client: pool }) as CampusHubDatabase;
  await pool.query("select 1");
});

afterAll(async () => { await pool?.end(); });

describe("real PostgreSQL Organiser Core", () => {
  it("creates, edits, audits and isolates Organisers, and attaches them to Events", async () => {
    const graph = await createGraph();
    const other = await createGraph();
    const organiserRequest = request(graph, CAPABILITIES.ORGANISER_MANAGE);
    const eventRequest = request(graph, CAPABILITIES.EVENT_MANAGE);
    const created = await organiserExecutor().createOrganiser(organiserRequest, graph.tenantId, { name: " Student Affairs " });
    expect(created).toMatchObject({ ok: true, changed: true, organiser: { version: 1, name: "Student Affairs", tenantId: graph.tenantId } });
    if (!created.ok) return;
    expect(await new DrizzleOrganiserRepository(getDatabase()).findOrganiserByIdForTenant(other.tenantId, created.organiser.id)).toBeNull();
    const auditRows = await getDatabase().select({ eventType: auditEvents.eventType, resourceVersion: auditEvents.resourceVersion }).from(auditEvents).where(and(eq(auditEvents.tenantId, graph.tenantId), eq(auditEvents.resourceId, created.organiser.id)));
    expect(auditRows).toEqual([{ eventType: "organiser.created", resourceVersion: 1 }]);

    const updated = await organiserExecutor().updateOrganiser(organiserRequest, graph.tenantId, created.organiser.id, { expectedVersion: 1, name: "Student Life Office" });
    expect(updated).toMatchObject({ ok: true, changed: true, organiser: { version: 2, name: "Student Life Office" } });
    await expect(organiserExecutor().updateOrganiser(organiserRequest, graph.tenantId, created.organiser.id, { expectedVersion: 1, name: "Stale" })).resolves.toEqual({ ok: false, error: "VERSION_CONFLICT" });

    const event = await eventExecutor().createEvent(eventRequest, graph.tenantId, eventInput(graph, created.organiser.id));
    expect(event).toMatchObject({ ok: true, record: { event: { organiserId: created.organiser.id }, organiser: { name: "Student Life Office" } } });
    if (!event.ok) return;
    const detached = await eventExecutor().updateEvent(eventRequest, graph.tenantId, event.record.event.id, { ...eventInput(graph, null), expectedVersion: 1, title: "Detached Organiser Event" });
    expect(detached).toMatchObject({ ok: true, record: { event: { version: 2, organiserId: null }, organiser: null } });
  });

  it("rolls back Organiser creation when the atomic audit append fails", async () => {
    const graph = await createGraph();
    const failingAudit = { appendOrganiserMutationInTransaction: async () => { throw new Error("audit failure"); } };
    const result = await organiserExecutor(undefined, failingAudit).createOrganiser(request(graph, CAPABILITIES.ORGANISER_MANAGE), graph.tenantId, { name: "Must Roll Back" });
    expect(result).toEqual({ ok: false, error: "PERSISTENCE_FAILED" });
    const rows = await getDatabase().select({ count: sql<number>`count(*)::int` }).from(organisers).where(eq(organisers.tenantId, graph.tenantId));
    expect(Number(rows[0]?.count ?? 0)).toBe(0);
  });

  it("makes an Event-first Organiser lock visible and waits for the Event transaction", async () => {
    const graph = await createGraph();
    const created = await organiserExecutor().createOrganiser(request(graph, CAPABILITIES.ORGANISER_MANAGE), graph.tenantId, { name: "Event Organiser" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const event = await eventExecutor().createEvent(request(graph, CAPABILITIES.EVENT_MANAGE), graph.tenantId, eventInput(graph, created.organiser.id));
    expect(event.ok).toBe(true);
    if (!event.ok) return;

    const entered = deferred<void>();
    const release = deferred<void>();
    const eventBackend = deferred<number>();
    const first = eventExecutor(async () => { entered.resolve(); await release.promise; }, (pid) => eventBackend.resolve(pid));
    const eventAttempt = first.updateEvent(request(graph, CAPABILITIES.EVENT_MANAGE), graph.tenantId, event.record.event.id, { ...eventInput(graph, created.organiser.id), expectedVersion: 1, title: "Event-first update" });
    await entered.promise;
    const eventBackendPid = await eventBackend.promise;

    const organiserClient = await getPool().connect();
    let organiserFinished = false;
    try {
      const organiserAttempt = organiserClient.query("begin").then(() => organiserClient.query("select id from organisers where tenant_id = $1 and id = $2 for update", [graph.tenantId, created.organiser.id]));
      await waitForLock(eventBackendPid, "organisers");
      release.resolve();
      await expect(eventAttempt).resolves.toMatchObject({ ok: true, record: { event: { version: 2 } } });
      await organiserAttempt;
      await organiserClient.query("update organisers set name = 'After Event', version = version + 1, updated_at = clock_timestamp() where id = $1", [created.organiser.id]);
      await organiserClient.query("commit");
      organiserFinished = true;
      expect((await getDatabase().select({ name: organisers.name }).from(organisers).where(eq(organisers.id, created.organiser.id)))[0]?.name).toBe("After Event");
    } finally {
      release.resolve();
      await eventAttempt.catch(() => undefined);
      if (!organiserFinished) await finish(organiserClient, false);
      else organiserClient.release();
    }
  });

  it("fails closed when role authority is revoked before the Organiser transaction reaches final authority", async () => {
    const graph = await createGraph();
    const created = await organiserExecutor().createOrganiser(request(graph, CAPABILITIES.ORGANISER_MANAGE), graph.tenantId, { name: "Authority Target" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const invalidator = await getPool().connect();
    let invalidatorFinished = false;
    try {
      await lockAndRevoke(invalidator, "role_grants", graph.organiserGrantId);
      const invalidatorBackendPid = await backendPid(invalidator);
      const attempt = organiserExecutor().updateOrganiser(request(graph, CAPABILITIES.ORGANISER_MANAGE), graph.tenantId, created.organiser.id, { expectedVersion: 1, name: "Should Deny" });
      await waitForLock(invalidatorBackendPid, "role_grants");
      await finish(invalidator, true);
      invalidatorFinished = true;
      await expect(attempt).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
      const row = (await getDatabase().select({ version: organisers.version, name: organisers.name }).from(organisers).where(eq(organisers.id, created.organiser.id)))[0];
      expect(row).toEqual({ version: 1, name: "Authority Target" });
    } finally {
      if (!invalidatorFinished) await finish(invalidator, false);
    }
  });
});
