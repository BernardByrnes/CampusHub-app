import { loadEnvConfig } from "@next/env";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";

import type * as schema from "@/server/db/schema";
import type { CampusHubDatabase } from "@/server/db/client";
import type { PostgresCapabilityAuthorizer } from "@/server/authorization/postgres-capability-authorizer";
import type { PostgresAuthorizedPublicationCreateExecutor } from "@/server/authorization/postgres-authorized-publication-create";
import type { CanonicalPublicationDraftInput } from "@/domain/content/publication-draft";

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

  return { tenant, membership, term, grant };
}

function requestFor(fixture: Awaited<ReturnType<typeof createFixture>>) {
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
    capability: "publication.create" as const,
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
