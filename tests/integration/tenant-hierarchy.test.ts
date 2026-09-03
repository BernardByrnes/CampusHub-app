import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  academicDivisions,
  campuses,
  programmes,
  residences,
  tenantAcademicYearConfig,
  type AcademicDivisionRow,
  type NewAcademicDivisionRow,
  type NewCampusRow,
  type NewProgrammeRow,
  type NewResidenceRow,
  type NewTenantAcademicYearConfigRow,
  type NewTenantRow,
  type ProgrammeRow,
  type TenantAcademicYearConfigRow,
  type TenantRow,
} from "@/server/db/schema";
import { tenants } from "@/server/db/schema/tenant";

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

const runPrefix = `campushub-hierarchy-${Date.now().toString(36)}-${randomUUID()
  .slice(0, 8)
  .toLowerCase()}`;
let sequence = 0;
let databaseHandle: ReturnType<typeof drizzle> | undefined;
let connectionPool: Pool | undefined;
const syntheticTenantIds = new Set<string>();

function getDatabase(): ReturnType<typeof drizzle> {
  if (!databaseHandle) {
    throw new Error("Database was not initialized.");
  }

  return databaseHandle;
}

function nextSlug(label: string): string {
  sequence += 1;
  return `${runPrefix}-${label}-${sequence}`;
}

function getPostgresCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const candidate = error as { code?: unknown; cause?: unknown };
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
  const rows = await getDatabase()
    .insert(tenants)
    .values({
      slug: nextSlug("tenant"),
      displayName: `Synthetic hierarchy Tenant ${runPrefix}`,
      status: "active",
      timezone: "Africa/Kampala",
      ...overrides,
    })
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Tenant insert returned no row.");
  }

  syntheticTenantIds.add(row.id);
  return row;
}

async function createCampus(
  tenantId: string,
  overrides: Partial<NewCampusRow> = {},
): Promise<void> {
  await getDatabase()
    .insert(campuses)
    .values({
      tenantId,
      label: `Synthetic Campus ${runPrefix}`,
      status: "active",
      ...overrides,
    })
    .returning();
}

async function createDivision(
  tenantId: string,
  overrides: Partial<NewAcademicDivisionRow> = {},
): Promise<AcademicDivisionRow> {
  const rows = await getDatabase()
    .insert(academicDivisions)
    .values({
      tenantId,
      label: `Synthetic Division ${runPrefix}`,
      level: 1,
      status: "active",
      parentAcademicDivisionId: null,
      mergedIntoAcademicDivisionId: null,
      mergedEffectiveAt: null,
      ...overrides,
    })
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Academic Division insert returned no row.");
  }

  return row;
}

async function createProgramme(
  tenantId: string,
  academicDivisionId: string,
  overrides: Partial<NewProgrammeRow> = {},
): Promise<ProgrammeRow> {
  const rows = await getDatabase()
    .insert(programmes)
    .values({
      tenantId,
      academicDivisionId,
      label: `Synthetic Programme ${runPrefix}`,
      status: "active",
      mergedIntoProgrammeId: null,
      mergedEffectiveAt: null,
      ...overrides,
    })
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Programme insert returned no row.");
  }

  return row;
}

async function createResidence(
  tenantId: string,
  overrides: Partial<NewResidenceRow> = {},
): Promise<void> {
  await getDatabase()
    .insert(residences)
    .values({
      tenantId,
      label: `Synthetic Residence ${runPrefix}`,
      status: "active",
      ...overrides,
    })
    .returning();
}

async function createYearConfig(
  tenantId: string,
  overrides: Partial<NewTenantAcademicYearConfigRow> = {},
): Promise<TenantAcademicYearConfigRow> {
  const rows = await getDatabase()
    .insert(tenantAcademicYearConfig)
    .values({
      tenantId,
      minimumYear: 2020,
      maximumYear: 2030,
      ...overrides,
    })
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Academic-year configuration insert returned no row.");
  }

  return row;
}

beforeAll(async () => {
  connectionPool = new Pool({ connectionString: configuredDatabaseUrl });
  databaseHandle = drizzle({ client: connectionPool });
  await connectionPool.query("select 1");
});

afterAll(async () => {
  try {
    if (databaseHandle && syntheticTenantIds.size > 0) {
      const tenantIds = [...syntheticTenantIds];
      await databaseHandle
        .delete(programmes)
        .where(inArray(programmes.tenantId, tenantIds));
      await databaseHandle
        .delete(academicDivisions)
        .where(inArray(academicDivisions.tenantId, tenantIds));
      await databaseHandle
        .delete(residences)
        .where(inArray(residences.tenantId, tenantIds));
      await databaseHandle
        .delete(campuses)
        .where(inArray(campuses.tenantId, tenantIds));
      await databaseHandle
        .delete(tenantAcademicYearConfig)
        .where(inArray(tenantAcademicYearConfig.tenantId, tenantIds));
      await databaseHandle
        .delete(tenants)
        .where(inArray(tenants.id, tenantIds));
    }
  } finally {
    await connectionPool?.end();
  }
});

describe("real PostgreSQL Tenant hierarchy constraints", () => {
  it("creates all five typed hierarchy/config tables", async () => {
    const result = await getDatabase().execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'campuses',
          'academic_divisions',
          'programmes',
          'residences',
          'tenant_academic_year_config'
        )
      order by table_name
    `);

    expect(result.rows.map((row) => String(row.table_name))).toEqual([
      "academic_divisions",
      "campuses",
      "programmes",
      "residences",
      "tenant_academic_year_config",
    ]);
  });

  it("rejects a Programme in Tenant A referencing a Division in Tenant B", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const divisionB = await createDivision(tenantB.id);

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(programmes)
          .values({
            tenantId: tenantA.id,
            academicDivisionId: divisionB.id,
            label: `Cross-tenant Programme ${runPrefix}`,
            status: "active",
          })
          .returning(),
      "23503",
    );
  });

  it("rejects a Division in Tenant A referencing a parent in Tenant B", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const parentB = await createDivision(tenantB.id);

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(academicDivisions)
          .values({
            tenantId: tenantA.id,
            label: `Cross-tenant Child ${runPrefix}`,
            level: 2,
            parentAcademicDivisionId: parentB.id,
            status: "active",
          })
          .returning(),
      "23503",
    );
  });

  it("rejects a Division in Tenant A merging into Tenant B", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const targetB = await createDivision(tenantB.id);

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(academicDivisions)
          .values({
            tenantId: tenantA.id,
            label: `Cross-tenant Division Merge ${runPrefix}`,
            status: "merged",
            mergedIntoAcademicDivisionId: targetB.id,
            mergedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
          })
          .returning(),
      "23503",
    );
  });

  it("rejects a Programme in Tenant A merging into Tenant B", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const divisionA = await createDivision(tenantA.id);
    const programmeB = await createProgramme(
      tenantB.id,
      (await createDivision(tenantB.id)).id,
    );

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(programmes)
          .values({
            tenantId: tenantA.id,
            academicDivisionId: divisionA.id,
            label: `Cross-tenant Programme Merge ${runPrefix}`,
            status: "merged",
            mergedIntoProgrammeId: programmeB.id,
            mergedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
          })
          .returning(),
      "23503",
    );
  });

  it("rejects a Division whose parent is itself", async () => {
    const tenant = await createTenant();
    const parent = await createDivision(tenant.id);
    const child = await createDivision(tenant.id, {
      level: 2,
      parentAcademicDivisionId: parent.id,
    });

    await expectPostgresCode(
      () =>
        getDatabase()
          .update(academicDivisions)
          .set({ parentAcademicDivisionId: child.id })
          .where(eq(academicDivisions.id, child.id)),
      "23514",
    );
  });

  it("rejects a Division whose merge target is itself", async () => {
    const tenant = await createTenant();
    const target = await createDivision(tenant.id);
    const merged = await createDivision(tenant.id, {
      status: "merged",
      mergedIntoAcademicDivisionId: target.id,
      mergedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await expectPostgresCode(
      () =>
        getDatabase()
          .update(academicDivisions)
          .set({ mergedIntoAcademicDivisionId: merged.id })
          .where(eq(academicDivisions.id, merged.id)),
      "23514",
    );
  });

  it("rejects a Programme whose merge target is itself", async () => {
    const tenant = await createTenant();
    const division = await createDivision(tenant.id);
    const target = await createProgramme(tenant.id, division.id);
    const merged = await createProgramme(tenant.id, division.id, {
      status: "merged",
      mergedIntoProgrammeId: target.id,
      mergedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await expectPostgresCode(
      () =>
        getDatabase()
          .update(programmes)
          .set({ mergedIntoProgrammeId: merged.id })
          .where(eq(programmes.id, merged.id)),
      "23514",
    );
  });

  it("rejects a merged Division without target and effective timestamp", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(academicDivisions)
          .values({
            tenantId: tenant.id,
            label: `Missing Division Merge Target ${runPrefix}`,
            status: "merged",
          })
          .returning(),
      "23514",
    );
  });

  it("rejects a merged Programme without target and effective timestamp", async () => {
    const tenant = await createTenant();
    const division = await createDivision(tenant.id);

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(programmes)
          .values({
            tenantId: tenant.id,
            academicDivisionId: division.id,
            label: `Missing Programme Merge Target ${runPrefix}`,
            status: "merged",
          })
          .returning(),
      "23514",
    );
  });

  it("rejects non-merged Division merge metadata", async () => {
    const tenant = await createTenant();
    const target = await createDivision(tenant.id);

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(academicDivisions)
          .values({
            tenantId: tenant.id,
            label: `Active Division With Merge Metadata ${runPrefix}`,
            status: "active",
            mergedIntoAcademicDivisionId: target.id,
            mergedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
          })
          .returning(),
      "23514",
    );
  });

  it("rejects non-merged Programme merge metadata", async () => {
    const tenant = await createTenant();
    const division = await createDivision(tenant.id);
    const target = await createProgramme(tenant.id, division.id);

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(programmes)
          .values({
            tenantId: tenant.id,
            academicDivisionId: division.id,
            label: `Active Programme With Merge Metadata ${runPrefix}`,
            status: "active",
            mergedIntoProgrammeId: target.id,
            mergedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
          })
          .returning(),
      "23514",
    );
  });

  it("rejects blank labels for Campus, Division, Programme, and Residence", async () => {
    const tenant = await createTenant();
    const division = await createDivision(tenant.id);

    await expectPostgresCode(
      () => createCampus(tenant.id, { label: "   " }),
      "23514",
    );
    await expectPostgresCode(
      () => createDivision(tenant.id, { label: "   " }),
      "23514",
    );
    await expectPostgresCode(
      () => createProgramme(tenant.id, division.id, { label: "   " }),
      "23514",
    );
    await expectPostgresCode(
      () => createResidence(tenant.id, { label: "   " }),
      "23514",
    );
  });

  it("rejects an academic minimum year below one", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () => createYearConfig(tenant.id, { minimumYear: 0 }),
      "23514",
    );
  });

  it("rejects an academic maximum year below the minimum", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () =>
        createYearConfig(tenant.id, {
          minimumYear: 2025,
          maximumYear: 2024,
        }),
      "23514",
    );
  });

  it("accepts and round-trips a valid Tenant academic-year configuration", async () => {
    const tenant = await createTenant();
    const config = await createYearConfig(tenant.id, {
      minimumYear: 2024,
      maximumYear: 2032,
    });

    expect(config).toMatchObject({
      tenantId: tenant.id,
      minimumYear: 2024,
      maximumYear: 2032,
    });
  });
});
