import { describe, expect, it } from "vitest";

import {
  StaticAuditIntegrityKeyProvider,
} from "@/domain/audit/audit-integrity-key-provider";
import type { AuditEventRow } from "@/server/db/schema/audit";

import {
  DrizzleAuditEventRepository,
  type AuditEventTransactionDatabase,
  type PublicationPublishedAuditAppendInput,
} from "./audit-event-repository";

const tenantId = "00000000-0000-4000-8000-000000000001";
const actorMembershipId = "00000000-0000-4000-8000-000000000002";
const publicationId = "00000000-0000-4000-8000-000000000003";
const eventId = "00000000-0000-4000-8000-000000000004";
const occurredAt = new Date("2026-09-09T10:00:00.000Z");
const key = new Uint8Array(Buffer.from("campushub-audit-repository-test-key"));

const appendInput: PublicationPublishedAuditAppendInput = {
  tenantId,
  actorMembershipId,
  publicationId,
  publicationVersion: 2,
  occurredAt,
  eventFacts: {
    transition: { from: "draft", to: "published" },
    audienceMode: "entire_tenant",
    confirmedRecipientCount: 0,
    audienceSnapshot: { mode: "entire_tenant", targets: [] },
  },
};

function queryReturning<T>(rows: readonly T[]) {
  return {
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: async () => rows }),
        limit: async () => rows,
      }),
    }),
  };
}

function appendTransaction() {
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
  };
  return {
    transaction: transaction as unknown as AuditEventTransactionDatabase,
    get inserted() {
      return inserted;
    },
  };
}

describe("DrizzleAuditEventRepository", () => {
  it("appends only the closed publication event through the supplied transaction", async () => {
    const harness = appendTransaction();
    const repository = new DrizzleAuditEventRepository({
      database: { select: () => queryReturning([]) } as never,
      keyProvider: new StaticAuditIntegrityKeyProvider(1, new Map([[1, key]])),
      eventIdFactory: () => eventId,
    });

    const event = await repository.appendPublicationPublishedInTransaction(
      harness.transaction,
      appendInput,
    );

    expect(event).toMatchObject({
      id: eventId,
      tenantId,
      sequence: 1,
      eventType: "publication.published",
      actorMembershipId,
      resourceType: "publication",
      resourceId: publicationId,
      resourceVersion: 2,
      occurredAt,
      previousHash: "0".repeat(64),
      keyVersion: 1,
    });
    expect(event.currentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(harness.inserted).toMatchObject({
      id: eventId,
      tenantId,
      sequence: 1,
      eventType: "publication.published",
      resourceType: "publication",
      resourceId: publicationId,
    });
    expect("delete" in repository).toBe(false);
    expect("update" in repository).toBe(false);
  });

  it("fails closed without an active signing key and does not insert", async () => {
    const harness = appendTransaction();
    const repository = new DrizzleAuditEventRepository({
      database: { select: () => queryReturning([]) } as never,
      keyProvider: new StaticAuditIntegrityKeyProvider(1, new Map()),
      eventIdFactory: () => eventId,
    });

    await expect(
      repository.appendPublicationPublishedInTransaction(
        harness.transaction,
        appendInput,
      ),
    ).rejects.toThrow("No active AuditEvent signing key");
    expect(harness.inserted).toBeUndefined();
  });

  it("rejects malformed Tenant and event identifiers before SQL", async () => {
    let selected = false;
    const repository = new DrizzleAuditEventRepository({
      database: {
        select: () => {
          selected = true;
          return queryReturning([]);
        },
      } as never,
      keyProvider: new StaticAuditIntegrityKeyProvider(1, new Map([[1, key]])),
    });

    await expect(
      repository.findAuditEventByIdForTenant("banana", eventId),
    ).resolves.toBeNull();
    await expect(
      repository.findAuditEventByIdForTenant(tenantId, "banana"),
    ).resolves.toBeNull();
    expect(selected).toBe(false);
  });

  it("does not expose audit deletion or update repository operations", () => {
    const repository = new DrizzleAuditEventRepository({
      database: { select: () => queryReturning([]) } as never,
      keyProvider: new StaticAuditIntegrityKeyProvider(1, new Map([[1, key]])),
    });

    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(repository))).not.toEqual(
      expect.arrayContaining(["delete", "update", "truncate"]),
    );
  });
});
