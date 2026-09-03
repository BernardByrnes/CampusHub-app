import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type { PublicationAudienceDefinition } from "@/domain/authorization/publication-audience";
import {
  academicDivisions,
  campuses,
  programmes,
  publicationAudienceCriteria,
  publications,
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
  type PublicationAudienceCriteriaRow,
  type PublicationRow,
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

const runPrefix = `campushub-audience-${Date.now().toString(36)}-${randomUUID()
  .slice(0, 8)
  .toLowerCase()}`;
let sequence = 0;
let databaseHandle: ReturnType<typeof drizzle> | undefined;
let connectionPool: Pool | undefined;
let audienceRepository: InstanceType<
  typeof import("@/server/repositories/publication-repository").DrizzlePublicationRepository
>;
const syntheticTenantIds = new Set<string>();

function getDatabase(): ReturnType<typeof drizzle> {
  if (!databaseHandle) {
    throw new Error("Database was not initialized.");
  }

  return databaseHandle;
}

function nextLabel(label: string): string {
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
      slug: nextLabel("tenant"),
      displayName: `Synthetic audience Tenant ${runPrefix}`,
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

async function createPublication(
  tenantId: string,
  audienceMode: "entire_tenant" | "targeted" = "entire_tenant",
  lifecycle: "draft" | "scheduled" | "published" | "expired" | "archived" =
    "draft",
): Promise<PublicationRow> {
  const rows = await getDatabase()
    .insert(publications)
    .values({
      tenantId,
      type: "news",
      title: nextLabel("publication"),
      body: "Synthetic audience publication body",
      priority: "standard",
      visibility: "MEMBERS",
      lifecycle,
      audienceMode,
      authorOfficeLabel: "Communications",
    })
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Publication insert returned no row.");
  }

  return row;
}

async function createCampus(
  tenantId: string,
  overrides: Partial<NewCampusRow> = {},
): Promise<string> {
  const rows = await getDatabase()
    .insert(campuses)
    .values({
      tenantId,
      label: nextLabel("campus"),
      status: "active",
      ...overrides,
    })
    .returning({ id: campuses.id });
  const row = rows[0];

  if (!row) {
    throw new Error("Campus insert returned no row.");
  }

  return row.id;
}

async function createDivision(
  tenantId: string,
  overrides: Partial<NewAcademicDivisionRow> = {},
): Promise<AcademicDivisionRow> {
  const rows = await getDatabase()
    .insert(academicDivisions)
    .values({
      tenantId,
      label: nextLabel("division"),
      level: 1,
      parentAcademicDivisionId: null,
      status: "active",
      mergedIntoAcademicDivisionId: null,
      mergedEffectiveAt: null,
      ...overrides,
    })
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Division insert returned no row.");
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
      label: nextLabel("programme"),
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
): Promise<string> {
  const rows = await getDatabase()
    .insert(residences)
    .values({
      tenantId,
      label: nextLabel("residence"),
      status: "active",
      ...overrides,
    })
    .returning({ id: residences.id });
  const row = rows[0];

  if (!row) {
    throw new Error("Residence insert returned no row.");
  }

  return row.id;
}

async function createYearConfig(
  tenantId: string,
  overrides: Partial<NewTenantAcademicYearConfigRow> = {},
): Promise<void> {
  await getDatabase().insert(tenantAcademicYearConfig).values({
    tenantId,
    minimumYear: 2020,
    maximumYear: 2030,
    ...overrides,
  });
}

type CriterionInsert = Omit<
  PublicationAudienceCriteriaRow,
  "id" | "createdAt" | "updatedAt"
>;

async function insertCriterion(
  values: CriterionInsert,
): Promise<PublicationAudienceCriteriaRow> {
  const rows = await getDatabase()
    .insert(publicationAudienceCriteria)
    .values(values)
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Criterion insert returned no row.");
  }

  return row;
}

function baseCriterion(
  tenantId: string,
  publicationId: string,
): CriterionInsert {
  return {
    tenantId,
    publicationId,
    dimension: "academic_year",
    provenancePolicy: "authoritative_only",
    campusId: null,
    academicDivisionId: null,
    programmeId: null,
    academicYear: 2025,
    residenceTarget: null,
    residenceId: null,
  };
}

function targetedDefinition(
  tenantId: string,
  publicationId: string,
  groups: PublicationAudienceDefinition["groups"],
): PublicationAudienceDefinition {
  return {
    tenantId,
    publicationId,
    mode: "targeted",
    groups,
  };
}

beforeAll(async () => {
  connectionPool = new Pool({ connectionString: configuredDatabaseUrl });
  databaseHandle = drizzle({ client: connectionPool });
  await connectionPool.query("select 1");

  const { DrizzlePublicationRepository } = await import(
    "@/server/repositories/publication-repository"
  );
  audienceRepository = new DrizzlePublicationRepository(
    databaseHandle as never,
  );
});

afterAll(async () => {
  try {
    if (databaseHandle && syntheticTenantIds.size > 0) {
      const tenantIds = [...syntheticTenantIds];
      await databaseHandle
        .delete(publicationAudienceCriteria)
        .where(inArray(publicationAudienceCriteria.tenantId, tenantIds));
      await databaseHandle
        .delete(publications)
        .where(inArray(publications.tenantId, tenantIds));
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

describe("real PostgreSQL Publication audience persistence", () => {
  it("creates the typed audience persistence objects", async () => {
    const result = await getDatabase().execute(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
        and table_name = 'publication_audience_criteria'
    `);
    expect(result.rows.map((row) => String(row.table_name))).toEqual([
      "publication_audience_criteria",
    ]);

    const enumResult = await getDatabase().execute(sql`
      select t.typname, e.enumlabel
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname in (
        'publication_audience_dimension',
        'publication_audience_provenance_policy',
        'publication_audience_residence_target'
      )
      order by t.typname, e.enumsortorder
    `);
    expect(enumResult.rows.map((row) => `${row.typname}:${row.enumlabel}`)).toEqual([
      "publication_audience_dimension:campus",
      "publication_audience_dimension:academic_division",
      "publication_audience_dimension:programme",
      "publication_audience_dimension:academic_year",
      "publication_audience_dimension:residence",
      "publication_audience_provenance_policy:authoritative_only",
      "publication_audience_provenance_policy:allow_self_declared",
      "publication_audience_residence_target:specific_residence",
      "publication_audience_residence_target:any_resident",
      "publication_audience_residence_target:non_resident",
    ]);
  });

  it("rejects cross-Tenant Publication and target foreign keys", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const publicationA = await createPublication(tenantA.id);
    const publicationB = await createPublication(tenantB.id);
    const campusB = await createCampus(tenantB.id);
    const divisionB = await createDivision(tenantB.id);
    const programmeB = await createProgramme(tenantB.id, divisionB.id);
    const residenceB = await createResidence(tenantB.id);

    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenantA.id, publicationB.id),
        }),
      "23503",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenantA.id, publicationA.id),
          dimension: "campus",
          campusId: campusB,
          academicYear: null,
        }),
      "23503",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenantA.id, publicationA.id),
          dimension: "academic_division",
          academicDivisionId: divisionB.id,
          academicYear: null,
        }),
      "23503",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenantA.id, publicationA.id),
          dimension: "programme",
          programmeId: programmeB.id,
          academicYear: null,
        }),
      "23503",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenantA.id, publicationA.id),
          dimension: "residence",
          academicYear: null,
          residenceTarget: "specific_residence",
          residenceId: residenceB,
        }),
      "23503",
    );
  });

  it("rejects every invalid dimension and residence payload shape", async () => {
    const tenant = await createTenant();
    const publication = await createPublication(tenant.id);
    const campus = await createCampus(tenant.id);
    const division = await createDivision(tenant.id);
    const programme = await createProgramme(tenant.id, division.id);
    const residence = await createResidence(tenant.id);

    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenant.id, publication.id),
          dimension: "campus",
          campusId: campus,
          academicYear: 2025,
        }),
      "23514",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenant.id, publication.id),
          dimension: "academic_division",
          academicDivisionId: division.id,
          campusId: campus,
          academicYear: null,
        }),
      "23514",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenant.id, publication.id),
          dimension: "programme",
          programmeId: programme.id,
          academicDivisionId: division.id,
          academicYear: null,
        }),
      "23514",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenant.id, publication.id),
          dimension: "academic_year",
          campusId: campus,
        }),
      "23514",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenant.id, publication.id),
          dimension: "residence",
          academicYear: null,
          residenceTarget: "any_resident",
          residenceId: residence,
        }),
      "23514",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenant.id, publication.id),
          dimension: "residence",
          academicYear: null,
          residenceTarget: "specific_residence",
          residenceId: null,
        }),
      "23514",
    );
    await expectPostgresCode(
      () =>
        insertCriterion({
          ...baseCriterion(tenant.id, publication.id),
          dimension: "academic_year",
          academicYear: 0,
        }),
      "23514",
    );
  });

  it("accepts every valid criterion shape", async () => {
    const tenant = await createTenant();
    const publication = await createPublication(tenant.id);
    const campus = await createCampus(tenant.id);
    const division = await createDivision(tenant.id);
    const programme = await createProgramme(tenant.id, division.id);
    const residence = await createResidence(tenant.id);

    const rows = await getDatabase()
      .insert(publicationAudienceCriteria)
      .values([
        {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "campus",
          campusId: campus,
          academicYear: null,
        },
        {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "academic_division",
          academicDivisionId: division.id,
          academicYear: null,
        },
        {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "programme",
          programmeId: programme.id,
          academicYear: null,
        },
        {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "academic_year",
          academicYear: 2025,
        },
        {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "residence",
          academicYear: null,
          residenceTarget: "specific_residence",
          residenceId: residence,
        },
        {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "residence",
          academicYear: null,
          residenceTarget: "any_resident",
          residenceId: null,
        },
        {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "residence",
          academicYear: null,
          residenceTarget: "non_resident",
          residenceId: null,
        },
      ])
      .returning();

    expect(rows).toHaveLength(7);
  });

  it("rejects duplicate values in each supported unique shape", async () => {
    const tenant = await createTenant();
    const campus = await createCampus(tenant.id);
    const division = await createDivision(tenant.id);
    const programme = await createProgramme(tenant.id, division.id);
    const residence = await createResidence(tenant.id);

    const duplicateCases = [
      async () => {
        const publication = await createPublication(tenant.id);
        const values = {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "campus" as const,
          campusId: campus,
          academicYear: null,
        };
        await insertCriterion(values);
        await insertCriterion(values);
      },
      async () => {
        const publication = await createPublication(tenant.id);
        const values = {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "programme" as const,
          programmeId: programme.id,
          academicYear: null,
        };
        await insertCriterion(values);
        await insertCriterion(values);
      },
      async () => {
        const publication = await createPublication(tenant.id);
        const values = baseCriterion(tenant.id, publication.id);
        await insertCriterion(values);
        await insertCriterion(values);
      },
      async () => {
        const publication = await createPublication(tenant.id);
        const values = {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "residence" as const,
          academicYear: null,
          residenceTarget: "specific_residence" as const,
          residenceId: residence,
        };
        await insertCriterion(values);
        await insertCriterion(values);
      },
      async () => {
        const publication = await createPublication(tenant.id);
        const values = {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "residence" as const,
          academicYear: null,
          residenceTarget: "any_resident" as const,
          residenceId: null,
        };
        await insertCriterion(values);
        await insertCriterion(values);
      },
      async () => {
        const publication = await createPublication(tenant.id);
        const values = {
          ...baseCriterion(tenant.id, publication.id),
          dimension: "residence" as const,
          academicYear: null,
          residenceTarget: "non_resident" as const,
          residenceId: null,
        };
        await insertCriterion(values);
        await insertCriterion(values);
      },
    ];

    for (const duplicateCase of duplicateCases) {
      await expectPostgresCode(duplicateCase, "23505");
    }
  });

  it("reads canonical unrestricted, targeted, deterministic, and fail-closed definitions", async () => {
    const tenant = await createTenant();
    const entirePublication = await createPublication(tenant.id);
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        entirePublication.id,
      ),
    ).resolves.toEqual({
      tenantId: tenant.id,
      publicationId: entirePublication.id,
      mode: "entire_tenant",
      groups: [],
    });

    const strayCampus = await createCampus(tenant.id);
    await insertCriterion({
      ...baseCriterion(tenant.id, entirePublication.id),
      dimension: "campus",
      campusId: strayCampus,
      academicYear: null,
    });
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        entirePublication.id,
      ),
    ).resolves.toBeNull();

    const emptyTargeted = await createPublication(tenant.id, "targeted");
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        emptyTargeted.id,
      ),
    ).resolves.toBeNull();

    const campusA = await createCampus(tenant.id);
    const campusB = await createCampus(tenant.id);
    const division = await createDivision(tenant.id);
    const programme = await createProgramme(tenant.id, division.id);
    const targetPublication = await createPublication(tenant.id, "targeted");
    await insertCriterion({
      ...baseCriterion(tenant.id, targetPublication.id),
      dimension: "campus",
      campusId: campusB,
      academicYear: null,
    });
    await insertCriterion({
      ...baseCriterion(tenant.id, targetPublication.id),
      dimension: "campus",
      campusId: campusA,
      academicYear: null,
    });
    await insertCriterion({
      ...baseCriterion(tenant.id, targetPublication.id),
      dimension: "programme",
      programmeId: programme.id,
      academicYear: null,
    });
    await insertCriterion({
      ...baseCriterion(tenant.id, targetPublication.id),
      dimension: "academic_year",
      academicYear: 2027,
    });

    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        targetPublication.id,
      ),
    ).resolves.toEqual({
      tenantId: tenant.id,
      publicationId: targetPublication.id,
      mode: "targeted",
      groups: [
        {
          dimension: "campus",
          provenancePolicy: "authoritative_only",
          campusIds: [campusA, campusB].sort((left, right) =>
            left.localeCompare(right),
          ),
        },
        {
          dimension: "programme",
          provenancePolicy: "authoritative_only",
          programmeIds: [programme.id],
        },
        {
          dimension: "academic_year",
          provenancePolicy: "authoritative_only",
          academicYears: [2027],
        },
      ],
    });

    const residence = await createResidence(tenant.id);
    const residencePublication = await createPublication(tenant.id, "targeted");
    await insertCriterion({
      ...baseCriterion(tenant.id, residencePublication.id),
      dimension: "residence",
      academicYear: null,
      residenceTarget: "non_resident",
      residenceId: null,
    });
    await insertCriterion({
      ...baseCriterion(tenant.id, residencePublication.id),
      dimension: "residence",
      academicYear: null,
      residenceTarget: "specific_residence",
      residenceId: residence,
    });
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        residencePublication.id,
      ),
    ).resolves.toMatchObject({
      mode: "targeted",
      groups: [
        {
          dimension: "residence",
          residenceTargets: [
            { kind: "specific_residence", residenceId: residence },
            { kind: "non_resident" },
          ],
        },
      ],
    });

    const conflictingPublication = await createPublication(tenant.id, "targeted");
    await insertCriterion({
      ...baseCriterion(tenant.id, conflictingPublication.id),
      dimension: "campus",
      campusId: campusA,
      academicYear: null,
    });
    await insertCriterion({
      ...baseCriterion(tenant.id, conflictingPublication.id),
      dimension: "campus",
      provenancePolicy: "allow_self_declared",
      campusId: campusB,
      academicYear: null,
    });
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        conflictingPublication.id,
      ),
    ).resolves.toBeNull();

    const foreignTenant = await createTenant();
    const foreignPublication = await createPublication(foreignTenant.id);
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        foreignPublication.id,
      ),
    ).resolves.toBeNull();
  });

  it("replaces draft audiences atomically and supports draft-to-targeted-to-entire", async () => {
    const tenant = await createTenant();
    await createYearConfig(tenant.id, { minimumYear: 2024, maximumYear: 2028 });
    const campusA = await createCampus(tenant.id);
    const campusB = await createCampus(tenant.id);
    const publication = await createPublication(tenant.id);

    const firstDefinition = targetedDefinition(tenant.id, publication.id, [
      {
        dimension: "campus",
        provenancePolicy: "authoritative_only",
        campusIds: [campusB, campusA],
      },
      {
        dimension: "academic_year",
        provenancePolicy: "allow_self_declared",
        academicYears: [2026],
      },
    ]);
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        publication.id,
        firstDefinition,
      ),
    ).resolves.toEqual(firstDefinition);
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        publication.id,
      ),
    ).resolves.toEqual({
      ...firstDefinition,
      groups: [
        {
          ...firstDefinition.groups[0],
          campusIds: [campusA, campusB].sort((left, right) =>
            left.localeCompare(right),
          ),
        },
        firstDefinition.groups[1],
      ],
    });

    const secondDefinition = targetedDefinition(tenant.id, publication.id, [
      {
        dimension: "campus",
        provenancePolicy: "authoritative_only",
        campusIds: [campusB],
      },
    ]);
    await audienceRepository.replaceDraftPublicationAudienceForTenant(
      tenant.id,
      publication.id,
      secondDefinition,
    );
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        publication.id,
      ),
    ).resolves.toEqual(secondDefinition);

    const entireDefinition: PublicationAudienceDefinition = {
      tenantId: tenant.id,
      publicationId: publication.id,
      mode: "entire_tenant",
      groups: [],
    };
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        publication.id,
        entireDefinition,
      ),
    ).resolves.toEqual(entireDefinition);
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        publication.id,
      ),
    ).resolves.toEqual(entireDefinition);
  });

  it("allows scheduled replacement and rejects immutable lifecycle states", async () => {
    const tenant = await createTenant();
    const scheduled = await createPublication(tenant.id, "entire_tenant", "scheduled");
    const scheduledDefinition: PublicationAudienceDefinition = {
      tenantId: tenant.id,
      publicationId: scheduled.id,
      mode: "entire_tenant",
      groups: [],
    };
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        scheduled.id,
        scheduledDefinition,
      ),
    ).resolves.toEqual(scheduledDefinition);

    for (const lifecycle of ["published", "expired", "archived"] as const) {
      const publication = await createPublication(tenant.id, "entire_tenant", lifecycle);
      await expect(
        audienceRepository.replaceDraftPublicationAudienceForTenant(
          tenant.id,
          publication.id,
          {
            tenantId: tenant.id,
            publicationId: publication.id,
            mode: "entire_tenant",
            groups: [],
          },
        ),
      ).resolves.toBeNull();
    }
  });

  it("rejects cross-Tenant, malformed, unconfigured, out-of-range, and inactive targets", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const publicationA = await createPublication(tenantA.id);
    const publicationB = await createPublication(tenantB.id);
    const foreignCampus = await createCampus(tenantB.id);
    const localCampus = await createCampus(tenantA.id);

    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publicationB.id,
        targetedDefinition(tenantA.id, publicationB.id, [
          {
            dimension: "campus",
            provenancePolicy: "authoritative_only",
            campusIds: [foreignCampus],
          },
        ]),
      ),
    ).resolves.toBeNull();
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publicationA.id,
        targetedDefinition(tenantB.id, publicationA.id, [
          {
            dimension: "campus",
            provenancePolicy: "authoritative_only",
            campusIds: [localCampus],
          },
        ]),
      ),
    ).resolves.toBeNull();
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publicationA.id,
        { tenantId: tenantA.id, publicationId: publicationA.id, mode: "targeted", groups: [] },
      ),
    ).resolves.toBeNull();

    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publicationA.id,
        targetedDefinition(tenantA.id, publicationA.id, [
          {
            dimension: "academic_year",
            provenancePolicy: "authoritative_only",
            academicYears: [2025],
          },
        ]),
      ),
    ).resolves.toBeNull();
    await createYearConfig(tenantA.id, { minimumYear: 2020, maximumYear: 2024 });
    for (const year of [2019, 2025]) {
      await expect(
        audienceRepository.replaceDraftPublicationAudienceForTenant(
          tenantA.id,
          publicationA.id,
          targetedDefinition(tenantA.id, publicationA.id, [
            {
              dimension: "academic_year",
              provenancePolicy: "authoritative_only",
              academicYears: [year],
            },
          ]),
        ),
      ).resolves.toBeNull();
    }

    const inactiveCampus = await createCampus(tenantA.id, { status: "inactive" });
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publicationA.id,
        targetedDefinition(tenantA.id, publicationA.id, [
          {
            dimension: "campus",
            provenancePolicy: "authoritative_only",
            campusIds: [inactiveCampus],
          },
        ]),
      ),
    ).resolves.toBeNull();
  });

  it("rejects merged hierarchy targets and accepts a configured active year", async () => {
    const tenant = await createTenant();
    await createYearConfig(tenant.id, { minimumYear: 2024, maximumYear: 2028 });
    const activeDivision = await createDivision(tenant.id);
    const mergedDivision = await createDivision(tenant.id, {
      status: "merged",
      mergedIntoAcademicDivisionId: activeDivision.id,
      mergedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const publication = await createPublication(tenant.id);

    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        publication.id,
        targetedDefinition(tenant.id, publication.id, [
          {
            dimension: "academic_division",
            provenancePolicy: "authoritative_only",
            academicDivisionIds: [mergedDivision.id],
          },
        ]),
      ),
    ).resolves.toBeNull();

    const validDefinition = targetedDefinition(tenant.id, publication.id, [
      {
        dimension: "academic_year",
        provenancePolicy: "authoritative_only",
        academicYears: [2026],
      },
    ]);
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        publication.id,
        validDefinition,
      ),
    ).resolves.toEqual(validDefinition);
  });

  it("rolls back mode and old criteria when criterion insertion fails", async () => {
    const tenant = await createTenant();
    const campus = await createCampus(tenant.id);
    const publication = await createPublication(tenant.id);
    await createYearConfig(tenant.id);
    const previousDefinition = targetedDefinition(tenant.id, publication.id, [
      {
        dimension: "campus",
        provenancePolicy: "authoritative_only",
        campusIds: [campus],
      },
    ]);
    await audienceRepository.replaceDraftPublicationAudienceForTenant(
      tenant.id,
      publication.id,
      previousDefinition,
    );

    await expectPostgresCode(
      async () => {
        await getDatabase().transaction(async (transaction) => {
          await transaction
            .update(publications)
            .set({ audienceMode: "entire_tenant" })
            .where(
              and(
                eq(publications.tenantId, tenant.id),
                eq(publications.id, publication.id),
              ),
            );
          await transaction
            .delete(publicationAudienceCriteria)
            .where(
              and(
                eq(publicationAudienceCriteria.tenantId, tenant.id),
                eq(publicationAudienceCriteria.publicationId, publication.id),
              ),
            );
          await transaction.insert(publicationAudienceCriteria).values({
            ...baseCriterion(tenant.id, publication.id),
            dimension: "campus",
            campusId: null,
            academicYear: null,
          });
        });
      },
      "23514",
    );

    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        publication.id,
      ),
    ).resolves.toEqual(previousDefinition);
    const persistedMode = await getDatabase()
      .select({ audienceMode: publications.audienceMode })
      .from(publications)
      .where(
        and(
          eq(publications.tenantId, tenant.id),
          eq(publications.id, publication.id),
        ),
      )
      .limit(1);
    expect(persistedMode[0]?.audienceMode).toBe("targeted");
  });
});
