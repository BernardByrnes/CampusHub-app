import { randomUUID } from "node:crypto";
import { loadEnvConfig } from "@next/env";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";

import type * as schema from "@/server/db/schema";
import type { CampusHubDatabase } from "@/server/db/client";
import type { PostgresCapabilityAuthorizer } from "@/server/authorization/postgres-capability-authorizer";
import type { PostgresAuthorizedPublicationCreateExecutor } from "@/server/authorization/postgres-authorized-publication-create";
import type { PostgresAuthorizedPublicationDraftEditExecutor } from "@/server/authorization/postgres-authorized-publication-draft-edit";
import type { CanonicalPublicationDraftInput } from "@/domain/content/publication-draft";
import type { UpdatePublicationDraftInput } from "@/domain/content/publication-draft-edit";

const NOW = new Date("2026-09-05T12:00:00.000Z");
const TERM_START = new Date("2026-01-01T00:00:00.000Z");
const TERM_END = new Date("2026-12-31T23:59:59.000Z");
const GRANT_END = new Date("2026-12-01T00:00:00.000Z");
const ONE_SECOND_AFTER_NOW = new Date("2026-09-05T12:00:01.000Z");
const TWO_SECONDS_AFTER_NOW = new Date("2026-09-05T12:00:02.000Z");

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
let DrizzlePublicationRepository: typeof import("@/server/repositories/publication-repository").DrizzlePublicationRepository;
let CreatePublicationService: typeof import("@/application/content/create-publication").CreatePublicationService;
const syntheticTenantIds = new Set<string>();
let sequence = 0;

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

  return { tenant, membership, term, grant, editGrant };
}

function requestFor(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  capability: "publication.create" | "publication.edit" = "publication.create",
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

async function waitForLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await getDatabase().execute(sql`
      select 1
      from pg_stat_activity
      where pid <> pg_backend_pid()
        and state = 'active'
        and wait_event_type = 'Lock'
        and query ilike '%for update%'
      limit 1
    `);
    if (result.rows.length > 0) {
      return;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for the edit lock request.");
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
  DrizzlePublicationRepository =
    publicationRepositoryModule.DrizzlePublicationRepository;
  CreatePublicationService = createPublicationModule.CreatePublicationService;

  await getDatabase().execute(sql`select 1`);
});

afterAll(async () => {
  if (database !== undefined && syntheticTenantIds.size > 0) {
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

  it("AUTH-RACE-01 revocation wins and commits no Publication", async () => {
    const fixture = await createFixture();
    const request = requestFor(fixture);
    await expect(capabilityAuthorizer.authorize(request)).resolves.toEqual({
      allowed: true,
    });

    const revocationClient = await beginClient();
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

      const mutation = executor().createAuthorizedPublication(
        request,
        fixture.tenant.id,
        publicationInput("revocation-wins"),
      );
      await revocationClient.query("commit");
      await expect(mutation).resolves.toEqual({
        outcome: "DENIED",
        code: "PERMISSION_DENIED",
      });
    } finally {
      revocationClient.release();
    }

    await expect(publicationCount(fixture.tenant.id)).resolves.toBe(0);
  });

  it("AUTH-RACE-02 create wins and revocation commits afterward", async () => {
    const fixture = await createFixture();
    const request = requestFor(fixture);
    let releaseInsert!: () => void;
    const insertMayProceed = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    let authorityLocked!: () => void;
    const authorityIsLocked = new Promise<void>((resolve) => {
      authorityLocked = resolve;
    });

    const mutation = executor(async () => {
      authorityLocked();
      await insertMayProceed;
    }).createAuthorizedPublication(
      request,
      fixture.tenant.id,
      publicationInput("create-wins"),
    );
    await authorityIsLocked;

    const revocationClient = await beginClient();
    try {
      const revocation = revocationClient.query(
        `update role_grants set revoked_at = $2 where id = $1`,
        [fixture.grant.id, NOW],
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseInsert();

      await expect(mutation).resolves.toMatchObject({ outcome: "CREATED" });
      await revocation;
      await revocationClient.query("commit");
    } finally {
      revocationClient.release();
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
      const mutation = executor().createAuthorizedPublication(
        request,
        fixture.tenant.id,
        publicationInput("term-closure"),
      );
      await closureClient.query("commit");
      await expect(mutation).resolves.toEqual({
        outcome: "DENIED",
        code: "PERMISSION_DENIED",
      });
    } finally {
      closureClient.release();
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
    let releaseFirst!: () => void;
    const firstMayCommit = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstLocked!: () => void;
    const firstIsLocked = new Promise<void>((resolve) => {
      firstLocked = resolve;
    });

    const first = editExecutor(async () => {
      firstLocked();
      await firstMayCommit;
    }).editAuthorizedPublication(
      requestFor(fixture, "publication.edit"),
      fixture.tenant.id,
      publication.id,
      publicationEditInput(1, "editor-a"),
    );
    await firstIsLocked;
    const second = editExecutor().editAuthorizedPublication(
      requestFor(fixture, "publication.edit"),
      fixture.tenant.id,
      publication.id,
      publicationEditInput(1, "editor-b"),
    );
    await waitForLockWait();
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
  });

  it("EDIT-RACE-02 shares one version stream with audience replacement", async () => {
    const fixture = await createFixture();
    const publication = await createDraftPublication(fixture.tenant.id);
    let releaseEdit!: () => void;
    const editMayCommit = new Promise<void>((resolve) => {
      releaseEdit = resolve;
    });
    let editLocked!: () => void;
    const editIsLocked = new Promise<void>((resolve) => {
      editLocked = resolve;
    });

    const edit = editExecutor(async () => {
      editLocked();
      await editMayCommit;
    }).editAuthorizedPublication(
      requestFor(fixture, "publication.edit"),
      fixture.tenant.id,
      publication.id,
      publicationEditInput(1, "metadata-wins"),
    );
    await editIsLocked;

    const audience = new DrizzlePublicationRepository(
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
    await waitForLockWait();
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
