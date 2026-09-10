import { describe, expect, it } from "vitest";

import {
  StaticAuditIntegrityKeyProvider,
} from "@/domain/audit/audit-integrity-key-provider";
import {
  AUDIT_GENESIS_HASH,
  type SportsAuditEventFacts,
} from "@/domain/audit/audit-event";
import type { AuditEventRow } from "@/server/db/schema/audit";

import {
  DrizzleAuditEventRepository,
  type AuditEventTransactionDatabase,
  type SportsAuditMutationAppendInput,
} from "./audit-event-repository";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorMembershipId = "00000000-0000-4000-8000-000000000002";
const resourceId = "00000000-0000-4000-8000-000000000003";
const eventId = "00000000-0000-4000-8000-000000000004";
const occurredAt = new Date("2026-09-10T12:00:00.000Z");
const key = new Uint8Array(Buffer.from("campushub-sports-audit-test-key"));

const sportFacts: SportsAuditEventFacts = {
  action: "created",
  name: "Football",
  status: "active",
  version: 1,
  sportId: null,
  campusId: null,
  tableMode: null,
};

const appendInput: SportsAuditMutationAppendInput = {
  tenantId,
  actorMembershipId,
  resourceType: "sport",
  resourceId,
  resourceVersion: 1,
  occurredAt,
  eventType: "sport.created",
  eventFacts: sportFacts,
};

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

function createAppendHarness(previousRows: readonly unknown[] = []) {
  let inserted: AuditEventRow | undefined;
  const transaction = {
    select: () => queryReturning(previousRows),
    insert: () => ({
      values: (row: AuditEventRow) => ({
        returning: async () => {
          inserted = row;
          return [row];
        },
      }),
    }),
  };
  return {
    transaction: transaction as unknown as AuditEventTransactionDatabase,
    get inserted() {
      return inserted;
    },
  };
}

function repository() {
  return new DrizzleAuditEventRepository({
    database: { select: () => queryReturning([]) } as never,
    keyProvider: new StaticAuditIntegrityKeyProvider(1, new Map([[1, key]])),
    eventIdFactory: () => eventId,
  });
}

describe("Sports audit repository", () => {
  it("appends a closed Sports event with a genesis chain link", async () => {
    const harness = createAppendHarness();
    const event = await repository().appendSportsMutationInTransaction(
      harness.transaction,
      appendInput,
    );

    expect(event).toMatchObject({
      id: eventId,
      tenantId,
      sequence: 1,
      eventType: "sport.created",
      resourceType: "sport",
      resourceId,
      resourceVersion: 1,
      previousHash: AUDIT_GENESIS_HASH,
      eventFacts: sportFacts,
    });
    expect(event.currentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(harness.inserted).toMatchObject({
      id: eventId,
      eventType: "sport.created",
      resourceType: "sport",
    });
  });

  it("continues the Tenant chain and rejects event/resource pair drift", async () => {
    const latest = {
      sequence: 4,
      currentHash: "a".repeat(64),
    };
    const harness = createAppendHarness([latest]);
    const event = await repository().appendSportsMutationInTransaction(
      harness.transaction,
      appendInput,
    );
    expect(event.sequence).toBe(5);
    expect(event.previousHash).toBe(latest.currentHash);

    const invalid = createAppendHarness();
    await expect(
      repository().appendSportsMutationInTransaction(
        invalid.transaction,
        {
          ...appendInput,
          eventType: "team.created",
        },
      ),
    ).rejects.toThrow("Invalid Sports audit input");
    expect(invalid.inserted).toBeUndefined();
  });
});
