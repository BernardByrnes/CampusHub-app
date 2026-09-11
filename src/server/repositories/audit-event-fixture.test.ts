import { describe, expect, it } from "vitest";

import { StaticAuditIntegrityKeyProvider } from "@/domain/audit/audit-integrity-key-provider";
import type { AuditEventRow } from "@/server/db/schema/audit";

import {
  DrizzleAuditEventRepository,
  type AuditEventTransactionDatabase,
} from "./audit-event-repository";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorMembershipId = "00000000-0000-4000-8000-000000000002";
const resourceId = "00000000-0000-4000-8000-000000000003";
const eventId = "00000000-0000-4000-8000-000000000004";
const date = new Date("2026-09-10T12:00:00.000Z");

function queryReturning(rows: readonly unknown[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => rows }),
        limit: async () => rows,
      }),
    }),
  };
}

describe("Fixture audit repository", () => {
  it("appends a signed Fixture lifecycle event to the Tenant chain", async () => {
    let inserted: AuditEventRow | undefined;
    const transaction = {
      select: () => queryReturning([]),
      insert: () => ({
        values: (row: AuditEventRow) => ({
          returning: async () => {
            inserted = row;
            return [row];
          },
        }),
      }),
    } as unknown as AuditEventTransactionDatabase;
    const repository = new DrizzleAuditEventRepository({
      database: { select: () => queryReturning([]) } as never,
      keyProvider: new StaticAuditIntegrityKeyProvider(
        1,
        new Map([[1, new Uint8Array(Buffer.from("fixture-audit-key"))]]),
      ),
      eventIdFactory: () => eventId,
    });
    const event = await repository.appendFixtureMutationInTransaction(
      transaction,
      {
        tenantId,
        actorMembershipId,
        resourceType: "fixture",
        resourceId,
        resourceVersion: 1,
        occurredAt: date,
        eventType: "fixture.created",
        eventFacts: {
          action: "created",
          state: "scheduled",
          version: 1,
          competitionId: "00000000-0000-4000-8000-000000000005",
          homeTeamId: "00000000-0000-4000-8000-000000000006",
          awayTeamId: "00000000-0000-4000-8000-000000000007",
          campusId: "00000000-0000-4000-8000-000000000008",
          startsAt: date.toISOString(),
          venue: "Main pitch",
          reason: null,
        },
      },
    );
    expect(event).toMatchObject({ eventType: "fixture.created", resourceType: "fixture", sequence: 1 });
    expect(event.currentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(inserted).toMatchObject({ eventType: "fixture.created", resourceType: "fixture" });
  });
});
