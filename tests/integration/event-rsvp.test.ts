import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import { DrizzleEventRsvpRepository } from "@/server/repositories/event-rsvp-repository";
import { appendEventRsvpAwardInTransaction } from "@/server/repositories/xp-ledger-repository";
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
  xpEventRsvpSourceClaims,
  xpLedgerEntries,
  xpSourceClaims,
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

async function createAdditionalMembership(tenantId: string, campusId: string): Promise<string> {
  const rows = await getDatabase().insert(memberships).values({
    tenantId,
    identitySubjectId: nextSlug("secondary-identity"),
    assuranceLevel: "L1",
    lifecycle: "verified",
    campusId,
    campusProvenance: "institution_verified",
    residenceState: "non_resident",
    residenceProvenance: "institution_verified",
  }).returning({ id: memberships.id });
  const membershipId = rows[0]?.id;
  if (membershipId === undefined) throw new Error("Secondary Membership fixture insert returned no row.");
  return membershipId;
}

async function createEventForGraph(graph: Graph, label: string): Promise<string> {
  const rows = await getDatabase().insert(events).values({
    tenantId: graph.tenantId,
    version: 1,
    title: `RSVP XP ${label}`,
    description: "An Event used by the real RSVP XP integration suite.",
    venue: "Main Hall",
    startsAt: FUTURE_START,
    endsAt: FUTURE_END,
    campusId: graph.campusId,
    visibility: "MEMBERS",
    audienceMode: "entire_tenant",
    rsvpEnabled: true,
    lifecycle: "published",
  }).returning({ id: events.id });
  const eventId = rows[0]?.id;
  if (eventId === undefined) throw new Error("RSVP XP Event fixture insert returned no row.");
  return eventId;
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

async function appendXpAward(
  graph: Graph,
  eventId: string,
  occurredAt: Date,
  requestIdempotencyKey: string,
): Promise<Awaited<ReturnType<typeof appendEventRsvpAwardInTransaction>>> {
  return getDatabase().transaction((transaction) => appendEventRsvpAwardInTransaction(transaction, {
    tenantId: graph.tenantId,
    membershipId: graph.membershipId,
    eventId,
    tenantTimezone: "Africa/Kampala",
    occurredAt,
    requestIdempotencyKey,
  }));
}

function postgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: unknown };
  return typeof candidate.code === "string" ? candidate.code : postgresErrorCode(candidate.cause);
}

async function expectCommitFailure(
  operation: (client: PoolClient) => Promise<unknown>,
): Promise<string> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await operation(client);
    await client.query("commit");
    return "NO_ERROR";
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    return postgresErrorCode(error) ?? "UNKNOWN";
  } finally {
    client.release();
  }
}

type GenericPair = Readonly<{
  tenantId: string;
  membershipId: string;
  claimId: string;
  ledgerId: string;
  sourceReferenceId: string;
}>;

function genericPair(graph: Graph): GenericPair {
  return {
    tenantId: graph.tenantId,
    membershipId: graph.membershipId,
    claimId: randomUUID(),
    ledgerId: randomUUID(),
    sourceReferenceId: randomUUID(),
  };
}

async function insertGenericClaim(client: PoolClient, pair: GenericPair, canonicalLedgerId = pair.ledgerId): Promise<void> {
  await client.query(
    `insert into public."xp_source_claims"
      (id, tenant_id, membership_id, rule_id, rule_version, source_kind,
       source_reference_id, source_occurrence, expected_entry_type,
       canonical_ledger_entry_id)
     values ($1, $2, $3, 'profile.field', $4, 'profile_field_completion',
             $5, 'a10-test-source', 'award', $6)`,
    [pair.claimId, pair.tenantId, pair.membershipId, 1, pair.sourceReferenceId, canonicalLedgerId],
  );
}

async function insertGenericLedger(
  client: PoolClient,
  pair: GenericPair,
  options: Readonly<{
    ledgerId?: string;
    tenantId?: string;
    membershipId?: string;
    entryType?: "award" | "capped_award" | "correction" | "reversal";
    amount?: number;
    ruleVersion?: number;
    sourceClaimId?: string | null;
    sourceReferenceId?: string;
    reasonCode?: string | null;
    reasonText?: string | null;
    sourceEntryId?: string | null;
    actorMembershipId?: string | null;
    adjustmentIntentId?: string | null;
  }> = {},
): Promise<void> {
  const entryType = options.entryType ?? "award";
  const amount = options.amount ?? 5;
  const sourceClaimId = options.sourceClaimId === undefined ? pair.claimId : options.sourceClaimId;
  await client.query(
    `insert into public."xp_ledger_entries"
      (id, tenant_id, membership_id, entry_type, amount, rule_id, rule_version,
       source_kind, source_reference_id, source_occurrence, source_claim_id,
       reason_code, reason_text, source_entry_id, actor_membership_id,
       adjustment_intent_id,
       tenant_day, occurred_at)
     values ($1, $2, $3, $4::public.xp_ledger_entry_type, $5, 'profile.field', $6,
             'profile_field_completion'::public.xp_source_kind, $7,
             'a10-test-source', $8, $9, $10, $11, $12, $13, current_date,
             clock_timestamp())`,
    [
      options.ledgerId ?? pair.ledgerId,
      options.tenantId ?? pair.tenantId,
      options.membershipId ?? pair.membershipId,
      entryType,
      amount,
      options.ruleVersion ?? 1,
      options.sourceReferenceId ?? pair.sourceReferenceId,
      sourceClaimId,
      options.reasonCode ?? null,
      options.reasonText ?? null,
      options.sourceEntryId ?? null,
      options.actorMembershipId ?? null,
      options.adjustmentIntentId ?? null,
    ],
  );
}

async function seedGenericAward(graph: Graph): Promise<GenericPair> {
  const pair = genericPair(graph);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await insertGenericClaim(client, pair);
    await insertGenericLedger(client, pair);
    await client.query("commit");
    return pair;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

type CorrectiveLedgerInput = Readonly<{
  ledgerId?: string;
  tenantId: string;
  membershipId: string;
  sourceReferenceId: string;
  sourceEntryId: string;
  actorMembershipId: string;
  adjustmentIntentId: string;
  entryType: "correction" | "reversal";
  amount: number;
  ruleVersion?: number;
  reasonCode?: string;
  reasonText?: string;
}>;

async function insertCorrectiveLedger(client: PoolClient | Pool, input: CorrectiveLedgerInput): Promise<string> {
  const ledgerId = input.ledgerId ?? randomUUID();
  await client.query(
    `insert into public."xp_ledger_entries"
      (id, tenant_id, membership_id, entry_type, amount, rule_id, rule_version,
       source_kind, source_reference_id, source_occurrence, source_claim_id,
       reason_code, reason_text, source_entry_id, actor_membership_id,
       adjustment_intent_id, tenant_day, occurred_at)
     values ($1, $2, $3, $4::public.xp_ledger_entry_type, $5, 'profile.field', $6,
             'profile_field_completion'::public.xp_source_kind, $7,
             'a10-test-source', null, $8, $9, $10, $11, $12,
             current_date, clock_timestamp())`,
    [
      ledgerId,
      input.tenantId,
      input.membershipId,
      input.entryType,
      input.amount,
      input.ruleVersion ?? 1,
      input.sourceReferenceId,
      input.reasonCode ?? "A10_TEST_CORRECTION",
      input.reasonText ?? "A10 corrective fixture",
      input.sourceEntryId,
      input.actorMembershipId,
      input.adjustmentIntentId,
    ],
  );
  return ledgerId;
}

async function committedCorrectiveLedger(input: CorrectiveLedgerInput): Promise<string> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const ledgerId = await insertCorrectiveLedger(client, input);
    await client.query("commit");
    return ledgerId;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
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
  let poolForCleanup: Pool | undefined;
  try {
    await adminPool.query(`grant usage on schema public to ${quotedRole}`);
    await adminPool.query(`revoke create on schema public from ${quotedRole}`);
    if (options.withApprovedRuntimeRole !== false) {
      await adminPool.query(`grant "campushub_runtime" to ${quotedRole}`);
    }
    await adminPool.query(
      `grant select on "tenants", "memberships", "events" to ${quotedRole}`,
    );
    await adminPool.query(
      `grant select on "event_audience_criteria" to ${quotedRole}`,
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
    await adminPool.query(
      `grant select, insert on "xp_ledger_entries", "xp_source_claims", "xp_event_rsvp_source_claims" to ${quotedRole}`,
    );
    const connectionUrl = new URL(configuredDatabaseUrl);
    connectionUrl.username = roleName;
    connectionUrl.password = password;
    const restrictedPool = new Pool({ connectionString: connectionUrl.toString(), max: 1 });
    poolForCleanup = restrictedPool;
    await restrictedPool.query("select 1");
    return {
      database: drizzle({ client: restrictedPool, schema: tables }) as CampusHubDatabase,
      pool: restrictedPool,
      roleName,
    };
  } catch (error) {
    await poolForCleanup?.end();
    await adminPool.query(`revoke "campushub_runtime" from ${quotedRole}`);
    await adminPool.query(`drop owned by ${quotedRole}`);
    await adminPool.query(`drop role ${quotedRole}`);
    await expectFixtureRolesAbsent([roleName]);
    throw error;
  }
}

async function destroyRestrictedRuntime(runtime: RestrictedRuntime): Promise<void> {
  await runtime.pool.end();
  const quotedRole = `"${runtime.roleName}"`;
  await getPool().query(`revoke "campushub_runtime" from ${quotedRole}`);
  await getPool().query(`revoke all privileges on schema public from ${quotedRole}`);
  await getPool().query(`revoke all privileges on all tables in schema public from ${quotedRole}`);
  await getPool().query(`revoke update ("updated_at") on "tenant_module_states" from ${quotedRole}`);
  await getPool().query(`drop owned by ${quotedRole}`);
  await getPool().query(`drop role ${quotedRole}`);
  await expectFixtureRolesAbsent([runtime.roleName]);
}

type AuthorityPrivilege = Readonly<{
  table: "tenants" | "memberships" | "events" | "xp_ledger_entries" | "xp_source_claims" | "xp_event_rsvp_source_claims";
  privilege: "UPDATE" | "DELETE" | "TRUNCATE" | "TRIGGER";
}>;

const PROTECTED_REFERENCE_TABLES = [
  "tenants",
  "memberships",
  "events",
  "xp_ledger_entries",
  "xp_source_claims",
  "xp_event_rsvp_source_claims",
] as const;

type ProtectedReferenceTable = (typeof PROTECTED_REFERENCE_TABLES)[number];

async function grantAuthorityPrivilege(roleName: string, authority: AuthorityPrivilege): Promise<void> {
  await getPool().query(
    `grant ${authority.privilege} on table public.${sqlIdentifier(authority.table)} to ${sqlIdentifier(roleName)}`,
  );
}

async function revokeAuthorityPrivilege(roleName: string, authority: AuthorityPrivilege): Promise<void> {
  await getPool().query(
    `revoke ${authority.privilege} on table public.${sqlIdentifier(authority.table)} from ${sqlIdentifier(roleName)}`,
  );
}

async function grantColumnReferencePrivilege(roleName: string, table: ProtectedReferenceTable): Promise<void> {
  await getPool().query(
    `grant references (id) on table public.${sqlIdentifier(table)} to ${sqlIdentifier(roleName)}`,
  );
}

async function revokeColumnReferencePrivilege(roleName: string, table: ProtectedReferenceTable): Promise<void> {
  await getPool().query(
    `revoke references (id) on table public.${sqlIdentifier(table)} from ${sqlIdentifier(roleName)}`,
  );
}

async function readReferencePrivilegeState(
  roleName: string,
  table: ProtectedReferenceTable,
): Promise<Readonly<{ tableLevel: boolean; anyColumn: boolean }>> {
  const result = await getPool().query<{ tableLevel: boolean; anyColumn: boolean }>(`
    select
      has_table_privilege($1::name, $2::text, 'REFERENCES') as "tableLevel",
      has_any_column_privilege($1::name, $2::text, 'REFERENCES') as "anyColumn"
  `, [roleName, `public.${table}`]);
  const row = result.rows[0];
  if (row === undefined) throw new Error("PostgreSQL REFERENCES privilege evidence was unavailable.");
  return row;
}

async function expectRuntimeAuthorityDenied(runtime: RestrictedRuntime, graph: Graph, idempotencyKey: string): Promise<void> {
  const runtimeRepository = new DrizzleEventRsvpRepository(runtime.database);
  await expect(change(graph, "going", 0, idempotencyKey, runtime.database, runtimeRepository)).resolves.toEqual({
    ok: false,
    error: "PERSISTENCE_FAILED",
  });
}

function realRuntimeRepository(runtime: RestrictedRuntime): DrizzleEventRsvpRepository {
  return new DrizzleEventRsvpRepository(runtime.database);
}

async function expectRealRuntimePositivePath(
  runtime: RestrictedRuntime,
  graph: Graph,
  idempotencyKey: string,
): Promise<void> {
  await expect(change(
    graph,
    "going",
    0,
    idempotencyKey,
    runtime.database,
    realRuntimeRepository(runtime),
  )).resolves.toMatchObject({
    ok: true,
    value: { outcome: "CHANGED", state: "going", participationVersion: 1, changed: true },
  });

  const rsvpRows = await getDatabase().select().from(eventRsvps).where(and(
    eq(eventRsvps.tenantId, graph.tenantId),
    eq(eventRsvps.eventId, graph.eventId),
    eq(eventRsvps.membershipId, graph.membershipId),
  ));
  const requestRows = await getDatabase().select().from(eventRsvpIdempotency).where(and(
    eq(eventRsvpIdempotency.tenantId, graph.tenantId),
    eq(eventRsvpIdempotency.idempotencyKey, idempotencyKey),
  ));
  const claimRows = await getDatabase().select().from(xpSourceClaims).where(and(
    eq(xpSourceClaims.tenantId, graph.tenantId),
    eq(xpSourceClaims.membershipId, graph.membershipId),
    eq(xpSourceClaims.ruleId, "event.rsvp"),
    eq(xpSourceClaims.sourceKind, "event_rsvp"),
    eq(xpSourceClaims.sourceReferenceId, graph.eventId),
  ));
  const eventSourceRows = await getDatabase().select().from(xpEventRsvpSourceClaims).where(and(
    eq(xpEventRsvpSourceClaims.tenantId, graph.tenantId),
    eq(xpEventRsvpSourceClaims.eventId, graph.eventId),
  ));
  const ledgerRows = await getDatabase().select().from(xpLedgerEntries).where(and(
    eq(xpLedgerEntries.tenantId, graph.tenantId),
    eq(xpLedgerEntries.membershipId, graph.membershipId),
    eq(xpLedgerEntries.ruleId, "event.rsvp"),
    eq(xpLedgerEntries.sourceKind, "event_rsvp"),
    eq(xpLedgerEntries.sourceReferenceId, graph.eventId),
  ));

  expect(rsvpRows).toHaveLength(1);
  expect(rsvpRows[0]).toMatchObject({ state: "going", version: 1 });
  expect(requestRows).toHaveLength(1);
  expect(requestRows[0]).toMatchObject({
    completedOutcome: "CHANGED",
    completedState: "going",
    completedParticipationVersion: 1,
    completedChanged: true,
  });
  expect(requestRows[0]?.completedAt).toBeInstanceOf(Date);
  expect(claimRows).toHaveLength(1);
  expect(claimRows[0]).toMatchObject({
    ruleId: "event.rsvp",
    sourceKind: "event_rsvp",
    sourceReferenceId: graph.eventId,
    sourceOccurrence: "initial_eligible_rsvp",
    expectedEntryType: "award",
  });
  expect(eventSourceRows).toHaveLength(1);
  expect(eventSourceRows[0]?.sourceClaimId).toBe(claimRows[0]?.id);
  expect(ledgerRows).toHaveLength(1);
  expect(ledgerRows[0]).toMatchObject({
    ruleId: "event.rsvp",
    sourceKind: "event_rsvp",
    sourceReferenceId: graph.eventId,
    entryType: "award",
    amount: 5,
    sourceClaimId: claimRows[0]?.id,
  });
  expect(ledgerRows[0]?.id).toBe(claimRows[0]?.canonicalLedgerEntryId);
}

type AuthorityRoleChain = Readonly<{
  intermediaryRole: string;
  dangerousRole: string;
}>;

async function expectFixtureRolesAbsent(roleNames: readonly string[]): Promise<void> {
  const result = await getPool().query<{ roleName: string }>(
    "select rolname as \"roleName\" from pg_roles where rolname::text = any($1::text[])",
    [roleNames],
  );
  expect(result.rows).toEqual([]);
}

type AuthorityRoleChainOptions = Readonly<{
  closureOnlyMemberships?: boolean;
}>;

async function createAuthorityRoleChain(
  runtime: RestrictedRuntime,
  options: AuthorityRoleChainOptions = {},
): Promise<AuthorityRoleChain> {
  const suffix = randomUUID().replaceAll("-", "");
  const intermediaryRole = `campushub_evt003_intermediary_${suffix}`;
  const dangerousRole = `campushub_evt003_dangerous_${suffix}`;
  const quotedIntermediary = sqlIdentifier(intermediaryRole);
  const quotedDangerous = sqlIdentifier(dangerousRole);
  const quotedLogin = sqlIdentifier(runtime.roleName);
  const chain = { intermediaryRole, dangerousRole } as const;
  let dangerousCreated = false;
  let intermediaryCreated = false;
  try {
    await getPool().query(`create role ${quotedDangerous} nologin`);
    dangerousCreated = true;
    await getPool().query(`create role ${quotedIntermediary} nologin`);
    intermediaryCreated = true;
    const membershipOptions = options.closureOnlyMemberships
      ? " with admin true, inherit false, set false"
      : "";
    await getPool().query(`grant ${quotedDangerous} to ${quotedIntermediary}${membershipOptions}`);
    await getPool().query(`grant ${quotedIntermediary} to ${quotedLogin}${membershipOptions}`);
    return chain;
  } catch (error) {
    if (dangerousCreated || intermediaryCreated) await destroyAuthorityRoleChain(runtime, chain);
    throw error;
  }
}

async function destroyAuthorityRoleChain(runtime: RestrictedRuntime, chain: AuthorityRoleChain): Promise<void> {
  const quotedIntermediary = sqlIdentifier(chain.intermediaryRole);
  const quotedDangerous = sqlIdentifier(chain.dangerousRole);
  const quotedLogin = sqlIdentifier(runtime.roleName);
  const adminPool = getPool();
  const existingRoles = await adminPool.query<{ roleName: string }>(
    "select rolname as \"roleName\" from pg_roles where rolname::text = any($1::text[])",
    [[runtime.roleName, chain.intermediaryRole, chain.dangerousRole, "campushub_data_owner"]],
  );
  const existing = new Set(existingRoles.rows.map((row) => row.roleName));

  if (existing.has(chain.dangerousRole) && existing.has("campushub_data_owner")) {
    await adminPool.query(`revoke "campushub_data_owner" from ${quotedDangerous}`);
  }
  if (existing.has(chain.intermediaryRole) && existing.has(chain.dangerousRole)) {
    await adminPool.query(`revoke ${quotedDangerous} from ${quotedIntermediary}`);
  }
  if (existing.has(runtime.roleName) && existing.has(chain.intermediaryRole)) {
    await adminPool.query(`revoke ${quotedIntermediary} from ${quotedLogin}`);
  }
  if (existing.has(chain.dangerousRole)) {
    await adminPool.query(`drop owned by ${quotedDangerous}`);
  }
  if (existing.has(chain.intermediaryRole)) {
    await adminPool.query(`drop owned by ${quotedIntermediary}`);
  }
  if (existing.has(chain.intermediaryRole)) {
    await adminPool.query(`drop role ${quotedIntermediary}`);
  }
  if (existing.has(chain.dangerousRole)) {
    await adminPool.query(`drop role ${quotedDangerous}`);
  }
  await expectFixtureRolesAbsent([chain.intermediaryRole, chain.dangerousRole]);
}

async function readAuthorityRoleMembershipChain(
  runtime: RestrictedRuntime,
  chain: AuthorityRoleChain,
): Promise<Readonly<{
  memberRole: string;
  grantedRole: string;
  adminOption: boolean;
  inheritOption: boolean;
  setOption: boolean;
}[]>> {
  const result = await getPool().query<{
    memberRole: string;
    grantedRole: string;
    adminOption: boolean;
    inheritOption: boolean;
    setOption: boolean;
  }>(`
    select
      member_role.rolname as "memberRole",
      granted_role.rolname as "grantedRole",
      membership.admin_option as "adminOption",
      membership.inherit_option as "inheritOption",
      membership.set_option as "setOption"
    from pg_auth_members as membership
    join pg_roles as member_role on member_role.oid = membership.member
    join pg_roles as granted_role on granted_role.oid = membership.roleid
    where (member_role.rolname = $1 and granted_role.rolname = $2)
       or (member_role.rolname = $2 and granted_role.rolname = $3)
    order by case when member_role.rolname = $1 then 0 else 1 end
  `, [runtime.roleName, chain.intermediaryRole, chain.dangerousRole]);
  return result.rows;
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
    const runtime = await createRestrictedRuntime();
    try {
      const privilegeRows = await getPool().query<{
        module_select: boolean;
        module_insert: boolean;
        rsvp_select: boolean;
        rsvp_insert: boolean;
        rsvp_update: boolean;
        rsvp_delete: boolean;
        rsvp_trigger: boolean;
        idempotency_delete: boolean;
        idempotency_trigger: boolean;
        module_tenant_id_update: boolean;
        module_scope_update: boolean;
        module_enabled_update: boolean;
        module_version_update: boolean;
        module_updated_at_update: boolean;
        tenants_update: boolean;
        tenants_delete: boolean;
        tenants_truncate: boolean;
        tenants_trigger: boolean;
        tenants_references: boolean;
        tenants_any_column_references: boolean;
        memberships_update: boolean;
        memberships_delete: boolean;
        memberships_truncate: boolean;
        memberships_trigger: boolean;
        memberships_references: boolean;
        memberships_any_column_references: boolean;
        events_update: boolean;
        events_delete: boolean;
        events_truncate: boolean;
        events_trigger: boolean;
        events_references: boolean;
        events_any_column_references: boolean;
        xp_ledger_select: boolean;
        xp_ledger_insert: boolean;
        xp_ledger_update: boolean;
        xp_ledger_delete: boolean;
        xp_ledger_truncate: boolean;
        xp_ledger_trigger: boolean;
        xp_ledger_references: boolean;
        xp_ledger_any_column_references: boolean;
        xp_source_select: boolean;
        xp_source_insert: boolean;
        xp_source_update: boolean;
        xp_source_delete: boolean;
        xp_source_truncate: boolean;
        xp_source_trigger: boolean;
        xp_source_references: boolean;
        xp_source_any_column_references: boolean;
        xp_event_source_select: boolean;
        xp_event_source_insert: boolean;
        xp_event_source_update: boolean;
        xp_event_source_delete: boolean;
        xp_event_source_truncate: boolean;
        xp_event_source_trigger: boolean;
        xp_event_source_references: boolean;
        xp_event_source_any_column_references: boolean;
      }>(`
        select
          has_table_privilege($1::name, 'public.tenant_module_states', 'SELECT') as module_select,
          has_table_privilege($1::name, 'public.tenant_module_states', 'INSERT') as module_insert,
          has_table_privilege($1::name, 'public.event_rsvps', 'SELECT') as rsvp_select,
          has_table_privilege($1::name, 'public.event_rsvps', 'INSERT') as rsvp_insert,
          has_table_privilege($1::name, 'public.event_rsvps', 'UPDATE') as rsvp_update,
          has_table_privilege($1::name, 'public.event_rsvps', 'DELETE') as rsvp_delete,
          has_table_privilege($1::name, 'public.event_rsvps', 'TRIGGER') as rsvp_trigger,
          has_table_privilege($1::name, 'public.event_rsvp_idempotency', 'DELETE') as idempotency_delete,
          has_table_privilege($1::name, 'public.event_rsvp_idempotency', 'TRIGGER') as idempotency_trigger,
          has_column_privilege($1::name, 'public.tenant_module_states', 'tenant_id', 'UPDATE') as module_tenant_id_update,
          has_column_privilege($1::name, 'public.tenant_module_states', 'module', 'UPDATE') as module_scope_update,
          has_column_privilege($1::name, 'public.tenant_module_states', 'enabled', 'UPDATE') as module_enabled_update,
          has_column_privilege($1::name, 'public.tenant_module_states', 'version', 'UPDATE') as module_version_update,
          has_column_privilege($1::name, 'public.tenant_module_states', 'updated_at', 'UPDATE') as module_updated_at_update,
          has_table_privilege($1::name, 'public.tenants', 'UPDATE') as tenants_update,
          has_table_privilege($1::name, 'public.tenants', 'DELETE') as tenants_delete,
          has_table_privilege($1::name, 'public.tenants', 'TRUNCATE') as tenants_truncate,
          has_table_privilege($1::name, 'public.tenants', 'TRIGGER') as tenants_trigger,
          has_table_privilege($1::name, 'public.tenants', 'REFERENCES') as tenants_references,
          has_any_column_privilege($1::name, 'public.tenants', 'REFERENCES') as tenants_any_column_references,
          has_table_privilege($1::name, 'public.memberships', 'UPDATE') as memberships_update,
          has_table_privilege($1::name, 'public.memberships', 'DELETE') as memberships_delete,
          has_table_privilege($1::name, 'public.memberships', 'TRUNCATE') as memberships_truncate,
          has_table_privilege($1::name, 'public.memberships', 'TRIGGER') as memberships_trigger,
          has_table_privilege($1::name, 'public.memberships', 'REFERENCES') as memberships_references,
          has_any_column_privilege($1::name, 'public.memberships', 'REFERENCES') as memberships_any_column_references,
          has_table_privilege($1::name, 'public.events', 'UPDATE') as events_update,
          has_table_privilege($1::name, 'public.events', 'DELETE') as events_delete,
          has_table_privilege($1::name, 'public.events', 'TRUNCATE') as events_truncate,
          has_table_privilege($1::name, 'public.events', 'TRIGGER') as events_trigger,
          has_table_privilege($1::name, 'public.events', 'REFERENCES') as events_references,
          has_any_column_privilege($1::name, 'public.events', 'REFERENCES') as events_any_column_references,
          has_table_privilege($1::name, 'public.xp_ledger_entries', 'SELECT') as xp_ledger_select,
          has_table_privilege($1::name, 'public.xp_ledger_entries', 'INSERT') as xp_ledger_insert,
          has_table_privilege($1::name, 'public.xp_ledger_entries', 'UPDATE') as xp_ledger_update,
          has_table_privilege($1::name, 'public.xp_ledger_entries', 'DELETE') as xp_ledger_delete,
          has_table_privilege($1::name, 'public.xp_ledger_entries', 'TRUNCATE') as xp_ledger_truncate,
          has_table_privilege($1::name, 'public.xp_ledger_entries', 'TRIGGER') as xp_ledger_trigger,
          has_table_privilege($1::name, 'public.xp_ledger_entries', 'REFERENCES') as xp_ledger_references,
          has_any_column_privilege($1::name, 'public.xp_ledger_entries', 'REFERENCES') as xp_ledger_any_column_references,
          has_table_privilege($1::name, 'public.xp_source_claims', 'SELECT') as xp_source_select,
          has_table_privilege($1::name, 'public.xp_source_claims', 'INSERT') as xp_source_insert,
          has_table_privilege($1::name, 'public.xp_source_claims', 'UPDATE') as xp_source_update,
          has_table_privilege($1::name, 'public.xp_source_claims', 'DELETE') as xp_source_delete,
          has_table_privilege($1::name, 'public.xp_source_claims', 'TRUNCATE') as xp_source_truncate,
          has_table_privilege($1::name, 'public.xp_source_claims', 'TRIGGER') as xp_source_trigger,
          has_table_privilege($1::name, 'public.xp_source_claims', 'REFERENCES') as xp_source_references,
          has_any_column_privilege($1::name, 'public.xp_source_claims', 'REFERENCES') as xp_source_any_column_references,
          has_table_privilege($1::name, 'public.xp_event_rsvp_source_claims', 'SELECT') as xp_event_source_select,
          has_table_privilege($1::name, 'public.xp_event_rsvp_source_claims', 'INSERT') as xp_event_source_insert,
          has_table_privilege($1::name, 'public.xp_event_rsvp_source_claims', 'UPDATE') as xp_event_source_update,
          has_table_privilege($1::name, 'public.xp_event_rsvp_source_claims', 'DELETE') as xp_event_source_delete,
          has_table_privilege($1::name, 'public.xp_event_rsvp_source_claims', 'TRUNCATE') as xp_event_source_truncate,
          has_table_privilege($1::name, 'public.xp_event_rsvp_source_claims', 'TRIGGER') as xp_event_source_trigger,
          has_table_privilege($1::name, 'public.xp_event_rsvp_source_claims', 'REFERENCES') as xp_event_source_references,
          has_any_column_privilege($1::name, 'public.xp_event_rsvp_source_claims', 'REFERENCES') as xp_event_source_any_column_references
      `, [runtime.roleName]);
      expect(privilegeRows.rows[0]).toEqual({
        module_select: true,
        module_insert: false,
        rsvp_select: true,
        rsvp_insert: true,
        rsvp_update: true,
        rsvp_delete: false,
        rsvp_trigger: false,
        idempotency_delete: false,
        idempotency_trigger: false,
        module_tenant_id_update: false,
        module_scope_update: false,
        module_enabled_update: false,
        module_version_update: false,
        module_updated_at_update: true,
        tenants_update: false,
        tenants_delete: false,
        tenants_truncate: false,
        tenants_trigger: false,
        tenants_references: false,
        tenants_any_column_references: false,
        memberships_update: false,
        memberships_delete: false,
        memberships_truncate: false,
        memberships_trigger: false,
        memberships_references: false,
        memberships_any_column_references: false,
        events_update: false,
        events_delete: false,
        events_truncate: false,
        events_trigger: false,
        events_references: false,
        events_any_column_references: false,
        xp_ledger_select: true,
        xp_ledger_insert: true,
        xp_ledger_update: false,
        xp_ledger_delete: false,
        xp_ledger_truncate: false,
        xp_ledger_trigger: false,
        xp_ledger_references: false,
        xp_ledger_any_column_references: false,
        xp_source_select: true,
        xp_source_insert: true,
        xp_source_update: false,
        xp_source_delete: false,
        xp_source_truncate: false,
        xp_source_trigger: false,
        xp_source_references: false,
        xp_source_any_column_references: false,
        xp_event_source_select: true,
        xp_event_source_insert: true,
        xp_event_source_update: false,
        xp_event_source_delete: false,
        xp_event_source_truncate: false,
        xp_event_source_trigger: false,
        xp_event_source_references: false,
        xp_event_source_any_column_references: false,
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

  it("RSVP-PG-AUTH-01 rejects every directly granted protected-table mutation privilege and unrelated login identity", async () => {
    const graph = await createGraph();
    const directAuthorities: readonly AuthorityPrivilege[] = [
      { table: "tenants", privilege: "UPDATE" },
      { table: "tenants", privilege: "DELETE" },
      { table: "tenants", privilege: "TRUNCATE" },
      { table: "tenants", privilege: "TRIGGER" },
      { table: "memberships", privilege: "UPDATE" },
      { table: "memberships", privilege: "DELETE" },
      { table: "memberships", privilege: "TRUNCATE" },
      { table: "memberships", privilege: "TRIGGER" },
      { table: "events", privilege: "UPDATE" },
      { table: "events", privilege: "DELETE" },
      { table: "events", privilege: "TRUNCATE" },
      { table: "events", privilege: "TRIGGER" },
      { table: "xp_ledger_entries", privilege: "TRIGGER" },
      { table: "xp_source_claims", privilege: "TRIGGER" },
      { table: "xp_event_rsvp_source_claims", privilege: "TRIGGER" },
    ];
    const runtime = await createRestrictedRuntime();
    try {
      for (const [index, authority] of directAuthorities.entries()) {
        await grantAuthorityPrivilege(runtime.roleName, authority);
        try {
          await expectRuntimeAuthorityDenied(runtime, graph, `authority-direct-${index}`);
        } finally {
          await revokeAuthorityPrivilege(runtime.roleName, authority);
        }
      }
    } finally {
      await destroyRestrictedRuntime(runtime);
    }

    const unrelatedRuntime = await createRestrictedRuntime({ withApprovedRuntimeRole: false });
    try {
      await expectRuntimeAuthorityDenied(unrelatedRuntime, graph, "authority-unrelated-login");
    } finally {
      await destroyRestrictedRuntime(unrelatedRuntime);
    }
  });

  it("RSVP-PG-AUTH-02 rejects an approved runtime member that owns a protected table", async () => {
    const graph = await createGraph();
    const runtime = await createRestrictedRuntime();
    const ownerRows = await getPool().query<{ owner: string }>(`
      select pg_get_userbyid(relowner) as owner
      from pg_class
      join pg_namespace on pg_namespace.oid = relnamespace
      where pg_namespace.nspname = 'public'
        and relname = 'events'
        and relkind = 'r'
    `);
    const originalOwner = ownerRows.rows[0]?.owner;
    if (originalOwner === undefined) {
      await destroyRestrictedRuntime(runtime);
      throw new Error("Protected Event table owner was unavailable.");
    }
    try {
      await getPool().query(`alter table public."events" owner to ${sqlIdentifier(runtime.roleName)}`);
      await expectRuntimeAuthorityDenied(runtime, graph, "authority-owner-negative");
    } finally {
      await getPool().query(`alter table public."events" owner to ${sqlIdentifier(originalOwner)}`);
      await destroyRestrictedRuntime(runtime);
    }
  });

  it("RSVP-PG-AUTH-03 rejects true two-hop dangerous authority and owner/admin reachability", async () => {
    const graph = await createGraph();
    const cases: readonly Readonly<{
      key: string;
      setup: (dangerousRole: string) => Promise<void>;
    }>[] = [
      {
        key: "authority-multihop-parent",
        setup: (dangerousRole) => grantAuthorityPrivilege(dangerousRole, { table: "events", privilege: "UPDATE" }),
      },
      {
        key: "authority-multihop-xp-trigger",
        setup: (dangerousRole) => grantAuthorityPrivilege(dangerousRole, { table: "xp_ledger_entries", privilege: "TRIGGER" }),
      },
      {
        key: "authority-multihop-data-owner",
        setup: (dangerousRole) => getPool().query(`grant "campushub_data_owner" to ${sqlIdentifier(dangerousRole)}`).then(() => undefined),
      },
    ];

    for (const authorityCase of cases) {
      const runtime = await createRestrictedRuntime();
      try {
        const chain = await createAuthorityRoleChain(runtime);
        try {
          await authorityCase.setup(chain.dangerousRole);
          await expectRuntimeAuthorityDenied(runtime, graph, authorityCase.key);
        } finally {
          await destroyAuthorityRoleChain(runtime, chain);
        }
      } finally {
        await destroyRestrictedRuntime(runtime);
      }
    }
  });

  it("RSVP-PG-AUTH-04 rejects direct column-level REFERENCES on every protected table", async () => {
    const graph = await createGraph();
    const runtime = await createRestrictedRuntime();
    try {
      for (const table of PROTECTED_REFERENCE_TABLES) {
        await grantColumnReferencePrivilege(runtime.roleName, table);
        try {
          await expect(readReferencePrivilegeState(runtime.roleName, table)).resolves.toEqual({
            tableLevel: false,
            anyColumn: true,
          });
          await expectRuntimeAuthorityDenied(runtime, graph, `column-reference-direct-${table}`);
        } finally {
          await revokeColumnReferencePrivilege(runtime.roleName, table);
        }
      }
      for (const table of PROTECTED_REFERENCE_TABLES) {
        await expect(readReferencePrivilegeState(runtime.roleName, table)).resolves.toEqual({
          tableLevel: false,
          anyColumn: false,
        });
      }
      await expectRealRuntimePositivePath(runtime, graph, "column-reference-direct-clean-positive");
    } finally {
      await destroyRestrictedRuntime(runtime);
    }
  });

  it("RSVP-PG-AUTH-05 rejects two-hop column-level REFERENCES on every protected table", async () => {
    for (const table of PROTECTED_REFERENCE_TABLES) {
      const graph = await createGraph();
      const runtime = await createRestrictedRuntime();
      let chain: AuthorityRoleChain | undefined;
      try {
        chain = await createAuthorityRoleChain(runtime, { closureOnlyMemberships: true });
        await grantColumnReferencePrivilege(chain.dangerousRole, table);
        await expect(readReferencePrivilegeState(chain.dangerousRole, table)).resolves.toEqual({
          tableLevel: false,
          anyColumn: true,
        });
        await expect(readReferencePrivilegeState(chain.intermediaryRole, table)).resolves.toEqual({
          tableLevel: false,
          anyColumn: false,
        });
        await expect(readReferencePrivilegeState(runtime.roleName, table)).resolves.toEqual({
          tableLevel: false,
          anyColumn: false,
        });
        await expect(readAuthorityRoleMembershipChain(runtime, chain)).resolves.toEqual([
          {
            memberRole: runtime.roleName,
            grantedRole: chain.intermediaryRole,
            adminOption: true,
            inheritOption: false,
            setOption: false,
          },
          {
            memberRole: chain.intermediaryRole,
            grantedRole: chain.dangerousRole,
            adminOption: true,
            inheritOption: false,
            setOption: false,
          },
        ]);
        await expectRuntimeAuthorityDenied(runtime, graph, `column-reference-two-hop-${table}`);

        const cleanedChain = chain;
        await destroyAuthorityRoleChain(runtime, cleanedChain);
        chain = undefined;
        await expectFixtureRolesAbsent([cleanedChain.intermediaryRole, cleanedChain.dangerousRole]);
        for (const protectedTable of PROTECTED_REFERENCE_TABLES) {
          await expect(readReferencePrivilegeState(runtime.roleName, protectedTable)).resolves.toEqual({
            tableLevel: false,
            anyColumn: false,
          });
        }
        await expectRealRuntimePositivePath(runtime, graph, `column-reference-two-hop-clean-positive-${table}`);
      } finally {
        try {
          if (chain !== undefined) await destroyAuthorityRoleChain(runtime, chain);
        } finally {
          await destroyRestrictedRuntime(runtime);
        }
      }
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
      await waitForBlockedBy(firstPid, barrier.ownerPid, "event_rsvps");

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
      await waitForBlockedBy(firstPid, barrier.ownerPid, "event_rsvps");

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
      await waitForBlockedBy(firstPid, barrier.ownerPid, "event_rsvps");

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
      await waitForBlocked(lockPid, "campushub_rsvp_lock_event");
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
      await waitForBlocked(lockPid, 'campushub_rsvp_lock_event');
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
      await waitForBlocked(lockPid, "campushub_rsvp_lock_event");
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
      await waitForBlocked(invalidatorPid, "campushub_rsvp_lock_tenant");
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
      await waitForBlocked(invalidatorPid, "campushub_rsvp_lock_membership");
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

  it("XP-PG-01/03 records one reciprocal Event RSVP award and never re-awards later RSVP transitions", async () => {
    const graph = await createGraph();
    await expect(change(graph, "going", 0, "xp-initial")).resolves.toMatchObject({ ok: true });
    await expect(change(graph, "going", 0, "xp-initial")).resolves.toMatchObject({ ok: true });
    await expect(change(graph, "interested", 1, "xp-transition")).resolves.toMatchObject({ ok: true });
    await expect(change(graph, "withdrawn", 2, "xp-withdraw")).resolves.toMatchObject({ ok: true });
    await expect(change(graph, "interested", 3, "xp-reactivate-interested")).resolves.toMatchObject({ ok: true });

    const ledgerRows = await getDatabase().select().from(xpLedgerEntries).where(and(
      eq(xpLedgerEntries.tenantId, graph.tenantId),
      eq(xpLedgerEntries.membershipId, graph.membershipId),
    ));
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0]).toMatchObject({
      entryType: "award",
      amount: 5,
      ruleId: "event.rsvp",
      ruleVersion: 1,
      sourceKind: "event_rsvp",
      sourceReferenceId: graph.eventId,
      sourceOccurrence: "initial_eligible_rsvp",
    });

    const claimRows = await getDatabase().select().from(xpSourceClaims).where(and(
      eq(xpSourceClaims.tenantId, graph.tenantId),
      eq(xpSourceClaims.membershipId, graph.membershipId),
    ));
    const typedRows = await getDatabase().select().from(xpEventRsvpSourceClaims).where(eq(
      xpEventRsvpSourceClaims.tenantId,
      graph.tenantId,
    ));
    expect(claimRows).toHaveLength(1);
    expect(typedRows).toHaveLength(1);
    expect(typedRows[0]).toMatchObject({ eventId: graph.eventId, sourceClaimId: claimRows[0]?.id });
    expect(claimRows[0]?.canonicalLedgerEntryId).toBe(ledgerRows[0]?.id);
    expect(claimRows[0]?.expectedEntryType).toBe(ledgerRows[0]?.entryType);
    const expectedDay = await getPool().query<{ tenant_day: string }>(
      "select ($1::timestamptz at time zone $2)::date::text as tenant_day",
      [ledgerRows[0]?.occurredAt, "Africa/Kampala"],
    );
    expect(ledgerRows[0]?.tenantDay).toBe(expectedDay.rows[0]?.tenant_day);
  });

  it("XP-PG-04 applies the Tenant-local whole-award cap across distinct Event RSVPs", async () => {
    const graph = await createGraph();
    for (let index = 0; index < 11; index += 1) {
      const eventId = index === 0 ? graph.eventId : await createEventForGraph(graph, String(index));
      await expect(change(
        { ...graph, eventId },
        "going",
        0,
        `xp-cap-${index}`,
      )).resolves.toMatchObject({ ok: true });
    }

    const ledgerRows = await getDatabase().select().from(xpLedgerEntries).where(and(
      eq(xpLedgerEntries.tenantId, graph.tenantId),
      eq(xpLedgerEntries.membershipId, graph.membershipId),
    ));
    expect(ledgerRows).toHaveLength(11);
    expect(ledgerRows.filter((row) => row.entryType === "award" && row.amount === 5)).toHaveLength(10);
    expect(ledgerRows.filter((row) => row.entryType === "capped_award" && row.amount === 0)).toHaveLength(1);
    expect(new Set(ledgerRows.map((row) => row.tenantDay)).size).toBe(1);
  });

  it("CAP-PG-01 serializes concurrent first RSVPs for one Tenant/Membership/day when both awards fit", async () => {
    const graph = await createGraph();
    const secondEventId = await createEventForGraph(graph, "concurrent");
    const firstLockAcquired = deferred<void>();
    const releaseFirst = deferred<void>();
    const secondEntered = deferred<void>();
    let firstPid = 0;
    let secondPid = 0;
    const firstRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { firstPid = pid; },
      afterXpAwardLockAcquired: async () => {
        firstLockAcquired.resolve();
        await releaseFirst.promise;
      },
    });
    const secondRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { secondPid = pid; secondEntered.resolve(); },
    });

    try {
      const first = change(graph, "going", 0, "xp-race-first", getDatabase(), firstRepository);
      await firstLockAcquired.promise;

      const second = change(
        { ...graph, eventId: secondEventId },
        "going",
        0,
        "xp-race-second",
        getDatabase(),
        secondRepository,
      );
      await secondEntered.promise;
      expect(secondPid).toBeGreaterThan(0);
      await waitForBlocked(firstPid, "pg_advisory_xact_lock");

      releaseFirst.resolve();
      await expect(first).resolves.toMatchObject({ ok: true, value: { state: "going" } });
      await expect(second).resolves.toMatchObject({ ok: true, value: { state: "going" } });
    } finally {
      releaseFirst.resolve();
    }

    const ledgerRows = await getDatabase().select().from(xpLedgerEntries).where(and(
      eq(xpLedgerEntries.tenantId, graph.tenantId),
      eq(xpLedgerEntries.membershipId, graph.membershipId),
    ));
    expect(ledgerRows).toHaveLength(2);
    expect(ledgerRows.filter((row) => row.entryType === "award" && row.amount === 5)).toHaveLength(2);
    expect(ledgerRows.filter((row) => row.entryType === "capped_award" && row.amount === 0)).toHaveLength(0);
  });

  it("XP-PG-STRUCT-01 rejects an incomplete reciprocal pair and denies runtime mutation of immutable facts", async () => {
    const graph = await createGraph();
    await expect(change(graph, "going", 0, "xp-immutable-seed")).resolves.toMatchObject({ ok: true });
    const existing = (await getDatabase().select().from(xpLedgerEntries).where(and(
      eq(xpLedgerEntries.tenantId, graph.tenantId),
      eq(xpLedgerEntries.membershipId, graph.membershipId),
    )))[0];
    if (existing === undefined) throw new Error("XP immutable fixture was unavailable.");

    const runtime = await createRestrictedRuntime();
    try {
      await expect(runtime.pool.query(
        'update "xp_ledger_entries" set amount = 4 where tenant_id = $1 and id = $2',
        [graph.tenantId, existing.id],
      )).rejects.toThrow();
      await expect(runtime.pool.query(
        'delete from "xp_source_claims" where tenant_id = $1',
        [graph.tenantId],
      )).rejects.toThrow();
    } finally {
      await destroyRestrictedRuntime(runtime);
    }

    const client = await getPool().connect();
    const claimId = randomUUID();
    const ledgerId = randomUUID();
    const incompletePairGraph = await createGraph();
    try {
      await client.query("begin");
      await client.query(
        `insert into public."xp_source_claims"
          (id, tenant_id, membership_id, rule_id, rule_version, source_kind,
           source_reference_id, source_occurrence, expected_entry_type,
           canonical_ledger_entry_id)
         values ($1, $2, $3, 'event.rsvp', 1, 'event_rsvp', $4,
                 'initial_eligible_rsvp', 'award', $5)`,
        [claimId, incompletePairGraph.tenantId, incompletePairGraph.membershipId, incompletePairGraph.eventId, ledgerId],
      );
      await expect(client.query("commit")).rejects.toThrow();
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });

  it("XP-PG-08 proves one concurrent corrective intent and preserves the original award", async () => {
    const graph = await createGraph();
    const source = await seedGenericAward(graph);
    const originalRows = await getDatabase().select().from(xpLedgerEntries).where(eq(
      xpLedgerEntries.id,
      source.ledgerId,
    ));
    const original = originalRows[0];
    if (original === undefined) throw new Error("Corrective source fixture was unavailable.");

    const adjustmentIntentId = randomUUID();
    const firstClient = await getPool().connect();
    const secondClient = await getPool().connect();
    let secondAttempt: Promise<string> | undefined;
    try {
      await firstClient.query("begin");
      const firstPid = await backendPid(firstClient);
      await insertCorrectiveLedger(firstClient, {
        tenantId: graph.tenantId,
        membershipId: graph.membershipId,
        sourceReferenceId: source.sourceReferenceId,
        sourceEntryId: source.ledgerId,
        actorMembershipId: graph.membershipId,
        adjustmentIntentId,
        entryType: "correction",
        amount: 2,
      });

      await secondClient.query("begin");
      const secondPid = await backendPid(secondClient);
      secondAttempt = (async () => {
        try {
          await insertCorrectiveLedger(secondClient, {
            tenantId: graph.tenantId,
            membershipId: graph.membershipId,
            sourceReferenceId: source.sourceReferenceId,
            sourceEntryId: source.ledgerId,
            actorMembershipId: graph.membershipId,
            adjustmentIntentId,
            entryType: "correction",
            amount: 2,
          });
          await secondClient.query("commit");
          return "COMMITTED";
        } catch (error) {
          await secondClient.query("rollback").catch(() => undefined);
          return postgresErrorCode(error) ?? "UNKNOWN";
        }
      })();

      const blockers = await waitForBlockedBy(secondPid, firstPid, "xp_ledger_entries");
      expect(blockers).toContain(firstPid);
      await firstClient.query("commit");
      expect(await secondAttempt).toBe("23505");
    } finally {
      await firstClient.query("rollback").catch(() => undefined);
      await secondClient.query("rollback").catch(() => undefined);
      firstClient.release();
      secondClient.release();
      await secondAttempt?.catch(() => undefined);
    }

    const sequentialDuplicate = await expectCommitFailure((client) => insertCorrectiveLedger(client, {
      tenantId: graph.tenantId,
      membershipId: graph.membershipId,
      sourceReferenceId: source.sourceReferenceId,
      sourceEntryId: source.ledgerId,
      actorMembershipId: graph.membershipId,
      adjustmentIntentId,
      entryType: "correction",
      amount: 2,
    }));
    expect(sequentialDuplicate).toBe("23505");

    const corrections = await getDatabase().select().from(xpLedgerEntries).where(and(
      eq(xpLedgerEntries.tenantId, graph.tenantId),
      eq(xpLedgerEntries.membershipId, graph.membershipId),
      eq(xpLedgerEntries.entryType, "correction"),
    ));
    expect(corrections).toHaveLength(1);
    expect(corrections[0]).toMatchObject({ amount: 2, adjustmentIntentId });
    const afterRows = await getDatabase().select().from(xpLedgerEntries).where(eq(
      xpLedgerEntries.id,
      source.ledgerId,
    ));
    expect(afterRows).toEqual([original]);
  });

  it("enforces corrective signs, source ownership/type, intent shape, and runtime denial", async () => {
    const graph = await createGraph();
    const source = await seedGenericAward(graph);

    await expect(committedCorrectiveLedger({
      tenantId: graph.tenantId,
      membershipId: graph.membershipId,
      sourceReferenceId: source.sourceReferenceId,
      sourceEntryId: source.ledgerId,
      actorMembershipId: graph.membershipId,
      adjustmentIntentId: randomUUID(),
      entryType: "correction",
      amount: 1,
    })).resolves.toEqual(expect.any(String));
    const validReversalId = await committedCorrectiveLedger({
      tenantId: graph.tenantId,
      membershipId: graph.membershipId,
      sourceReferenceId: source.sourceReferenceId,
      sourceEntryId: source.ledgerId,
      actorMembershipId: graph.membershipId,
      adjustmentIntentId: randomUUID(),
      entryType: "reversal",
      amount: -1,
    });

    for (const [entryType, amount] of [
      ["correction", -1],
      ["correction", 0],
      ["reversal", 1],
      ["reversal", 0],
    ] as const) {
      const code = await expectCommitFailure((client) => insertCorrectiveLedger(client, {
        tenantId: graph.tenantId,
        membershipId: graph.membershipId,
        sourceReferenceId: source.sourceReferenceId,
        sourceEntryId: source.ledgerId,
        actorMembershipId: graph.membershipId,
        adjustmentIntentId: randomUUID(),
        entryType,
        amount,
      }));
      expect(code).toBe("23514");
    }

    const nonexistentSource = await expectCommitFailure((client) => insertCorrectiveLedger(client, {
      tenantId: graph.tenantId,
      membershipId: graph.membershipId,
      sourceReferenceId: source.sourceReferenceId,
      sourceEntryId: randomUUID(),
      actorMembershipId: graph.membershipId,
      adjustmentIntentId: randomUUID(),
      entryType: "correction",
      amount: 1,
    }));
    expect(nonexistentSource).not.toBe("NO_ERROR");

    const otherGraph = await createGraph();
    const otherSource = await seedGenericAward(otherGraph);
    const crossTenantSource = await expectCommitFailure((client) => insertCorrectiveLedger(client, {
      tenantId: graph.tenantId,
      membershipId: graph.membershipId,
      sourceReferenceId: otherSource.sourceReferenceId,
      sourceEntryId: otherSource.ledgerId,
      actorMembershipId: graph.membershipId,
      adjustmentIntentId: randomUUID(),
      entryType: "correction",
      amount: 1,
    }));
    expect(crossTenantSource).not.toBe("NO_ERROR");

    const secondaryMembershipId = await createAdditionalMembership(graph.tenantId, graph.campusId);
    const secondarySource = await seedGenericAward({ ...graph, membershipId: secondaryMembershipId });
    const wrongMembershipSource = await expectCommitFailure((client) => insertCorrectiveLedger(client, {
      tenantId: graph.tenantId,
      membershipId: graph.membershipId,
      sourceReferenceId: secondarySource.sourceReferenceId,
      sourceEntryId: secondarySource.ledgerId,
      actorMembershipId: graph.membershipId,
      adjustmentIntentId: randomUUID(),
      entryType: "correction",
      amount: 1,
    }));
    expect(wrongMembershipSource).not.toBe("NO_ERROR");

    const correctionSource = await expectCommitFailure((client) => insertCorrectiveLedger(client, {
      tenantId: graph.tenantId,
      membershipId: graph.membershipId,
      sourceReferenceId: source.sourceReferenceId,
      sourceEntryId: validReversalId,
      actorMembershipId: graph.membershipId,
      adjustmentIntentId: randomUUID(),
      entryType: "correction",
      amount: 1,
    }));
    expect(correctionSource).not.toBe("NO_ERROR");

    const runtime = await createRestrictedRuntime();
    try {
      await expect(insertCorrectiveLedger(runtime.pool, {
        tenantId: graph.tenantId,
        membershipId: graph.membershipId,
        sourceReferenceId: source.sourceReferenceId,
        sourceEntryId: source.ledgerId,
        actorMembershipId: graph.membershipId,
        adjustmentIntentId: randomUUID(),
        entryType: "correction",
        amount: 1,
      })).rejects.toThrow();
    } finally {
      await destroyRestrictedRuntime(runtime);
    }
  });

  it("XP-PG-02 keeps conceptual source uniqueness stronger than request idempotency", async () => {
    const graph = await createGraph();
    const first = await appendXpAward(graph, graph.eventId, new Date(), "xp-source-key-a");
    const second = await appendXpAward(graph, graph.eventId, new Date(), "xp-source-key-b");
    expect(second).toEqual(first);
    await expect(getDatabase().select().from(xpSourceClaims).where(and(
      eq(xpSourceClaims.tenantId, graph.tenantId),
      eq(xpSourceClaims.membershipId, graph.membershipId),
    ))).resolves.toHaveLength(1);
    await expect(getDatabase().select().from(xpLedgerEntries).where(and(
      eq(xpLedgerEntries.tenantId, graph.tenantId),
      eq(xpLedgerEntries.membershipId, graph.membershipId),
    ))).resolves.toHaveLength(1);
  });

  it("XP-PG-05 prevents cross-Tenant reads, writes, and false source conflicts", async () => {
    const first = await createGraph();
    const second = await createGraph();
    await expect(change(first, "going", 0, "xp-tenant-a")).resolves.toMatchObject({ ok: true });
    await expect(change({ ...second, eventId: first.eventId }, "going", 0, "xp-tenant-b-foreign-event")).resolves.toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    await expect(getDatabase().select().from(xpSourceClaims).where(eq(
      xpSourceClaims.tenantId,
      second.tenantId,
    ))).resolves.toHaveLength(0);
    await expect(getDatabase().select().from(xpLedgerEntries).where(eq(
      xpLedgerEntries.tenantId,
      second.tenantId,
    ))).resolves.toHaveLength(0);
  });

  it("XP-PG-06 rolls back a forced XP failure without a partial RSVP, claim, ledger, or idempotency row", async () => {
    const graph = await createGraph();
    const repositoryWithFailure = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      afterXpAwardLockAcquired: async () => {
        throw new Error("deterministic XP failure");
      },
    });
    await expect(change(graph, "going", 0, "xp-forced-failure", getDatabase(), repositoryWithFailure)).resolves.toEqual({
      ok: false,
      error: "PERSISTENCE_FAILED",
    });
    await expect(getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, graph.tenantId))).resolves.toHaveLength(0);
    await expect(getDatabase().select().from(eventRsvpIdempotency).where(eq(eventRsvpIdempotency.tenantId, graph.tenantId))).resolves.toHaveLength(0);
    await expect(getDatabase().select().from(xpSourceClaims).where(eq(xpSourceClaims.tenantId, graph.tenantId))).resolves.toHaveLength(0);
    await expect(getDatabase().select().from(xpLedgerEntries).where(eq(xpLedgerEntries.tenantId, graph.tenantId))).resolves.toHaveLength(0);
  });

  it("XP-PG-07 commits the RSVP, source claim, ledger fact, and request completion atomically", async () => {
    const graph = await createGraph();
    await expect(change(graph, "going", 0, "xp-atomic-success")).resolves.toMatchObject({ ok: true });
    const rsvpRows = await getDatabase().select().from(eventRsvps).where(eq(eventRsvps.tenantId, graph.tenantId));
    const idempotencyRows = await getDatabase().select().from(eventRsvpIdempotency).where(eq(eventRsvpIdempotency.tenantId, graph.tenantId));
    const claimRows = await getDatabase().select().from(xpSourceClaims).where(eq(xpSourceClaims.tenantId, graph.tenantId));
    const ledgerRows = await getDatabase().select().from(xpLedgerEntries).where(eq(xpLedgerEntries.tenantId, graph.tenantId));
    expect(rsvpRows).toHaveLength(1);
    expect(idempotencyRows[0]?.completedOutcome).toBe("CHANGED");
    expect(claimRows).toHaveLength(1);
    expect(ledgerRows).toHaveLength(1);
    expect(claimRows[0]?.canonicalLedgerEntryId).toBe(ledgerRows[0]?.id);
  });

  it("XP-PG-09 rejects a source claim without its canonical ordinary ledger row at commit", async () => {
    const pair = genericPair(await createGraph());
    const code = await expectCommitFailure((client) => insertGenericClaim(client, pair));
    expect(code).toBe("23503");
  });

  it("XP-PG-10 rejects an ordinary ledger row without its source claim at commit", async () => {
    const pair = genericPair(await createGraph());
    const code = await expectCommitFailure((client) => insertGenericLedger(client, pair));
    expect(code).toBe("23503");
  });

  it("XP-PG-11 rejects reciprocal claim and ledger identifiers that disagree", async () => {
    const pair = genericPair(await createGraph());
    const wrongLedgerId = randomUUID();
    const code = await expectCommitFailure(async (client) => {
      await insertGenericClaim(client, pair);
      await insertGenericLedger(client, pair, { ledgerId: wrongLedgerId });
    });
    expect(code).toBe("23503");
  });

  it("XP-PG-12 rejects two ordinary ledger facts for one source claim", async () => {
    const pair = genericPair(await createGraph());
    const duplicateLedgerId = randomUUID();
    const code = await expectCommitFailure(async (client) => {
      await insertGenericClaim(client, pair);
      await insertGenericLedger(client, pair);
      await insertGenericLedger(client, pair, { ledgerId: duplicateLedgerId });
    });
    expect(code).toBe("23503");
  });

  it("XP-PG-13 rejects claim and ledger Tenant identities that disagree", async () => {
    const first = await createGraph();
    const second = await createGraph();
    const pair = genericPair(first);
    const code = await expectCommitFailure(async (client) => {
      await insertGenericClaim(client, pair);
      await insertGenericLedger(client, pair, {
        tenantId: second.tenantId,
        membershipId: second.membershipId,
      });
    });
    expect(code).toBe("23503");
  });

  it("XP-PG-14 rejects claim and ledger Membership identities that disagree", async () => {
    const first = await createGraph();
    const second = await createGraph();
    const pair = genericPair(first);
    const code = await expectCommitFailure(async (client) => {
      await insertGenericClaim(client, pair);
      await insertGenericLedger(client, pair, { membershipId: second.membershipId });
    });
    expect(code).toBe("23503");
  });

  it("XP-PG-15 rejects a claim outcome that disagrees with ledger entry type", async () => {
    const pair = genericPair(await createGraph());
    const code = await expectCommitFailure(async (client) => {
      await insertGenericClaim(client, pair);
      await insertGenericLedger(client, pair, { entryType: "capped_award", amount: 0 });
    });
    expect(code).toBe("23503");
  });

  it("XP-PG-16 rejects a claim whose canonical entry is a correction or reversal", async () => {
    const graph = await createGraph();
    const source = await seedGenericAward(graph);
    const correctionId = await committedCorrectiveLedger({
      tenantId: graph.tenantId,
      membershipId: graph.membershipId,
      sourceReferenceId: source.sourceReferenceId,
      sourceEntryId: source.ledgerId,
      actorMembershipId: graph.membershipId,
      adjustmentIntentId: randomUUID(),
      entryType: "correction",
      amount: 1,
    });
    const pair = genericPair(graph);
    const code = await expectCommitFailure(async (client) => {
      await insertGenericClaim(client, pair, correctionId);
    });
    expect(code).toBe("23503");
  });

  it("XP-PG-RECIPROCAL-17 rejects a claim and ledger rule-version mismatch at commit", async () => {
    const pair = genericPair(await createGraph());
    const code = await expectCommitFailure(async (client) => {
      await insertGenericClaim(client, pair);
      await insertGenericLedger(client, pair, { ruleVersion: 2 });
    });
    expect(code).toBe("23503");
  });

  it("CAP-PG-02 serializes a concurrent daily-cap overshoot so 45 plus two five-point awards ends at 50", async () => {
    const graph = await createGraph();
    for (let index = 0; index < 9; index += 1) {
      const seedEventId = await createEventForGraph(graph, `cap-boundary-seed-${index}`);
      await expect(change({ ...graph, eventId: seedEventId }, "going", 0, `cap-boundary-seed-${index}`)).resolves.toMatchObject({ ok: true });
    }
    const firstEventId = await createEventForGraph(graph, "cap-boundary-first");
    const secondEventId = await createEventForGraph(graph, "cap-boundary-second");
    const firstLockAcquired = deferred<void>();
    const releaseFirst = deferred<void>();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    let firstPid = 0;
    let secondPid = 0;
    const firstRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { firstPid = pid; firstStarted.resolve(); },
      afterXpAwardLockAcquired: async () => {
        firstLockAcquired.resolve();
        await releaseFirst.promise;
      },
    });
    const secondRepository = new DrizzleEventRsvpRepository(getDatabase(), {
      runtimeDatabaseAuthorityVerifier: async () => true,
      onTransactionStarted: async (pid) => { secondPid = pid; secondStarted.resolve(); },
    });
    let first: ReturnType<typeof change> | undefined;
    let second: ReturnType<typeof change> | undefined;
    try {
      first = change({ ...graph, eventId: firstEventId }, "going", 0, "cap-boundary-first", getDatabase(), firstRepository);
      await firstStarted.promise;
      await firstLockAcquired.promise;
      second = change({ ...graph, eventId: secondEventId }, "going", 0, "cap-boundary-second", getDatabase(), secondRepository);
      await secondStarted.promise;
      await waitForBlocked(firstPid, "pg_advisory_xact_lock");
      expect(secondPid).toBeGreaterThan(0);
      releaseFirst.resolve();
      await expect(first).resolves.toMatchObject({ ok: true });
      await expect(second).resolves.toMatchObject({ ok: true });
    } finally {
      releaseFirst.resolve();
      await Promise.allSettled([first, second].filter((value): value is ReturnType<typeof change> => value !== undefined));
    }
    const rows = await getDatabase().select().from(xpLedgerEntries).where(and(
      eq(xpLedgerEntries.tenantId, graph.tenantId),
      eq(xpLedgerEntries.membershipId, graph.membershipId),
    ));
    expect(rows).toHaveLength(11);
    expect(rows.filter((row) => row.entryType === "award" && row.amount === 5)).toHaveLength(10);
    expect(rows.filter((row) => row.entryType === "capped_award" && row.amount === 0)).toHaveLength(1);
  });

  it("CAP-PG-03 permanently consumes a capped source across a later Tenant-local day", async () => {
    const graph = await createGraph();
    for (let index = 0; index < 10; index += 1) {
      const seedEventId = await createEventForGraph(graph, `cap-retry-seed-${index}`);
      await expect(change({ ...graph, eventId: seedEventId }, "going", 0, `cap-retry-seed-${index}`)).resolves.toMatchObject({ ok: true });
    }
    const cappedEventId = await createEventForGraph(graph, "cap-retry-capped");
    await expect(change({ ...graph, eventId: cappedEventId }, "going", 0, "cap-retry-original")).resolves.toMatchObject({ ok: true });
    const replay = await appendXpAward(graph, cappedEventId, new Date(Date.now() + 86_400_000), "cap-retry-next-day");
    expect(replay).toMatchObject({ entryType: "capped_award", amount: 0 });
    await expect(getDatabase().select().from(xpSourceClaims).where(and(
      eq(xpSourceClaims.tenantId, graph.tenantId),
      eq(xpSourceClaims.membershipId, graph.membershipId),
    ))).resolves.toHaveLength(11);
  });

  it("CAP-PG-04 derives the governed day from the Tenant timezone rather than UTC", async () => {
    const graph = await createGraph();
    const occurredAt = new Date("2026-09-19T23:30:00.000Z");
    await appendXpAward(graph, graph.eventId, occurredAt, "cap-timezone-boundary");
    const rows = await getDatabase().select({ tenantDay: xpLedgerEntries.tenantDay }).from(xpLedgerEntries).where(eq(
      xpLedgerEntries.tenantId,
      graph.tenantId,
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantDay).toBe("2026-09-20");
    expect(occurredAt.toISOString().slice(0, 10)).toBe("2026-09-19");
  });

  it("CAP-PG-05 scopes advisory-lock key material to Tenant, Membership, and local day", async () => {
    const graph = await createGraph();
    const otherMembershipId = randomUUID();
    const day = "2026-09-20";
    const result = await getPool().query<{ first_key: string; second_key: string; third_key: string }>(
      `select
         hashtextextended($1, 0)::text as first_key,
         hashtextextended($2, 0)::text as second_key,
         hashtextextended($3, 0)::text as third_key`,
      [
        `${graph.tenantId}:${graph.membershipId}:${day}`,
        `${graph.tenantId}:${otherMembershipId}:${day}`,
        `${randomUUID()}:${graph.membershipId}:${day}`,
      ],
    );
    expect(result.rows[0]?.first_key).not.toBe(result.rows[0]?.second_key);
    expect(result.rows[0]?.first_key).not.toBe(result.rows[0]?.third_key);
  });
});
