import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import type * as schema from "@/server/db/schema";
import type { CampusHubDatabase } from "@/server/db/client";
import type { PostgresCapabilityAuthorizer } from "@/server/authorization/postgres-capability-authorizer";
import type { PostgresAuthorizedPublicationCreateExecutor } from "@/server/authorization/postgres-authorized-publication-create";
import type { PostgresAuthorizedPublicationDraftEditExecutor } from "@/server/authorization/postgres-authorized-publication-draft-edit";
import type { PostgresAuthorizedPublicationPublishExecutor } from "@/server/authorization/postgres-authorized-publication-publish";
import type { CanonicalPublicationDraftInput } from "@/domain/content/publication-draft";
import type { UpdatePublicationDraftInput } from "@/domain/content/publication-draft-edit";
import { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import { StaticAuditIntegrityKeyProvider } from "@/domain/audit/audit-integrity-key-provider";
import type { PublicationPublishAuditWriter } from "@/server/repositories/publication-repository";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const TERM_START = new Date("2026-01-01T00:00:00.000Z");
const TERM_END = new Date("2026-12-31T23:59:59.000Z");
const GRANT_END = new Date("2026-12-01T00:00:00.000Z");
const ONE_SECOND_AFTER_NOW = new Date("2026-09-05T12:00:01.000Z");
const TWO_SECONDS_AFTER_NOW = new Date("2026-09-05T12:00:02.000Z");
const POSTGRES_LOCK_WAIT_TIMEOUT_MS = 5_000;
const POSTGRES_LOCK_POLL_DELAY_MS = 25;

let capabilityNow = NOW;

if (process.env.CAMPUSHUB_DB_INTEGRATION !== "1") {
  throw new Error(
    "Real database integration is opt-in. Set CAMPUSHUB_DB_INTEGRATION=1.",
  );
}

function loadIntegrationEnvironment(): void {
  const originalNodeEnv = process.env.NODE_ENV;
  const mutableEnvironment = process.env as Record<
    string,
    string | undefined
  >;
  if (originalNodeEnv === "test") {
    mutableEnvironment.NODE_ENV = "development";
  }
  try {
    loadEnvConfig(process.cwd());
  } finally {
    if (originalNodeEnv === "test") {
      mutableEnvironment.NODE_ENV = originalNodeEnv;
    }
  }
}

loadIntegrationEnvironment();

let database: CampusHubDatabase | undefined;
let pool: Pool | undefined;
let tables: typeof schema;
let capabilityAuthorizer: PostgresCapabilityAuthorizer;
let AuthorizedPublicationCreateExecutor: typeof PostgresAuthorizedPublicationCreateExecutor;
let AuthorizedPublicationDraftEditExecutor: typeof PostgresAuthorizedPublicationDraftEditExecutor;
let AuthorizedPublicationPublishExecutor: typeof PostgresAuthorizedPublicationPublishExecutor;
let DrizzlePublicationRepository: typeof import("@/server/repositories/publication-repository").DrizzlePublicationRepository;
let CreatePublicationService: typeof import("@/application/content/create-publication").CreatePublicationService;
const syntheticTenantIds = new Set<string>();
let sequence = 0;
const integrationAuditKey = new Uint8Array(
  Buffer.from("campushub-integration-audit-key-2026-09-09"),
);

function getDatabase(): CampusHubDatabase {
  if (database === undefined) {
    throw new Error("Database was not initialized.");
  }
  return database;
}

function getPool(): Pool {
  if (pool === undefined) {
    throw new Error("Pool was not initialized.");
  }
  return pool;
}

function getDatabaseConnectionString(): string {
  const value = process.env.DATABASE_URL;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("DATABASE_URL was not loaded for integration tests.");
  }
  return value;
}

async function authorizerForDatabase(
  targetDatabase: CampusHubDatabase,
): Promise<PostgresCapabilityAuthorizer> {
  const tenantRepositoryModule = await import(
    "@/server/repositories/tenant-repository"
  );
  const membershipRepositoryModule = await import(
    "@/server/repositories/membership-repository"
  );
  const guildTermRepositoryModule = await import(
    "@/server/repositories/guild-term-repository"
  );
  const roleGrantRepositoryModule = await import(
    "@/server/repositories/role-grant-repository"
  );
  const authorizerModule = await import(
    "@/server/authorization/postgres-capability-authorizer"
  );

  return new authorizerModule.PostgresCapabilityAuthorizer({
    tenants: new tenantRepositoryModule.DrizzleTenantRepository(targetDatabase),
    memberships: new membershipRepositoryModule.DrizzleMembershipRepository(
      targetDatabase,
    ),
    guildTerms: new guildTermRepositoryModule.DrizzleGuildTermRepository(
      targetDatabase,
    ),
    roleGrants: new roleGrantRepositoryModule.DrizzleRoleGrantRepository(
      targetDatabase,
    ),
    clock: { now: () => capabilityNow },
  });
}

type RestrictedAdminPathTerminal =
  | "audit_owner"
  | "audit_update"
  | "schema_create"
  | "createrole"
  | "benign";

type RestrictedAdminPath = Readonly<{
  bridgeCount: number;
  seed: "admin" | "set";
  terminal: RestrictedAdminPathTerminal;
}>;

type RestrictedRoleMembershipEdge = Readonly<{
  memberRoleName: string;
  targetRoleName: string;
}>;

type RestrictedRuntimeDatabase = Readonly<{
  adminPathRoleNames: readonly (readonly string[])[];
  adminPathTargetNames: readonly string[];
  database: CampusHubDatabase;
  membershipEdges: readonly RestrictedRoleMembershipEdge[];
  pool: Pool;
  roleName: string;
  auxiliaryRoleNames: readonly string[];
}>;

type RestrictedRuntimeOptions = Readonly<{
  adminPaths?: readonly RestrictedAdminPath[];
  auditOwnerMembership?: "set" | "admin_only";
  dangerousPrivileges?: readonly ("audit_update" | "schema_create")[];
  dangerousMembership?: "set" | "admin_only";
}>;

async function createRestrictedRuntimeDatabase(
  options: RestrictedRuntimeOptions = {},
): Promise<RestrictedRuntimeDatabase> {
  const adminPool = getPool();
  const roleName = `campushub_runtime_test_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const quotedRole = `"${roleName}"`;
  const dangerousPrivileges = options.dangerousPrivileges ?? [];
  const adminPaths = options.adminPaths ?? [];
  const auxiliaryRoleNames: string[] = [];
  const membershipEdges: RestrictedRoleMembershipEdge[] = [];
  const adminPathRoleNames: string[][] = [];
  const adminPathTargetNames: string[] = [];
  const requiresNoInherit =
    options.auditOwnerMembership === "admin_only" ||
    options.dangerousMembership === "admin_only" ||
    dangerousPrivileges.length > 0 ||
    adminPaths.some((path) => path.seed === "admin");
  const inheritance = requiresNoInherit ? "NOINHERIT" : "INHERIT";
  const tableNames = [
    "tenants",
    "memberships",
    "guild_terms",
    "role_grants",
    "publications",
    "publication_audience_criteria",
  ];

  const createAuxiliaryRole = async (
    label: string,
    createrole = false,
  ): Promise<string> => {
    const auxiliaryRoleName = `campushub_${label}_${randomUUID().replaceAll(
      "-",
      "",
    )}`;
    const quotedAuxiliaryRole = `"${auxiliaryRoleName}"`;
    await adminPool.query(
      `create role ${quotedAuxiliaryRole} nologin${
        createrole ? " createrole" : ""
      }`,
    );
    auxiliaryRoleNames.push(auxiliaryRoleName);
    return auxiliaryRoleName;
  };

  const grantMembership = async (
    targetRoleName: string,
    memberRoleName: string,
    mode: "set" | "admin_only",
  ): Promise<void> => {
    const quotedTarget = `"${targetRoleName}"`;
    const quotedMember = `"${memberRoleName}"`;
    if (mode === "admin_only") {
      await adminPool.query(
        `grant ${quotedTarget} to ${quotedMember} with admin true, set false, inherit false`,
      );
    } else {
      await adminPool.query(
        `grant ${quotedTarget} to ${quotedMember} with set true, inherit true`,
      );
    }
    membershipEdges.push({ memberRoleName, targetRoleName });
  };

  await adminPool.query(
    `create role ${quotedRole} login ${inheritance} password '${password}'`,
  );
  try {
    await adminPool.query(`grant usage on schema public to ${quotedRole}`);
    await adminPool.query(`revoke create on schema public from ${quotedRole}`);
    await adminPool.query(
      `grant select on ${tableNames.map((name) => `"${name}"`).join(", ")} to ${quotedRole}`,
    );
    await adminPool.query(
      `grant "campushub_runtime" to ${quotedRole}`,
    );
    await adminPool.query(
      `grant update on ${tableNames
        .filter((name) => name !== "publication_audience_criteria")
        .map((name) => `"${name}"`)
        .join(", ")} to ${quotedRole}`,
    );
    await adminPool.query(`grant select, insert on "audit_events" to ${quotedRole}`);
    if (options.auditOwnerMembership === "set") {
      await grantMembership("campushub_audit_owner", roleName, "set");
    } else if (options.auditOwnerMembership === "admin_only") {
      await grantMembership("campushub_audit_owner", roleName, "admin_only");
    }
    for (const dangerousPrivilege of dangerousPrivileges) {
      const dangerousRoleName = await createAuxiliaryRole("dangerous_test");
      const quotedDangerousRole = `"${dangerousRoleName}"`;
      if (dangerousPrivilege === "audit_update") {
        await adminPool.query(
          `grant update on "audit_events" to ${quotedDangerousRole}`,
        );
      } else {
        await adminPool.query(
          `grant create on schema public to ${quotedDangerousRole}`,
        );
      }
      await grantMembership(
        dangerousRoleName,
        roleName,
        options.dangerousMembership === "admin_only" ? "admin_only" : "set",
      );
    }

    for (const path of adminPaths) {
      const pathRoleNames: string[] = [];
      let memberRoleName = roleName;
      for (
        let bridgeIndex = 0;
        bridgeIndex < path.bridgeCount;
        bridgeIndex += 1
      ) {
        const bridgeRoleName = await createAuxiliaryRole("admin_bridge");
        pathRoleNames.push(bridgeRoleName);
        await grantMembership(
          bridgeRoleName,
          memberRoleName,
          bridgeIndex === 0 && path.seed === "set" ? "set" : "admin_only",
        );
        memberRoleName = bridgeRoleName;
      }

      let targetRoleName: string;
      if (path.terminal === "audit_owner") {
        targetRoleName = "campushub_audit_owner";
      } else {
        targetRoleName = await createAuxiliaryRole(
          `admin_${path.terminal}`,
          path.terminal === "createrole",
        );
        const quotedTargetRole = `"${targetRoleName}"`;
        if (path.terminal === "audit_update") {
          await adminPool.query(
            `grant update on "audit_events" to ${quotedTargetRole}`,
          );
        } else if (path.terminal === "schema_create") {
          await adminPool.query(
            `grant create on schema public to ${quotedTargetRole}`,
          );
        }
        pathRoleNames.push(targetRoleName);
      }
      await grantMembership(
        targetRoleName,
        memberRoleName,
        path.bridgeCount === 0 && path.seed === "set" ? "set" : "admin_only",
      );
      adminPathRoleNames.push(pathRoleNames);
      adminPathTargetNames.push(targetRoleName);
    }

    const connectionUrl = new URL(getDatabaseConnectionString());
    connectionUrl.username = roleName;
    connectionUrl.password = password;
    const restrictedPool = new Pool({
      connectionString: connectionUrl.toString(),
      max: 1,
    });
    await restrictedPool.query("select 1");
    const restrictedDatabase = drizzle({
      client: restrictedPool,
      schema: tables,
    }) as CampusHubDatabase;
    return {
      adminPathRoleNames,
      adminPathTargetNames,
      auxiliaryRoleNames,
      database: restrictedDatabase,
      membershipEdges,
      pool: restrictedPool,
      roleName,
    };
  } catch (error) {
    for (const edge of [...membershipEdges].reverse()) {
      await adminPool
        .query(`revoke "${edge.targetRoleName}" from "${edge.memberRoleName}"`)
        .catch(() => undefined);
    }
    await adminPool
      .query(`revoke "campushub_runtime" from ${quotedRole}`)
      .catch(() => undefined);
    await adminPool
      .query(`revoke all privileges on schema public from ${quotedRole}`)
      .catch(() => undefined);
    await adminPool
      .query(`revoke all privileges on all tables in schema public from ${quotedRole}`)
      .catch(() => undefined);
    await adminPool.query(`drop role ${quotedRole}`).catch(() => undefined);
    for (const auxiliaryRoleName of auxiliaryRoleNames) {
      const quotedAuxiliaryRole = `"${auxiliaryRoleName}"`;
      await adminPool
        .query(`revoke all privileges on schema public from ${quotedAuxiliaryRole}`)
        .catch(() => undefined);
      await adminPool
        .query(`revoke all privileges on all tables in schema public from ${quotedAuxiliaryRole}`)
        .catch(() => undefined);
      await adminPool.query(`drop role ${quotedAuxiliaryRole}`).catch(() => undefined);
    }
    throw error;
  }
}

async function destroyRestrictedRuntimeDatabase(
  restricted: RestrictedRuntimeDatabase,
): Promise<void> {
  await restricted.pool.end();
  const adminPool = getPool();
  const quotedRole = `"${restricted.roleName}"`;
  await adminPool
    .query(`revoke "campushub_runtime" from ${quotedRole}`)
    .catch(() => undefined);
  for (const edge of [...restricted.membershipEdges].reverse()) {
    await adminPool
      .query(`revoke "${edge.targetRoleName}" from "${edge.memberRoleName}"`)
      .catch(() => undefined);
  }
  await adminPool
    .query(`revoke all privileges on schema public from ${quotedRole}`)
    .catch(() => undefined);
  await adminPool
    .query(`revoke all privileges on all tables in schema public from ${quotedRole}`)
    .catch(() => undefined);
  await adminPool.query(`drop role ${quotedRole}`);
  for (const auxiliaryRoleName of restricted.auxiliaryRoleNames) {
    const quotedAuxiliaryRole = `"${auxiliaryRoleName}"`;
    await adminPool
      .query(`revoke all privileges on schema public from ${quotedAuxiliaryRole}`)
      .catch(() => undefined);
    await adminPool
      .query(`revoke all privileges on all tables in schema public from ${quotedAuxiliaryRole}`)
      .catch(() => undefined);
    await adminPool.query(`drop role ${quotedAuxiliaryRole}`);
  }
}

function nextSlug(label: string): string {
  sequence += 1;
  return `campushub-race-${Date.now().toString(36)}-${label}-${sequence}`;
}

function nextIdentity(label: string): string {
  sequence += 1;
  return `campushub-race-${label}-${sequence}`;
}

async function createFixture() {
  const db = getDatabase();
  const tenantRows = await db
    .insert(tables.tenants)
    .values({
      slug: nextSlug("tenant"),
      displayName: "Capability race Tenant",
      status: "active",
      timezone: "Africa/Kampala",
    })
    .returning();
  const tenant = tenantRows[0];
  if (tenant === undefined) {
    throw new Error("Tenant fixture insert returned no row.");
  }
  syntheticTenantIds.add(tenant.id);

  const membershipRows = await db
    .insert(tables.memberships)
    .values({
      tenantId: tenant.id,
      identitySubjectId: nextIdentity("member"),
      assuranceLevel: "L2",
      lifecycle: "verified",
    })
    .returning();
  const membership = membershipRows[0];
  if (membership === undefined) {
    throw new Error("Membership fixture insert returned no row.");
  }

  const termRows = await db
    .insert(tables.guildTerms)
    .values({
      tenantId: tenant.id,
      label: "Capability race term",
      startsAt: TERM_START,
      endsAt: TERM_END,
      status: "active",
    })
    .returning();
  const term = termRows[0];
  if (term === undefined) {
    throw new Error("Guild Term fixture insert returned no row.");
  }

  const grantRows = await db
    .insert(tables.roleGrants)
    .values({
      tenantId: tenant.id,
      guildTermId: term.id,
      membershipId: membership.id,
      role: "publisher",
      capability: "publication.create",
      moduleScope: "publication",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: GRANT_END,
    })
    .returning();
  const grant = grantRows[0];
  if (grant === undefined) {
    throw new Error("Role Grant fixture insert returned no row.");
  }

  const editGrantRows = await db
    .insert(tables.roleGrants)
    .values({
      tenantId: tenant.id,
      guildTermId: term.id,
      membershipId: membership.id,
      role: "publisher",
      capability: "publication.edit",
      moduleScope: "publication",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: GRANT_END,
    })
    .returning();
  const editGrant = editGrantRows[0];
  if (editGrant === undefined) {
    throw new Error("Publication edit Role Grant fixture insert returned no row.");
  }

  const publishGrantRows = await db
    .insert(tables.roleGrants)
    .values({
      tenantId: tenant.id,
      guildTermId: term.id,
      membershipId: membership.id,
      role: "publisher",
      capability: "publication.publish",
      moduleScope: "publication",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: GRANT_END,
    })
    .returning();
  const publishGrant = publishGrantRows[0];
  if (publishGrant === undefined) {
    throw new Error("Publication publish Role Grant fixture insert returned no row.");
  }

  return { tenant, membership, term, grant, editGrant, publishGrant };
}

function requestFor(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  capability:
    | "publication.create"
    | "publication.edit"
    | "publication.publish" = "publication.create",
) {
  return {
    actor: {
      identitySubjectId: fixture.membership.identitySubjectId,
      tenantId: fixture.tenant.id,
      membershipId: fixture.membership.id,
    },
    context: {
      tenantStatus: fixture.tenant.status,
      membershipStatus: fixture.membership.lifecycle,
      assuranceLevel: fixture.membership.assuranceLevel,
    },
    capability,
    scope: {
      tenantId: fixture.tenant.id,
      module: "publication" as const,
      resource: "publication",
    },
  };
}

type CapabilityRaceRequest = ReturnType<typeof requestFor>;

function publicationInput(label: string): CanonicalPublicationDraftInput {
  return {
    type: "notice",
    title: `Atomic capability ${label}`,
    body: `Atomic capability body ${label}`,
    priority: "standard",
    visibility: "MEMBERS",
    audienceMode: "entire_tenant",
    authorOfficeLabel: "Guild Communications Office",
    expiresAt: null,
  };
}

function publicationEditInput(
  expectedVersion: number,
  label: string,
): UpdatePublicationDraftInput {
  return {
    expectedVersion,
    type: "notice",
    title: `Edited publication ${label}`,
    body: `Edited publication body ${label}`,
    priority: "priority",
    visibility: "PUBLIC",
    authorOfficeLabel: "Guild Communications Office",
    expiresAt: new Date("2026-11-01T00:00:00.000Z"),
  };
}

function postgresCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string") {
    return candidate.code;
  }
  return postgresCode(candidate.cause);
}

function executor(
  beforeInsert?: () => Promise<void>,
): PostgresAuthorizedPublicationCreateExecutor {
  return new AuthorizedPublicationCreateExecutor({
    database: getDatabase(),
    authorizer: capabilityAuthorizer,
    beforeInsert,
  });
}

function editExecutor(
  beforeUpdate?: () => Promise<void>,
): PostgresAuthorizedPublicationDraftEditExecutor {
  return new AuthorizedPublicationDraftEditExecutor({
    database: getDatabase(),
    authorizer: capabilityAuthorizer,
    beforeUpdate,
  });
}

async function createDraftPublication(
  tenantId: string,
  overrides: Partial<schema.NewPublicationRow> = {},
): Promise<schema.PublicationRow> {
  const rows = await getDatabase()
    .insert(tables.publications)
    .values({
      tenantId,
      type: "notice",
      title: `Atomic capability draft ${Date.now()}`,
      body: "Atomic capability draft body",
      priority: "standard",
      visibility: "MEMBERS",
      lifecycle: "draft",
      audienceMode: "targeted",
      authorOfficeLabel: "Guild Communications Office",
      publishAt: null,
      expiresAt: null,
      ...overrides,
    })
    .returning();
  const publication = rows[0];
  if (publication === undefined) {
    throw new Error("Draft Publication fixture insert returned no row.");
  }
  return publication;
}

async function publicationRow(
  publicationId: string,
): Promise<schema.PublicationRow | null> {
  const rows = await getDatabase()
    .select()
    .from(tables.publications)
    .where(eq(tables.publications.id, publicationId))
    .limit(1);
  return rows[0] ?? null;
}

async function auditRowsForPublication(
  tenantId: string,
  publicationId: string,
): Promise<readonly schema.AuditEventRow[]> {
  return getDatabase()
    .select()
    .from(tables.auditEvents)
    .where(
      and(
        eq(tables.auditEvents.tenantId, tenantId),
        eq(tables.auditEvents.resourceId, publicationId),
      ),
    )
    .orderBy(tables.auditEvents.sequence);
}

type PostgresActivity = Readonly<{
  pid: number;
  blockingPids: readonly number[];
  state: string | null;
  waitEventType: string | null;
  query: string | null;
}>;

type PublicationLockWaiter = PostgresActivity;

function isPublicationLockWaiter(activity: PostgresActivity): boolean {
  const query = activity.query?.toLowerCase() ?? "";
  return (
    activity.state === "active" &&
    activity.waitEventType === "Lock" &&
    query.includes('from "publications"') &&
    query.includes("for update")
  );
}

function publishExecutor(
  beforePublish?: () => Promise<void>,
  afterPublishMutation?: () => Promise<void>,
  auditEvents: PublicationPublishAuditWriter = new DrizzleAuditEventRepository({
    database: getDatabase(),
    keyProvider: new StaticAuditIntegrityKeyProvider(
      1,
      new Map([[1, integrationAuditKey]]),
    ),
  }),
): PostgresAuthorizedPublicationPublishExecutor {
  return new AuthorizedPublicationPublishExecutor({
    database: getDatabase(),
    authorizer: capabilityAuthorizer,
    auditEvents,
    // Existing fixture tests use the CI admin connection. The restricted-login
    // test below omits this seam and exercises the production verifier.
    runtimeDatabaseAuthorityVerifier: async () => true,
    beforePublish,
    afterPublishMutation,
  });
}

function strictPublishExecutorFor(
  targetDatabase: CampusHubDatabase,
  targetAuthorizer: PostgresCapabilityAuthorizer,
): PostgresAuthorizedPublicationPublishExecutor {
  return new AuthorizedPublicationPublishExecutor({
    database: targetDatabase,
    authorizer: targetAuthorizer,
    auditEvents: new DrizzleAuditEventRepository({
      database: targetDatabase,
      keyProvider: new StaticAuditIntegrityKeyProvider(
        1,
        new Map([[1, integrationAuditKey]]),
      ),
    }),
  });
}

function isPublicationLockHolder(activity: PostgresActivity): boolean {
  const query = activity.query?.toLowerCase() ?? "";
  return (
    activity.state === "idle in transaction" &&
    query.includes('from "publications"') &&
    query.includes("for update")
  );
}

function isAuthorityLockWaiter(activity: PostgresActivity): boolean {
  const query = activity.query?.toLowerCase() ?? "";
  return (
    activity.state === "active" &&
    activity.waitEventType === "Lock" &&
    (query.includes('from "tenants"') || query.includes("from tenants")) &&
    query.includes("for update")
  );
}

async function readPostgresActivities(): Promise<readonly PostgresActivity[]> {
  const result = await getDatabase().execute(sql`
    select
      activity.pid::int as pid,
      pg_blocking_pids(activity.pid) as blocking_pids,
      activity.state,
      activity.wait_event_type,
      activity.query
    from pg_stat_activity as activity
    where activity.pid <> pg_backend_pid()
  `);

  return (result.rows as Array<{
    pid?: unknown;
    blocking_pids?: unknown;
    state?: unknown;
    wait_event_type?: unknown;
    query?: unknown;
  }>).flatMap((row) => {
    const pid = Number(row.pid);
    if (!Number.isInteger(pid)) {
      return [];
    }

    const blockingPids = Array.isArray(row.blocking_pids)
      ? row.blocking_pids
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value))
      : [];

    return [
      {
        pid,
        blockingPids,
        state: typeof row.state === "string" ? row.state : null,
        waitEventType:
          typeof row.wait_event_type === "string" ? row.wait_event_type : null,
        query: typeof row.query === "string" ? row.query : null,
      },
    ];
  });
}

async function waitForPostgresCondition<T>(
  read: () => Promise<T>,
  isReady: (value: T) => boolean,
  timeoutMessage: string,
): Promise<T> {
  const deadline = Date.now() + POSTGRES_LOCK_WAIT_TIMEOUT_MS;

  while (true) {
    const value = await read();
    if (isReady(value)) {
      return value;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(timeoutMessage);
    }

    await new Promise<void>((resolve) =>
      setTimeout(
        resolve,
        Math.min(POSTGRES_LOCK_POLL_DELAY_MS, remainingMs),
      ),
    );
  }
}

function publicationLockWaiters(
  activities: readonly PostgresActivity[],
): readonly PublicationLockWaiter[] {
  return activities.filter(isPublicationLockWaiter);
}

async function waitForPublicationLockHolder(): Promise<PostgresActivity> {
  const activities = await waitForPostgresCondition(
    readPostgresActivities,
    (currentActivities) =>
      currentActivities.filter(isPublicationLockHolder).length === 1,
    "Timed out waiting for the first editor to hold the Publication lock.",
  );
  const holders = activities.filter(isPublicationLockHolder);
  const holder = holders[0];
  if (holder === undefined) {
    throw new Error("The first editor's Publication lock holder disappeared.");
  }
  return holder;
}

async function waitForAuthorityLockWaiterBlockedByBackend(
  blockingBackendPid: number,
): Promise<PostgresActivity> {
  const activities = await waitForPostgresCondition(
    readPostgresActivities,
    (currentActivities) =>
      currentActivities.filter(
        (activity) =>
          isAuthorityLockWaiter(activity) &&
          hasBlockingPath(currentActivities, activity.pid, blockingBackendPid),
      ).length === 1,
    `Timed out waiting for exactly one authority lock waiter blocked by backend ${blockingBackendPid}.`,
  );
  const waiters = activities.filter(
    (activity) =>
      isAuthorityLockWaiter(activity) &&
      hasBlockingPath(activities, activity.pid, blockingBackendPid),
  );
  const waiter = waiters[0];
  if (waiter === undefined) {
    throw new Error(
      `The authority lock waiter blocked by backend ${blockingBackendPid} disappeared.`,
    );
  }
  return waiter;
}

function hasBlockingPath(
  activities: readonly PostgresActivity[],
  blockedPid: number,
  targetBlockerPid: number,
): boolean {
  const activitiesByPid = new Map(
    activities.map((activity) => [activity.pid, activity]),
  );
  const pendingPids = [blockedPid];
  const visitedPids = new Set<number>();

  while (pendingPids.length > 0) {
    const pid = pendingPids.pop();
    if (pid === undefined || visitedPids.has(pid)) {
      continue;
    }
    visitedPids.add(pid);

    const activity = activitiesByPid.get(pid);
    if (activity === undefined) {
      continue;
    }

    for (const blockerPid of activity.blockingPids) {
      if (blockerPid === targetBlockerPid) {
        return true;
      }
      if (!visitedPids.has(blockerPid)) {
        pendingPids.push(blockerPid);
      }
    }
  }

  return false;
}

async function waitForAnyPublicationLockWaiters(
  expectedWaiters = 1,
): Promise<void> {
  await waitForPostgresCondition(
    async () => publicationLockWaiters(await readPostgresActivities()),
    (waiters) => waiters.length >= expectedWaiters,
    `Timed out waiting for ${expectedWaiters} Publication lock waiter(s).`,
  );
}

async function waitForPublicationLockWaiterBlockedByBackend(
  blockingBackendPid: number,
): Promise<PublicationLockWaiter> {
  const activities = await waitForPostgresCondition(
    readPostgresActivities,
    (currentActivities) =>
      publicationLockWaiters(currentActivities).some((waiter) =>
        hasBlockingPath(currentActivities, waiter.pid, blockingBackendPid),
      ),
    `Timed out waiting for a Publication lock waiter blocked by backend ${blockingBackendPid}.`,
  );
  const waiter = publicationLockWaiters(activities).find((candidate) =>
    hasBlockingPath(activities, candidate.pid, blockingBackendPid),
  );
  if (waiter === undefined) {
    throw new Error(
      `Publication lock waiter blocked by backend ${blockingBackendPid} disappeared.`,
    );
  }
  return waiter;
}

/**
 * The audience operation is observed first while blocked by the manual holder.
 * Once the editor starts, accept either a direct holder blocker or a PostgreSQL
 * blocking path through that already-queued audience operation.
 */
async function waitForPublicationLockQueue(
  blockingBackendPid: number,
  firstWaiterPid: number,
): Promise<void> {
  await waitForPostgresCondition(
    readPostgresActivities,
    (activities) => {
      const waiters = publicationLockWaiters(activities);
      const firstWaiter = waiters.find(
        (waiter) =>
          waiter.pid === firstWaiterPid &&
          hasBlockingPath(activities, waiter.pid, blockingBackendPid),
      );
      if (firstWaiter === undefined) {
        return false;
      }

      return waiters.some((waiter) => {
        if (waiter.pid === firstWaiter.pid) {
          return false;
        }
        const blockedByHolder = hasBlockingPath(
          activities,
          waiter.pid,
          blockingBackendPid,
        );
        const queuedBehindFirstWaiter = hasBlockingPath(
          activities,
          waiter.pid,
          firstWaiter.pid,
        );
        return blockedByHolder &&
          (waiter.blockingPids.includes(blockingBackendPid) ||
            queuedBehindFirstWaiter);
      });
    },
    `Timed out waiting for the Publication editor to queue behind audience waiter ${firstWaiterPid}.`,
  );
}

async function publicationCount(tenantId: string): Promise<number> {
  const result = await getDatabase().execute(sql`
    select count(*)::int as count
    from "publications"
    where "tenant_id" = ${tenantId}
      and "title" like ${"Atomic capability%"}
  `);
  return Number((result.rows[0] as { count: number }).count);
}

async function beginClient(): Promise<PoolClient> {
  const client = await getPool().connect();
  await client.query("BEGIN");
  return client;
}

async function backendPid(client: PoolClient): Promise<number> {
  const result = await client.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  const pid = Number(result.rows[0]?.pid);
  if (!Number.isInteger(pid)) {
    throw new Error("PostgreSQL backend did not return a valid PID.");
  }
  return pid;
}

async function cleanupAuditFixtures(): Promise<void> {
  if (syntheticTenantIds.size === 0) {
    return;
  }

  // This is an integration-harness cleanup path only. The production runtime
  // has no audit delete/truncate operation; the disposable/shared test role
  // must bypass the append-only trigger to remove synthetic fixtures before
  // the Tenant rows are cleaned up.
  const cleanupClient = await getPool().connect();
  try {
    await cleanupClient.query("BEGIN");
    await cleanupClient.query("SET LOCAL session_replication_role = 'replica'");
    await cleanupClient.query(
      `delete from "audit_events" where "tenant_id" = any($1::uuid[])`,
      [[...syntheticTenantIds]],
    );
    await cleanupClient.query("COMMIT");
  } catch (error) {
    await cleanupClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    cleanupClient.release();
  }
}

beforeAll(async () => {
  const databaseModule = await import("@/server/db/client");
  const schemaModule = await import("@/server/db/schema");
  const tenantRepositoryModule = await import(
    "@/server/repositories/tenant-repository"
  );
  const membershipRepositoryModule = await import(
    "@/server/repositories/membership-repository"
  );
  const guildTermRepositoryModule = await import(
    "@/server/repositories/guild-term-repository"
  );
  const roleGrantRepositoryModule = await import(
    "@/server/repositories/role-grant-repository"
  );
  const authorizerModule = await import(
    "@/server/authorization/postgres-capability-authorizer"
  );
  const executorModule = await import(
    "@/server/authorization/postgres-authorized-publication-create"
  );
  const editExecutorModule = await import(
    "@/server/authorization/postgres-authorized-publication-draft-edit"
  );
  const publishExecutorModule = await import(
    "@/server/authorization/postgres-authorized-publication-publish"
  );
  const publicationRepositoryModule = await import(
    "@/server/repositories/publication-repository"
  );
  const createPublicationModule = await import(
    "@/application/content/create-publication"
  );

  database = databaseModule.db;
  pool = databaseModule.pool;
  tables = schemaModule;
  const tenantRepository = new tenantRepositoryModule.DrizzleTenantRepository(
    database,
  );
  const membershipRepository =
    new membershipRepositoryModule.DrizzleMembershipRepository(database);
  const guildTermRepository =
    new guildTermRepositoryModule.DrizzleGuildTermRepository(database);
  const roleGrantRepository =
    new roleGrantRepositoryModule.DrizzleRoleGrantRepository(database);
  capabilityAuthorizer = new authorizerModule.PostgresCapabilityAuthorizer({
    tenants: tenantRepository,
    memberships: membershipRepository,
    guildTerms: guildTermRepository,
    roleGrants: roleGrantRepository,
    clock: { now: () => capabilityNow },
  });
  AuthorizedPublicationCreateExecutor =
    executorModule.PostgresAuthorizedPublicationCreateExecutor;
  AuthorizedPublicationDraftEditExecutor =
    editExecutorModule.PostgresAuthorizedPublicationDraftEditExecutor;
  AuthorizedPublicationPublishExecutor =
    publishExecutorModule.PostgresAuthorizedPublicationPublishExecutor;
  DrizzlePublicationRepository =
    publicationRepositoryModule.DrizzlePublicationRepository;
  CreatePublicationService = createPublicationModule.CreatePublicationService;

  await getDatabase().execute(sql`select 1`);
});

afterAll(async () => {
  if (database !== undefined && syntheticTenantIds.size > 0) {
    await cleanupAuditFixtures();
    await database
      .delete(tables.roleGrants)
      .where(inArray(tables.roleGrants.tenantId, [...syntheticTenantIds]));
    await database
      .delete(tables.guildTerms)
      .where(inArray(tables.guildTerms.tenantId, [...syntheticTenantIds]));
    await database
      .delete(tables.publicationAudienceCriteria)
      .where(
        inArray(
          tables.publicationAudienceCriteria.tenantId,
          [...syntheticTenantIds],
        ),
      );
    await database
      .delete(tables.publications)
      .where(inArray(tables.publications.tenantId, [...syntheticTenantIds]));
    await database
      .delete(tables.campuses)
      .where(inArray(tables.campuses.tenantId, [...syntheticTenantIds]));
    await database
      .delete(tables.memberships)
      .where(inArray(tables.memberships.tenantId, [...syntheticTenantIds]));
    await database
      .delete(tables.tenants)
      .where(inArray(tables.tenants.id, [...syntheticTenantIds]));
  }
  await pool?.end();
});

describe("durable capability commit-time authorization", () => {
  beforeEach(() => {
    capabilityNow = NOW;
  });

  it("PUBLISH-01 publishes a standard Publication with the locked confirmation", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });

    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toMatchObject({
      outcome: "PUBLISHED",
      publication: {
        id: publication.id,
        tenantId: fixture.tenant.id,
        version: 2,
        lifecycle: "published",
        publishAt: NOW,
      },
    });

    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 2,
      lifecycle: "published",
      publishAt: NOW,
    });
    const auditRows = await auditRowsForPublication(
      fixture.tenant.id,
      publication.id,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      tenantId: fixture.tenant.id,
      sequence: 1,
      eventType: "publication.published",
      actorMembershipId: fixture.membership.id,
      resourceType: "publication",
      resourceId: publication.id,
      resourceVersion: 2,
      occurredAt: NOW,
      previousHash: "0".repeat(64),
      keyVersion: 1,
      integrityFormatVersion: 1,
      eventContractVersion: 1,
    });
    expect(auditRows[0]?.eventFacts).toEqual({
      transition: { from: "draft", to: "published" },
      audienceMode: "entire_tenant",
      confirmedRecipientCount: 1,
      audienceSnapshot: { mode: "entire_tenant", targets: [] },
    });
    expect(JSON.stringify(auditRows[0]?.eventFacts)).not.toMatch(
      /title|body|identitySubjectId|recipientMembership/i,
    );
    const auditRepository = new DrizzleAuditEventRepository({
      database: getDatabase(),
      keyProvider: new StaticAuditIntegrityKeyProvider(
        1,
        new Map([[1, integrationAuditKey]]),
      ),
    });
    await expect(
      auditRepository.verifyAuditChainForTenant(fixture.tenant.id),
    ).resolves.toBe(true);
  });

  it("PUBLISH-02 fails closed for every Priority Publication even when both grants exist", async () => {
    const fixture = await createFixture();
    await getDatabase().insert(tables.roleGrants).values({
      tenantId: fixture.tenant.id,
      guildTermId: fixture.term.id,
      membershipId: fixture.membership.id,
      role: "guild_administrator",
      capability: "publication.priority_publish",
      moduleScope: "publication",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: GRANT_END,
    });
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
      priority: "priority",
    });

    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });

    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 1,
      lifecycle: "draft",
      publishAt: null,
    });
  });

  it("PUBLISH-AUDIT-01 records a targeted structural snapshot without recipient identities", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id);
    const campusRows = await getDatabase()
      .insert(tables.campuses)
      .values({
        tenantId: fixture.tenant.id,
        label: "Main Campus",
        status: "active",
      })
      .returning();
    const campus = campusRows[0];
    if (campus === undefined) {
      throw new Error("Campus fixture insert returned no row.");
    }
    await getDatabase().insert(tables.publicationAudienceCriteria).values({
      tenantId: fixture.tenant.id,
      publicationId: publication.id,
      dimension: "campus",
      provenancePolicy: "authoritative_only",
      campusId: campus.id,
    });

    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 0 },
      ),
    ).resolves.toMatchObject({
      outcome: "PUBLISHED",
      publication: { version: 2, lifecycle: "published" },
    });

    const auditRows = await auditRowsForPublication(
      fixture.tenant.id,
      publication.id,
    );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.eventFacts).toEqual({
      transition: { from: "draft", to: "published" },
      audienceMode: "targeted",
      confirmedRecipientCount: 0,
      audienceSnapshot: {
        mode: "targeted",
        targets: [
          {
            dimension: "campus",
            targetId: campus.id,
            targetValue: null,
            targetLabel: "Main Campus",
          },
        ],
      },
    });
  });

  it("PUBLISH-03 rejects an expiry at or before the authoritative publish time", async () => {
    for (const expiresAt of [
      new Date("2026-01-15T11:59:59.999Z"),
      NOW,
    ]) {
      const fixture = await createFixture();
      const publication = await createDraftPublication(fixture.tenant.id, {
        audienceMode: "entire_tenant",
        expiresAt,
      });

      await expect(
        publishExecutor().publishAuthorizedPublication(
          requestFor(fixture, "publication.publish"),
          fixture.tenant.id,
          publication.id,
          { expectedVersion: 1, confirmedRecipientCount: 1 },
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_STATE" });

      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 1,
        lifecycle: "draft",
        publishAt: null,
        expiresAt,
      });
    }
  });

  it("PUBLISH-03 accepts a future expiry without rewriting it", async () => {
    const fixture = await createFixture();
    const futureExpiry = new Date("2026-12-31T23:59:59.999Z");
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
      expiresAt: futureExpiry,
    });

    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toMatchObject({
      outcome: "PUBLISHED",
      publication: {
        version: 2,
        lifecycle: "published",
        publishAt: NOW,
        expiresAt: futureExpiry,
      },
    });

    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 2,
      lifecycle: "published",
      publishAt: NOW,
      expiresAt: futureExpiry,
    });
  });

  it("PUBLISH-04 rejects stale versions without changing the draft", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });

    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 2, confirmedRecipientCount: 1 },
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "VERSION_CONFLICT" });

    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 1,
      lifecycle: "draft",
    });
  });

  it("PUBLISH-05 rechecks the current audience confirmation under the Publication lock", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });

    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 0 },
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "RECONFIRM_REQUIRED" });

    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 1,
      lifecycle: "draft",
    });
  });

  it("PUBLISH-RACE-01 lets one locked publish win and rejects the stale publisher", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    const request = requestFor(fixture, "publication.publish");

    const results = await Promise.all([
      publishExecutor().publishAuthorizedPublication(
        request,
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
      publishExecutor().publishAuthorizedPublication(
        request,
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ]);

    expect(results.filter((result) => result.outcome === "PUBLISHED")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "DENIED")).toEqual([
      { outcome: "DENIED", code: "VERSION_CONFLICT" },
    ]);
    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 2,
      lifecycle: "published",
    });
  });

  it("PUBLISH-RACE-02 rejects a publish queued behind a concurrent draft edit", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    const holder = await beginClient();
    let holderCommitted = false;
    let publish: Promise<unknown> = Promise.resolve();
    try {
      await holder.query(
        `select id from publications where tenant_id = $1 and id = $2 for update`,
        [fixture.tenant.id, publication.id],
      );
      publish = publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      );
      await waitForPublicationLockWaiterBlockedByBackend(
        await backendPid(holder),
      );
      await holder.query(
        `update publications set title = $3, version = version + 1, updated_at = $4 where tenant_id = $1 and id = $2`,
        [fixture.tenant.id, publication.id, "Edited before publish", NOW],
      );
      await holder.query("commit");
      holderCommitted = true;

      await expect(publish).resolves.toEqual({
        outcome: "DENIED",
        code: "VERSION_CONFLICT",
      });
    } finally {
      if (!holderCommitted) {
        await holder.query("rollback").catch(() => undefined);
      }
      holder.release();
      await Promise.allSettled([publish]);
    }

    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 2,
      lifecycle: "draft",
      title: "Edited before publish",
    });
  });

  it("PUBLISH-RACE-03 lets publish win before a stale governed draft edit", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    let releasePublish: () => void = () => undefined;
    const publishMayCommit = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    let publishLocked: () => void = () => undefined;
    const publishIsLocked = new Promise<void>((resolve) => {
      publishLocked = resolve;
    });
    let publish: Promise<unknown> = Promise.resolve();
    let edit: Promise<unknown> = Promise.resolve();

    try {
      publish = publishExecutor(async () => {
        publishLocked();
        await publishMayCommit;
      }).publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      );
      await Promise.race([
        publishIsLocked,
        publish.then(() => {
          throw new Error("Publication publish completed before its gate opened.");
        }),
      ]);
      const publishBackendPid = (await waitForPublicationLockHolder()).pid;

      edit = editExecutor().editAuthorizedPublication(
        requestFor(fixture, "publication.edit"),
        fixture.tenant.id,
        publication.id,
        publicationEditInput(1, "stale-after-publish"),
      );
      const editWaiter = await waitForAuthorityLockWaiterBlockedByBackend(
        publishBackendPid,
      );
      expect(editWaiter.pid).not.toBe(publishBackendPid);
      releasePublish();

      await expect(publish).resolves.toMatchObject({
        outcome: "PUBLISHED",
        publication: { version: 2, lifecycle: "published" },
      });
      await expect(edit).resolves.toEqual({
        outcome: "DENIED",
        code: "VERSION_CONFLICT",
      });
      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 2,
        lifecycle: "published",
      });
      await expect(
        auditRowsForPublication(fixture.tenant.id, publication.id),
      ).resolves.toHaveLength(1);
    } finally {
      releasePublish();
      await Promise.allSettled([publish, edit]);
    }
  });

  it("PUBLISH-RACE-04 lets the governed draft edit win before a stale publish", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    let releaseEdit: () => void = () => undefined;
    const editMayCommit = new Promise<void>((resolve) => {
      releaseEdit = resolve;
    });
    let editLocked: () => void = () => undefined;
    const editIsLocked = new Promise<void>((resolve) => {
      editLocked = resolve;
    });
    let edit: Promise<unknown> = Promise.resolve();
    let publish: Promise<unknown> = Promise.resolve();

    try {
      edit = editExecutor(async () => {
        editLocked();
        await editMayCommit;
      }).editAuthorizedPublication(
        requestFor(fixture, "publication.edit"),
        fixture.tenant.id,
        publication.id,
        publicationEditInput(1, "edit-wins-before-publish"),
      );
      await Promise.race([
        editIsLocked,
        edit.then(() => {
          throw new Error("Publication edit completed before its gate opened.");
        }),
      ]);
      const editBackendPid = (await waitForPublicationLockHolder()).pid;

      publish = publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      );
      const publishWaiter = await waitForAuthorityLockWaiterBlockedByBackend(
        editBackendPid,
      );
      expect(publishWaiter.pid).not.toBe(editBackendPid);
      releaseEdit();

      await expect(edit).resolves.toMatchObject({
        outcome: "UPDATED",
        publication: { version: 2, lifecycle: "draft" },
      });
      await expect(publish).resolves.toEqual({
        outcome: "DENIED",
        code: "VERSION_CONFLICT",
      });
      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 2,
        lifecycle: "draft",
        title: "Edited publication edit-wins-before-publish",
      });
      await expect(
        auditRowsForPublication(fixture.tenant.id, publication.id),
      ).resolves.toHaveLength(0);
    } finally {
      releaseEdit();
      await Promise.allSettled([edit, publish]);
    }
  });

  it("PUBLISH-RACE-05 lets publish win before a stale audience replacement", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    let releasePublish: () => void = () => undefined;
    const publishMayCommit = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    let publishLocked: () => void = () => undefined;
    const publishIsLocked = new Promise<void>((resolve) => {
      publishLocked = resolve;
    });
    const replacement = {
      tenantId: fixture.tenant.id,
      publicationId: publication.id,
      mode: "entire_tenant" as const,
      groups: [],
    };
    let publish: Promise<unknown> = Promise.resolve();
    let audience: Promise<unknown> = Promise.resolve();

    try {
      publish = publishExecutor(async () => {
        publishLocked();
        await publishMayCommit;
      }).publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      );
      await Promise.race([
        publishIsLocked,
        publish.then(() => {
          throw new Error("Publication publish completed before its gate opened.");
        }),
      ]);
      const publishBackendPid = (await waitForPublicationLockHolder()).pid;

      audience = new DrizzlePublicationRepository(
        getDatabase(),
      ).replaceDraftPublicationAudienceForTenant(
        fixture.tenant.id,
        publication.id,
        1,
        replacement,
      );
      const audienceWaiter = await waitForPublicationLockWaiterBlockedByBackend(
        publishBackendPid,
      );
      expect(audienceWaiter.pid).not.toBe(publishBackendPid);
      releasePublish();

      await expect(publish).resolves.toMatchObject({
        outcome: "PUBLISHED",
        publication: { version: 2, lifecycle: "published" },
      });
      await expect(audience).resolves.toEqual({
        ok: false,
        error: "VERSION_CONFLICT",
      });
      await expect(
        auditRowsForPublication(fixture.tenant.id, publication.id),
      ).resolves.toHaveLength(1);
    } finally {
      releasePublish();
      await Promise.allSettled([publish, audience]);
    }
  });

  it("PUBLISH-RACE-06 lets audience replacement win before a stale publish", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "targeted",
    });
    const lockHolder = await beginClient();
    let holderCommitted = false;
    const replacement = {
      tenantId: fixture.tenant.id,
      publicationId: publication.id,
      mode: "entire_tenant" as const,
      groups: [],
    };
    let audience: Promise<unknown> = Promise.resolve();
    let publish: Promise<unknown> = Promise.resolve();

    try {
      const lockHolderBackendPid = await backendPid(lockHolder);
      await lockHolder.query(
        "select id from publications where tenant_id = $1 and id = $2 for update",
        [fixture.tenant.id, publication.id],
      );
      audience = new DrizzlePublicationRepository(
        getDatabase(),
      ).replaceDraftPublicationAudienceForTenant(
        fixture.tenant.id,
        publication.id,
        1,
        replacement,
      );
      const audienceWaiter = await waitForPublicationLockWaiterBlockedByBackend(
        lockHolderBackendPid,
      );

      publish = publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      );
      await waitForPublicationLockQueue(
        lockHolderBackendPid,
        audienceWaiter.pid,
      );
      await lockHolder.query("commit");
      holderCommitted = true;

      await expect(audience).resolves.toEqual({
        ok: true,
        definition: replacement,
        version: 2,
      });
      await expect(publish).resolves.toEqual({
        outcome: "DENIED",
        code: "VERSION_CONFLICT",
      });
      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 2,
        lifecycle: "draft",
        audienceMode: "entire_tenant",
      });
      await expect(
        auditRowsForPublication(fixture.tenant.id, publication.id),
      ).resolves.toHaveLength(0);
    } finally {
      if (!holderCommitted) {
        await lockHolder.query("rollback").catch(() => undefined);
      }
      lockHolder.release();
      await Promise.allSettled([audience, publish]);
    }
  });

  it("PUBLISH-AUTH-01 denies when the publish grant expires after the authority lock", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    await getDatabase()
      .update(tables.roleGrants)
      .set({ expiresAt: ONE_SECOND_AFTER_NOW })
      .where(eq(tables.roleGrants.id, fixture.publishGrant.id));

    const result = await publishExecutor(async () => {
      capabilityNow = TWO_SECONDS_AFTER_NOW;
    }).publishAuthorizedPublication(
      requestFor(fixture, "publication.publish"),
      fixture.tenant.id,
      publication.id,
      { expectedVersion: 1, confirmedRecipientCount: 1 },
    );

    expect(result).toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });
    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 1,
      lifecycle: "draft",
    });
  });

  it("PUBLISH-AUTH-02 denies after a committed revocation and preserves the draft", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    await getDatabase()
      .update(tables.roleGrants)
      .set({ revokedAt: NOW })
      .where(eq(tables.roleGrants.id, fixture.publishGrant.id));

    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });
    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 1,
      lifecycle: "draft",
    });
  });

  it("PUBLISH-AUTH-RACE-01 lets a committed revocation win before publish", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    const revocationClient = await beginClient();
    let revocationCommitted = false;
    let publish: Promise<unknown> = Promise.resolve();

    try {
      const revocationBackendPid = await backendPid(revocationClient);
      await revocationClient.query(
        "select id from tenants where id = $1 for update",
        [fixture.tenant.id],
      );
      await revocationClient.query(
        "select id from role_grants where id = $1 for update",
        [fixture.publishGrant.id],
      );
      await revocationClient.query(
        "update role_grants set revoked_at = $2 where id = $1",
        [fixture.publishGrant.id, NOW],
      );

      publish = publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      );
      await waitForAuthorityLockWaiterBlockedByBackend(revocationBackendPid);
      await revocationClient.query("commit");
      revocationCommitted = true;

      await expect(publish).resolves.toEqual({
        outcome: "DENIED",
        code: "PERMISSION_DENIED",
      });
      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 1,
        lifecycle: "draft",
      });
      await expect(
        auditRowsForPublication(fixture.tenant.id, publication.id),
      ).resolves.toHaveLength(0);
    } finally {
      if (!revocationCommitted) {
        await revocationClient.query("rollback").catch(() => undefined);
      }
      revocationClient.release();
      await Promise.allSettled([publish]);
    }
  });

  it("PUBLISH-AUTH-RACE-02 lets publish win before a queued revocation", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    let releasePublish: () => void = () => undefined;
    const publishMayCommit = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    let publishLocked: () => void = () => undefined;
    const publishIsLocked = new Promise<void>((resolve) => {
      publishLocked = resolve;
    });
    const revocationClient = await beginClient();
    let revocationCommitted = false;
    let publish: Promise<unknown> = Promise.resolve();
    let revocation: Promise<unknown> = Promise.resolve();

    try {
      publish = publishExecutor(async () => {
        publishLocked();
        await publishMayCommit;
      }).publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      );
      await Promise.race([
        publishIsLocked,
        publish.then(() => {
          throw new Error("Publication publish completed before its gate opened.");
        }),
      ]);
      const publishBackendPid = (await waitForPublicationLockHolder()).pid;

      revocation = (async () => {
        await revocationClient.query(
          "select id from tenants where id = $1 for update",
          [fixture.tenant.id],
        );
        await revocationClient.query(
          "update role_grants set revoked_at = $2 where id = $1",
          [fixture.publishGrant.id, NOW],
        );
        await revocationClient.query("commit");
        revocationCommitted = true;
      })();
      await waitForAuthorityLockWaiterBlockedByBackend(publishBackendPid);
      releasePublish();

      await expect(publish).resolves.toMatchObject({
        outcome: "PUBLISHED",
        publication: { version: 2, lifecycle: "published" },
      });
      await expect(revocation).resolves.toBeUndefined();
      await expect(
        auditRowsForPublication(fixture.tenant.id, publication.id),
      ).resolves.toHaveLength(1);
      await expect(
        getDatabase()
          .select({ revokedAt: tables.roleGrants.revokedAt })
          .from(tables.roleGrants)
          .where(eq(tables.roleGrants.id, fixture.publishGrant.id)),
      ).resolves.toMatchObject([{ revokedAt: NOW }]);
    } finally {
      releasePublish();
      if (!revocationCommitted) {
        await revocationClient.query("rollback").catch(() => undefined);
      }
      revocationClient.release();
      await Promise.allSettled([publish, revocation]);
    }
  });

  it("PUBLISH-TENANT-01 normalizes a foreign Publication to NOT_FOUND", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();
    const foreignPublication = await createDraftPublication(fixtureB.tenant.id, {
      audienceMode: "entire_tenant",
    });

    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixtureA, "publication.publish"),
        fixtureA.tenant.id,
        foreignPublication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "NOT_FOUND" });
    await expect(publicationRow(foreignPublication.id)).resolves.toMatchObject({
      tenantId: fixtureB.tenant.id,
      version: 1,
      lifecycle: "draft",
    });
  });

  it("PUBLISH-ROLLBACK-01 rolls back a post-mutation failure", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    let failureHookCalled = false;

    await expect(
      publishExecutor(undefined, async () => {
        failureHookCalled = true;
        throw new Error("simulated post-mutation failure");
      }).publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERSISTENCE_FAILED" });

    expect(failureHookCalled).toBe(true);
    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 1,
      lifecycle: "draft",
      publishAt: null,
    });
  });

  it("PUBLISH-ROLLBACK-02 rolls back the Publication when audit append fails", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    const failingAuditWriter: PublicationPublishAuditWriter = {
      appendPublicationPublishedInTransaction: async () => {
        throw new Error("simulated audit append failure");
      },
    };

    await expect(
      publishExecutor(undefined, undefined, failingAuditWriter).publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERSISTENCE_FAILED" });
    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 1,
      lifecycle: "draft",
      publishAt: null,
    });
    await expect(auditRowsForPublication(fixture.tenant.id, publication.id)).resolves.toHaveLength(0);
  });

  it("A6-AUDIT-01 rejects UPDATE, DELETE, and TRUNCATE while retaining the event", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toMatchObject({ outcome: "PUBLISHED" });
    const auditRows = await auditRowsForPublication(
      fixture.tenant.id,
      publication.id,
    );
    const auditRow = auditRows[0];
    if (auditRow === undefined) {
      throw new Error("Expected an audit row for append-only testing.");
    }

    const updateError = await getDatabase()
      .update(tables.auditEvents)
      .set({ currentHash: auditRow.currentHash })
      .where(eq(tables.auditEvents.id, auditRow.id))
      .then(() => null)
      .catch((error: unknown) => error);
    expect(postgresCode(updateError)).toBe("42501");

    const deleteError = await getDatabase()
      .delete(tables.auditEvents)
      .where(eq(tables.auditEvents.id, auditRow.id))
      .then(() => null)
      .catch((error: unknown) => error);
    expect(postgresCode(deleteError)).toBe("42501");

    const truncateClient = await beginClient();
    let truncateError: unknown = null;
    try {
      await truncateClient.query("TRUNCATE TABLE \"audit_events\"");
    } catch (error) {
      truncateError = error;
    } finally {
      await truncateClient.query("ROLLBACK").catch(() => undefined);
      truncateClient.release();
    }
    expect(postgresCode(truncateError)).toBe("42501");
    await expect(
      auditRowsForPublication(fixture.tenant.id, publication.id),
    ).resolves.toHaveLength(1);
  });

  it("A6-AUDIT-02 keeps the runtime table privilege boundary separate from the owner", async () => {
    const result = await getDatabase().execute(sql`
      select
        pg_get_userbyid(c.relowner) as owner,
        has_table_privilege('campushub_runtime', 'public.audit_events', 'SELECT') as can_select,
        has_table_privilege('campushub_runtime', 'public.audit_events', 'INSERT') as can_insert,
        has_table_privilege('campushub_runtime', 'public.audit_events', 'UPDATE') as can_update,
        has_table_privilege('campushub_runtime', 'public.audit_events', 'DELETE') as can_delete,
        has_table_privilege('campushub_runtime', 'public.audit_events', 'TRUNCATE') as can_truncate,
        has_table_privilege('campushub_runtime', 'public.audit_events', 'REFERENCES') as can_reference,
        has_table_privilege('campushub_runtime', 'public.audit_events', 'TRIGGER') as can_trigger,
        has_schema_privilege('campushub_runtime', 'public', 'CREATE') as can_create_schema
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'audit_events'
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    expect(row).toMatchObject({
      owner: "campushub_audit_owner",
      can_select: true,
      can_insert: true,
      can_update: false,
      can_delete: false,
      can_truncate: false,
      can_reference: false,
      can_trigger: false,
      can_create_schema: false,
    });
  });

  it("A6-AUDIT-03 retains the audit event after Publication removal", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toMatchObject({ outcome: "PUBLISHED" });
    await getDatabase()
      .delete(tables.publications)
      .where(
        and(
          eq(tables.publications.tenantId, fixture.tenant.id),
          eq(tables.publications.id, publication.id),
        ),
      );
    await expect(
      auditRowsForPublication(fixture.tenant.id, publication.id),
    ).resolves.toHaveLength(1);
  });

  it("A6-AUDIT-04 rejects a structurally valid persisted row with a bad HMAC", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id, {
      audienceMode: "entire_tenant",
    });
    await expect(
      publishExecutor().publishAuthorizedPublication(
        requestFor(fixture, "publication.publish"),
        fixture.tenant.id,
        publication.id,
        { expectedVersion: 1, confirmedRecipientCount: 1 },
      ),
    ).resolves.toMatchObject({ outcome: "PUBLISHED" });

    const validRows = await auditRowsForPublication(
      fixture.tenant.id,
      publication.id,
    );
    const validRow = validRows[0];
    if (validRow === undefined) {
      throw new Error("Expected the valid audit row before bad-HMAC insertion.");
    }

    await getDatabase().insert(tables.auditEvents).values({
      id: randomUUID(),
      tenantId: fixture.tenant.id,
      sequence: 2,
      eventType: "publication.published",
      actorMembershipId: fixture.membership.id,
      resourceType: "publication",
      resourceId: publication.id,
      resourceVersion: 2,
      occurredAt: new Date(NOW.getTime() + 1000),
      eventFacts: validRow.eventFacts,
      previousHash: validRow.currentHash,
      currentHash: "f".repeat(64),
      keyVersion: 1,
      integrityFormatVersion: 1,
      eventContractVersion: 1,
    });

    const auditRepository = new DrizzleAuditEventRepository({
      database: getDatabase(),
      keyProvider: new StaticAuditIntegrityKeyProvider(
        1,
        new Map([[1, integrationAuditKey]]),
      ),
    });
    await expect(
      auditRepository.verifyAuditChainForTenant(fixture.tenant.id),
    ).resolves.toBe(false);
  });

  it("A6-AUDIT-04b records PostgreSQL role-cycle rejection for recursive closure", async () => {
    const adminPool = getPool();
    const firstRoleName = `campushub_cycle_test_${randomUUID().replaceAll(
      "-",
      "",
    )}`;
    const secondRoleName = `campushub_cycle_test_${randomUUID().replaceAll(
      "-",
      "",
    )}`;
    const quotedFirstRole = `"${firstRoleName}"`;
    const quotedSecondRole = `"${secondRoleName}"`;
    let firstMembershipCreated = false;
    let cycleMembershipCreated = false;
    await adminPool.query(`create role ${quotedFirstRole} nologin`);
    await adminPool.query(`create role ${quotedSecondRole} nologin`);
    try {
      await adminPool.query(
        `grant ${quotedSecondRole} to ${quotedFirstRole} with admin true`,
      );
      firstMembershipCreated = true;
      try {
        await adminPool.query(
          `grant ${quotedFirstRole} to ${quotedSecondRole} with admin true`,
        );
        cycleMembershipCreated = true;
      } catch {
        cycleMembershipCreated = false;
      }
      expect(cycleMembershipCreated).toBe(false);
    } finally {
      if (cycleMembershipCreated) {
        await adminPool
          .query(`revoke ${quotedFirstRole} from ${quotedSecondRole}`)
          .catch(() => undefined);
      }
      if (firstMembershipCreated) {
        await adminPool
          .query(`revoke ${quotedSecondRole} from ${quotedFirstRole}`)
          .catch(() => undefined);
      }
      await adminPool.query(`drop role ${quotedFirstRole}`);
      await adminPool.query(`drop role ${quotedSecondRole}`);
    }
  });

  it("A6-AUDIT-05 accepts only a restricted runtime login and rejects privileged principals", async () => {
    const fixture = await createFixture();
    const restricted = await createRestrictedRuntimeDatabase();
    let ownerMember: RestrictedRuntimeDatabase | undefined;
    let dangerousUpdateMember: RestrictedRuntimeDatabase | undefined;
    let dangerousSchemaMember: RestrictedRuntimeDatabase | undefined;
    const transitiveMembers: RestrictedRuntimeDatabase[] = [];
    const expectAdminPathDenied = async (
      runtime: RestrictedRuntimeDatabase,
      targetRoleName: string,
    ): Promise<void> => {
      const reachability = await runtime.pool.query<{
        settable: boolean;
        usable: boolean;
      }>(
        `
          select
            pg_has_role(session_user::name, $1::name, 'SET') as settable,
            pg_has_role(session_user::name, $1::name, 'USAGE') as usable
        `,
        [targetRoleName],
      );
      expect(reachability.rows[0]).toEqual({
        settable: false,
        usable: false,
      });
      const authorizer = await authorizerForDatabase(runtime.database);
      const publishExecutor = strictPublishExecutorFor(
        runtime.database,
        authorizer,
      );
      const publication = await createDraftPublication(fixture.tenant.id, {
        audienceMode: "entire_tenant",
      });
      await expect(
        publishExecutor.publishAuthorizedPublication(
          requestFor(fixture, "publication.publish"),
          fixture.tenant.id,
          publication.id,
          { expectedVersion: 1, confirmedRecipientCount: 1 },
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "PERSISTENCE_FAILED" });
      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 1,
        lifecycle: "draft",
        publishAt: null,
      });
      await expect(
        auditRowsForPublication(fixture.tenant.id, publication.id),
      ).resolves.toHaveLength(0);
    };
    try {
      const restrictedAuthorizer = await authorizerForDatabase(
        restricted.database,
      );
      const restrictedExecutor = strictPublishExecutorFor(
        restricted.database,
        restrictedAuthorizer,
      );
      const restrictedPublication = await createDraftPublication(
        fixture.tenant.id,
        { audienceMode: "entire_tenant" },
      );

      await expect(
        restrictedExecutor.publishAuthorizedPublication(
          requestFor(fixture, "publication.publish"),
          fixture.tenant.id,
          restrictedPublication.id,
          { expectedVersion: 1, confirmedRecipientCount: 1 },
        ),
      ).resolves.toMatchObject({
        outcome: "PUBLISHED",
        publication: { version: 2, lifecycle: "published" },
      });
      await expect(
        auditRowsForPublication(fixture.tenant.id, restrictedPublication.id),
      ).resolves.toHaveLength(1);

      const auditRow = (
        await auditRowsForPublication(fixture.tenant.id, restrictedPublication.id)
      )[0];
      if (auditRow === undefined) {
        throw new Error("Expected the restricted runtime audit row.");
      }

      await expect(
        restricted.pool.query(
          'update "audit_events" set "current_hash" = $1 where "id" = $2',
          [auditRow.currentHash, auditRow.id],
        ),
      ).rejects.toBeTruthy();
      await expect(
        restricted.pool.query('delete from "audit_events" where "id" = $1', [
          auditRow.id,
        ]),
      ).rejects.toBeTruthy();
      await expect(
        restricted.pool.query('truncate table "audit_events"'),
      ).rejects.toBeTruthy();

      const adminPublication = await createDraftPublication(fixture.tenant.id, {
        audienceMode: "entire_tenant",
      });
      const adminExecutor = strictPublishExecutorFor(
        getDatabase(),
        capabilityAuthorizer,
      );
      await expect(
        adminExecutor.publishAuthorizedPublication(
          requestFor(fixture, "publication.publish"),
          fixture.tenant.id,
          adminPublication.id,
          { expectedVersion: 1, confirmedRecipientCount: 1 },
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "PERSISTENCE_FAILED" });
      await expect(publicationRow(adminPublication.id)).resolves.toMatchObject({
        version: 1,
        lifecycle: "draft",
        publishAt: null,
      });

      ownerMember = await createRestrictedRuntimeDatabase({
        auditOwnerMembership: "admin_only",
      });
      const ownerMembership = await ownerMember.pool.query<{
        settable: boolean;
        adminOption: boolean;
      }>(
        `
          select
            pg_has_role(current_user, 'campushub_audit_owner', 'SET') as settable,
            exists (
              select 1
              from pg_auth_members as membership
              join pg_roles as member_role
                on member_role.oid = membership.member
              join pg_roles as target_role
                on target_role.oid = membership.roleid
              where member_role.rolname = current_user
                and target_role.rolname = 'campushub_audit_owner'
                and membership.admin_option
            ) as "adminOption"
        `,
      );
      expect(ownerMembership.rows[0]).toEqual({
        settable: false,
        adminOption: true,
      });
      const ownerAuthorizer = await authorizerForDatabase(ownerMember.database);
      const ownerExecutor = strictPublishExecutorFor(
        ownerMember.database,
        ownerAuthorizer,
      );
      const ownerPublication = await createDraftPublication(fixture.tenant.id, {
        audienceMode: "entire_tenant",
      });
      await expect(
        ownerExecutor.publishAuthorizedPublication(
          requestFor(fixture, "publication.publish"),
          fixture.tenant.id,
          ownerPublication.id,
          { expectedVersion: 1, confirmedRecipientCount: 1 },
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "PERSISTENCE_FAILED" });
      await expect(publicationRow(ownerPublication.id)).resolves.toMatchObject({
        version: 1,
        lifecycle: "draft",
        publishAt: null,
      });

      dangerousUpdateMember = await createRestrictedRuntimeDatabase({
        dangerousPrivileges: ["audit_update"],
        dangerousMembership: "admin_only",
      });
      const dangerousUpdateRole = dangerousUpdateMember.auxiliaryRoleNames[0];
      if (dangerousUpdateRole === undefined) {
        throw new Error("Expected the dangerous audit-update role.");
      }
      const dangerousUpdateMembership = await dangerousUpdateMember.pool.query<{
        settable: boolean;
        adminOption: boolean;
      }>(
        `
          select
            pg_has_role(current_user, $1::name, 'SET') as settable,
            exists (
              select 1
              from pg_auth_members as membership
              join pg_roles as member_role
                on member_role.oid = membership.member
              join pg_roles as target_role
                on target_role.oid = membership.roleid
              where member_role.rolname = current_user
                and target_role.rolname = $1
                and membership.admin_option
            ) as "adminOption"
        `,
        [dangerousUpdateRole],
      );
      expect(dangerousUpdateMembership.rows[0]).toEqual({
        settable: false,
        adminOption: true,
      });
      const dangerousUpdateAuthorizer = await authorizerForDatabase(
        dangerousUpdateMember.database,
      );
      const dangerousUpdateExecutor = strictPublishExecutorFor(
        dangerousUpdateMember.database,
        dangerousUpdateAuthorizer,
      );
      const dangerousUpdatePublication = await createDraftPublication(
        fixture.tenant.id,
        { audienceMode: "entire_tenant" },
      );
      await expect(
        dangerousUpdateExecutor.publishAuthorizedPublication(
          requestFor(fixture, "publication.publish"),
          fixture.tenant.id,
          dangerousUpdatePublication.id,
          { expectedVersion: 1, confirmedRecipientCount: 1 },
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "PERSISTENCE_FAILED" });
      await expect(
        publicationRow(dangerousUpdatePublication.id),
      ).resolves.toMatchObject({
        version: 1,
        lifecycle: "draft",
        publishAt: null,
      });

      dangerousSchemaMember = await createRestrictedRuntimeDatabase({
        dangerousPrivileges: ["schema_create"],
        dangerousMembership: "admin_only",
      });
      const dangerousSchemaRole = dangerousSchemaMember.auxiliaryRoleNames[0];
      if (dangerousSchemaRole === undefined) {
        throw new Error("Expected the dangerous schema-create role.");
      }
      const dangerousSchemaMembership = await dangerousSchemaMember.pool.query<{
        settable: boolean;
        adminOption: boolean;
      }>(
        `
          select
            pg_has_role(current_user, $1::name, 'SET') as settable,
            exists (
              select 1
              from pg_auth_members as membership
              join pg_roles as member_role
                on member_role.oid = membership.member
              join pg_roles as target_role
                on target_role.oid = membership.roleid
              where member_role.rolname = current_user
                and target_role.rolname = $1
                and membership.admin_option
            ) as "adminOption"
        `,
        [dangerousSchemaRole],
      );
      expect(dangerousSchemaMembership.rows[0]).toEqual({
        settable: false,
        adminOption: true,
      });
      const dangerousSchemaAuthorizer = await authorizerForDatabase(
        dangerousSchemaMember.database,
      );
      const dangerousSchemaExecutor = strictPublishExecutorFor(
        dangerousSchemaMember.database,
        dangerousSchemaAuthorizer,
      );
      const dangerousSchemaPublication = await createDraftPublication(
        fixture.tenant.id,
        { audienceMode: "entire_tenant" },
      );
      await expect(
        dangerousSchemaExecutor.publishAuthorizedPublication(
          requestFor(fixture, "publication.publish"),
          fixture.tenant.id,
          dangerousSchemaPublication.id,
          { expectedVersion: 1, confirmedRecipientCount: 1 },
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "PERSISTENCE_FAILED" });
      await expect(
        publicationRow(dangerousSchemaPublication.id),
      ).resolves.toMatchObject({
        version: 1,
        lifecycle: "draft",
        publishAt: null,
      });

      const twoHopUpdateMember = await createRestrictedRuntimeDatabase({
        adminPaths: [
          { bridgeCount: 1, seed: "admin", terminal: "audit_update" },
        ],
      });
      transitiveMembers.push(twoHopUpdateMember);
      const twoHopUpdateRole = twoHopUpdateMember.adminPathTargetNames[0];
      if (twoHopUpdateRole === undefined) {
        throw new Error("Expected the two-hop audit-update role.");
      }
      await expectAdminPathDenied(twoHopUpdateMember, twoHopUpdateRole);

      const threeHopOwnerMember = await createRestrictedRuntimeDatabase({
        adminPaths: [
          { bridgeCount: 2, seed: "admin", terminal: "audit_owner" },
        ],
      });
      transitiveMembers.push(threeHopOwnerMember);
      await expectAdminPathDenied(
        threeHopOwnerMember,
        "campushub_audit_owner",
      );

      const transitiveSchemaMember = await createRestrictedRuntimeDatabase({
        adminPaths: [
          { bridgeCount: 1, seed: "admin", terminal: "schema_create" },
        ],
      });
      transitiveMembers.push(transitiveSchemaMember);
      const transitiveSchemaRole =
        transitiveSchemaMember.adminPathTargetNames[0];
      if (transitiveSchemaRole === undefined) {
        throw new Error("Expected the transitive schema-create role.");
      }
      await expectAdminPathDenied(
        transitiveSchemaMember,
        transitiveSchemaRole,
      );

      const transitiveCreateRoleMember = await createRestrictedRuntimeDatabase({
        adminPaths: [
          { bridgeCount: 2, seed: "admin", terminal: "createrole" },
        ],
      });
      transitiveMembers.push(transitiveCreateRoleMember);
      const transitiveCreateRole =
        transitiveCreateRoleMember.adminPathTargetNames[0];
      if (transitiveCreateRole === undefined) {
        throw new Error("Expected the transitive CREATEROLE role.");
      }
      await expectAdminPathDenied(
        transitiveCreateRoleMember,
        transitiveCreateRole,
      );

      const mixedAuthorityMember = await createRestrictedRuntimeDatabase({
        adminPaths: [
          { bridgeCount: 1, seed: "set", terminal: "audit_update" },
        ],
      });
      transitiveMembers.push(mixedAuthorityMember);
      const mixedAuthorityRole = mixedAuthorityMember.adminPathTargetNames[0];
      if (mixedAuthorityRole === undefined) {
        throw new Error("Expected the mixed-authority audit-update role.");
      }
      await expectAdminPathDenied(mixedAuthorityMember, mixedAuthorityRole);

      const benignAdminMember = await createRestrictedRuntimeDatabase({
        adminPaths: [
          { bridgeCount: 2, seed: "admin", terminal: "benign" },
        ],
      });
      transitiveMembers.push(benignAdminMember);
      const benignAuthorizer = await authorizerForDatabase(
        benignAdminMember.database,
      );
      const benignExecutor = strictPublishExecutorFor(
        benignAdminMember.database,
        benignAuthorizer,
      );
      const benignPublication = await createDraftPublication(
        fixture.tenant.id,
        { audienceMode: "entire_tenant" },
      );
      await expect(
        benignExecutor.publishAuthorizedPublication(
          requestFor(fixture, "publication.publish"),
          fixture.tenant.id,
          benignPublication.id,
          { expectedVersion: 1, confirmedRecipientCount: 1 },
        ),
      ).resolves.toMatchObject({
        outcome: "PUBLISHED",
        publication: { version: 2, lifecycle: "published" },
      });
      await expect(
        auditRowsForPublication(fixture.tenant.id, benignPublication.id),
      ).resolves.toHaveLength(1);
    } finally {
      for (const transitiveMember of [...transitiveMembers].reverse()) {
        await destroyRestrictedRuntimeDatabase(transitiveMember);
      }
      if (dangerousSchemaMember !== undefined) {
        await destroyRestrictedRuntimeDatabase(dangerousSchemaMember);
      }
      if (dangerousUpdateMember !== undefined) {
        await destroyRestrictedRuntimeDatabase(dangerousUpdateMember);
      }
      if (ownerMember !== undefined) {
        await destroyRestrictedRuntimeDatabase(ownerMember);
      }
      await destroyRestrictedRuntimeDatabase(restricted);
    }
  });

  it("AUTH-RACE-01 revocation wins and commits no Publication", async () => {
    const fixture = await createFixture();
    const request = requestFor(fixture);
    await expect(capabilityAuthorizer.authorize(request)).resolves.toEqual({
      allowed: true,
    });

    const revocationClient = await beginClient();
    let revocationCommitted = false;
    let mutation: Promise<unknown> = Promise.resolve();
    try {
      await revocationClient.query(
        `select id from tenants where id = $1 for update`,
        [fixture.tenant.id],
      );
      await revocationClient.query(
        `select id from role_grants where id = $1 for update`,
        [fixture.grant.id],
      );
      await revocationClient.query(
        `update role_grants set revoked_at = $2 where id = $1`,
        [fixture.grant.id, NOW],
      );

      mutation = executor().createAuthorizedPublication(
        request,
        fixture.tenant.id,
        publicationInput("revocation-wins"),
      );
      await revocationClient.query("commit");
      revocationCommitted = true;
      await expect(mutation).resolves.toEqual({
        outcome: "DENIED",
        code: "PERMISSION_DENIED",
      });
    } finally {
      if (!revocationCommitted) {
        await revocationClient.query("rollback").catch(() => undefined);
      }
      revocationClient.release();
      await Promise.allSettled([mutation]);
    }

    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(0);
  });

  it("AUTH-RACE-02 create wins and revocation commits afterward", async () => {
    const fixture = await createFixture();
    const request = requestFor(fixture);
    let releaseInsert: () => void = () => undefined;
    const insertMayProceed = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    let authorityLocked: () => void = () => undefined;
    const authorityIsLocked = new Promise<void>((resolve) => {
      authorityLocked = resolve;
    });

    let mutation: Promise<unknown> = Promise.resolve();
    let revocation: Promise<unknown> = Promise.resolve();
    let revocationClient: PoolClient | undefined;
    let revocationCommitted = false;
    try {
      mutation = executor(async () => {
        authorityLocked();
        await insertMayProceed;
      }).createAuthorizedPublication(
        request,
        fixture.tenant.id,
        publicationInput("create-wins"),
      );
      await Promise.race([
        authorityIsLocked,
        mutation.then(() => {
          throw new Error("Publication creation completed before its gate opened.");
        }),
      ]);

      revocationClient = await beginClient();
      revocation = revocationClient.query(
        `update role_grants set revoked_at = $2 where id = $1`,
        [fixture.grant.id, NOW],
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseInsert();

      await expect(mutation).resolves.toMatchObject({ outcome: "CREATED" });
      await revocation;
      await revocationClient.query("commit");
      revocationCommitted = true;
    } finally {
      releaseInsert();
      await Promise.allSettled([mutation, revocation]);
      if (revocationClient !== undefined) {
        if (!revocationCommitted) {
          await revocationClient.query("rollback").catch(() => undefined);
        }
        revocationClient.release();
      }
    }

    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(1);
    const revoked = await getDatabase()
      .select({ revokedAt: tables.roleGrants.revokedAt })
      .from(tables.roleGrants)
      .where(eq(tables.roleGrants.id, fixture.grant.id));
    expect(revoked[0]?.revokedAt).toEqual(NOW);

    await expect(
      executor().createAuthorizedPublication(
        request,
        fixture.tenant.id,
        publicationInput("post-revocation"),
      ),
    ).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(1);
  });

  it("AUTH-RACE-03 denies when term closure commits before authority lock", async () => {
    const fixture = await createFixture();
    const request = requestFor(fixture);
    const closureClient = await beginClient();
    let closureCommitted = false;
    let mutation: Promise<unknown> = Promise.resolve();
    try {
      await closureClient.query(
        `select id from tenants where id = $1 for update`,
        [fixture.tenant.id],
      );
      await closureClient.query(
        `select id from guild_terms where id = $1 for update`,
        [fixture.term.id],
      );
      await closureClient.query(
        `update guild_terms set status = 'closed' where id = $1`,
        [fixture.term.id],
      );
      mutation = executor().createAuthorizedPublication(
        request,
        fixture.tenant.id,
        publicationInput("term-closure"),
      );
      await closureClient.query("commit");
      closureCommitted = true;
      await expect(mutation).resolves.toEqual({
        outcome: "DENIED",
        code: "PERMISSION_DENIED",
      });
    } finally {
      if (!closureCommitted) {
        await closureClient.query("rollback").catch(() => undefined);
      }
      closureClient.release();
      await Promise.allSettled([mutation]);
    }
    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(0);
  });

  it("AUTH-TIME-01 denies when a grant expires after locks but before the final check", async () => {
    const fixture = await createFixture();
    await getDatabase()
      .update(tables.roleGrants)
      .set({ expiresAt: ONE_SECOND_AFTER_NOW })
      .where(eq(tables.roleGrants.id, fixture.grant.id));

    let authorityWasLockedAt: Date | undefined;
    const result = await executor(async () => {
      authorityWasLockedAt = capabilityNow;
      capabilityNow = TWO_SECONDS_AFTER_NOW;
    }).createAuthorizedPublication(
      requestFor(fixture),
      fixture.tenant.id,
      publicationInput("grant-expiry-freshness"),
    );

    expect(authorityWasLockedAt).toEqual(NOW);
    expect(capabilityNow).toEqual(TWO_SECONDS_AFTER_NOW);
    expect(result).toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(0);
  });

  it("denies natural Guild Term expiry without a status update", async () => {
    const fixture = await createFixture();
    await getDatabase()
      .update(tables.guildTerms)
      .set({ endsAt: ONE_SECOND_AFTER_NOW })
      .where(eq(tables.guildTerms.id, fixture.term.id));
    await getDatabase()
      .update(tables.roleGrants)
      .set({ expiresAt: ONE_SECOND_AFTER_NOW })
      .where(eq(tables.roleGrants.id, fixture.grant.id));

    let authorityWasLockedAt: Date | undefined;
    const result = await executor(async () => {
      authorityWasLockedAt = capabilityNow;
      capabilityNow = TWO_SECONDS_AFTER_NOW;
    }).createAuthorizedPublication(
      requestFor(fixture),
      fixture.tenant.id,
      publicationInput("term-expiry-freshness"),
    );

    expect(authorityWasLockedAt).toEqual(NOW);
    expect(result).toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    const termAfter = await getDatabase()
      .select({ status: tables.guildTerms.status, endsAt: tables.guildTerms.endsAt })
      .from(tables.guildTerms)
      .where(eq(tables.guildTerms.id, fixture.term.id));
    expect(termAfter[0]).toEqual({
      status: "active",
      endsAt: ONE_SECOND_AFTER_NOW,
    });
    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(0);
  });

  it("DRAFT-01 through DRAFT-03 create only canonical draft defaults", async () => {
    const fixture = await createFixture();
    const result = await executor().createAuthorizedPublication(
      requestFor(fixture),
      fixture.tenant.id,
      publicationInput("draft-defaults"),
    );

    expect(result).toMatchObject({
      outcome: "CREATED",
      publication: {
        tenantId: fixture.tenant.id,
        version: 1,
        priority: "standard",
        visibility: "MEMBERS",
        lifecycle: "draft",
        publishAt: null,
        expiresAt: null,
      },
    });
    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(1);
  });

  it("DRAFT-04 through DRAFT-06 persist supported metadata without publishing", async () => {
    const fixture = await createFixture();
    const expiresAt = new Date("2026-11-01T00:00:00.000Z");
    const result = await executor().createAuthorizedPublication(
      requestFor(fixture),
      fixture.tenant.id,
      {
        ...publicationInput("draft-metadata"),
        priority: "priority",
        visibility: "PUBLIC",
        expiresAt,
      },
    );

    expect(result).toMatchObject({
      outcome: "CREATED",
      publication: {
        priority: "priority",
        visibility: "PUBLIC",
        lifecycle: "draft",
        publishAt: null,
        expiresAt,
      },
    });
    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(1);
  });

  it("EDIT-01 and EDIT-AUTH-01 update only with a valid edit grant", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id);
    await getDatabase().insert(tables.publicationAudienceCriteria).values({
      tenantId: fixture.tenant.id,
      publicationId: publication.id,
      dimension: "academic_year",
      provenancePolicy: "authoritative_only",
      academicYear: 2026,
    });

    const input = publicationEditInput(1, "metadata");
    await expect(
      editExecutor().editAuthorizedPublication(
        requestFor(fixture, "publication.edit"),
        fixture.tenant.id,
        publication.id,
        input,
      ),
    ).resolves.toMatchObject({
      outcome: "UPDATED",
      publication: {
        id: publication.id,
        tenantId: fixture.tenant.id,
        version: 2,
        title: input.title,
        body: input.body,
        priority: input.priority,
        visibility: input.visibility,
        lifecycle: "draft",
        publishAt: null,
        audienceMode: "targeted",
      },
    });

    const current = await publicationRow(publication.id);
    expect(current).toMatchObject({
      version: 2,
      audienceMode: "targeted",
      title: input.title,
      body: input.body,
    });
    const criteria = await getDatabase()
      .select()
      .from(tables.publicationAudienceCriteria)
      .where(eq(tables.publicationAudienceCriteria.publicationId, publication.id));
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.academicYear).toBe(2026);
  });

  it("EDIT-02, EDIT-03, and EDIT-AUTH-08 normalize missing/foreign edits to NOT_FOUND", async () => {
    const fixtureA = await createFixture();
    const fixtureB = await createFixture();
    const foreignPublication = await createDraftPublication(fixtureB.tenant.id);
    const request = requestFor(fixtureA, "publication.edit");

    await expect(
      editExecutor().editAuthorizedPublication(
        request,
        fixtureA.tenant.id,
        randomUUID(),
        publicationEditInput(1, "missing"),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "NOT_FOUND" });
    await expect(
      editExecutor().editAuthorizedPublication(
        request,
        fixtureA.tenant.id,
        foreignPublication.id,
        publicationEditInput(1, "foreign"),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "NOT_FOUND" });
    await expect(publicationRow(foreignPublication.id)).resolves.toMatchObject({
      version: 1,
      title: foreignPublication.title,
    });
  });

  it("EDIT-04 rejects a stale version without changing the current fields", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id);
    const request = requestFor(fixture, "publication.edit");
    const first = publicationEditInput(1, "first");
    const stale = publicationEditInput(1, "stale");

    await expect(
      editExecutor().editAuthorizedPublication(
        request,
        fixture.tenant.id,
        publication.id,
        first,
      ),
    ).resolves.toMatchObject({ outcome: "UPDATED", publication: { version: 2 } });
    await expect(
      editExecutor().editAuthorizedPublication(
        request,
        fixture.tenant.id,
        publication.id,
        stale,
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "VERSION_CONFLICT" });
    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 2,
      title: first.title,
      body: first.body,
    });
  });

  it.each(["scheduled", "published", "expired", "archived"] as const)(
    "EDIT-05 through EDIT-07 reject %s Publications without changing them",
    async (lifecycle) => {
      const fixture = await createFixture();
      const publication = await createDraftPublication(fixture.tenant.id, {
        lifecycle,
      });
      await expect(
        editExecutor().editAuthorizedPublication(
          requestFor(fixture, "publication.edit"),
          fixture.tenant.id,
          publication.id,
          publicationEditInput(1, lifecycle),
        ),
      ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_STATE" });
      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 1,
        lifecycle,
        title: publication.title,
      });
    },
  );

  it("EDIT-AUTH-02 through EDIT-AUTH-06 require the current publication.edit grant", async () => {
    const revoked = await createFixture();
    const revokedPublication = await createDraftPublication(revoked.tenant.id);
    await getDatabase()
      .update(tables.roleGrants)
      .set({ revokedAt: NOW })
      .where(eq(tables.roleGrants.id, revoked.editGrant.id));
    await expect(
      editExecutor().editAuthorizedPublication(
        requestFor(revoked, "publication.edit"),
        revoked.tenant.id,
        revokedPublication.id,
        publicationEditInput(1, "revoked"),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });

    const expired = await createFixture();
    const expiredPublication = await createDraftPublication(expired.tenant.id);
    await getDatabase()
      .update(tables.roleGrants)
      .set({ expiresAt: new Date("2026-09-04T00:00:00.000Z") })
      .where(eq(tables.roleGrants.id, expired.editGrant.id));
    await expect(
      editExecutor().editAuthorizedPublication(
        requestFor(expired, "publication.edit"),
        expired.tenant.id,
        expiredPublication.id,
        publicationEditInput(1, "expired-grant"),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });

    const closed = await createFixture();
    const closedPublication = await createDraftPublication(closed.tenant.id);
    await getDatabase()
      .update(tables.guildTerms)
      .set({ status: "closed" })
      .where(eq(tables.guildTerms.id, closed.term.id));
    await expect(
      editExecutor().editAuthorizedPublication(
        requestFor(closed, "publication.edit"),
        closed.tenant.id,
        closedPublication.id,
        publicationEditInput(1, "closed-term"),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });

    const onlyCreate = await createFixture();
    const onlyCreatePublication = await createDraftPublication(onlyCreate.tenant.id);
    await getDatabase()
      .update(tables.roleGrants)
      .set({ revokedAt: NOW })
      .where(eq(tables.roleGrants.id, onlyCreate.editGrant.id));
    await expect(
      editExecutor().editAuthorizedPublication(
        requestFor(onlyCreate, "publication.edit"),
        onlyCreate.tenant.id,
        onlyCreatePublication.id,
        publicationEditInput(1, "create-only"),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });

    const onlyPublish = await createFixture();
    const onlyPublishPublication = await createDraftPublication(
      onlyPublish.tenant.id,
    );
    await getDatabase()
      .update(tables.roleGrants)
      .set({ revokedAt: NOW })
      .where(eq(tables.roleGrants.tenantId, onlyPublish.tenant.id));
    await getDatabase().insert(tables.roleGrants).values({
      tenantId: onlyPublish.tenant.id,
      guildTermId: onlyPublish.term.id,
      membershipId: onlyPublish.membership.id,
      role: "publisher",
      capability: "publication.publish",
      moduleScope: "publication",
      expiresAt: GRANT_END,
    });
    await expect(
      editExecutor().editAuthorizedPublication(
        requestFor(onlyPublish, "publication.edit"),
        onlyPublish.tenant.id,
        onlyPublishPublication.id,
        publicationEditInput(1, "publish-only"),
      ),
    ).resolves.toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });
  });

  it("EDIT-AUTH-07 denies natural term and grant expiry after the Publication lock", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id);
    await getDatabase()
      .update(tables.guildTerms)
      .set({ endsAt: ONE_SECOND_AFTER_NOW })
      .where(eq(tables.guildTerms.id, fixture.term.id));
    await getDatabase()
      .update(tables.roleGrants)
      .set({ expiresAt: ONE_SECOND_AFTER_NOW })
      .where(eq(tables.roleGrants.id, fixture.editGrant.id));

    let publicationWasLocked = false;
    const result = await editExecutor(async () => {
      publicationWasLocked = true;
      capabilityNow = TWO_SECONDS_AFTER_NOW;
    }).editAuthorizedPublication(
      requestFor(fixture, "publication.edit"),
      fixture.tenant.id,
      publication.id,
      publicationEditInput(1, "natural-expiry"),
    );
    expect(publicationWasLocked).toBe(true);
    expect(result).toEqual({ outcome: "DENIED", code: "PERMISSION_DENIED" });
    await expect(publicationRow(publication.id)).resolves.toMatchObject({
      version: 1,
    });
  });

  it("EDIT-RACE-01 lets one real PostgreSQL editor win and rejects the stale writer", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id);
    let releaseFirst: () => void = () => undefined;
    const firstMayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstLocked: () => void = () => undefined;
    const firstIsLocked = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();

    try {
      first = editExecutor(async () => {
        firstLocked();
        await firstMayCommit;
      }).editAuthorizedPublication(
        requestFor(fixture, "publication.edit"),
        fixture.tenant.id,
        publication.id,
        publicationEditInput(1, "editor-a"),
      );
      await Promise.race([
        firstIsLocked,
        first.then(() => {
          throw new Error("First publication edit completed before its gate opened.");
        }),
      ]);
      const firstEditorBackendPid = (await waitForPublicationLockHolder()).pid;
      second = editExecutor().editAuthorizedPublication(
        requestFor(fixture, "publication.edit"),
        fixture.tenant.id,
        publication.id,
        publicationEditInput(1, "editor-b"),
      );
      const secondEditor = await waitForAuthorityLockWaiterBlockedByBackend(
        firstEditorBackendPid,
      );
      expect(secondEditor.pid).not.toBe(firstEditorBackendPid);
      releaseFirst();

      await expect(first).resolves.toMatchObject({
        outcome: "UPDATED",
        publication: { version: 2, title: "Edited publication editor-a" },
      });
      await expect(second).resolves.toEqual({
        outcome: "DENIED",
        code: "VERSION_CONFLICT",
      });
      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 2,
        title: "Edited publication editor-a",
      });
    } finally {
      releaseFirst();
      await Promise.allSettled([first, second]);
    }
  });

  it("EDIT-RACE-02 shares one version stream with audience replacement", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id);
    let releaseEdit: () => void = () => undefined;
    const editMayCommit = new Promise<void>((resolve) => {
      releaseEdit = resolve;
    });
    let editLocked: () => void = () => undefined;
    const editIsLocked = new Promise<void>((resolve) => {
      editLocked = resolve;
    });

    let edit: Promise<unknown> = Promise.resolve();
    let audience: Promise<unknown> = Promise.resolve();

    try {
      edit = editExecutor(async () => {
        editLocked();
        await editMayCommit;
      }).editAuthorizedPublication(
        requestFor(fixture, "publication.edit"),
        fixture.tenant.id,
        publication.id,
        publicationEditInput(1, "metadata-wins"),
      );
      await Promise.race([
        editIsLocked,
        edit.then(() => {
          throw new Error("Publication edit completed before its gate opened.");
        }),
      ]);

      audience = new DrizzlePublicationRepository(
        getDatabase(),
      ).replaceDraftPublicationAudienceForTenant(
        fixture.tenant.id,
        publication.id,
        1,
        {
          tenantId: fixture.tenant.id,
          publicationId: publication.id,
          mode: "entire_tenant",
          groups: [],
        },
      );
      await waitForAnyPublicationLockWaiters();
      releaseEdit();

      await expect(edit).resolves.toMatchObject({
        outcome: "UPDATED",
        publication: { version: 2 },
      });
      await expect(audience).resolves.toEqual({
        ok: false,
        error: "VERSION_CONFLICT",
      });
      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 2,
        audienceMode: "targeted",
      });
    } finally {
      releaseEdit();
      await Promise.allSettled([edit, audience]);
    }
  });

  it("EDIT-RACE-03 lets audience replacement win before a stale publication edit", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id);
    const lockHolder = await beginClient();
    let holderCommitted = false;
    let audience: Promise<unknown> = Promise.resolve();
    let edit: Promise<unknown> = Promise.resolve();

    try {
      const lockHolderBackendPid = await backendPid(lockHolder);
      await lockHolder.query(
        "select id from publications where id = $1 for update",
        [publication.id],
      );

      audience = new DrizzlePublicationRepository(
        getDatabase(),
      ).replaceDraftPublicationAudienceForTenant(
        fixture.tenant.id,
        publication.id,
        1,
        {
          tenantId: fixture.tenant.id,
          publicationId: publication.id,
          mode: "entire_tenant",
          groups: [],
        },
      );
      const audienceWaiter =
        await waitForPublicationLockWaiterBlockedByBackend(
          lockHolderBackendPid,
        );

      edit = editExecutor().editAuthorizedPublication(
        requestFor(fixture, "publication.edit"),
        fixture.tenant.id,
        publication.id,
        publicationEditInput(1, "stale-after-audience"),
      );
      await waitForPublicationLockQueue(
        lockHolderBackendPid,
        audienceWaiter.pid,
      );

      await lockHolder.query("commit");
      holderCommitted = true;

      await expect(audience).resolves.toEqual({
        ok: true,
        definition: {
          tenantId: fixture.tenant.id,
          publicationId: publication.id,
          mode: "entire_tenant",
          groups: [],
        },
        version: 2,
      });
      await expect(edit).resolves.toEqual({
        outcome: "DENIED",
        code: "VERSION_CONFLICT",
      });
      await expect(publicationRow(publication.id)).resolves.toMatchObject({
        version: 2,
        audienceMode: "entire_tenant",
        title: publication.title,
      });
      await expect(
        getDatabase()
          .select()
          .from(tables.publicationAudienceCriteria)
          .where(
            eq(tables.publicationAudienceCriteria.publicationId, publication.id),
          ),
      ).resolves.toHaveLength(0);
    } finally {
      if (!holderCommitted) {
        await lockHolder.query("rollback").catch(() => undefined);
      }
      lockHolder.release();
      await Promise.allSettled([audience, edit]);
    }
  });

  it("rejects a stale preflight allow after the grant is revoked", async () => {
    const fixture = await createFixture();
    const preflightThenRevoke = {
      authorize: async (authorizationRequest: CapabilityRaceRequest) => {
        const decision = await capabilityAuthorizer.authorize(
          authorizationRequest,
        );
        if (decision.allowed) {
          await getDatabase()
            .update(tables.roleGrants)
            .set({ revokedAt: NOW })
            .where(eq(tables.roleGrants.id, fixture.grant.id));
        }
        return decision;
      },
    };
    const service = new CreatePublicationService({
      capabilityAuthorizer: preflightThenRevoke,
      authorizedPublicationCreate: executor(),
    });

    await expect(
      service.createPublication({
        trustedContext: {
          identitySubjectId: fixture.membership.identitySubjectId,
          tenantId: fixture.tenant.id,
          tenantStatus: fixture.tenant.status,
          membershipId: fixture.membership.id,
          assuranceLevel: fixture.membership.assuranceLevel,
          membershipStatus: fixture.membership.lifecycle,
        },
        requestedTenantId: fixture.tenant.id,
        publication: publicationInput("stale-preflight"),
      }),
    ).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(0);
  });

  it("selects a later valid historical grant after a revoked instance", async () => {
    const fixture = await createFixture();
    await getDatabase()
      .update(tables.roleGrants)
      .set({ revokedAt: NOW })
      .where(eq(tables.roleGrants.id, fixture.grant.id));
    const replacementRows = await getDatabase()
      .insert(tables.roleGrants)
      .values({
        tenantId: fixture.tenant.id,
        guildTermId: fixture.term.id,
        membershipId: fixture.membership.id,
        role: "publisher",
        capability: "publication.create",
        moduleScope: "publication",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        expiresAt: GRANT_END,
      })
      .returning();
    expect(replacementRows).toHaveLength(1);

    await expect(
      capabilityAuthorizer.authorize(requestFor(fixture)),
    ).resolves.toEqual({ allowed: true });
    await expect(
      executor().createAuthorizedPublication(
        requestFor(fixture),
        fixture.tenant.id,
        publicationInput("historical-valid"),
      ),
    ).resolves.toMatchObject({ outcome: "CREATED" });
  });

  it("fails closed for a grant that expires after its Guild Term", async () => {
    const fixture = await createFixture();
    await getDatabase()
      .update(tables.roleGrants)
      .set({ expiresAt: new Date("2027-01-01T00:00:00.000Z") })
      .where(eq(tables.roleGrants.id, fixture.grant.id));

    await expect(
      capabilityAuthorizer.authorize(requestFor(fixture)),
    ).resolves.toEqual({ allowed: false });
    await expect(
      executor().createAuthorizedPublication(
        requestFor(fixture),
        fixture.tenant.id,
        publicationInput("term-bound"),
      ),
    ).resolves.toEqual({
      outcome: "DENIED",
      code: "PERMISSION_DENIED",
    });
  });

  it("keeps historical grant rows Tenant-bound", async () => {
    const fixture = await createFixture();
    const otherRows = await getDatabase()
      .insert(tables.tenants)
      .values({
        slug: nextSlug("other-tenant"),
        displayName: "Other capability race Tenant",
        status: "active",
        timezone: "Africa/Kampala",
      })
      .returning();
    const otherTenant = otherRows[0];
    if (otherTenant === undefined) {
      throw new Error("Other Tenant fixture insert returned no row.");
    }
    syntheticTenantIds.add(otherTenant.id);

    let caught: unknown;
    try {
      await getDatabase()
        .insert(tables.roleGrants)
        .values({
          tenantId: otherTenant.id,
          guildTermId: fixture.term.id,
          membershipId: fixture.membership.id,
          role: "publisher",
          capability: "publication.create",
          moduleScope: "publication",
          expiresAt: GRANT_END,
        });
    } catch (error) {
      caught = error;
    }
    expect(postgresCode(caught)).toBe("23503");
  });
});
