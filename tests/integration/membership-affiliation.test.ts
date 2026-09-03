import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { isMembershipAudienceFacts } from "@/domain/membership/membership-audience";
import type { CampusHubDatabase } from "@/server/db/client";
import {
  academicDivisions,
  campuses,
  memberships,
  programmes,
  residences,
  tenants,
  type AcademicDivisionRow,
  type MembershipRow,
  type NewAcademicDivisionRow,
  type NewCampusRow,
  type NewMembershipRow,
  type NewProgrammeRow,
  type NewResidenceRow,
  type NewTenantRow,
  type ProgrammeRow,
  type ResidenceRow,
  type TenantRow,
} from "@/server/db/schema";
import type { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";

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

const runPrefix = `campushub-membership-${Date.now().toString(36)}-${randomUUID()
  .slice(0, 8)
  .toLowerCase()}`;
let sequence = 0;
let databaseHandle: ReturnType<typeof drizzle> | undefined;
let connectionPool: Pool | undefined;
let MembershipRepositoryConstructor: typeof DrizzleMembershipRepository;
const syntheticTenantIds = new Set<string>();

function getDatabase(): ReturnType<typeof drizzle> {
  if (!databaseHandle) {
    throw new Error("Database was not initialized.");
  }

  return databaseHandle;
}

function nextValue(label: string): string {
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
      slug: nextValue("tenant"),
      displayName: `Synthetic Membership Tenant ${runPrefix}`,
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
): Promise<{ id: string }> {
  const rows = await getDatabase()
    .insert(campuses)
    .values({
      tenantId,
      label: `Synthetic Campus ${runPrefix}`,
      status: "active",
      ...overrides,
    })
    .returning({ id: campuses.id });
  const row = rows[0];

  if (!row) {
    throw new Error("Campus insert returned no row.");
  }

  return row;
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
): Promise<ResidenceRow> {
  const rows = await getDatabase()
    .insert(residences)
    .values({
      tenantId,
      label: `Synthetic Residence ${runPrefix}`,
      status: "active",
      ...overrides,
    })
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Residence insert returned no row.");
  }

  return row;
}

async function createMembership(
  tenantId: string,
  overrides: Partial<NewMembershipRow> = {},
): Promise<MembershipRow> {
  const rows = await getDatabase()
    .insert(memberships)
    .values({
      tenantId,
      identitySubjectId: nextValue("identity"),
      assuranceLevel: "L2",
      lifecycle: "verified",
      ...overrides,
    })
    .returning();
  const row = rows[0];

  if (!row) {
    throw new Error("Membership insert returned no row.");
  }

  return row;
}

async function createCompleteMembership(
  tenantId: string,
): Promise<{
  membership: MembershipRow;
  campusId: string;
  divisionId: string;
  programmeId: string;
  residenceId: string;
}> {
  const campus = await createCampus(tenantId);
  const division = await createDivision(tenantId);
  const programme = await createProgramme(tenantId, division.id);
  const residence = await createResidence(tenantId);
  const membership = await createMembership(tenantId, {
    campusId: campus.id,
    campusProvenance: "institution_verified",
    academicDivisionId: division.id,
    academicDivisionProvenance: "roster_derived",
    programmeId: programme.id,
    programmeProvenance: "self_declared",
    academicYear: 2,
    academicYearProvenance: "institution_verified",
    residenceState: "resident",
    residenceId: residence.id,
    residenceProvenance: "self_declared",
  });

  return {
    membership,
    campusId: campus.id,
    divisionId: division.id,
    programmeId: programme.id,
    residenceId: residence.id,
  };
}

function createRepository(): DrizzleMembershipRepository {
  return new MembershipRepositoryConstructor(
    getDatabase() as unknown as CampusHubDatabase,
  );
}

beforeAll(async () => {
  const repositoryModule = await import(
    "@/server/repositories/membership-repository"
  );
  MembershipRepositoryConstructor = repositoryModule.DrizzleMembershipRepository;
  connectionPool = new Pool({ connectionString: configuredDatabaseUrl });
  databaseHandle = drizzle({ client: connectionPool });
  await connectionPool.query("select 1");
});

afterAll(async () => {
  try {
    if (databaseHandle && syntheticTenantIds.size > 0) {
      const tenantIds = [...syntheticTenantIds];
      await databaseHandle
        .delete(memberships)
        .where(inArray(memberships.tenantId, tenantIds));
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
        .delete(tenants)
        .where(inArray(tenants.id, tenantIds));
    }
  } finally {
    await connectionPool?.end();
  }
});

describe("real PostgreSQL Membership affiliation constraints", () => {
  it("rejects a Membership in Tenant A referencing a Campus in Tenant B", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const campusB = await createCampus(tenantB.id);

    await expectPostgresCode(
      () =>
        createMembership(tenantA.id, {
          campusId: campusB.id,
          campusProvenance: "institution_verified",
        }),
      "23503",
    );
  });

  it("rejects a Membership in Tenant A referencing a Division in Tenant B", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const divisionB = await createDivision(tenantB.id);

    await expectPostgresCode(
      () =>
        createMembership(tenantA.id, {
          academicDivisionId: divisionB.id,
          academicDivisionProvenance: "institution_verified",
        }),
      "23503",
    );
  });

  it("rejects a Membership in Tenant A referencing a Programme in Tenant B", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const divisionA = await createDivision(tenantA.id);
    const divisionB = await createDivision(tenantB.id);
    const programmeB = await createProgramme(tenantB.id, divisionB.id);

    await expectPostgresCode(
      () =>
        createMembership(tenantA.id, {
          academicDivisionId: divisionA.id,
          academicDivisionProvenance: "institution_verified",
          programmeId: programmeB.id,
          programmeProvenance: "institution_verified",
        }),
      "23503",
    );
  });

  it("rejects a Membership in Tenant A referencing a Residence in Tenant B", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const residenceB = await createResidence(tenantB.id);

    await expectPostgresCode(
      () =>
        createMembership(tenantA.id, {
          residenceState: "resident",
          residenceId: residenceB.id,
          residenceProvenance: "institution_verified",
        }),
      "23503",
    );
  });

  it("rejects a populated Programme without a Division", async () => {
    const tenant = await createTenant();
    const division = await createDivision(tenant.id);
    const programme = await createProgramme(tenant.id, division.id);

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          programmeId: programme.id,
          programmeProvenance: "institution_verified",
        }),
      "23514",
    );
  });

  it("rejects a Programme whose selected Division does not match", async () => {
    const tenant = await createTenant();
    const selectedDivision = await createDivision(tenant.id);
    const programmeDivision = await createDivision(tenant.id);
    const programme = await createProgramme(tenant.id, programmeDivision.id);

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          academicDivisionId: selectedDivision.id,
          academicDivisionProvenance: "institution_verified",
          programmeId: programme.id,
          programmeProvenance: "institution_verified",
        }),
      "23503",
    );
  });

  it("accepts a Programme and Division that match", async () => {
    const tenant = await createTenant();
    const division = await createDivision(tenant.id);
    const programme = await createProgramme(tenant.id, division.id);

    const membership = await createMembership(tenant.id, {
      academicDivisionId: division.id,
      academicDivisionProvenance: "institution_verified",
      programmeId: programme.id,
      programmeProvenance: "roster_derived",
    });

    expect(membership.programmeId).toBe(programme.id);
    expect(membership.academicDivisionId).toBe(division.id);
  });

  it("rejects academic year zero", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          academicYear: 0,
          academicYearProvenance: "institution_verified",
        }),
      "23514",
    );
  });

  it("rejects a populated academic year with optional provenance", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          academicYear: 2,
          academicYearProvenance: "optional",
        }),
      "23514",
    );
  });

  it("rejects a null academic year with evidenced provenance", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          academicYear: null,
          academicYearProvenance: "roster_derived",
        }),
      "23514",
    );
  });

  it("rejects a populated Division with optional provenance", async () => {
    const tenant = await createTenant();
    const division = await createDivision(tenant.id);

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          academicDivisionId: division.id,
          academicDivisionProvenance: "optional",
        }),
      "23514",
    );
  });

  it("rejects a populated Programme with optional provenance", async () => {
    const tenant = await createTenant();
    const division = await createDivision(tenant.id);
    const programme = await createProgramme(tenant.id, division.id);

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          academicDivisionId: division.id,
          academicDivisionProvenance: "institution_verified",
          programmeId: programme.id,
          programmeProvenance: "optional",
        }),
      "23514",
    );
  });

  it("rejects a populated Campus with optional provenance", async () => {
    const tenant = await createTenant();
    const campus = await createCampus(tenant.id);

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          campusId: campus.id,
          campusProvenance: "optional",
        }),
      "23514",
    );
  });

  it("rejects a missing Campus with non-null provenance", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          campusId: null,
          campusProvenance: "self_declared",
        }),
      "23514",
    );
  });

  it("accepts a missing Campus with null provenance as transitional persistence", async () => {
    const tenant = await createTenant();
    const membership = await createMembership(tenant.id, {
      campusId: null,
      campusProvenance: null,
    });

    expect(membership.campusId).toBeNull();
    expect(membership.campusProvenance).toBeNull();
  });

  it("rejects an unknown Residence with a Residence ID", async () => {
    const tenant = await createTenant();
    const residence = await createResidence(tenant.id);

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          residenceState: "unknown",
          residenceId: residence.id,
          residenceProvenance: "institution_verified",
        }),
      "23514",
    );
  });

  it("rejects an unknown Residence with non-optional provenance", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          residenceState: "unknown",
          residenceId: null,
          residenceProvenance: "roster_derived",
        }),
      "23514",
    );
  });

  it("rejects a resident Membership without a Residence ID", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          residenceState: "resident",
          residenceId: null,
          residenceProvenance: "institution_verified",
        }),
      "23514",
    );
  });

  it("rejects a resident Membership with optional provenance", async () => {
    const tenant = await createTenant();
    const residence = await createResidence(tenant.id);

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          residenceState: "resident",
          residenceId: residence.id,
          residenceProvenance: "optional",
        }),
      "23514",
    );
  });

  it("rejects a non-resident Membership with a Residence ID", async () => {
    const tenant = await createTenant();
    const residence = await createResidence(tenant.id);

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          residenceState: "non_resident",
          residenceId: residence.id,
          residenceProvenance: "institution_verified",
        }),
      "23514",
    );
  });

  it("rejects a non-resident Membership with optional provenance", async () => {
    const tenant = await createTenant();

    await expectPostgresCode(
      () =>
        createMembership(tenant.id, {
          residenceState: "non_resident",
          residenceId: null,
          residenceProvenance: "optional",
        }),
      "23514",
    );
  });

  it("accepts a valid resident Membership", async () => {
    const tenant = await createTenant();
    const residence = await createResidence(tenant.id);
    const membership = await createMembership(tenant.id, {
      residenceState: "resident",
      residenceId: residence.id,
      residenceProvenance: "institution_verified",
    });

    expect(membership.residenceState).toBe("resident");
    expect(membership.residenceId).toBe(residence.id);
  });

  it("accepts a valid non-resident Membership", async () => {
    const tenant = await createTenant();
    const membership = await createMembership(tenant.id, {
      residenceState: "non_resident",
      residenceId: null,
      residenceProvenance: "roster_derived",
    });

    expect(membership.residenceState).toBe("non_resident");
    expect(membership.residenceId).toBeNull();
  });

  it("accepts a valid unknown Residence state", async () => {
    const tenant = await createTenant();
    const membership = await createMembership(tenant.id, {
      residenceState: "unknown",
      residenceId: null,
      residenceProvenance: "optional",
    });

    expect(membership.residenceState).toBe("unknown");
    expect(membership.residenceId).toBeNull();
  });
});

describe("real PostgreSQL Membership audience-facts repository", () => {
  it("maps a complete authoritative Membership to audience facts", async () => {
    const tenant = await createTenant();
    const fixture = await createCompleteMembership(tenant.id);
    const result = await createRepository().findMembershipAudienceFactsByIdForTenant(
      tenant.id,
      fixture.membership.id,
    );

    expect(result).not.toBeNull();
    expect(isMembershipAudienceFacts(result)).toBe(true);
    expect(result).toMatchObject({
      membershipId: fixture.membership.id,
      tenantId: tenant.id,
      campus: {
        value: fixture.campusId,
        provenance: "institution_verified",
      },
      academicDivision: {
        value: fixture.divisionId,
        provenance: "roster_derived",
      },
      programme: {
        value: fixture.programmeId,
        provenance: "self_declared",
      },
      academicYear: { value: 2, provenance: "institution_verified" },
      residence: {
        state: "resident",
        residenceId: fixture.residenceId,
        provenance: "self_declared",
      },
    });
  });

  it("preserves self-declared affiliation provenance", async () => {
    const tenant = await createTenant();
    const fixture = await createCompleteMembership(tenant.id);
    const result = await createRepository().findMembershipAudienceFactsByIdForTenant(
      tenant.id,
      fixture.membership.id,
    );

    expect(result?.campus.provenance).toBe("institution_verified");
    expect(result?.programme?.provenance).toBe("self_declared");
    expect(result?.residence.provenance).toBe("self_declared");
  });

  it("maps missing optional fields to canonical optional attributes", async () => {
    const tenant = await createTenant();
    const campus = await createCampus(tenant.id);
    const membership = await createMembership(tenant.id, {
      campusId: campus.id,
      campusProvenance: "institution_verified",
      academicDivisionId: null,
      academicDivisionProvenance: "optional",
      programmeId: null,
      programmeProvenance: "optional",
      academicYear: null,
      academicYearProvenance: "optional",
      residenceState: "unknown",
      residenceId: null,
      residenceProvenance: "optional",
    });
    const result = await createRepository().findMembershipAudienceFactsByIdForTenant(
      tenant.id,
      membership.id,
    );

    expect(result).toMatchObject({
      academicDivision: { value: null, provenance: "optional" },
      programme: { value: null, provenance: "optional" },
      academicYear: { value: null, provenance: "optional" },
    });
  });

  it("maps unknown Residence state canonically", async () => {
    const tenant = await createTenant();
    const campus = await createCampus(tenant.id);
    const membership = await createMembership(tenant.id, {
      campusId: campus.id,
      campusProvenance: "roster_derived",
      residenceState: "unknown",
      residenceId: null,
      residenceProvenance: "optional",
    });
    const result = await createRepository().findMembershipAudienceFactsByIdForTenant(
      tenant.id,
      membership.id,
    );

    expect(result?.residence).toEqual({
      state: "unknown",
      residenceId: null,
      provenance: "optional",
    });
  });

  it("returns null for a Membership with missing Campus", async () => {
    const tenant = await createTenant();
    const membership = await createMembership(tenant.id, {
      campusId: null,
      campusProvenance: null,
    });

    await expect(
      createRepository().findMembershipAudienceFactsByIdForTenant(
        tenant.id,
        membership.id,
      ),
    ).resolves.toBeNull();
  });

  it("returns null for a cross-Tenant Membership lookup", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const fixture = await createCompleteMembership(tenantB.id);

    await expect(
      createRepository().findMembershipAudienceFactsByIdForTenant(
        tenantA.id,
        fixture.membership.id,
      ),
    ).resolves.toBeNull();
  });

  it("fails closed for malformed Tenant and Membership identifiers", async () => {
    const database = {
      select: () => {
        throw new Error("malformed audience-facts identifier reached SQL");
      },
    } as unknown as CampusHubDatabase;
    const repository = new MembershipRepositoryConstructor(database);

    await expect(
      repository.findMembershipAudienceFactsByIdForTenant(
        "not-a-uuid",
        "00000000-0000-4000-8000-000000000001",
      ),
    ).resolves.toBeNull();
    await expect(
      repository.findMembershipAudienceFactsByIdForTenant(
        "00000000-0000-4000-8000-000000000001",
        "not-a-uuid",
      ),
    ).resolves.toBeNull();
  });
});
