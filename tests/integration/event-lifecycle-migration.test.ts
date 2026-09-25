import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { loadEnvConfig } from "@next/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

if (process.env.CAMPUSHUB_DB_INTEGRATION !== "1") {
  throw new Error("Real database integration is opt-in. Set CAMPUSHUB_DB_INTEGRATION=1.");
}

loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL was not loaded for migration integration tests.");
}
const configuredDatabaseUrl = databaseUrl;

const migrationDirectory = join(process.cwd(), "drizzle");
const baseMigrationFiles = readdirSync(migrationDirectory)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name) && name < "0019_")
  .sort();
const lifecycleMigrationFile = "0019_high_harry_osborn.sql";
const lifecycleMigrationStatements = readFileSync(
  join(migrationDirectory, lifecycleMigrationFile),
  "utf8",
)
  .split(/--> statement-breakpoint/g)
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0);
const phase4StatementIndex = lifecycleMigrationStatements.findIndex((statement) =>
  statement.includes("CH-EVT-004 migration phase 4"),
);
if (phase4StatementIndex < 0) {
  throw new Error("CH-EVT-004 migration phase 4 statement was not found.");
}

let adminPool: Pool | undefined;
let baseDatabaseName = "";
let databaseSequence = 0;
const databaseCloseTimeoutMs = 10_000;
const databaseClosePollIntervalMs = 100;

function getAdminPool(): Pool {
  if (adminPool === undefined) throw new Error("Migration admin pool is not initialized.");
  return adminPool;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function databaseUrlFor(databaseName: string): string {
  const url = new URL(configuredDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function executeStatements(
  client: PoolClient,
  statements: readonly string[],
): Promise<void> {
  for (const statement of statements) {
    await client.query(statement);
  }
}

async function executeInTransaction(
  pool: Pool,
  statements: readonly string[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await executeStatements(client, statements);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function createDatabase(
  databaseName: string,
  template?: string,
): Promise<void> {
  const templateClause = template === undefined
    ? ""
    : ` TEMPLATE ${quoteIdentifier(template)}`;
  await getAdminPool().query(
    `create database ${quoteIdentifier(databaseName)}${templateClause}`,
  );
}

async function dropDatabase(databaseName: string): Promise<void> {
  const deadline = Date.now() + databaseCloseTimeoutMs;
  let remainingSessions: Array<{
    pid: number;
    usename: string | null;
    application_name: string | null;
    state: string | null;
    wait_event_type: string | null;
  }> = [];

  do {
    const result = await getAdminPool().query<{
      pid: number;
      usename: string | null;
      application_name: string | null;
      state: string | null;
      wait_event_type: string | null;
    }>(
      `select pid, usename, application_name, state, wait_event_type
       from pg_stat_activity
       where datname = $1 and pid <> pg_backend_pid()`,
      [databaseName],
    );
    remainingSessions = result.rows;
    if (remainingSessions.length === 0) break;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out waiting for sessions to close before dropping ${databaseName}: ${JSON.stringify(remainingSessions)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, databaseClosePollIntervalMs));
  } while (true);

  await getAdminPool().query(
    `drop database if exists ${quoteIdentifier(databaseName)}`,
  );
}

async function withDisposableDatabase<T>(
  callback: (pool: Pool) => Promise<T>,
): Promise<T> {
  const databaseName = `campushub_evt004_migration_${Date.now().toString(36)}_${databaseSequence++}`;
  await createDatabase(databaseName, baseDatabaseName);
  const disposablePool = new Pool({ connectionString: databaseUrlFor(databaseName), max: 1 });
  try {
    return await callback(disposablePool);
  } finally {
    await disposablePool.end();
    await dropDatabase(databaseName);
  }
}

type SeedOptions = Readonly<{
  lifecycle?: "draft" | "published";
  contradictory?: Readonly<{
    kind:
      | "missing_action"
      | "null_action"
      | "missing_lifecycle"
      | "null_lifecycle"
      | "missing_version"
      | "null_version"
      | "malformed_version"
      | "oversized_version"
      | "wrong_version"
      | "wrong_resource_version"
      | "wrong_tenant";
  }>;
}>;

const IDS = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  otherTenantId: "10000000-0000-4000-8000-000000000002",
  membershipId: "20000000-0000-4000-8000-000000000001",
  otherMembershipId: "20000000-0000-4000-8000-000000000002",
  campusId: "30000000-0000-4000-8000-000000000001",
  otherCampusId: "30000000-0000-4000-8000-000000000002",
  eventId: "40000000-0000-4000-8000-000000000001",
  auditId: "50000000-0000-4000-8000-000000000001",
  contradictoryAuditId: "50000000-0000-4000-8000-000000000002",
} as const;

const EVENT_VERSION = 2;
const EVENT_START = "2026-09-25T10:00:00.000Z";
const AUDIT_OCCURRED_AT = "2026-09-20T10:00:00.000Z";

async function seedEvent(pool: Pool, options: SeedOptions = {}): Promise<void> {
  const lifecycle = options.lifecycle ?? "published";
  await pool.query(
    `insert into "tenants" ("id", "slug", "display_name", "status", "timezone") values ($1, $2, $3, 'active', 'Africa/Kampala'), ($4, $5, $6, 'active', 'Africa/Kampala')`,
    [IDS.tenantId, "migration-tenant", "Migration Tenant", IDS.otherTenantId, "migration-other", "Other Tenant"],
  );
  await pool.query(
    `insert into "campuses" ("id", "tenant_id", "label", "status") values ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
    [IDS.campusId, IDS.tenantId, "Migration Campus", IDS.otherCampusId, IDS.otherTenantId, "Other Campus"],
  );
  await pool.query(
    `insert into "memberships" ("id", "tenant_id", "identity_subject_id", "assurance_level", "lifecycle") values ($1, $2, $3, 'L2', 'verified'), ($4, $5, $6, 'L2', 'verified')`,
    [IDS.membershipId, IDS.tenantId, "migration-identity", IDS.otherMembershipId, IDS.otherTenantId, "other-identity"],
  );
  await pool.query(
    `insert into "events" ("id", "tenant_id", "version", "title", "description", "venue", "starts_at", "ends_at", "campus_id", "visibility", "audience_mode", "rsvp_enabled", "lifecycle") values ($1, $2, $3, 'Migration Event', 'Migration Event Description', 'Main Hall', $4, null, $5, 'MEMBERS', 'entire_tenant', false, $6)`,
    [IDS.eventId, IDS.tenantId, EVENT_VERSION, EVENT_START, IDS.campusId, lifecycle],
  );
  if (lifecycle !== "published") return;

  const goodFacts = { action: "published", lifecycle: "published", version: String(EVENT_VERSION) };
  await pool.query(
    `insert into "audit_events" ("id", "tenant_id", "sequence", "event_type", "actor_membership_id", "resource_type", "resource_id", "resource_version", "occurred_at", "event_facts", "previous_hash", "current_hash", "key_version", "integrity_format_version", "event_contract_version") values ($1, $2, 1, 'event.published', $3, 'event', $4, $5, $6, $7::jsonb, $8, $9, 1, 1, 1)`,
    [IDS.auditId, IDS.tenantId, IDS.membershipId, IDS.eventId, EVENT_VERSION, AUDIT_OCCURRED_AT, JSON.stringify(goodFacts), "0".repeat(64), "1".repeat(64)],
  );

  const contradictory = options.contradictory;
  if (contradictory === undefined) return;
  const facts: Record<string, unknown> = { ...goodFacts };
  let tenantId: string = IDS.tenantId;
  let resourceVersion: number | null = EVENT_VERSION;
  switch (contradictory.kind) {
    case "missing_action": delete facts.action; break;
    case "null_action": facts.action = null; break;
    case "missing_lifecycle": delete facts.lifecycle; break;
    case "null_lifecycle": facts.lifecycle = null; break;
    case "missing_version": delete facts.version; break;
    case "null_version": facts.version = null; break;
    case "malformed_version": facts.version = "not-an-integer"; break;
    case "oversized_version": facts.version = "999999999999999999999999999999"; break;
    case "wrong_version": facts.version = "3"; break;
    case "wrong_resource_version": resourceVersion = 3; break;
    case "wrong_tenant": tenantId = IDS.otherTenantId; break;
  }
  await pool.query(
    `insert into "audit_events" ("id", "tenant_id", "sequence", "event_type", "actor_membership_id", "resource_type", "resource_id", "resource_version", "occurred_at", "event_facts", "previous_hash", "current_hash", "key_version", "integrity_format_version", "event_contract_version") values ($1, $2, 2, 'event.published', $3, 'event', $4, $5, $6, $7::jsonb, $8, $9, 1, 1, 1)`,
    [IDS.contradictoryAuditId, tenantId, tenantId === IDS.tenantId ? IDS.membershipId : IDS.otherMembershipId, IDS.eventId, resourceVersion, AUDIT_OCCURRED_AT, JSON.stringify(facts), "1".repeat(64), "2".repeat(64)],
  );
}

async function runFullLifecycleMigration(pool: Pool): Promise<void> {
  await executeInTransaction(pool, lifecycleMigrationStatements);
}

async function runThroughPhase3AndExpectPhase4Failure(
  pool: Pool,
  corrupt: (client: PoolClient) => Promise<unknown>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await executeStatements(client, lifecycleMigrationStatements.slice(0, phase4StatementIndex));
    await client.query("set local session_replication_role = replica");
    await corrupt(client);
    await expect(client.query(lifecycleMigrationStatements[phase4StatementIndex]!)).rejects.toThrow(
      "CH-EVT-004 history bootstrap postcondition failed",
    );
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  adminPool = new Pool({ connectionString: databaseUrl, max: 2 });
  baseDatabaseName = `campushub_evt004_migration_base_${Date.now().toString(36)}`;
  await createDatabase(baseDatabaseName);
  const basePool = new Pool({ connectionString: databaseUrlFor(baseDatabaseName), max: 1 });
  try {
    await executeInTransaction(basePool, baseMigrationFiles.flatMap((file) =>
      readFileSync(join(migrationDirectory, file), "utf8")
        .split(/--> statement-breakpoint/g)
        .map((statement) => statement.trim())
        .filter((statement) => statement.length > 0),
    ));
  } finally {
    await basePool.end();
  }
}, 120_000);

afterAll(async () => {
  try {
    if (baseDatabaseName !== "") await dropDatabase(baseDatabaseName);
  } finally {
    await adminPool?.end();
  }
});

describe("isolated CH-EVT-004 migration invariants", () => {
  it("initializes an exact sequence-1 baseline and leaves drafts empty", async () => {
    await withDisposableDatabase(async (pool) => {
      await seedEvent(pool, { lifecycle: "published" });
      await pool.query(
        `insert into "events" ("id", "tenant_id", "version", "title", "description", "venue", "starts_at", "ends_at", "campus_id", "visibility", "audience_mode", "rsvp_enabled", "lifecycle") values ('40000000-0000-4000-8000-000000000002', $1, 1, 'Draft Event', 'Draft Event Description', 'Main Hall', $2, null, $3, 'MEMBERS', 'entire_tenant', false, 'draft')`,
        [IDS.tenantId, EVENT_START, IDS.campusId],
      );
      await runFullLifecycleMigration(pool);
      const history = await pool.query(
        `select tenant_id, event_id, sequence, event_version, from_lifecycle, to_lifecycle, starts_at, ends_at, postponed_from_starts_at, reason, cancellation_retention_until, occurred_at from "event_lifecycle_history" order by event_id`,
      );
      expect(history.rows).toHaveLength(1);
      expect(history.rows[0]).toMatchObject({
        tenant_id: IDS.tenantId,
        event_id: IDS.eventId,
        sequence: 1,
        event_version: EVENT_VERSION,
        from_lifecycle: "draft",
        to_lifecycle: "published",
        postponed_from_starts_at: null,
        reason: null,
        cancellation_retention_until: null,
      });
      expect(new Date(history.rows[0].starts_at).toISOString()).toBe(EVENT_START);
      expect(new Date(history.rows[0].occurred_at).toISOString()).toBe(AUDIT_OCCURRED_AT);
      await expect(pool.query(`select cancellation_retention_until from "events" where id = $1`, [IDS.eventId])).resolves.toMatchObject({ rows: [{ cancellation_retention_until: null }] });
      await expect(pool.query(`select count(*)::int as count from "event_lifecycle_history" where event_id = '40000000-0000-4000-8000-000000000002'`)).resolves.toMatchObject({ rows: [{ count: 0 }] });
    });
  }, 120_000);

  it.each([
    "missing_action",
    "null_action",
    "missing_lifecycle",
    "null_lifecycle",
    "missing_version",
    "null_version",
    "malformed_version",
    "oversized_version",
    "wrong_version",
    "wrong_resource_version",
    "wrong_tenant",
  ] as const)("fails closed for contradictory publication provenance: %s", async (kind) => {
    await withDisposableDatabase(async (pool) => {
      await seedEvent(pool, { contradictory: { kind } });
      await expect(runFullLifecycleMigration(pool)).rejects.toThrow("CH-EVT-004");
      await expect(pool.query(`select to_regclass('public.event_lifecycle_history') as table_name`)).resolves.toMatchObject({ rows: [{ table_name: null }] });
    });
  }, 120_000);

  it.each([
    {
      name: "wrong sequence",
      corrupt: (client: PoolClient) => client.query(`update "event_lifecycle_history" set sequence = 2 where event_id = $1`, [IDS.eventId]),
    },
    {
      name: "wrong Event version",
      corrupt: (client: PoolClient) => client.query(`update "event_lifecycle_history" set event_version = 3 where event_id = $1`, [IDS.eventId]),
    },
    {
      name: "wrong startsAt",
      corrupt: (client: PoolClient) => client.query(`update "event_lifecycle_history" set starts_at = starts_at + interval '1 day' where event_id = $1`, [IDS.eventId]),
    },
    {
      name: "wrong endsAt",
      corrupt: (client: PoolClient) => client.query(`update "event_lifecycle_history" set ends_at = starts_at + interval '1 hour' where event_id = $1`, [IDS.eventId]),
    },
    {
      name: "wrong from lifecycle",
      corrupt: (client: PoolClient) => client.query(`update "event_lifecycle_history" set from_lifecycle = 'postponed' where event_id = $1`, [IDS.eventId]),
    },
    {
      name: "wrong to lifecycle",
      corrupt: (client: PoolClient) => client.query(`update "event_lifecycle_history" set from_lifecycle = 'published', to_lifecycle = 'postponed', postponed_from_starts_at = starts_at, reason = 'Corrupt transition' where event_id = $1`, [IDS.eventId]),
    },
    {
      name: "non-null reason and postponedFrom",
      corrupt: (client: PoolClient) => client.query(`update "event_lifecycle_history" set from_lifecycle = 'published', to_lifecycle = 'postponed', postponed_from_starts_at = starts_at, reason = 'Corrupt transition' where event_id = $1`, [IDS.eventId]),
    },
    {
      name: "non-null cancellation retention",
      corrupt: (client: PoolClient) => client.query(`update "event_lifecycle_history" set from_lifecycle = 'published', to_lifecycle = 'cancelled', reason = 'Corrupt cancellation', cancellation_retention_until = starts_at where event_id = $1`, [IDS.eventId]),
    },
    {
      name: "wrong occurredAt",
      corrupt: (client: PoolClient) => client.query(`update "event_lifecycle_history" set occurred_at = occurred_at + interval '1 second' where event_id = $1`, [IDS.eventId]),
    },
  ] as const)("rejects a corrupted complete baseline: %s", async ({ corrupt }) => {
    await withDisposableDatabase(async (pool) => {
      await seedEvent(pool);
      await runThroughPhase3AndExpectPhase4Failure(pool, corrupt);
    });
  }, 120_000);
});
