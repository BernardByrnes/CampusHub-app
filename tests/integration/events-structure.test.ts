import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

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
  await getDatabase().insert(roleGrants).values({
    tenantId, guildTermId, membershipId, role: "publisher", capability: CAPABILITIES.EVENT_MANAGE, moduleScope: "event", expiresAt: new Date("2026-12-31T23:59:59.000Z"), revokedAt: null,
  });
  return { tenantId, campusId, membershipId };
}

function services(beforeMutation?: () => Promise<void>, auditEventsOverride?: Pick<DrizzleAuditEventRepository, "appendEventMutationInTransaction">) {
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
    runtimeDatabaseAuthorityVerifier: async () => true,
    beforeMutation,
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

async function prepareRequest(graph: Awaited<ReturnType<typeof createGraph>>) {
  return { ...request(graph), actor: { ...request(graph).actor, identitySubjectId: await identitySubjectId(graph) } };
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
});
