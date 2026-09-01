import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ASSURANCE_LEVELS } from "@/domain/authorization/assurance-level";
import { validateRequestContext } from "@/domain/authorization/context-policy";
import { RESOURCE_VISIBILITIES } from "@/domain/authorization/resource-visibility";
import {
  PUBLICATION_LIFECYCLES,
  PUBLICATION_TYPES,
} from "@/domain/content/publication";
import { MEMBERSHIP_LIFECYCLE_STATUSES } from "@/domain/membership/membership";
import { TENANT_LIFECYCLE_STATUSES } from "@/domain/tenancy/tenant";
import type { CampusHubDatabase } from "@/server/db/client";
import { memberships } from "@/server/db/schema/membership";
import type { MembershipRow, NewMembershipRow } from "@/server/db/schema/membership";
import { publications } from "@/server/db/schema/publication";
import type {
  NewPublicationRow,
  PublicationRow,
} from "@/server/db/schema/publication";
import { tenants } from "@/server/db/schema/tenant";
import type { NewTenantRow, TenantRow } from "@/server/db/schema/tenant";
import type { Pool } from "pg";

import type { RequestContextService } from "@/application/context/resolve-request-context";
import type { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import type { DrizzlePublicationRepository } from "@/server/repositories/publication-repository";
import type { DrizzleTenantRepository } from "@/server/repositories/tenant-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLLBACK_MARKER = "CAMPUSHUB_INTENTIONAL_ROLLBACK";

function loadIntegrationEnvironment() {
  const originalNodeEnv = process.env.NODE_ENV;
  const mutableEnvironment = process.env as Record<
    string,
    string | undefined
  >;

  if (originalNodeEnv === "test") {
    mutableEnvironment.NODE_ENV = "development";
  }

  try {
    return loadEnvConfig(process.cwd());
  } finally {
    if (originalNodeEnv === "test") {
      mutableEnvironment.NODE_ENV = originalNodeEnv;
    }
  }
}

if (process.env.CAMPUSHUB_DB_INTEGRATION !== "1") {
  throw new Error(
    "Real database integration is opt-in. Set CAMPUSHUB_DB_INTEGRATION=1.",
  );
}

const databaseUrlBeforeLoad = process.env.DATABASE_URL;
const loadedEnvironment = loadIntegrationEnvironment();
const localEnvFile = loadedEnvironment.loadedEnvFiles.find(
  (file) => file.path === ".env.local",
);
const localDatabaseUrl = localEnvFile?.env?.DATABASE_URL;

if (!localDatabaseUrl) {
  throw new Error(".env.local must provide DATABASE_URL for integration tests.");
}

if (
  databaseUrlBeforeLoad !== undefined &&
  databaseUrlBeforeLoad !== localDatabaseUrl
) {
  throw new Error(
    "A conflicting process DATABASE_URL is set; use the ignored .env.local value.",
  );
}

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (
  typeof configuredDatabaseUrl !== "string" ||
  configuredDatabaseUrl.includes("PASTE_SUPABASE_CONNECTION_STRING_HERE")
) {
  throw new Error("DATABASE_URL is missing or still contains the placeholder.");
}

const parsedDatabaseUrl = new URL(configuredDatabaseUrl);
if (
  (parsedDatabaseUrl.protocol !== "postgres:" &&
    parsedDatabaseUrl.protocol !== "postgresql:") ||
  !parsedDatabaseUrl.hostname.endsWith(".pooler.supabase.com") ||
  parsedDatabaseUrl.port !== "5432"
) {
  throw new Error(
    "Integration tests require the Supabase Supavisor Session Pooler on port 5432.",
  );
}

const runPrefix = `campushub-it-${Date.now().toString(36)}-${randomUUID()
  .slice(0, 8)
  .toLowerCase()}`;

let databaseHandle: CampusHubDatabase | undefined;
let connectionPool: Pool | undefined;
let tenantRepository: DrizzleTenantRepository | undefined;
let membershipRepository: DrizzleMembershipRepository | undefined;
let publicationRepository: DrizzlePublicationRepository | undefined;
let contextService: RequestContextService | undefined;
let serverVersion = "";
let currentDatabaseName = "";
let sequence = 0;
const syntheticTenantIds = new Set<string>();

function getDatabase(): CampusHubDatabase {
  if (!databaseHandle) {
    throw new Error("Database was not initialized.");
  }

  return databaseHandle;
}

function getTenantRepository(): DrizzleTenantRepository {
  if (!tenantRepository) {
    throw new Error("Tenant repository was not initialized.");
  }

  return tenantRepository;
}

function getMembershipRepository(): DrizzleMembershipRepository {
  if (!membershipRepository) {
    throw new Error("Membership repository was not initialized.");
  }

  return membershipRepository;
}

function getPublicationRepository(): DrizzlePublicationRepository {
  if (!publicationRepository) {
    throw new Error("Publication repository was not initialized.");
  }

  return publicationRepository;
}

function getContextService(): RequestContextService {
  if (!contextService) {
    throw new Error("Request context service was not initialized.");
  }

  return contextService;
}

function nextSlug(label: string): string {
  sequence += 1;
  return `${runPrefix}-${label}-${sequence}`;
}

function nextIdentity(label: string): string {
  sequence += 1;
  return `${runPrefix}-${label}-${sequence}`;
}

function requireValue<T>(value: T | null, message: string): T {
  if (value === null) {
    throw new Error(message);
  }

  return value;
}

function getPostgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as {
    code?: unknown;
    cause?: unknown;
  };
  if (typeof candidate.code === "string") {
    return candidate.code;
  }

  return getPostgresCode(candidate.cause);
}

async function expectPostgresCode(
  operation: () => Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  let caught: unknown;

  try {
    await operation();
  } catch (error) {
    caught = error;
  }

  expect(caught, `Expected PostgreSQL error ${expectedCode}`).toBeDefined();
  expect(getPostgresCode(caught)).toBe(expectedCode);
}

async function createTenant(
  overrides: Partial<NewTenantRow> = {},
): Promise<TenantRow> {
  const values: NewTenantRow = {
    slug: nextSlug("tenant"),
    displayName: `Synthetic ${runPrefix}`,
    status: "active",
    timezone: "Africa/Kampala",
    ...overrides,
  };
  const rows = await getDatabase().insert(tenants).values(values).returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Tenant insert returned no row.");
  }

  syntheticTenantIds.add(row.id);
  return row;
}

async function createMembership(
  tenantId: string,
  overrides: Partial<NewMembershipRow> = {},
): Promise<MembershipRow> {
  const values: NewMembershipRow = {
    tenantId,
    identitySubjectId: nextIdentity("identity"),
    assuranceLevel: "L2",
    lifecycle: "verified",
    ...overrides,
  };
  const rows = await getDatabase()
    .insert(memberships)
    .values(values)
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Membership insert returned no row.");
  }

  return row;
}

async function createPublication(
  tenantId: string,
  overrides: Partial<NewPublicationRow> = {},
): Promise<PublicationRow> {
  const values: NewPublicationRow = {
    tenantId,
    type: "news",
    title: `Synthetic Publication ${runPrefix}`,
    body: `Synthetic publication body ${runPrefix}`,
    visibility: "MEMBERS",
    lifecycle: "draft",
    ...overrides,
  };
  const rows = await getDatabase()
    .insert(publications)
    .values(values)
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Publication insert returned no row.");
  }

  return row;
}

async function insertRawTenant(values: {
  slug: string;
  displayName?: string;
  status?: string;
  timezone?: string;
}): Promise<void> {
  await getDatabase().execute(sql`
    insert into "tenants" ("slug", "display_name", "status", "timezone")
    values (
      ${values.slug},
      ${values.displayName ?? `Synthetic ${runPrefix}`},
      ${values.status ?? "active"},
      ${values.timezone ?? "Africa/Kampala"}
    )
  `);
}

async function insertRawMembership(values: {
  tenantId: string;
  identitySubjectId: string;
  assuranceLevel?: string;
  lifecycle?: string;
}): Promise<void> {
  await getDatabase().execute(sql`
    insert into "memberships" (
      "tenant_id",
      "identity_subject_id",
      "assurance_level",
      "lifecycle"
    )
    values (
      ${values.tenantId},
      ${values.identitySubjectId},
      ${values.assuranceLevel ?? "L2"},
      ${values.lifecycle ?? "verified"}
    )
  `);
}

async function insertRawPublication(values: {
  tenantId?: string | null;
  type?: string;
  title?: string;
  body?: string;
  visibility?: string;
  lifecycle?: string;
}): Promise<void> {
  await getDatabase().execute(sql`
    insert into "publications" (
      "tenant_id",
      "type",
      "title",
      "body",
      "visibility",
      "lifecycle"
    )
    values (
      ${values.tenantId ?? null},
      ${values.type ?? "news"},
      ${values.title ?? `Synthetic Publication ${runPrefix}`},
      ${values.body ?? `Synthetic publication body ${runPrefix}`},
      ${values.visibility ?? "MEMBERS"},
      ${values.lifecycle ?? "draft"}
    )
  `);
}

beforeAll(async () => {
  const databaseModule = await import("@/server/db/client");
  const tenantRepositoryModule = await import(
    "@/server/repositories/tenant-repository"
  );
  const membershipRepositoryModule = await import(
    "@/server/repositories/membership-repository"
  );
  const publicationRepositoryModule = await import(
    "@/server/repositories/publication-repository"
  );
  const contextModule = await import(
    "@/application/context/resolve-request-context"
  );

  databaseHandle = databaseModule.db;
  connectionPool = databaseModule.pool;
  tenantRepository = new tenantRepositoryModule.DrizzleTenantRepository(
    databaseHandle,
  );
  membershipRepository =
    new membershipRepositoryModule.DrizzleMembershipRepository(databaseHandle);
  publicationRepository =
    new publicationRepositoryModule.DrizzlePublicationRepository(databaseHandle);
  contextService = new contextModule.RequestContextService({
    tenants: tenantRepository,
    memberships: membershipRepository,
  });

  const connectionResult = await databaseHandle.execute(sql`
    select current_database() as database_name, version() as server_version
  `);
  const connectionRow = connectionResult.rows[0] as
    | { database_name: string; server_version: string }
    | undefined;

  if (!connectionRow) {
    throw new Error("PostgreSQL connectivity query returned no row.");
  }

  currentDatabaseName = connectionRow.database_name;
  serverVersion = connectionRow.server_version;
});

afterAll(async () => {
  if (!databaseHandle) {
    await connectionPool?.end();
    return;
  }

  try {
    if (syntheticTenantIds.size > 0) {
      await databaseHandle
        .delete(publications)
        .where(inArray(publications.tenantId, [...syntheticTenantIds]));
    }
    await databaseHandle
      .delete(memberships)
      .where(like(memberships.identitySubjectId, `${runPrefix}%`));
    await databaseHandle
      .delete(tenants)
      .where(like(tenants.slug, `${runPrefix}%`));
  } finally {
    await connectionPool?.end();
  }
});

describe("real Supabase PostgreSQL foundation", () => {
  it("connects through the Session Pooler and exposes the expected foundation", async () => {
    expect(currentDatabaseName).toBeTruthy();
    expect(serverVersion).toMatch(/^PostgreSQL \d+/);

    const selectOne = await getDatabase().execute(sql`select 1 as ok`);
    expect((selectOne.rows[0] as { ok: number }).ok).toBe(1);

    const tableResult = await getDatabase().execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('tenants', 'memberships', 'publications')
      order by table_name
    `);
    expect(tableResult.rows.map((row) => String(row.table_name))).toEqual([
      "memberships",
      "publications",
      "tenants",
    ]);

    const enumResult = await getDatabase().execute(sql`
      select
        t.typname as enum_name,
        e.enumlabel as enum_value
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
      where n.nspname = 'public'
        and t.typname in (
          'tenant_lifecycle',
          'membership_lifecycle',
          'membership_assurance_level',
          'publication_type',
          'publication_lifecycle',
          'publication_visibility'
        )
      order by t.typname, e.enumsortorder
    `);
    const enums = new Map<string, string[]>();
    for (const row of enumResult.rows) {
      const enumName = String(row.enum_name);
      const enumValues = enums.get(enumName) ?? [];
      enumValues.push(String(row.enum_value));
      enums.set(enumName, enumValues);
    }
    expect(enums.get("tenant_lifecycle")).toEqual([...TENANT_LIFECYCLE_STATUSES]);
    expect(enums.get("membership_lifecycle")).toEqual([
      ...MEMBERSHIP_LIFECYCLE_STATUSES,
    ]);
    expect(enums.get("membership_assurance_level")).toEqual([
      ...ASSURANCE_LEVELS,
    ]);
    expect(enums.get("publication_type")).toEqual([...PUBLICATION_TYPES]);
    expect(enums.get("publication_lifecycle")).toEqual([
      ...PUBLICATION_LIFECYCLES,
    ]);
    expect(enums.get("publication_visibility")).toEqual([
      ...RESOURCE_VISIBILITIES,
    ]);

    const indexResult = await getDatabase().execute(sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname in (
          'tenants_slug_unique',
          'memberships_tenant_identity_unique',
          'publications_tenant_id_id',
          'publications_tenant_lifecycle'
        )
      order by indexname
    `);
    expect(indexResult.rows.map((row) => String(row.indexname))).toEqual([
      "memberships_tenant_identity_unique",
      "publications_tenant_id_id",
      "publications_tenant_lifecycle",
      "tenants_slug_unique",
    ]);

    const journalResult = await getDatabase().execute(sql`
      select count(*)::int as migration_count
      from "drizzle"."__drizzle_migrations"
    `);
    expect(
      Number(
        (journalResult.rows[0] as { migration_count: number }).migration_count,
      ),
    ).toBe(2);
  });

  it("generates distinct UUID defaults for Tenant and Membership", async () => {
    const tenant = await createTenant();
    const membership = await createMembership(tenant.id);

    expect(tenant.id).toMatch(UUID_PATTERN);
    expect(membership.id).toMatch(UUID_PATTERN);
    expect(tenant.id).not.toBe(membership.id);
  });

  it("generates a Publication UUID and round-trips exact fields", async () => {
    const tenant = await createTenant({ slug: nextSlug("publication-round-trip") });
    const created = requireValue(
      await getPublicationRepository().createPublication(tenant.id, {
        type: "notice",
        title: "Synthetic notice",
        body: "Synthetic notice body",
        visibility: "PUBLIC",
        lifecycle: "published",
      }),
      "Publication repository did not return the inserted row.",
    );

    expect(created.id).toMatch(UUID_PATTERN);
    expect(created).toMatchObject({
      tenantId: tenant.id,
      type: "notice",
      title: "Synthetic notice",
      body: "Synthetic notice body",
      visibility: "PUBLIC",
      lifecycle: "published",
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.updatedAt).toBeInstanceOf(Date);

    const read = requireValue(
      await getPublicationRepository().findPublicationByIdForTenant(
        tenant.id,
        created.id,
      ),
      "Publication repository did not return the round-tripped row.",
    );
    expect(read).toEqual(created);
  });

  it("rejects a Publication referencing a nonexistent Tenant", async () => {
    await expectPostgresCode(
      () =>
        getPublicationRepository().createPublication(randomUUID(), {
          type: "news",
          title: "Synthetic foreign publication",
          body: "This insert must fail at the Tenant foreign key.",
        }),
      "23503",
    );
  });

  it("returns a Tenant A Publication within Tenant A scope", async () => {
    const tenantA = await createTenant({ slug: nextSlug("publication-owner") });
    const publication = await createPublication(tenantA.id, {
      title: "Tenant A publication",
      body: "Tenant A publication body",
    });

    const read = requireValue(
      await getPublicationRepository().findPublicationByIdForTenant(
        tenantA.id,
        publication.id,
      ),
      "Tenant A could not read its own Publication.",
    );
    expect(read).toMatchObject({
      id: publication.id,
      tenantId: tenantA.id,
      title: "Tenant A publication",
    });
  });

  it("makes foreign and nonexistent Publication lookups equivalent", async () => {
    const tenantA = await createTenant({ slug: nextSlug("publication-foreign-a") });
    const tenantB = await createTenant({ slug: nextSlug("publication-foreign-b") });
    const publication = await createPublication(tenantA.id);

    const foreign = await getPublicationRepository().findPublicationByIdForTenant(
      tenantB.id,
      publication.id,
    );
    const nonexistent =
      await getPublicationRepository().findPublicationByIdForTenant(
        tenantB.id,
        randomUUID(),
      );

    expect(foreign).toBeNull();
    expect(nonexistent).toBeNull();
    expect(foreign).toEqual(nonexistent);
  });

  it("returns only the requested Publication for multiple rows in one Tenant", async () => {
    const tenant = await createTenant({ slug: nextSlug("publication-multiple") });
    const first = await createPublication(tenant.id, {
      title: "First Publication",
      body: "First Publication body",
    });
    const second = await createPublication(tenant.id, {
      title: "Second Publication",
      body: "Second Publication body",
    });

    const readFirst = requireValue(
      await getPublicationRepository().findPublicationByIdForTenant(
        tenant.id,
        first.id,
      ),
      "First Publication was not readable.",
    );
    const readSecond = requireValue(
      await getPublicationRepository().findPublicationByIdForTenant(
        tenant.id,
        second.id,
      ),
      "Second Publication was not readable.",
    );

    expect(readFirst.id).toBe(first.id);
    expect(readFirst.title).toBe("First Publication");
    expect(readSecond.id).toBe(second.id);
    expect(readSecond.title).toBe("Second Publication");
  });

  it("isolates Publication rows across multiple Tenants", async () => {
    const tenantA = await createTenant({ slug: nextSlug("publication-isolation-a") });
    const tenantB = await createTenant({ slug: nextSlug("publication-isolation-b") });
    const publicationA = await createPublication(tenantA.id, {
      title: "Tenant A isolated Publication",
    });
    const publicationB = await createPublication(tenantB.id, {
      title: "Tenant B isolated Publication",
    });

    expect(
      await getPublicationRepository().findPublicationByIdForTenant(
        tenantA.id,
        publicationA.id,
      ),
    ).toMatchObject({ id: publicationA.id, tenantId: tenantA.id });
    expect(
      await getPublicationRepository().findPublicationByIdForTenant(
        tenantA.id,
        publicationB.id,
      ),
    ).toBeNull();
    expect(
      await getPublicationRepository().findPublicationByIdForTenant(
        tenantB.id,
        publicationB.id,
      ),
    ).toMatchObject({ id: publicationB.id, tenantId: tenantB.id });
    expect(
      await getPublicationRepository().findPublicationByIdForTenant(
        tenantB.id,
        publicationA.id,
      ),
    ).toBeNull();
  });

  it("enforces Publication enum, nonempty, and required-Tenant constraints", async () => {
    const tenant = await createTenant({ slug: nextSlug("publication-constraints") });

    await expectPostgresCode(
      () => insertRawPublication({ tenantId: tenant.id, type: "invalid" }),
      "22P02",
    );
    await expectPostgresCode(
      () =>
        insertRawPublication({
          tenantId: tenant.id,
          lifecycle: "invalid",
        }),
      "22P02",
    );
    await expectPostgresCode(
      () =>
        insertRawPublication({
          tenantId: tenant.id,
          visibility: "PRIVATE",
        }),
      "22P02",
    );
    await expectPostgresCode(
      () => insertRawPublication({ tenantId: tenant.id, title: "   " }),
      "23514",
    );
    await expectPostgresCode(
      () => insertRawPublication({ tenantId: tenant.id, body: "" }),
      "23514",
    );
    await expectPostgresCode(() => insertRawPublication({}), "23502");
  });

  it("preserves Publication ownership with ON DELETE RESTRICT metadata", async () => {
    const tenant = await createTenant({ slug: nextSlug("publication-restrict") });
    const publication = await createPublication(tenant.id);

    await expectPostgresCode(
      () => getDatabase().delete(tenants).where(eq(tenants.id, tenant.id)),
      "23503",
    );

    const publicationAfterDelete = await getDatabase()
      .select({ id: publications.id })
      .from(publications)
      .where(eq(publications.id, publication.id));
    expect(publicationAfterDelete).toHaveLength(1);

    const foreignKeyResult = await getDatabase().execute(sql`
      select
        confdeltype as delete_action,
        confupdtype as update_action,
        pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = 'publications_tenant_id_tenants_id_fk'
    `);
    const foreignKey = foreignKeyResult.rows[0] as {
      delete_action: string;
      update_action: string;
      definition: string;
    };
    expect(foreignKey.delete_action).toBe("r");
    expect(foreignKey.update_action).toBe("c");
    expect(foreignKey.definition).toContain("ON UPDATE CASCADE");
    expect(foreignKey.definition).toContain("ON DELETE RESTRICT");
  });

  it("accepts every Tenant lifecycle and rejects an invalid enum value", async () => {
    for (const status of TENANT_LIFECYCLE_STATUSES) {
      const tenant = await createTenant({
        slug: nextSlug(`tenant-${status}`),
        status,
      });
      expect(tenant.status).toBe(status);
    }

    await expectPostgresCode(
      () =>
        insertRawTenant({
          slug: nextSlug("invalid-tenant-lifecycle"),
          status: "unknown",
        }),
      "22P02",
    );
  });

  it("accepts every Membership lifecycle and rejects an invalid enum value", async () => {
    const tenant = await createTenant();

    for (const lifecycle of MEMBERSHIP_LIFECYCLE_STATUSES) {
      const membership = await createMembership(tenant.id, {
        identitySubjectId: nextIdentity(`lifecycle-${lifecycle}`),
        lifecycle,
      });
      expect(membership.lifecycle).toBe(lifecycle);
    }

    await expectPostgresCode(
      () =>
        insertRawMembership({
          tenantId: tenant.id,
          identitySubjectId: nextIdentity("invalid-membership-lifecycle"),
          lifecycle: "invalid",
        }),
      "22P02",
    );
  });

  it("accepts every assurance level and rejects L4", async () => {
    const tenant = await createTenant();

    for (const assuranceLevel of ASSURANCE_LEVELS) {
      const membership = await createMembership(tenant.id, {
        identitySubjectId: nextIdentity(`assurance-${assuranceLevel}`),
        assuranceLevel,
      });
      expect(membership.assuranceLevel).toBe(assuranceLevel);
    }

    await expectPostgresCode(
      () =>
        insertRawMembership({
          tenantId: tenant.id,
          identitySubjectId: nextIdentity("invalid-assurance"),
          assuranceLevel: "L4",
        }),
      "22P02",
    );
  });

  it("enforces the database slug-format check", async () => {
    const validTenant = await createTenant({ slug: nextSlug("valid-slug") });
    expect(validTenant.slug).toContain(runPrefix);

    const malformedSlugs = [
      `${runPrefix.toUpperCase()}-uppercase`,
      `${runPrefix}-with space`,
      `-${runPrefix}-leading`,
      `${runPrefix}-trailing-`,
      "",
      "a".repeat(81),
    ];

    for (const slug of malformedSlugs) {
      await expectPostgresCode(
        () => insertRawTenant({ slug }),
        "23514",
      );
    }
  });

  it("enforces unique Tenant slugs in PostgreSQL", async () => {
    const slug = nextSlug("duplicate-slug");
    await createTenant({ slug });

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(tenants)
          .values({
            slug,
            displayName: `Synthetic duplicate ${runPrefix}`,
            status: "active",
            timezone: "Africa/Kampala",
          })
          .returning(),
      "23505",
    );
  });

  it("enforces tenant-scoped Membership uniqueness", async () => {
    const tenantA = await createTenant({ slug: nextSlug("unique-tenant-a") });
    const identitySubjectId = nextIdentity("scoped-identity");
    await createMembership(tenantA.id, { identitySubjectId });

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(memberships)
          .values({
            tenantId: tenantA.id,
            identitySubjectId,
            assuranceLevel: "L2",
            lifecycle: "verified",
          })
          .returning(),
      "23505",
    );

    const tenantB = await createTenant({ slug: nextSlug("unique-tenant-b") });
    const secondMembership = await createMembership(tenantB.id, {
      identitySubjectId,
    });
    expect(secondMembership.identitySubjectId).toBe(identitySubjectId);
    expect(secondMembership.tenantId).toBe(tenantB.id);
  });

  it("rejects a Membership referencing a nonexistent Tenant", async () => {
    await expectPostgresCode(
      () =>
        insertRawMembership({
          tenantId: randomUUID(),
          identitySubjectId: nextIdentity("foreign-key"),
        }),
      "23503",
    );
  });

  it("proves ON DELETE RESTRICT and ON UPDATE CASCADE metadata", async () => {
    const tenant = await createTenant({ slug: nextSlug("restrict-tenant") });
    const membership = await createMembership(tenant.id);

    await expectPostgresCode(
      () => getDatabase().delete(tenants).where(eq(tenants.id, tenant.id)),
      "23503",
    );

    const membershipAfterDelete = await getDatabase()
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.id, membership.id));
    expect(membershipAfterDelete).toHaveLength(1);

    const foreignKeyResult = await getDatabase().execute(sql`
      select
        confdeltype as delete_action,
        confupdtype as update_action,
        pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = 'memberships_tenant_id_tenants_id_fk'
    `);
    const foreignKey = foreignKeyResult.rows[0] as {
      delete_action: string;
      update_action: string;
      definition: string;
    };
    expect(foreignKey.delete_action).toBe("r");
    expect(foreignKey.update_action).toBe("c");
    expect(foreignKey.definition).toContain("ON UPDATE CASCADE");
    expect(foreignKey.definition).toContain("ON DELETE RESTRICT");
  });

  it("enforces the declared nonempty database checks", async () => {
    const tenantForMembership = await createTenant();

    await expectPostgresCode(
      () =>
        insertRawTenant({
          slug: nextSlug("blank-display-name"),
          displayName: "   ",
        }),
      "23514",
    );
    await expectPostgresCode(
      () =>
        insertRawTenant({
          slug: nextSlug("blank-timezone"),
          timezone: "   ",
        }),
      "23514",
    );
    await expectPostgresCode(
      () =>
        insertRawMembership({
          tenantId: tenantForMembership.id,
          identitySubjectId: "   ",
        }),
      "23514",
    );
  });

  it("keeps IANA timezone validation in the domain and round-trips valid values", async () => {
    const { isValidIanaTimezone } = await import("@/domain/tenancy/tenant");
    expect(isValidIanaTimezone("Africa/Kampala")).toBe(true);
    expect(isValidIanaTimezone("Mars/Olympus")).toBe(false);

    const tenant = await createTenant({ timezone: "Africa/Kampala" });
    const readTenant = requireValue(
      await getTenantRepository().findTenantById(tenant.id),
      "Timezone test Tenant was not readable.",
    );
    expect(readTenant.timezone).toBe("Africa/Kampala");
  });

  it("round-trips a Tenant through the real Drizzle repository", async () => {
    const tenant = await createTenant({
      slug: nextSlug("tenant-round-trip"),
      displayName: "Synthetic Round Trip Tenant",
      status: "grace",
      timezone: "Africa/Kampala",
    });
    const readTenant = requireValue(
      await getTenantRepository().findTenantBySlug(tenant.slug),
      "Tenant repository did not return the inserted row.",
    );

    expect(readTenant).toMatchObject({
      id: tenant.id,
      slug: tenant.slug,
      displayName: "Synthetic Round Trip Tenant",
      status: "grace",
      timezone: "Africa/Kampala",
    });
    expect(readTenant.createdAt).toBeInstanceOf(Date);
    expect(readTenant.updatedAt).toBeInstanceOf(Date);
  });

  it("round-trips a Membership through the real Drizzle repository", async () => {
    const tenant = await createTenant({ slug: nextSlug("membership-round-trip") });
    const membership = await createMembership(tenant.id, {
      identitySubjectId: nextIdentity("membership-round-trip"),
      assuranceLevel: "L1",
      lifecycle: "stale",
    });
    const readMembership = requireValue(
      await getMembershipRepository().findMembershipById(membership.id),
      "Membership repository did not return the inserted row.",
    );
    const readByRelation = requireValue(
      await getMembershipRepository().findMembershipForIdentityAndTenant(
        membership.identitySubjectId,
        tenant.id,
      ),
      "Membership relation lookup did not return the inserted row.",
    );

    expect(readMembership).toMatchObject({
      id: membership.id,
      tenantId: tenant.id,
      identitySubjectId: membership.identitySubjectId,
      assuranceLevel: "L1",
      lifecycle: "stale",
    });
    expect(readByRelation.id).toBe(membership.id);
    expect(readMembership.createdAt).toBeInstanceOf(Date);
    expect(readMembership.updatedAt).toBeInstanceOf(Date);
  });

  it("resolves trusted context through real repositories and application policy", async () => {
    const tenant = await createTenant({ slug: nextSlug("context-tenant") });
    const membership = await createMembership(tenant.id, {
      identitySubjectId: nextIdentity("context-identity"),
      assuranceLevel: "L2",
      lifecycle: "verified",
    });
    const result = await getContextService().resolveRequestContext(
      { identitySubjectId: membership.identitySubjectId },
      { tenantId: tenant.id },
    );

    expect(result).toEqual({
      resolved: true,
      context: {
        identitySubjectId: membership.identitySubjectId,
        tenantId: tenant.id,
        tenantStatus: "active",
        membershipId: membership.id,
        assuranceLevel: "L2",
        membershipStatus: "verified",
      },
    });
  });

  it("resolves restrictive lifecycle states as trusted facts", async () => {
    const suspendedTenant = await createTenant({
      slug: nextSlug("suspended-tenant"),
      status: "suspended",
    });
    const suspendedTenantMembership = await createMembership(
      suspendedTenant.id,
      { identitySubjectId: nextIdentity("suspended-tenant") },
    );
    const suspendedTenantResult = await getContextService().resolveRequestContext(
      { identitySubjectId: suspendedTenantMembership.identitySubjectId },
      { tenantId: suspendedTenant.id },
    );
    expect(suspendedTenantResult).toMatchObject({
      resolved: true,
      context: { tenantStatus: "suspended" },
    });

    const staleTenant = await createTenant({ slug: nextSlug("stale-membership") });
    const staleMembership = await createMembership(staleTenant.id, {
      identitySubjectId: nextIdentity("stale-membership"),
      lifecycle: "stale",
    });
    const staleResult = await getContextService().resolveRequestContext(
      { identitySubjectId: staleMembership.identitySubjectId },
      { tenantId: staleTenant.id },
    );
    expect(staleResult).toMatchObject({
      resolved: true,
      context: { membershipStatus: "stale" },
    });

    const participationTenant = await createTenant({
      slug: nextSlug("participation-suspended"),
    });
    const participationMembership = await createMembership(
      participationTenant.id,
      {
        identitySubjectId: nextIdentity("participation-suspended"),
        lifecycle: "participation_suspended",
      },
    );
    const participationResult =
      await getContextService().resolveRequestContext(
        { identitySubjectId: participationMembership.identitySubjectId },
        { tenantId: participationTenant.id },
      );
    expect(participationResult).toMatchObject({
      resolved: true,
      context: { membershipStatus: "participation_suspended" },
    });
  });

  it("rejects a persisted cross-Tenant context join", async () => {
    const tenantA = await createTenant({ slug: nextSlug("cross-tenant-a") });
    const tenantB = await createTenant({ slug: nextSlug("cross-tenant-b") });
    const membershipA = await createMembership(tenantA.id, {
      identitySubjectId: nextIdentity("cross-tenant"),
    });
    const readTenantB = requireValue(
      await getTenantRepository().findTenantById(tenantB.id),
      "Tenant B was not readable.",
    );
    const readMembershipA = requireValue(
      await getMembershipRepository().findMembershipById(membershipA.id),
      "Membership A was not readable.",
    );

    expect(
      validateRequestContext({
        identitySubjectId: membershipA.identitySubjectId,
        tenant: readTenantB,
        membership: readMembershipA,
      }),
    ).toEqual({ resolved: false, code: "CONTEXT_MISMATCH" });
  });

  it("rejects a persisted cross-identity context join", async () => {
    const tenant = await createTenant({ slug: nextSlug("cross-identity") });
    const membership = await createMembership(tenant.id, {
      identitySubjectId: nextIdentity("identity-a"),
    });
    const readTenant = requireValue(
      await getTenantRepository().findTenantById(tenant.id),
      "Cross-identity Tenant was not readable.",
    );
    const readMembership = requireValue(
      await getMembershipRepository().findMembershipById(membership.id),
      "Cross-identity Membership was not readable.",
    );

    expect(
      validateRequestContext({
        identitySubjectId: nextIdentity("identity-b"),
        tenant: readTenant,
        membership: readMembership,
      }),
    ).toEqual({ resolved: false, code: "CONTEXT_MISMATCH" });
  });

  it("allows exactly one concurrent Membership for a Tenant and identity", async () => {
    const tenant = await createTenant({ slug: nextSlug("concurrent") });
    const identitySubjectId = nextIdentity("concurrent");
    const insertAttempt = () =>
      getDatabase()
        .insert(memberships)
        .values({
          tenantId: tenant.id,
          identitySubjectId,
          assuranceLevel: "L2",
          lifecycle: "verified",
        })
        .returning();

    const results = await Promise.allSettled([insertAttempt(), insertAttempt()]);
    const successes = results.filter(
      (result) => result.status === "fulfilled",
    );
    const failures = results.filter((result) => result.status === "rejected");

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(
      getPostgresCode((failures[0] as PromiseRejectedResult).reason),
    ).toBe("23505");

    const persisted = await getDatabase()
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenant.id),
          eq(memberships.identitySubjectId, identitySubjectId),
        ),
      );
    expect(persisted).toHaveLength(1);
  });

  it("rolls back a real PostgreSQL transaction completely", async () => {
    const slug = nextSlug("rollback");
    const identitySubjectId = nextIdentity("rollback");

    await expect(
      getDatabase().transaction(async (transaction) => {
        const tenantRows = await transaction
          .insert(tenants)
          .values({
            slug,
            displayName: `Synthetic rollback ${runPrefix}`,
            status: "active",
            timezone: "Africa/Kampala",
          })
          .returning();
        const tenant = tenantRows[0];

        if (!tenant) {
          throw new Error("Rollback Tenant insert returned no row.");
        }

        await transaction.insert(memberships).values({
          tenantId: tenant.id,
          identitySubjectId,
          assuranceLevel: "L2",
          lifecycle: "verified",
        });
        throw new Error(ROLLBACK_MARKER);
      }),
    ).rejects.toThrow(ROLLBACK_MARKER);

    const remainingTenant = await getDatabase()
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug));
    const remainingMembership = await getDatabase()
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.identitySubjectId, identitySubjectId));
    expect(remainingTenant).toHaveLength(0);
    expect(remainingMembership).toHaveLength(0);
  });
});
