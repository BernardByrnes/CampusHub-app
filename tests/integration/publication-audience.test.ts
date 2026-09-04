import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  evaluatePublicationAudience,
  type PublicationAudienceDefinition,
} from "@/domain/authorization/publication-audience";
import type { ResolvedTenantReadFacts } from "@/domain/authorization/publication-read-contract";
import type { ResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import {
  getPublicationAudienceReadinessForTenant,
  validatePublicationAudienceConfirmationForTenant,
} from "@/application/content/publication-audience-readiness";
import {
  isMembershipAudienceFacts,
  type MembershipAudienceFacts,
} from "@/domain/membership/membership-audience";
import {
  academicDivisions,
  campuses,
  memberships,
  programmes,
  publicationAudienceCriteria,
  publications,
  residences,
  tenantAcademicYearConfig,
  type AcademicDivisionRow,
  type NewAcademicDivisionRow,
  type NewCampusRow,
  type NewMembershipRow,
  type NewPublicationRow,
  type NewProgrammeRow,
  type NewResidenceRow,
  type NewTenantAcademicYearConfigRow,
  type NewTenantRow,
  type ProgrammeRow,
  type PublicationAudienceCriteriaRow,
  type PublicationRow,
  type MembershipRow,
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

async function waitForDatabaseLockWait(queryFragment: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await getDatabase().execute(sql`
      select 1
      from pg_stat_activity
      where pid <> pg_backend_pid()
        and state = 'active'
        and wait_event_type = 'Lock'
        and query ilike ${`%${queryFragment}%`}
      limit 1
    `);
    if (result.rows.length > 0) {
      return;
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  throw new Error("Timed out waiting for the atomic audience lock request.");
}

async function waitForPublicationRowLockWait(): Promise<void> {
  return waitForDatabaseLockWait("for update");
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
  overrides: Partial<NewPublicationRow> = {},
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
      ...overrides,
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

async function createMembership(
  tenantId: string,
  overrides: Partial<NewMembershipRow> = {},
): Promise<MembershipRow> {
  const rows = await getDatabase()
    .insert(memberships)
    .values({
      tenantId,
      identitySubjectId: nextLabel("identity"),
      assuranceLevel: "L2",
      lifecycle: "verified",
      campusId: null,
      campusProvenance: null,
      academicDivisionId: null,
      academicDivisionProvenance: "optional",
      programmeId: null,
      programmeProvenance: "optional",
      academicYear: null,
      academicYearProvenance: "optional",
      residenceState: "unknown",
      residenceId: null,
      residenceProvenance: "optional",
      ...overrides,
    })
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Membership insert returned no row.");
  }

  return row;
}

function toAudienceFacts(row: MembershipRow): MembershipAudienceFacts | null {
  const candidate = {
    membershipId: row.id,
    tenantId: row.tenantId,
    campus: {
      value: row.campusId,
      provenance: row.campusProvenance ?? "optional",
    },
    academicDivision: {
      value: row.academicDivisionId,
      provenance: row.academicDivisionProvenance,
    },
    programme: {
      value: row.programmeId,
      provenance: row.programmeProvenance,
    },
    academicYear: {
      value: row.academicYear,
      provenance: row.academicYearProvenance,
    },
    residence: {
      state: row.residenceState,
      residenceId: row.residenceId,
      provenance: row.residenceProvenance,
    },
  };

  return isMembershipAudienceFacts(candidate) ? candidate : null;
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

function directReadFacts(tenantId: string): ResolvedTenantReadFacts {
  return {
    tenantId,
    tenantStatus: "active",
    publicSurfacePermitted: true,
    onLeaveReadEnabled: true,
    alumniPublicReadEnabled: true,
  };
}

function directReadMembershipViewer(
  tenantId: string,
  membership: MembershipRow,
): ResourceReadViewer {
  return {
    kind: "membership",
    context: {
      identitySubjectId: membership.identitySubjectId,
      tenantId,
      tenantStatus: "active",
      membershipId: membership.id,
      assuranceLevel: membership.assuranceLevel,
      membershipStatus: membership.lifecycle,
    },
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
        .delete(memberships)
        .where(inArray(memberships.tenantId, tenantIds));
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
        1,
        firstDefinition,
      ),
    ).resolves.toEqual({ ok: true, definition: firstDefinition, version: 2 });
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
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        publication.id,
        2,
        secondDefinition,
      ),
    ).resolves.toEqual({ ok: true, definition: secondDefinition, version: 3 });
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
        3,
        entireDefinition,
      ),
    ).resolves.toEqual({ ok: true, definition: entireDefinition, version: 4 });
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
        1,
        scheduledDefinition,
      ),
    ).resolves.toEqual({
      ok: true,
      definition: scheduledDefinition,
      version: 2,
    });

    for (const lifecycle of ["published", "expired", "archived"] as const) {
      const publication = await createPublication(tenant.id, "entire_tenant", lifecycle);
      await expect(
        audienceRepository.replaceDraftPublicationAudienceForTenant(
          tenant.id,
          publication.id,
          1,
          {
            tenantId: tenant.id,
            publicationId: publication.id,
            mode: "entire_tenant",
            groups: [],
          },
        ),
      ).resolves.toEqual({ ok: false, error: "INVALID_STATE" });
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
        1,
        targetedDefinition(tenantA.id, publicationB.id, [
          {
            dimension: "campus",
            provenancePolicy: "authoritative_only",
            campusIds: [foreignCampus],
          },
        ]),
      ),
    ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publicationA.id,
        1,
        targetedDefinition(tenantB.id, publicationA.id, [
          {
            dimension: "campus",
            provenancePolicy: "authoritative_only",
            campusIds: [localCampus],
          },
        ]),
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_AUDIENCE" });
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publicationA.id,
        1,
        { tenantId: tenantA.id, publicationId: publicationA.id, mode: "targeted", groups: [] },
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_AUDIENCE" });

    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publicationA.id,
        1,
        targetedDefinition(tenantA.id, publicationA.id, [
          {
            dimension: "academic_year",
            provenancePolicy: "authoritative_only",
            academicYears: [2025],
          },
        ]),
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_AUDIENCE" });
    await createYearConfig(tenantA.id, { minimumYear: 2020, maximumYear: 2024 });
    for (const year of [2019, 2025]) {
      await expect(
        audienceRepository.replaceDraftPublicationAudienceForTenant(
          tenantA.id,
          publicationA.id,
          1,
          targetedDefinition(tenantA.id, publicationA.id, [
            {
              dimension: "academic_year",
              provenancePolicy: "authoritative_only",
              academicYears: [year],
            },
          ]),
        ),
      ).resolves.toEqual({ ok: false, error: "INVALID_AUDIENCE" });
    }

    const inactiveCampus = await createCampus(tenantA.id, { status: "inactive" });
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publicationA.id,
        1,
        targetedDefinition(tenantA.id, publicationA.id, [
          {
            dimension: "campus",
            provenancePolicy: "authoritative_only",
            campusIds: [inactiveCampus],
          },
        ]),
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_AUDIENCE" });
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
        1,
        targetedDefinition(tenant.id, publication.id, [
          {
            dimension: "academic_division",
            provenancePolicy: "authoritative_only",
            academicDivisionIds: [mergedDivision.id],
          },
        ]),
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_AUDIENCE" });

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
        1,
        validDefinition,
      ),
    ).resolves.toEqual({ ok: true, definition: validDefinition, version: 2 });
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
      1,
      previousDefinition,
    );

    await expectPostgresCode(
      async () => {
        await getDatabase().transaction(async (transaction) => {
          await transaction
            .update(publications)
            .set({
              audienceMode: "entire_tenant",
              version: sql`${publications.version} + 1`,
            })
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
      .select({
        audienceMode: publications.audienceMode,
        version: publications.version,
      })
      .from(publications)
      .where(
        and(
          eq(publications.tenantId, tenant.id),
          eq(publications.id, publication.id),
        ),
      )
      .limit(1);
    expect(persistedMode[0]?.audienceMode).toBe("targeted");
    expect(persistedMode[0]?.version).toBe(2);
  });

  it("uses Publication versions for stale audience writes and immutable states", async () => {
    const tenant = await createTenant();
    const campus = await createCampus(tenant.id);
    const publication = await createPublication(tenant.id);
    await createYearConfig(tenant.id);
    const definition = targetedDefinition(tenant.id, publication.id, [
      {
        dimension: "campus",
        provenancePolicy: "authoritative_only",
        campusIds: [campus],
      },
    ]);

    expect(publication.version).toBe(1);
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        publication.id,
        1,
        definition,
      ),
    ).resolves.toEqual({ ok: true, definition, version: 2 });

    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        publication.id,
        1,
        {
          tenantId: tenant.id,
          publicationId: publication.id,
          mode: "entire_tenant",
          groups: [],
        },
      ),
    ).resolves.toEqual({ ok: false, error: "VERSION_CONFLICT" });
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        publication.id,
      ),
    ).resolves.toEqual(definition);

    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        publication.id,
        2,
        { tenantId: tenant.id, publicationId: publication.id, mode: "targeted", groups: [] },
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_AUDIENCE" });
    const unchanged = await getDatabase()
      .select({ version: publications.version })
      .from(publications)
      .where(
        and(
          eq(publications.tenantId, tenant.id),
          eq(publications.id, publication.id),
        ),
      )
      .limit(1);
    expect(unchanged[0]?.version).toBe(2);

    const versionConstraint = await getDatabase().execute(sql`
      select constraint_name
      from information_schema.check_constraints
      where constraint_schema = 'public'
        and constraint_name = 'publications_version_positive'
    `);
    expect(versionConstraint.rows.map((row) => row.constraint_name)).toEqual([
      "publications_version_positive",
    ]);
    await expectPostgresCode(
      () =>
        getDatabase().transaction(async (transaction) => {
          await transaction
            .update(publications)
            .set({ version: 0 })
            .where(
              and(
                eq(publications.tenantId, tenant.id),
                eq(publications.id, publication.id),
              ),
            );
        }),
      "23514",
    );
    const afterConstraintFailure = await getDatabase()
      .select({ version: publications.version })
      .from(publications)
      .where(eq(publications.id, publication.id))
      .limit(1);
    expect(afterConstraintFailure[0]?.version).toBe(2);

    const immutable = await createPublication(tenant.id, "entire_tenant", "published");
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        immutable.id,
        1,
        {
          tenantId: tenant.id,
          publicationId: immutable.id,
          mode: "entire_tenant",
          groups: [],
        },
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_STATE" });
    const immutableVersion = await getDatabase()
      .select({ version: publications.version })
      .from(publications)
      .where(eq(publications.id, immutable.id))
      .limit(1);
    expect(immutableVersion[0]?.version).toBe(1);
  });

  it("counts complete Membership audience facts with evaluator-equivalent SQL", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    await createYearConfig(tenantA.id, { minimumYear: 1, maximumYear: 4 });
    const campusA = await createCampus(tenantA.id);
    const campusB = await createCampus(tenantA.id);
    const emptyCampus = await createCampus(tenantA.id);
    const division = await createDivision(tenantA.id);
    const programmeX = await createProgramme(tenantA.id, division.id);
    const programmeY = await createProgramme(tenantA.id, division.id);
    const residenceA = await createResidence(tenantA.id);
    const residenceB = await createResidence(tenantA.id);

    const memberA = await createMembership(tenantA.id, {
      campusId: campusA,
      campusProvenance: "roster_derived",
      academicDivisionId: division.id,
      academicDivisionProvenance: "institution_verified",
      programmeId: programmeX.id,
      programmeProvenance: "roster_derived",
      academicYear: 2,
      academicYearProvenance: "roster_derived",
      residenceState: "resident",
      residenceId: residenceA,
      residenceProvenance: "institution_verified",
    });
    const memberB = await createMembership(tenantA.id, {
      campusId: campusB,
      campusProvenance: "institution_verified",
      academicDivisionId: division.id,
      academicDivisionProvenance: "institution_verified",
      programmeId: programmeY.id,
      programmeProvenance: "institution_verified",
      academicYear: 3,
      academicYearProvenance: "institution_verified",
      residenceState: "non_resident",
      residenceProvenance: "roster_derived",
    });
    const selfDeclared = await createMembership(tenantA.id, {
      campusId: campusA,
      campusProvenance: "self_declared",
      academicDivisionId: division.id,
      academicDivisionProvenance: "self_declared",
      programmeId: programmeX.id,
      programmeProvenance: "self_declared",
      academicYear: 2,
      academicYearProvenance: "self_declared",
      residenceState: "resident",
      residenceId: residenceB,
      residenceProvenance: "self_declared",
    });
    const unknownResidence = await createMembership(tenantA.id, {
      campusId: campusA,
      campusProvenance: "roster_derived",
      academicDivisionId: division.id,
      academicDivisionProvenance: "roster_derived",
      programmeId: programmeX.id,
      programmeProvenance: "roster_derived",
      academicYear: 2,
      academicYearProvenance: "roster_derived",
      residenceState: "unknown",
      residenceId: null,
      residenceProvenance: "optional",
    });
    const missingCampus = await createMembership(tenantA.id, {
      campusId: null,
      campusProvenance: null,
      academicDivisionId: division.id,
      academicDivisionProvenance: "roster_derived",
      programmeId: programmeX.id,
      programmeProvenance: "roster_derived",
      academicYear: 2,
      academicYearProvenance: "roster_derived",
    });
    await createMembership(tenantB.id);
    const fixtureRows = [
      memberA,
      memberB,
      selfDeclared,
      unknownResidence,
      missingCampus,
    ];

    const countAudience = async (
      groups: PublicationAudienceDefinition["groups"],
    ): Promise<number> => {
      const publication = await createPublication(tenantA.id, "targeted");
      const definition = targetedDefinition(tenantA.id, publication.id, groups);
      await expect(
        audienceRepository.replaceDraftPublicationAudienceForTenant(
          tenantA.id,
          publication.id,
          1,
          definition,
        ),
      ).resolves.toMatchObject({ ok: true, version: 2 });
      const count = await audienceRepository.countPublicationAudienceMembershipsForTenant(
        tenantA.id,
        publication.id,
      );
      expect(typeof count).toBe("number");
      return count ?? -1;
    };

    const entire = await createPublication(tenantA.id);
    expect(
      await audienceRepository.countPublicationAudienceMembershipsForTenant(
        tenantA.id,
        entire.id,
      ),
    ).toBe(5);

    const campusAuthoritative = [
      {
        dimension: "campus" as const,
        provenancePolicy: "authoritative_only" as const,
        campusIds: [campusA],
      },
    ];
    const campusAllowSelf = [
      {
        dimension: "campus" as const,
        provenancePolicy: "allow_self_declared" as const,
        campusIds: [campusA],
      },
    ];
    const dimensionCases: Array<{
      groups: PublicationAudienceDefinition["groups"];
      expected: number;
    }> = [
      { groups: campusAuthoritative, expected: 2 },
      { groups: campusAllowSelf, expected: 3 },
      {
        groups: [
          {
            dimension: "campus",
            provenancePolicy: "authoritative_only",
            campusIds: [campusA, campusB],
          },
        ],
        expected: 3,
      },
      {
        groups: [
          ...campusAuthoritative,
          {
            dimension: "programme",
            provenancePolicy: "authoritative_only",
            programmeIds: [programmeX.id],
          },
        ],
        expected: 2,
      },
      {
        groups: [
          {
            dimension: "programme",
            provenancePolicy: "authoritative_only",
            programmeIds: [programmeX.id, programmeY.id],
          },
        ],
        expected: 3,
      },
      {
        groups: [
          {
            dimension: "academic_division",
            provenancePolicy: "authoritative_only",
            academicDivisionIds: [division.id],
          },
        ],
        expected: 3,
      },
      {
        groups: [
          {
            dimension: "academic_division",
            provenancePolicy: "allow_self_declared",
            academicDivisionIds: [division.id],
          },
        ],
        expected: 4,
      },
      {
        groups: [
          {
            dimension: "academic_year",
            provenancePolicy: "authoritative_only",
            academicYears: [2],
          },
        ],
        expected: 2,
      },
      {
        groups: [
          {
            dimension: "academic_year",
            provenancePolicy: "allow_self_declared",
            academicYears: [2],
          },
        ],
        expected: 3,
      },
      {
        groups: [
          {
            dimension: "programme",
            provenancePolicy: "allow_self_declared",
            programmeIds: [programmeX.id],
          },
        ],
        expected: 3,
      },
      {
        groups: [
          {
            dimension: "residence",
            provenancePolicy: "authoritative_only",
            residenceTargets: [{ kind: "specific_residence", residenceId: residenceA }],
          },
        ],
        expected: 1,
      },
      {
        groups: [
          {
            dimension: "residence",
            provenancePolicy: "authoritative_only",
            residenceTargets: [{ kind: "any_resident" }],
          },
        ],
        expected: 1,
      },
      {
        groups: [
          {
            dimension: "residence",
            provenancePolicy: "allow_self_declared",
            residenceTargets: [{ kind: "any_resident" }],
          },
        ],
        expected: 2,
      },
      {
        groups: [
          {
            dimension: "residence",
            provenancePolicy: "authoritative_only",
            residenceTargets: [{ kind: "non_resident" }],
          },
        ],
        expected: 1,
      },
      {
        groups: [
          {
            dimension: "residence",
            provenancePolicy: "allow_self_declared",
            residenceTargets: [{ kind: "specific_residence", residenceId: residenceB }],
          },
        ],
        expected: 1,
      },
      {
        groups: [
          {
            dimension: "campus",
            provenancePolicy: "authoritative_only",
            campusIds: [emptyCampus],
          },
        ],
        expected: 0,
      },
    ];

    for (const testCase of dimensionCases) {
      const publication = await createPublication(tenantA.id, "targeted");
      const definition = targetedDefinition(tenantA.id, publication.id, testCase.groups);
      const result = await audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        publication.id,
        1,
        definition,
      );
      expect(result).toMatchObject({ ok: true });
      const sqlCount = await audienceRepository.countPublicationAudienceMembershipsForTenant(
        tenantA.id,
        publication.id,
      );
      expect(sqlCount).toBe(testCase.expected);

      const evaluatorCount = fixtureRows.filter((row) =>
        evaluatePublicationAudience(
          definition,
          toAudienceFacts(row),
        ).eligible,
      ).length;
      expect(sqlCount).toBe(evaluatorCount);
    }

    const allowSelfResidence = await countAudience([
      {
        dimension: "residence",
        provenancePolicy: "allow_self_declared",
        residenceTargets: [{ kind: "specific_residence", residenceId: residenceB }],
      },
    ]);
    expect(allowSelfResidence).toBe(1);
  }, 120_000);

  it("returns readiness only for valid current definitions and targets", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    await createYearConfig(tenantA.id, { minimumYear: 2020, maximumYear: 2030 });
    const activeCampus = await createCampus(tenantA.id);
    const inactiveCampus = await createCampus(tenantA.id, { status: "inactive" });
    const activeDivision = await createDivision(tenantA.id);
    const mergedDivision = await createDivision(tenantA.id, {
      status: "merged",
      mergedIntoAcademicDivisionId: activeDivision.id,
      mergedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const activeProgramme = await createProgramme(tenantA.id, activeDivision.id);
    const inactiveProgramme = await createProgramme(tenantA.id, activeDivision.id, {
      status: "inactive",
    });
    const mergedProgramme = await createProgramme(tenantA.id, activeDivision.id, {
      status: "merged",
      mergedIntoProgrammeId: activeProgramme.id,
      mergedEffectiveAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    const inactiveResidence = await createResidence(tenantA.id, { status: "inactive" });

    const entire = await createPublication(tenantA.id);
    await createMembership(tenantA.id, { campusId: activeCampus, campusProvenance: "roster_derived" });
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: audienceRepository },
        tenantA.id,
        entire.id,
      ),
    ).resolves.toMatchObject({
      publicationVersion: 1,
      audienceMode: "entire_tenant",
      estimatedRecipientCount: 1,
      audienceDefinitionValid: true,
      targetsCurrentlyValid: true,
      requiresAudienceSizeConfirmation: true,
    });

    const validTargeted = await createPublication(tenantA.id, "targeted");
    const validDefinition = targetedDefinition(tenantA.id, validTargeted.id, [
      {
        dimension: "campus",
        provenancePolicy: "authoritative_only",
        campusIds: [activeCampus],
      },
    ]);
    await expect(
      audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenantA.id,
        validTargeted.id,
        1,
        validDefinition,
      ),
    ).resolves.toMatchObject({ ok: true, version: 2 });
    const validReadiness = await getPublicationAudienceReadinessForTenant(
      { publications: audienceRepository },
      tenantA.id,
      validTargeted.id,
    );
    expect(validReadiness).toMatchObject({
      publicationVersion: 2,
      audienceDefinitionValid: true,
      targetsCurrentlyValid: true,
      estimatedRecipientCount: 1,
    });
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: audienceRepository },
        tenantA.id,
        validTargeted.id,
      ),
    ).resolves.toEqual(validReadiness);

    const noCriteria = await createPublication(tenantA.id, "targeted");
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: audienceRepository },
        tenantA.id,
        noCriteria.id,
      ),
    ).resolves.toMatchObject({
      audienceDefinitionValid: false,
      targetsCurrentlyValid: false,
      estimatedRecipientCount: null,
      requiresAudienceSizeConfirmation: false,
    });

    const invalidPersistedCases: Array<{
      criterion: CriterionInsert;
    }> = [
      {
        criterion: {
          ...baseCriterion(tenantA.id, "placeholder"),
          dimension: "campus",
          campusId: inactiveCampus,
          academicYear: null,
        },
      },
      {
        criterion: {
          ...baseCriterion(tenantA.id, "placeholder"),
          dimension: "academic_division",
          academicDivisionId: mergedDivision.id,
          academicYear: null,
        },
      },
      {
        criterion: {
          ...baseCriterion(tenantA.id, "placeholder"),
          dimension: "programme",
          programmeId: inactiveProgramme.id,
          academicYear: null,
        },
      },
      {
        criterion: {
          ...baseCriterion(tenantA.id, "placeholder"),
          dimension: "programme",
          programmeId: mergedProgramme.id,
          academicYear: null,
        },
      },
      {
        criterion: {
          ...baseCriterion(tenantA.id, "placeholder"),
          dimension: "residence",
          residenceTarget: "specific_residence",
          residenceId: inactiveResidence,
          academicYear: null,
        },
      },
      {
        criterion: {
          ...baseCriterion(tenantA.id, "placeholder"),
          dimension: "academic_year",
          academicYear: 2040,
        },
      },
    ];

    for (const { criterion } of invalidPersistedCases) {
      const publication = await createPublication(tenantA.id, "targeted");
      await insertCriterion({ ...criterion, publicationId: publication.id });
      await expect(
        getPublicationAudienceReadinessForTenant(
          { publications: audienceRepository },
          tenantA.id,
          publication.id,
        ),
      ).resolves.toMatchObject({
        audienceDefinitionValid: true,
        targetsCurrentlyValid: false,
        estimatedRecipientCount: null,
      });
    }

    const conflicting = await createPublication(tenantA.id, "targeted");
    await insertCriterion({
      ...baseCriterion(tenantA.id, conflicting.id),
      dimension: "campus",
      campusId: activeCampus,
      academicYear: null,
    });
    await insertCriterion({
      ...baseCriterion(tenantA.id, conflicting.id),
      dimension: "campus",
      provenancePolicy: "allow_self_declared",
      campusId: inactiveCampus,
      academicYear: null,
    });
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: audienceRepository },
        tenantA.id,
        conflicting.id,
      ),
    ).resolves.toMatchObject({
      audienceDefinitionValid: false,
      targetsCurrentlyValid: false,
      estimatedRecipientCount: null,
    });

    const foreign = await createPublication(tenantB.id);
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: audienceRepository },
        tenantA.id,
        foreign.id,
      ),
    ).resolves.toBeNull();
  });

  it("revalidates audience confirmations against current version and count", async () => {
    const tenant = await createTenant();
    const publication = await createPublication(tenant.id);
    const dependencies = { publications: audienceRepository };

    await expect(
      validatePublicationAudienceConfirmationForTenant(
        dependencies,
        tenant.id,
        publication.id,
        { expectedPublicationVersion: 1, confirmedRecipientCount: 0 },
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      validatePublicationAudienceConfirmationForTenant(
        dependencies,
        tenant.id,
        publication.id,
        { expectedPublicationVersion: 2, confirmedRecipientCount: 0 },
      ),
    ).resolves.toEqual({ ok: false, error: "VERSION_CONFLICT" });

    await createMembership(tenant.id);
    await expect(
      validatePublicationAudienceConfirmationForTenant(
        dependencies,
        tenant.id,
        publication.id,
        { expectedPublicationVersion: 1, confirmedRecipientCount: 0 },
      ),
    ).resolves.toEqual({ ok: false, error: "RECONFIRM_REQUIRED" });
  });

  it("rejects stale confirmation after a locked replacement commits a new audience", async () => {
    const tenant = await createTenant();
    const campusA = await createCampus(tenant.id);
    const campusB = await createCampus(tenant.id);
    const memberA = await createMembership(tenant.id, {
      campusId: campusA,
      campusProvenance: "roster_derived",
    });
    const memberB = await createMembership(tenant.id, {
      campusId: campusB,
      campusProvenance: "roster_derived",
    });
    const publication = await createPublication(tenant.id, "targeted");
    await insertCriterion({
      ...baseCriterion(tenant.id, publication.id),
      dimension: "campus",
      campusId: campusA,
      academicYear: null,
    });

    const initialReadiness = await getPublicationAudienceReadinessForTenant(
      { publications: audienceRepository },
      tenant.id,
      publication.id,
    );
    expect(initialReadiness).toMatchObject({
      publicationVersion: 1,
      estimatedRecipientCount: 1,
      audienceDefinitionValid: true,
      targetsCurrentlyValid: true,
    });
    expect(memberA.id).not.toBe(memberB.id);

    let replacementReady!: () => void;
    const replacementIsReady = new Promise<void>((resolve) => {
      replacementReady = resolve;
    });
    let allowReplacementCommit!: () => void;
    const replacementMayCommit = new Promise<void>((resolve) => {
      allowReplacementCommit = resolve;
    });

    const replacementTransaction = getDatabase().transaction(async (transaction) => {
      const lockedRows = await transaction
        .select({ id: publications.id, version: publications.version })
        .from(publications)
        .where(
          and(
            eq(publications.tenantId, tenant.id),
            eq(publications.id, publication.id),
          ),
        )
        .for("update")
        .limit(1);
      expect(lockedRows[0]?.version).toBe(1);

      await transaction
        .update(publications)
        .set({
          audienceMode: "targeted",
          version: sql`${publications.version} + 1`,
          updatedAt: new Date(),
        })
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
        campusId: campusB,
        academicYear: null,
      });

      replacementReady();
      await replacementMayCommit;
    });

    await replacementIsReady;
    const staleConfirmation = validatePublicationAudienceConfirmationForTenant(
      { publications: audienceRepository },
      tenant.id,
      publication.id,
      { expectedPublicationVersion: 1, confirmedRecipientCount: 1 },
    );
    let lockWaitError: unknown;
    try {
      await waitForPublicationRowLockWait();
    } catch (error) {
      lockWaitError = error;
    } finally {
      allowReplacementCommit();
    }

    await replacementTransaction;
    if (lockWaitError !== undefined) {
      throw lockWaitError;
    }
    await expect(staleConfirmation).resolves.toEqual({
      ok: false,
      error: "VERSION_CONFLICT",
    });

    const currentReadiness = await getPublicationAudienceReadinessForTenant(
      { publications: audienceRepository },
      tenant.id,
      publication.id,
    );
    expect(currentReadiness).toMatchObject({
      publicationVersion: 2,
      estimatedRecipientCount: 1,
      audienceDefinitionValid: true,
      targetsCurrentlyValid: true,
    });
    await expect(
      audienceRepository.findPublicationAudienceDefinitionForTenant(
        tenant.id,
        publication.id,
      ),
    ).resolves.toEqual(
      targetedDefinition(tenant.id, publication.id, [
        {
          dimension: "campus",
          provenancePolicy: "authoritative_only",
          campusIds: [campusB],
        },
      ]),
    );
  }, 120_000);

  it("keeps replacement behind an authoritative confirmation lock", async () => {
    const tenant = await createTenant();
    const campusA = await createCampus(tenant.id);
    const campusB = await createCampus(tenant.id);
    await createMembership(tenant.id, {
      campusId: campusA,
      campusProvenance: "roster_derived",
    });
    await createMembership(tenant.id, {
      campusId: campusB,
      campusProvenance: "roster_derived",
    });
    const publication = await createPublication(tenant.id, "targeted");
    const definitionA = targetedDefinition(tenant.id, publication.id, [
      {
        dimension: "campus",
        provenancePolicy: "authoritative_only",
        campusIds: [campusA],
      },
    ]);
    const definitionB = targetedDefinition(tenant.id, publication.id, [
      {
        dimension: "campus",
        provenancePolicy: "authoritative_only",
        campusIds: [campusB],
      },
    ]);
    await insertCriterion({
      ...baseCriterion(tenant.id, publication.id),
      dimension: "campus",
      campusId: campusA,
      academicYear: null,
    });

    const initialReadiness = await getPublicationAudienceReadinessForTenant(
      { publications: audienceRepository },
      tenant.id,
      publication.id,
    );
    expect(initialReadiness).toMatchObject({
      publicationVersion: 1,
      estimatedRecipientCount: 1,
    });

    let tableLockReady!: () => void;
    const tableLockIsReady = new Promise<void>((resolve) => {
      tableLockReady = resolve;
    });
    let releaseTableLock!: () => void;
    const tableLockMayRelease = new Promise<void>((resolve) => {
      releaseTableLock = resolve;
    });
    const tableLockTransaction = getDatabase().transaction(async (transaction) => {
      await transaction.execute(
        sql`lock table "memberships" in access exclusive mode`,
      );
      tableLockReady();
      await tableLockMayRelease;
    });

    await tableLockIsReady;
    const authoritativeConfirmation =
      validatePublicationAudienceConfirmationForTenant(
        { publications: audienceRepository },
        tenant.id,
        publication.id,
        { expectedPublicationVersion: 1, confirmedRecipientCount: 1 },
      );

    let orchestrationError: unknown;
    let replacementPromise: Promise<unknown> | undefined;
    try {
      await waitForDatabaseLockWait("count(*)");
      replacementPromise = audienceRepository.replaceDraftPublicationAudienceForTenant(
        tenant.id,
        publication.id,
        1,
        definitionB,
      );
      await waitForPublicationRowLockWait();
    } catch (error) {
      orchestrationError = error;
    } finally {
      releaseTableLock();
    }

    await tableLockTransaction;
    let confirmationResult: unknown;
    let confirmationError: unknown;
    try {
      confirmationResult = await authoritativeConfirmation;
    } catch (error) {
      confirmationError = error;
    }
    let replacementResult: unknown;
    let replacementError: unknown;
    if (replacementPromise !== undefined) {
      try {
        replacementResult = await replacementPromise;
      } catch (error) {
        replacementError = error;
      }
    }

    if (orchestrationError !== undefined) {
      throw orchestrationError;
    }
    if (confirmationError !== undefined) {
      throw confirmationError;
    }
    if (replacementError !== undefined) {
      throw replacementError;
    }

    expect(confirmationResult).toEqual({ ok: true });
    expect(replacementResult).toMatchObject({ ok: true, version: 2 });
    expect(definitionA).not.toEqual(definitionB);
    await expect(
      getPublicationAudienceReadinessForTenant(
        { publications: audienceRepository },
        tenant.id,
        publication.id,
      ),
    ).resolves.toMatchObject({
      publicationVersion: 2,
      estimatedRecipientCount: 1,
    });
  }, 120_000);

  it("authorizes real targeted Publication reads from persisted definitions and Membership facts", async () => {
    const { ReadPublicationService } = await import(
      "@/application/content/read-publication"
    );
    const { PersistedPublicationAudienceResolver } = await import(
      "@/application/content/publication-read-resolvers"
    );
    const { DrizzleMembershipRepository } = await import(
      "@/server/repositories/membership-repository"
    );

    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const campusA = await createCampus(tenantA.id);
    const divisionA = await createDivision(tenantA.id);
    const programmeA = await createProgramme(tenantA.id, divisionA.id);
    const residenceA = await createResidence(tenantA.id);
    const eligibleMembership = await createMembership(tenantA.id, {
      campusId: campusA,
      campusProvenance: "roster_derived",
      academicDivisionId: divisionA.id,
      academicDivisionProvenance: "roster_derived",
      programmeId: programmeA.id,
      programmeProvenance: "roster_derived",
      academicYear: 2,
      academicYearProvenance: "institution_verified",
      residenceState: "resident",
      residenceId: residenceA,
      residenceProvenance: "roster_derived",
    });
    const ineligibleMembership = await createMembership(tenantA.id, {
      campusId: campusA,
      campusProvenance: "roster_derived",
      academicDivisionId: divisionA.id,
      academicDivisionProvenance: "roster_derived",
      programmeId: programmeA.id,
      programmeProvenance: "roster_derived",
      academicYear: 3,
      academicYearProvenance: "institution_verified",
      residenceState: "resident",
      residenceId: residenceA,
      residenceProvenance: "roster_derived",
    });
    const incompleteMembership = await createMembership(tenantA.id);
    const foreignMembership = await createMembership(tenantB.id);
    const publication = await createPublication(
      tenantA.id,
      "targeted",
      "published",
      {
        visibility: "MEMBERS",
        publishAt: new Date("2026-01-10T12:00:00.000Z"),
      },
    );
    await insertCriterion({
      ...baseCriterion(tenantA.id, publication.id),
      dimension: "campus",
      campusId: campusA,
      academicYear: null,
    });
    await insertCriterion({
      ...baseCriterion(tenantA.id, publication.id),
      dimension: "programme",
      programmeId: programmeA.id,
      academicYear: null,
    });
    await insertCriterion({
      ...baseCriterion(tenantA.id, publication.id),
      dimension: "academic_year",
      academicYear: 2,
    });

    const membershipRepository = new DrizzleMembershipRepository(
      getDatabase() as never,
    );
    const service = new ReadPublicationService({
      publications: audienceRepository,
      exposureResolver: {
        resolveExposure: (candidates) =>
          new Map(
            candidates.map((candidate) => [candidate.id, "READABLE" as const]),
          ),
      },
      audienceResolver: new PersistedPublicationAudienceResolver({
        publications: audienceRepository,
        memberships: membershipRepository,
      }),
    });

    await expect(
      service.getPublicationForRead(
        {
          tenantId: tenantA.id,
          publicationId: publication.id,
          viewer: directReadMembershipViewer(tenantA.id, eligibleMembership),
          tenantFacts: directReadFacts(tenantA.id),
          now: new Date("2026-01-15T12:00:00.000Z"),
        },
      ),
    ).resolves.toMatchObject({ outcome: "FOUND" });
    await expect(
      service.getPublicationForRead({
        tenantId: tenantA.id,
        publicationId: publication.id,
        viewer: directReadMembershipViewer(tenantA.id, ineligibleMembership),
        tenantFacts: directReadFacts(tenantA.id),
        now: new Date("2026-01-15T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
    await expect(
      service.getPublicationForRead({
        tenantId: tenantA.id,
        publicationId: publication.id,
        viewer: directReadMembershipViewer(tenantA.id, foreignMembership),
        tenantFacts: directReadFacts(tenantA.id),
        now: new Date("2026-01-15T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
    await expect(
      service.getPublicationForRead({
        tenantId: tenantA.id,
        publicationId: publication.id,
        viewer: directReadMembershipViewer(tenantA.id, incompleteMembership),
        tenantFacts: directReadFacts(tenantA.id),
        now: new Date("2026-01-15T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
    await expect(
      service.getPublicationForRead({
        tenantId: tenantA.id,
        publicationId: publication.id,
        viewer: { kind: "anonymous", tenantId: tenantA.id },
        tenantFacts: directReadFacts(tenantA.id),
        now: new Date("2026-01-15T12:00:00.000Z"),
      }),
    ).resolves.toEqual({ outcome: "NOT_FOUND" });
  });

  it("keeps direct-read provenance and Residence decisions on the canonical evaluator", async () => {
    const { ReadPublicationService } = await import(
      "@/application/content/read-publication"
    );
    const { PersistedPublicationAudienceResolver } = await import(
      "@/application/content/publication-read-resolvers"
    );
    const { DrizzleMembershipRepository } = await import(
      "@/server/repositories/membership-repository"
    );

    const tenant = await createTenant();
    const campus = await createCampus(tenant.id);
    const division = await createDivision(tenant.id);
    const programme = await createProgramme(tenant.id, division.id);
    const residence = await createResidence(tenant.id);
    const otherResidence = await createResidence(tenant.id);
    const selfDeclaredMembership = await createMembership(tenant.id, {
      campusId: campus,
      campusProvenance: "self_declared",
      academicDivisionId: division.id,
      academicDivisionProvenance: "roster_derived",
      programmeId: programme.id,
      programmeProvenance: "self_declared",
      academicYear: 2,
      academicYearProvenance: "institution_verified",
      residenceState: "resident",
      residenceId: residence,
      residenceProvenance: "roster_derived",
    });
    const rightResidenceMembership = await createMembership(tenant.id, {
      campusId: campus,
      campusProvenance: "roster_derived",
      academicDivisionId: division.id,
      academicDivisionProvenance: "roster_derived",
      programmeId: programme.id,
      programmeProvenance: "roster_derived",
      academicYear: 2,
      academicYearProvenance: "institution_verified",
      residenceState: "resident",
      residenceId: residence,
      residenceProvenance: "roster_derived",
    });
    const wrongResidenceMembership = await createMembership(tenant.id, {
      campusId: campus,
      campusProvenance: "roster_derived",
      academicDivisionId: division.id,
      academicDivisionProvenance: "roster_derived",
      programmeId: programme.id,
      programmeProvenance: "roster_derived",
      academicYear: 2,
      academicYearProvenance: "institution_verified",
      residenceState: "resident",
      residenceId: otherResidence,
      residenceProvenance: "roster_derived",
    });
    const nonResidentMembership = await createMembership(tenant.id, {
      campusId: campus,
      campusProvenance: "roster_derived",
      academicDivisionId: division.id,
      academicDivisionProvenance: "roster_derived",
      programmeId: programme.id,
      programmeProvenance: "roster_derived",
      academicYear: 2,
      academicYearProvenance: "institution_verified",
      residenceState: "non_resident",
      residenceId: null,
      residenceProvenance: "roster_derived",
    });
    const unknownResidenceMembership = await createMembership(tenant.id);

    const service = new ReadPublicationService({
      publications: audienceRepository,
      exposureResolver: {
        resolveExposure: (candidates) =>
          new Map(
            candidates.map((candidate) => [candidate.id, "READABLE" as const]),
          ),
      },
      audienceResolver: new PersistedPublicationAudienceResolver({
        publications: audienceRepository,
        memberships: new DrizzleMembershipRepository(getDatabase() as never),
      }),
    });
    const read = (publicationId: string, membership: MembershipRow) =>
      service.getPublicationForRead({
        tenantId: tenant.id,
        publicationId,
        viewer: directReadMembershipViewer(tenant.id, membership),
        tenantFacts: directReadFacts(tenant.id),
        now: new Date("2026-01-15T12:00:00.000Z"),
      });
    const createPublishedTargeted = () =>
      createPublication(tenant.id, "targeted", "published", {
        visibility: "MEMBERS",
        publishAt: new Date("2026-01-10T12:00:00.000Z"),
      });

    const authoritativePublication = await createPublishedTargeted();
    await insertCriterion({
      ...baseCriterion(tenant.id, authoritativePublication.id),
      dimension: "programme",
      provenancePolicy: "authoritative_only",
      programmeId: programme.id,
      academicYear: null,
    });
    const allowSelfPublication = await createPublishedTargeted();
    await insertCriterion({
      ...baseCriterion(tenant.id, allowSelfPublication.id),
      dimension: "programme",
      provenancePolicy: "allow_self_declared",
      programmeId: programme.id,
      academicYear: null,
    });
    await expect(read(authoritativePublication.id, selfDeclaredMembership)).resolves.toEqual({
      outcome: "NOT_FOUND",
    });
    await expect(read(allowSelfPublication.id, selfDeclaredMembership)).resolves.toMatchObject({
      outcome: "FOUND",
    });

    const specificResidencePublication = await createPublishedTargeted();
    await insertCriterion({
      ...baseCriterion(tenant.id, specificResidencePublication.id),
      dimension: "residence",
      residenceTarget: "specific_residence",
      residenceId: residence,
      academicYear: null,
    });
    await expect(read(specificResidencePublication.id, rightResidenceMembership)).resolves.toMatchObject({
      outcome: "FOUND",
    });
    await expect(read(specificResidencePublication.id, wrongResidenceMembership)).resolves.toEqual({
      outcome: "NOT_FOUND",
    });

    const anyResidentPublication = await createPublishedTargeted();
    await insertCriterion({
      ...baseCriterion(tenant.id, anyResidentPublication.id),
      dimension: "residence",
      residenceTarget: "any_resident",
      residenceId: null,
      academicYear: null,
    });
    await expect(read(anyResidentPublication.id, wrongResidenceMembership)).resolves.toMatchObject({
      outcome: "FOUND",
    });

    const nonResidentPublication = await createPublishedTargeted();
    await insertCriterion({
      ...baseCriterion(tenant.id, nonResidentPublication.id),
      dimension: "residence",
      residenceTarget: "non_resident",
      residenceId: null,
      academicYear: null,
    });
    await expect(read(nonResidentPublication.id, nonResidentMembership)).resolves.toMatchObject({
      outcome: "FOUND",
    });
    await expect(read(nonResidentPublication.id, unknownResidenceMembership)).resolves.toEqual({
      outcome: "NOT_FOUND",
    });
  });

  it("lists mixed targeted and entire-Tenant Publications on ACTIVE and ARCHIVE", async () => {
    const { ListPublicationsService } = await import(
      "@/application/content/list-publications"
    );
    const { PersistedPublicationAudienceBatchResolver } = await import(
      "@/application/content/publication-read-resolvers"
    );
    const { DrizzleMembershipRepository } = await import(
      "@/server/repositories/membership-repository"
    );
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const campusA = await createCampus(tenantA.id);
    const campusB = await createCampus(tenantA.id);
    const membership = await createMembership(tenantA.id, {
      campusId: campusA,
      campusProvenance: "roster_derived",
    });
    const entire = await createPublication(tenantA.id, "entire_tenant", "published", {
      visibility: "MEMBERS",
      publishAt: new Date("2026-01-14T12:00:00.000Z"),
    });
    const eligibleTargeted = await createPublication(
      tenantA.id,
      "targeted",
      "published",
      {
        visibility: "MEMBERS",
        publishAt: new Date("2026-01-13T12:00:00.000Z"),
      },
    );
    await insertCriterion({
      ...baseCriterion(tenantA.id, eligibleTargeted.id),
      dimension: "campus",
      campusId: campusA,
      academicYear: null,
    });
    const ineligibleTargeted = await createPublication(
      tenantA.id,
      "targeted",
      "published",
      {
        visibility: "MEMBERS",
        publishAt: new Date("2026-01-12T12:00:00.000Z"),
      },
    );
    await insertCriterion({
      ...baseCriterion(tenantA.id, ineligibleTargeted.id),
      dimension: "campus",
      campusId: campusB,
      academicYear: null,
    });
    const malformedTargeted = await createPublication(
      tenantA.id,
      "targeted",
      "published",
      {
        visibility: "MEMBERS",
        publishAt: new Date("2026-01-11T12:00:00.000Z"),
      },
    );
    const foreignPublication = await createPublication(
      tenantB.id,
      "entire_tenant",
      "published",
      {
        visibility: "MEMBERS",
        publishAt: new Date("2026-01-15T12:00:00.000Z"),
      },
    );
    const archivedEligible = await createPublication(
      tenantA.id,
      "targeted",
      "archived",
      {
        visibility: "MEMBERS",
        publishAt: new Date("2026-01-10T12:00:00.000Z"),
      },
    );
    await insertCriterion({
      ...baseCriterion(tenantA.id, archivedEligible.id),
      dimension: "campus",
      campusId: campusA,
      academicYear: null,
    });
    const archivedIneligible = await createPublication(
      tenantA.id,
      "targeted",
      "archived",
      {
        visibility: "MEMBERS",
        publishAt: new Date("2026-01-09T12:00:00.000Z"),
      },
    );
    await insertCriterion({
      ...baseCriterion(tenantA.id, archivedIneligible.id),
      dimension: "campus",
      campusId: campusB,
      academicYear: null,
    });

    const membershipRepository = new DrizzleMembershipRepository(
      getDatabase() as never,
    );
    const service = new ListPublicationsService({
      publications: audienceRepository,
      exposureResolver: {
        resolveExposure: (candidates) =>
          new Map(
            candidates.map((candidate) => [candidate.id, "READABLE" as const]),
          ),
      },
      audienceBatchResolver: new PersistedPublicationAudienceBatchResolver({
        publications: audienceRepository,
        memberships: membershipRepository,
      }),
    });
    const viewer = directReadMembershipViewer(tenantA.id, membership);

    const activeResult = await service.listPublications({
      tenantId: tenantA.id,
      surface: "ACTIVE",
      viewer,
      tenantFacts: directReadFacts(tenantA.id),
      now: new Date("2026-01-15T12:00:00.000Z"),
      limit: 50,
    });
    expect(activeResult).toMatchObject({ outcome: "OK", nextCursor: null });
    if (activeResult.outcome === "OK") {
      expect(activeResult.items.map((item) => item.id)).toEqual([
        entire.id,
        eligibleTargeted.id,
      ]);
      expect(activeResult.items.map((item) => item.id)).not.toContain(
        ineligibleTargeted.id,
      );
      expect(activeResult.items.map((item) => item.id)).not.toContain(
        malformedTargeted.id,
      );
      expect(activeResult.items.map((item) => item.id)).not.toContain(
        foreignPublication.id,
      );
    }

    const archiveResult = await service.listPublications({
      tenantId: tenantA.id,
      surface: "ARCHIVE",
      viewer,
      tenantFacts: directReadFacts(tenantA.id),
      now: new Date("2026-01-15T12:00:00.000Z"),
      limit: 50,
    });
    expect(archiveResult).toEqual({
      outcome: "OK",
      items: [expect.objectContaining({ id: archivedEligible.id })],
      nextCursor: null,
    });
    expect(archiveResult.outcome === "OK" ? archiveResult.items.map((item) => item.id) : []).not.toContain(
      archivedIneligible.id,
    );
  });

  it("paginates real collections past hidden targeted rows without duplicates or skips", async () => {
    const { ListPublicationsService } = await import(
      "@/application/content/list-publications"
    );
    const { PersistedPublicationAudienceBatchResolver } = await import(
      "@/application/content/publication-read-resolvers"
    );
    const { DrizzleMembershipRepository } = await import(
      "@/server/repositories/membership-repository"
    );
    const tenant = await createTenant();
    const campusA = await createCampus(tenant.id);
    const campusB = await createCampus(tenant.id);
    const membership = await createMembership(tenant.id, {
      campusId: campusA,
      campusProvenance: "roster_derived",
    });
    const hiddenLeading = await createPublication(tenant.id, "targeted", "published", {
      publishAt: new Date("2026-01-14T12:00:00.000Z"),
    });
    await insertCriterion({
      ...baseCriterion(tenant.id, hiddenLeading.id),
      dimension: "campus",
      campusId: campusB,
      academicYear: null,
    });
    const entireFirst = await createPublication(tenant.id, "entire_tenant", "published", {
      publishAt: new Date("2026-01-13T12:00:00.000Z"),
    });
    const eligibleMiddle = await createPublication(tenant.id, "targeted", "published", {
      publishAt: new Date("2026-01-12T12:00:00.000Z"),
    });
    await insertCriterion({
      ...baseCriterion(tenant.id, eligibleMiddle.id),
      dimension: "campus",
      campusId: campusA,
      academicYear: null,
    });
    const hiddenMiddle = await createPublication(tenant.id, "targeted", "published", {
      publishAt: new Date("2026-01-11T12:00:00.000Z"),
    });
    await insertCriterion({
      ...baseCriterion(tenant.id, hiddenMiddle.id),
      dimension: "campus",
      campusId: campusB,
      academicYear: null,
    });
    const entireSecond = await createPublication(tenant.id, "entire_tenant", "published", {
      publishAt: new Date("2026-01-10T12:00:00.000Z"),
    });
    const queries: Array<{ cursor: unknown; limit: number }> = [];
    const definitionCalls: string[][] = [];
    const membershipCalls: string[][] = [];
    const baseMembershipRepository = new DrizzleMembershipRepository(
      getDatabase() as never,
    );
    const collectionRepository = {
      listPublicationCandidatesForTenant: async (query: {
        tenantId: string;
        surface: "ACTIVE" | "ARCHIVE";
        now: Date;
        cursor: { publishAt: Date; id: string } | null;
        limit: number;
      }) => {
        queries.push({ cursor: query.cursor, limit: query.limit });
        return audienceRepository.listPublicationCandidatesForTenant(query);
      },
      findPublicationAudienceDefinitionsForTenant: async (
        tenantId: string,
        publicationIds: readonly string[],
      ) => {
        definitionCalls.push([...publicationIds]);
        return audienceRepository.findPublicationAudienceDefinitionsForTenant(
          tenantId,
          publicationIds,
        );
      },
    };
    const service = new ListPublicationsService({
      publications: collectionRepository,
      exposureResolver: {
        resolveExposure: (candidates) =>
          new Map(
            candidates.map((candidate) => [candidate.id, "READABLE" as const]),
          ),
      },
      audienceBatchResolver: new PersistedPublicationAudienceBatchResolver({
        publications: collectionRepository,
        memberships: {
          findMembershipAudienceFactsByIdForTenant: async (tenantId, membershipId) => {
            membershipCalls.push([tenantId, membershipId]);
            return baseMembershipRepository.findMembershipAudienceFactsByIdForTenant(
              tenantId,
              membershipId,
            );
          },
        },
      }),
    });
    const viewer = directReadMembershipViewer(tenant.id, membership);
    const list = (cursor?: string | null) =>
      service.listPublications({
        tenantId: tenant.id,
        surface: "ACTIVE",
        viewer,
        tenantFacts: directReadFacts(tenant.id),
        now: new Date("2026-01-15T12:00:00.000Z"),
        limit: 2,
        cursor,
      });

    const pageOne = await list(null);
    expect(pageOne.outcome).toBe("OK");
    if (pageOne.outcome !== "OK" || pageOne.nextCursor === null) {
      throw new Error("Expected page-one cursor for targeted collection.");
    }
    expect(pageOne.items.map((item) => item.id)).toEqual([
      entireFirst.id,
      eligibleMiddle.id,
    ]);

    const pageTwo = await list(pageOne.nextCursor);
    expect(pageTwo).toMatchObject({ outcome: "OK", nextCursor: null });
    if (pageTwo.outcome !== "OK") {
      return;
    }
    expect(pageTwo.items.map((item) => item.id)).toEqual([entireSecond.id]);
    expect(new Set([
      ...pageOne.items.map((item) => item.id),
      ...pageTwo.items.map((item) => item.id),
    ]).size).toBe(3);
    expect(queries).toHaveLength(2);
    expect(definitionCalls).toEqual([
      [hiddenLeading.id, eligibleMiddle.id, hiddenMiddle.id],
      [hiddenMiddle.id],
    ]);
    expect(membershipCalls).toHaveLength(2);
    expect(membershipCalls.every(([tenantId]) => tenantId === tenant.id)).toBe(
      true,
    );
  });
});
