import { randomUUID } from "node:crypto";

import { loadEnvConfig } from "@next/env";
import { inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import {
  StaticAuditIntegrityKeyProvider,
} from "@/domain/audit/audit-integrity-key-provider";
import { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import { DrizzleCompetitionRepository } from "@/server/repositories/competition-repository";
import { DrizzleSportRepository } from "@/server/repositories/sport-repository";
import { DrizzleTeamRepository } from "@/server/repositories/team-repository";
import {
  auditEvents,
  campuses,
  competitions,
  memberships,
  sports,
  teams,
  tenants,
} from "@/server/db/schema";

if (process.env.CAMPUSHUB_DB_INTEGRATION !== "1") {
  throw new Error(
    "Real database integration is opt-in. Set CAMPUSHUB_DB_INTEGRATION=1.",
  );
}

loadEnvConfig(process.cwd());

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (
  typeof configuredDatabaseUrl !== "string" ||
  configuredDatabaseUrl.trim().length === 0
) {
  throw new Error("DATABASE_URL was not loaded for integration tests.");
}

const runPrefix =
  "campushub-sports-" +
  Date.now().toString(36) +
  "-" +
  randomUUID().slice(0, 8).toLowerCase();
const auditKey = new Uint8Array(
  Buffer.from("campushub-sports-integration-audit-key"),
);
const syntheticTenantIds = new Set<string>();
let sequence = 0;
let database: ReturnType<typeof drizzle> | undefined;
let pool: Pool | undefined;

function getDatabase(): ReturnType<typeof drizzle> {
  if (database === undefined) {
    throw new Error("Sports integration database was not initialized.");
  }
  return database;
}

function nextSlug(label: string): string {
  sequence += 1;
  return runPrefix + "-" + label + "-" + sequence;
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
  expect(caught, "Expected PostgreSQL error " + expectedCode).toBeDefined();
  expect(getPostgresCode(caught)).toBe(expectedCode);
}

async function createTenant(): Promise<{ id: string }> {
  const rows = await getDatabase()
    .insert(tenants)
    .values({
      slug: nextSlug("tenant"),
      displayName: "Sports integration Tenant " + runPrefix,
      status: "active",
      timezone: "Africa/Kampala",
    })
    .returning({ id: tenants.id });
  const tenant = rows[0];
  if (tenant === undefined) {
    throw new Error("Sports Tenant insert returned no row.");
  }
  syntheticTenantIds.add(tenant.id);
  return tenant;
}

async function createCampus(tenantId: string): Promise<{ id: string }> {
  const rows = await getDatabase()
    .insert(campuses)
    .values({
      tenantId,
      label: "Sports integration Campus " + runPrefix,
      status: "active",
    })
    .returning({ id: campuses.id });
  const campus = rows[0];
  if (campus === undefined) {
    throw new Error("Sports Campus insert returned no row.");
  }
  return campus;
}

async function createMembership(tenantId: string): Promise<{ id: string }> {
  const rows = await getDatabase()
    .insert(memberships)
    .values({
      tenantId,
      identitySubjectId: nextSlug("identity"),
      assuranceLevel: "L2",
      lifecycle: "verified",
    })
    .returning({ id: memberships.id });
  const membership = rows[0];
  if (membership === undefined) {
    throw new Error("Sports Membership insert returned no row.");
  }
  return membership;
}

function requireOk<T extends { ok: boolean }>(
  result: T,
): Extract<T, { ok: true }> {
  if (!result.ok) {
    throw new Error(
      "Expected successful Sports mutation, received " +
        JSON.stringify(result),
    );
  }
  return result as Extract<T, { ok: true }>;
}

beforeAll(async () => {
  pool = new Pool({ connectionString: configuredDatabaseUrl });
  database = drizzle({ client: pool });
  await pool.query("select 1");
});

afterAll(async () => {
  try {
    if (syntheticTenantIds.size > 0) {
      const tenantIds = [...syntheticTenantIds];
      await getDatabase()
        .delete(auditEvents)
        .where(inArray(auditEvents.tenantId, tenantIds));
      await getDatabase()
        .delete(teams)
        .where(inArray(teams.tenantId, tenantIds));
      await getDatabase()
        .delete(competitions)
        .where(inArray(competitions.tenantId, tenantIds));
      await getDatabase()
        .delete(sports)
        .where(inArray(sports.tenantId, tenantIds));
      await getDatabase()
        .delete(memberships)
        .where(inArray(memberships.tenantId, tenantIds));
      await getDatabase()
        .delete(campuses)
        .where(inArray(campuses.tenantId, tenantIds));
      await getDatabase()
        .delete(tenants)
        .where(inArray(tenants.id, tenantIds));
    }
  } finally {
    await pool?.end();
  }
});

describe("real PostgreSQL Tenant-owned Sports structure", () => {
  it("persists, versions, audits, and deactivates Sport, Competition, and Team", async () => {
    const tenant = await createTenant();
    const campus = await createCampus(tenant.id);
    const membership = await createMembership(tenant.id);
    const sportRepository = new DrizzleSportRepository(getDatabase() as never);
    const competitionRepository = new DrizzleCompetitionRepository(
      getDatabase() as never,
    );
    const teamRepository = new DrizzleTeamRepository(getDatabase() as never);
    const auditRepository = new DrizzleAuditEventRepository({
      database: getDatabase() as never,
      keyProvider: new StaticAuditIntegrityKeyProvider(
        1,
        new Map([[1, auditKey]]),
      ),
      eventIdFactory: randomUUID,
    });

    const created = await getDatabase().transaction(async (transaction) => {
      const sportResult = requireOk(
        await sportRepository.createSportInTransaction(transaction, tenant.id, {
          name: "Football",
        }),
      );
      await auditRepository.appendSportsMutationInTransaction(transaction, {
        tenantId: tenant.id,
        actorMembershipId: membership.id,
        resourceType: "sport",
        resourceId: sportResult.sport.id,
        resourceVersion: sportResult.sport.version,
        occurredAt: sportResult.sport.createdAt,
        eventType: "sport.created",
        eventFacts: {
          action: "created",
          name: sportResult.sport.name,
          status: sportResult.sport.status,
          version: sportResult.sport.version,
          sportId: null,
          campusId: null,
          tableMode: null,
        },
      });

      const competitionResult = requireOk(
        await competitionRepository.createCompetitionInTransaction(
          transaction,
          tenant.id,
          {
            sportId: sportResult.sport.id,
            name: "Campus League",
            seasonLabel: "2026",
            campusId: campus.id,
            tableMode: "none",
          },
        ),
      );
      await auditRepository.appendSportsMutationInTransaction(transaction, {
        tenantId: tenant.id,
        actorMembershipId: membership.id,
        resourceType: "competition",
        resourceId: competitionResult.competition.id,
        resourceVersion: competitionResult.competition.version,
        occurredAt: competitionResult.competition.createdAt,
        eventType: "competition.created",
        eventFacts: {
          action: "created",
          name: competitionResult.competition.name,
          status: competitionResult.competition.status,
          version: competitionResult.competition.version,
          sportId: competitionResult.competition.sportId,
          campusId: competitionResult.competition.campusId,
          tableMode: competitionResult.competition.tableMode,
        },
      });

      const teamResult = requireOk(
        await teamRepository.createTeamInTransaction(transaction, tenant.id, {
          sportId: sportResult.sport.id,
          name: "Campus United",
          affiliationLabel: null,
        }),
      );
      await auditRepository.appendSportsMutationInTransaction(transaction, {
        tenantId: tenant.id,
        actorMembershipId: membership.id,
        resourceType: "team",
        resourceId: teamResult.team.id,
        resourceVersion: teamResult.team.version,
        occurredAt: teamResult.team.createdAt,
        eventType: "team.created",
        eventFacts: {
          action: "created",
          name: teamResult.team.name,
          status: teamResult.team.status,
          version: teamResult.team.version,
          sportId: teamResult.team.sportId,
          campusId: null,
          tableMode: null,
        },
      });

      return {
        sport: sportResult.sport,
        competition: competitionResult.competition,
        team: teamResult.team,
      };
    });

    expect(created.sport.version).toBe(1);
    expect(created.competition.version).toBe(1);
    expect(created.team.version).toBe(1);
    expect(
      await sportRepository.listSportsForTenant(tenant.id, { limit: 1 }),
    ).toHaveLength(1);
    expect(
      await competitionRepository.listCompetitionsForTenant(tenant.id, {
        campusId: campus.id,
        limit: 1,
      }),
    ).toHaveLength(1);
    expect(
      await teamRepository.listTeamsForTenant(tenant.id, {
        sportId: created.sport.id,
        limit: 1,
      }),
    ).toHaveLength(1);

    const changed = await getDatabase().transaction(async (transaction) => {
      const sportResult = requireOk(
        await sportRepository.updateSportInTransaction(
          transaction,
          tenant.id,
          created.sport.id,
          { expectedVersion: 1, name: "Association Football" },
        ),
      );
      await auditRepository.appendSportsMutationInTransaction(transaction, {
        tenantId: tenant.id,
        actorMembershipId: membership.id,
        resourceType: "sport",
        resourceId: sportResult.sport.id,
        resourceVersion: sportResult.sport.version,
        occurredAt: sportResult.sport.updatedAt,
        eventType: "sport.changed",
        eventFacts: {
          action: "changed",
          name: sportResult.sport.name,
          status: sportResult.sport.status,
          version: sportResult.sport.version,
          sportId: null,
          campusId: null,
          tableMode: null,
        },
      });
      return sportResult.sport;
    });
    expect(changed.version).toBe(2);
    const changedRelated = await getDatabase().transaction(
      async (transaction) => {
        const competitionResult = requireOk(
          await competitionRepository.updateCompetitionInTransaction(
            transaction,
            tenant.id,
            created.competition.id,
            {
              expectedVersion: 1,
              sportId: created.competition.sportId,
              name: "Campus League",
              seasonLabel: created.competition.seasonLabel,
              campusId: created.competition.campusId,
              tableMode: "manual",
            },
          ),
        );
        await auditRepository.appendSportsMutationInTransaction(transaction, {
          tenantId: tenant.id,
          actorMembershipId: membership.id,
          resourceType: "competition",
          resourceId: competitionResult.competition.id,
          resourceVersion: competitionResult.competition.version,
          occurredAt: competitionResult.competition.updatedAt,
          eventType: "competition.changed",
          eventFacts: {
            action: "changed",
            name: competitionResult.competition.name,
            status: competitionResult.competition.status,
            version: competitionResult.competition.version,
            sportId: competitionResult.competition.sportId,
            campusId: competitionResult.competition.campusId,
            tableMode: competitionResult.competition.tableMode,
          },
        });
        const teamResult = requireOk(
          await teamRepository.updateTeamInTransaction(
            transaction,
            tenant.id,
            created.team.id,
            {
              expectedVersion: 1,
              sportId: created.team.sportId,
              name: created.team.name,
              affiliationLabel: "Campus",
            },
          ),
        );
        await auditRepository.appendSportsMutationInTransaction(transaction, {
          tenantId: tenant.id,
          actorMembershipId: membership.id,
          resourceType: "team",
          resourceId: teamResult.team.id,
          resourceVersion: teamResult.team.version,
          occurredAt: teamResult.team.updatedAt,
          eventType: "team.changed",
          eventFacts: {
            action: "changed",
            name: teamResult.team.name,
            status: teamResult.team.status,
            version: teamResult.team.version,
            sportId: teamResult.team.sportId,
            campusId: null,
            tableMode: null,
          },
        });
        return {
          competition: competitionResult.competition,
          team: teamResult.team,
        };
      },
    );
    expect(changedRelated.competition.version).toBe(2);
    expect(changedRelated.competition.tableMode).toBe("manual");
    expect(changedRelated.team.version).toBe(2);
    await expect(
      getDatabase().transaction((transaction) =>
        sportRepository.updateSportInTransaction(
          transaction,
          tenant.id,
          created.sport.id,
          { expectedVersion: 1, name: "Stale Update" },
        ),
      ),
    ).resolves.toEqual({ ok: false, error: "VERSION_CONFLICT" });

    const deactivated = await getDatabase().transaction(async (transaction) => {
      const competitionResult = requireOk(
        await competitionRepository.deactivateCompetitionInTransaction(
          transaction,
          tenant.id,
          created.competition.id,
          2,
        ),
      );
      await auditRepository.appendSportsMutationInTransaction(transaction, {
        tenantId: tenant.id,
        actorMembershipId: membership.id,
        resourceType: "competition",
        resourceId: competitionResult.competition.id,
        resourceVersion: competitionResult.competition.version,
        occurredAt: competitionResult.competition.updatedAt,
        eventType: "competition.deactivated",
        eventFacts: {
          action: "deactivated",
          name: competitionResult.competition.name,
          status: competitionResult.competition.status,
          version: competitionResult.competition.version,
          sportId: competitionResult.competition.sportId,
          campusId: competitionResult.competition.campusId,
          tableMode: competitionResult.competition.tableMode,
        },
      });
      const teamResult = requireOk(
        await teamRepository.deactivateTeamInTransaction(
          transaction,
          tenant.id,
          created.team.id,
          2,
        ),
      );
      await auditRepository.appendSportsMutationInTransaction(transaction, {
        tenantId: tenant.id,
        actorMembershipId: membership.id,
        resourceType: "team",
        resourceId: teamResult.team.id,
        resourceVersion: teamResult.team.version,
        occurredAt: teamResult.team.updatedAt,
        eventType: "team.deactivated",
        eventFacts: {
          action: "deactivated",
          name: teamResult.team.name,
          status: teamResult.team.status,
          version: teamResult.team.version,
          sportId: teamResult.team.sportId,
          campusId: null,
          tableMode: null,
        },
      });
      const sportResult = requireOk(
        await sportRepository.deactivateSportInTransaction(
          transaction,
          tenant.id,
          created.sport.id,
          2,
        ),
      );
      await auditRepository.appendSportsMutationInTransaction(transaction, {
        tenantId: tenant.id,
        actorMembershipId: membership.id,
        resourceType: "sport",
        resourceId: sportResult.sport.id,
        resourceVersion: sportResult.sport.version,
        occurredAt: sportResult.sport.updatedAt,
        eventType: "sport.deactivated",
        eventFacts: {
          action: "deactivated",
          name: sportResult.sport.name,
          status: sportResult.sport.status,
          version: sportResult.sport.version,
          sportId: null,
          campusId: null,
          tableMode: null,
        },
      });
      return {
        competition: competitionResult.competition,
        team: teamResult.team,
        sport: sportResult.sport,
      };
    });

    expect(deactivated.sport.status).toBe("inactive");
    expect(deactivated.competition.status).toBe("inactive");
    expect(deactivated.team.status).toBe("inactive");
    expect(
      await sportRepository.findSportByIdForTenant(tenant.id, created.sport.id),
    ).toMatchObject({ id: created.sport.id, status: "inactive", version: 3 });
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(sportRepository)),
    ).not.toContain("delete");
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(competitionRepository)),
    ).not.toContain("delete");
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(teamRepository)),
    ).not.toContain("delete");

    await expect(auditRepository.verifyAuditChainForTenant(tenant.id)).resolves.toBe(
      true,
    );
    const auditEventsForTenant = await auditRepository.listAuditEventsForTenant(
      tenant.id,
    );
    expect(auditEventsForTenant.map((event) => event.eventType)).toEqual([
      "sport.created",
      "competition.created",
      "team.created",
      "sport.changed",
      "competition.changed",
      "team.changed",
      "competition.deactivated",
      "team.deactivated",
      "sport.deactivated",
    ]);
  });

  it("rejects cross-Tenant Competition and Team relational references", async () => {
    const tenantA = await createTenant();
    const tenantB = await createTenant();
    const campusA = await createCampus(tenantA.id);
    const campusB = await createCampus(tenantB.id);
    const sportA = await getDatabase()
      .insert(sports)
      .values({ tenantId: tenantA.id, name: "Football" })
      .returning({ id: sports.id });
    const sportB = await getDatabase()
      .insert(sports)
      .values({ tenantId: tenantB.id, name: "Rugby" })
      .returning({ id: sports.id });
    const sportAId = sportA[0]?.id;
    const sportBId = sportB[0]?.id;
    if (sportAId === undefined || sportBId === undefined) {
      throw new Error("Sports fixture insert returned no IDs.");
    }

    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(competitions)
          .values({
            tenantId: tenantA.id,
            sportId: sportBId,
            name: "Foreign Sport Competition",
            seasonLabel: "2026",
            campusId: campusA.id,
            tableMode: "none",
          })
          .returning(),
      "23503",
    );
    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(competitions)
          .values({
            tenantId: tenantA.id,
            sportId: sportAId,
            name: "Foreign Campus Competition",
            seasonLabel: "2026",
            campusId: campusB.id,
            tableMode: "none",
          })
          .returning(),
      "23503",
    );
    await expectPostgresCode(
      () =>
        getDatabase()
          .insert(teams)
          .values({
            tenantId: tenantA.id,
            sportId: sportBId,
            name: "Foreign Sport Team",
            affiliationLabel: null,
          })
          .returning(),
      "23503",
    );
  });

  it("keeps the Sports schema closed and does not add a Competition link to Team", async () => {
    const rows = await getDatabase().execute(
      sql.raw(
        "select table_name, column_name from information_schema.columns " +
          "where table_schema = 'public' and table_name in ('sports', 'competitions', 'teams') " +
          "order by table_name, ordinal_position",
      ),
    );
    const columns = rows.rows.map(
      (row) => String(row.table_name) + "." + String(row.column_name),
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "sports.tenant_id",
        "sports.name",
        "competitions.sport_id",
        "competitions.campus_id",
        "competitions.table_mode",
        "teams.sport_id",
        "teams.affiliation_label",
      ]),
    );
    expect(columns).not.toContain("teams.competition_id");
  });
});
