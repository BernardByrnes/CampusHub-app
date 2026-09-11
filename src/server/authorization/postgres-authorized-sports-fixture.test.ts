import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: {}, pool: {} }));

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { Fixture } from "@/domain/sports/fixtures";
import type { CampusHubDatabase } from "@/server/db/client";
import type { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import type { DrizzleFixtureRepository } from "@/server/repositories/fixture-repository";

import {
  PostgresAuthorizedSportsManagementExecutor,
  type PostgresAuthorizedSportsManagementDependencies,
} from "./postgres-authorized-sports";

const tenantId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";
const fixtureId = "00000000-0000-4000-8000-000000000003";
const date = new Date("2026-09-10T12:00:00.000Z");
const fixture: Fixture = {
  id: fixtureId,
  tenantId,
  competitionId: "00000000-0000-4000-8000-000000000004",
  homeTeamId: "00000000-0000-4000-8000-000000000005",
  awayTeamId: "00000000-0000-4000-8000-000000000006",
  campusId: "00000000-0000-4000-8000-000000000007",
  startsAt: date,
  venue: "Main pitch",
  state: "scheduled",
  reason: null,
  version: 1,
  createdAt: date,
  updatedAt: date,
};

describe("Postgres authorized Fixture mutations", () => {
  it("uses the same transaction for authority, Fixture mutation, and audit", async () => {
    const transaction = {};
    const database = {
      transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction)),
    } as unknown as CampusHubDatabase;
    const authorizer = {
      authorizeSportManageInTransaction: vi.fn(async (_tx: unknown, _request: unknown, _before: unknown, after: (date: Date) => void) => {
        after(date);
        return { allowed: true as const };
      }),
    } as never;
    const createFixtureInTransaction = vi.fn(async () => ({ ok: true as const, fixture }));
    const appendFixtureMutationInTransaction = vi.fn(async () => ({}));
    const dependencies: PostgresAuthorizedSportsManagementDependencies = {
      database,
      authorizer,
      auditEvents: {
        appendSportsMutationInTransaction: vi.fn(async () => ({})),
        appendFixtureMutationInTransaction,
      } as unknown as Pick<DrizzleAuditEventRepository, "appendSportsMutationInTransaction"> & Partial<Pick<DrizzleAuditEventRepository, "appendFixtureMutationInTransaction">>,
      runtimeDatabaseAuthorityVerifier: vi.fn(async () => true),
      fixtureRepository: { createFixtureInTransaction } as unknown as DrizzleFixtureRepository,
    };
    const executor = new PostgresAuthorizedSportsManagementExecutor(dependencies);
    const request = {
      actor: { identitySubjectId: "identity-a", tenantId, membershipId },
      context: { tenantStatus: "active", membershipStatus: "verified", assuranceLevel: "L2" },
      capability: CAPABILITIES.SPORT_MANAGE,
      scope: { tenantId, module: "sports", resource: "fixture" },
    } as const;
    await expect(
      executor.createFixture(request, tenantId, {
        competitionId: fixture.competitionId,
        homeTeamId: fixture.homeTeamId,
        awayTeamId: fixture.awayTeamId,
        campusId: fixture.campusId,
        startsAt: date,
        venue: fixture.venue,
      }),
    ).resolves.toEqual({ ok: true, fixture });
    expect(createFixtureInTransaction).toHaveBeenCalledWith(transaction, tenantId, expect.anything());
    expect(appendFixtureMutationInTransaction).toHaveBeenCalledWith(transaction, expect.objectContaining({ eventType: "fixture.created" }));
  });
});
