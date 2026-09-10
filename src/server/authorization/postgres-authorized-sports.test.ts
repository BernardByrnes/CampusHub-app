import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({
  db: {},
  pool: {},
}));

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import type { Sport } from "@/domain/sports/sports";
import type { CampusHubDatabase } from "@/server/db/client";
import type { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import type { DrizzleSportRepository } from "@/server/repositories/sport-repository";

import {
  PostgresAuthorizedSportsManagementExecutor,
  type PostgresAuthorizedSportsManagementDependencies,
} from "./postgres-authorized-sports";
import type { PostgresCapabilityAuthorizer } from "./postgres-capability-authorizer";

const tenantId = "00000000-0000-4000-8000-000000000001";
const membershipId = "00000000-0000-4000-8000-000000000002";
const sportId = "00000000-0000-4000-8000-000000000003";
const occurredAt = new Date("2026-09-10T12:00:00.000Z");

const sport: Sport = {
  id: sportId,
  tenantId,
  name: "Football",
  status: "active",
  version: 1,
  createdAt: occurredAt,
  updatedAt: occurredAt,
};

function request(
  overrides: Partial<CapabilityAuthorizationRequest> = {},
): CapabilityAuthorizationRequest {
  return {
    actor: {
      identitySubjectId: "identity-a",
      tenantId,
      membershipId,
    },
    context: {
      tenantStatus: "active",
      membershipStatus: "verified",
      assuranceLevel: "L2",
    },
    capability: CAPABILITIES.SPORT_MANAGE,
    scope: {
      tenantId,
      module: "sports",
      resource: "sport",
    },
    ...overrides,
  };
}

function createHarness(options: Readonly<{
  authority?: boolean;
  runtimeAuthority?: boolean;
  mutation?: Readonly<{ ok: false; error: "VERSION_CONFLICT" }> | Readonly<{ ok: true; sport: Sport }>;
  afterMutation?: () => Promise<void>;
}> = {}) {
  const transaction = {};
  const transactionCalls: unknown[] = [];
  const database = {
    transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) => {
      transactionCalls.push(transaction);
      return callback(transaction);
    }),
  } as unknown as CampusHubDatabase;
  const authorizeSportManageInTransaction = vi.fn(
    async (
      _transaction: unknown,
      _request: CapabilityAuthorizationRequest,
      _beforeFinalCheck: (() => Promise<void>) | undefined,
      afterFinalCheck: ((checkedAt: Date) => void) | undefined,
    ) => {
      if (options.authority === false) {
        return { allowed: false as const, code: "PERMISSION_DENIED" as const };
      }
      afterFinalCheck?.(occurredAt);
      return { allowed: true as const };
    },
  );
  const authorizer = {
    authorizeSportManageInTransaction,
  } as unknown as PostgresCapabilityAuthorizer;
  const createSportInTransaction = vi.fn(async () =>
    options.mutation ?? { ok: true as const, sport },
  );
  const sportsRepository = {
    createSportInTransaction,
  } as unknown as DrizzleSportRepository;
  const appendSportsMutationInTransaction = vi.fn(async () => ({}));
  const auditEvents = {
    appendSportsMutationInTransaction,
  } as unknown as Pick<
    DrizzleAuditEventRepository,
    "appendSportsMutationInTransaction"
  >;
  const runtimeDatabaseAuthorityVerifier = vi.fn(async () =>
    options.runtimeAuthority !== false,
  );
  const dependencies: PostgresAuthorizedSportsManagementDependencies = {
    database,
    authorizer,
    auditEvents,
    runtimeDatabaseAuthorityVerifier,
    afterMutation: options.afterMutation,
    sportsRepository,
  };
  return {
    executor: new PostgresAuthorizedSportsManagementExecutor(dependencies),
    database,
    transaction,
    transactionCalls,
    authorizeSportManageInTransaction,
    createSportInTransaction,
    appendSportsMutationInTransaction,
    runtimeDatabaseAuthorityVerifier,
  };
}

describe("PostgresAuthorizedSportsManagementExecutor", () => {
  it("rejects malformed gateway requests before opening a transaction", async () => {
    const harness = createHarness();

    await expect(
      harness.executor.createSport(
        request({ scope: { tenantId, module: "publication", resource: "publication" } }),
        tenantId,
        { name: "Football" },
      ),
    ).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
    expect(harness.database.transaction).not.toHaveBeenCalled();
    expect(harness.createSportInTransaction).not.toHaveBeenCalled();
  });

  it("denies at the fresh transaction authority check without mutation or audit", async () => {
    const harness = createHarness({ authority: false });

    await expect(
      harness.executor.createSport(request(), tenantId, { name: "Football" }),
    ).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
    expect(harness.database.transaction).toHaveBeenCalledTimes(1);
    expect(harness.authorizeSportManageInTransaction).toHaveBeenCalledWith(
      harness.transaction,
      request(),
      undefined,
      expect.any(Function),
    );
    expect(harness.runtimeDatabaseAuthorityVerifier).not.toHaveBeenCalled();
    expect(harness.createSportInTransaction).not.toHaveBeenCalled();
    expect(harness.appendSportsMutationInTransaction).not.toHaveBeenCalled();
  });

  it("fails closed when the runtime PostgreSQL authority verifier rejects the session", async () => {
    const harness = createHarness({ runtimeAuthority: false });

    await expect(
      harness.executor.createSport(request(), tenantId, { name: "Football" }),
    ).resolves.toEqual({ ok: false, error: "PERSISTENCE_FAILED" });
    expect(harness.runtimeDatabaseAuthorityVerifier).toHaveBeenCalledWith(
      harness.transaction,
    );
    expect(harness.createSportInTransaction).not.toHaveBeenCalled();
    expect(harness.appendSportsMutationInTransaction).not.toHaveBeenCalled();
  });

  it("passes the same transaction to authority, mutation, and audit", async () => {
    const harness = createHarness();

    await expect(
      harness.executor.createSport(request(), tenantId, { name: "Football" }),
    ).resolves.toEqual({ ok: true, sport });
    expect(harness.transactionCalls).toEqual([harness.transaction]);
    expect(harness.runtimeDatabaseAuthorityVerifier).toHaveBeenCalledWith(
      harness.transaction,
    );
    expect(harness.createSportInTransaction).toHaveBeenCalledWith(
      harness.transaction,
      tenantId,
      { name: "Football" },
    );
    expect(harness.appendSportsMutationInTransaction).toHaveBeenCalledWith(
      harness.transaction,
      expect.objectContaining({
        tenantId,
        actorMembershipId: membershipId,
        resourceType: "sport",
        resourceId: sportId,
        resourceVersion: 1,
        eventType: "sport.created",
      }),
    );
  });

  it("does not append audit when the resource mutation fails", async () => {
    const harness = createHarness({
      mutation: { ok: false, error: "VERSION_CONFLICT" },
    });

    await expect(
      harness.executor.createSport(request(), tenantId, { name: "Football" }),
    ).resolves.toEqual({ ok: false, error: "VERSION_CONFLICT" });
    expect(harness.appendSportsMutationInTransaction).not.toHaveBeenCalled();
  });

  it("converts audit or post-mutation failures into a transaction failure", async () => {
    const auditFailure = createHarness();
    auditFailure.appendSportsMutationInTransaction.mockRejectedValueOnce(
      new Error("audit unavailable"),
    );
    await expect(
      auditFailure.executor.createSport(request(), tenantId, { name: "Football" }),
    ).resolves.toEqual({ ok: false, error: "PERSISTENCE_FAILED" });

    const postMutationFailure = createHarness({
      afterMutation: async () => {
        throw new Error("test rollback marker");
      },
    });
    await expect(
      postMutationFailure.executor.createSport(
        request(),
        tenantId,
        { name: "Football" },
      ),
    ).resolves.toEqual({ ok: false, error: "PERSISTENCE_FAILED" });
    expect(postMutationFailure.appendSportsMutationInTransaction).toHaveBeenCalledTimes(1);
  });
});
