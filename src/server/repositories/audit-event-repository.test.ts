import { describe, expect, it } from "vitest";

import {
  StaticAuditIntegrityKeyProvider,
} from "@/domain/audit/audit-integrity-key-provider";
import {
  AUDIT_EVENT_CONTRACT_VERSION,
  AUDIT_GENESIS_HASH,
  AUDIT_INTEGRITY_FORMAT_VERSION,
  type AuditEvent,
} from "@/domain/audit/audit-event";
import {
  auditEventToIntegrityEnvelope,
  computeAuditCurrentHash,
} from "@/domain/audit/audit-integrity";
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
const historicalKey = new Uint8Array(
  Buffer.from("campushub-audit-repository-historical-key"),
);

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

function eventIdFor(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence
    .toString(16)
    .padStart(12, "0")}`;
}

function auditRows(
  count: number,
  options: Readonly<{ tenantId?: string; keyVersion?: number; key?: Uint8Array }> = {},
): AuditEventRow[] {
  const tenant = options.tenantId ?? tenantId;
  const keyVersion = options.keyVersion ?? 1;
  const signingKey = options.key ?? key;
  const rows: AuditEventRow[] = [];
  let previousHash = AUDIT_GENESIS_HASH;

  for (let sequence = 1; sequence <= count; sequence += 1) {
    const event: AuditEvent = {
      id: eventIdFor(sequence),
      tenantId: tenant,
      sequence,
      eventType: "publication.published",
      actorMembershipId,
      resourceType: "publication",
      resourceId: publicationId,
      resourceVersion: 2,
      occurredAt: new Date(
        occurredAt.getTime() + (sequence - 1) * 1000,
      ),
      eventFacts: {
        transition: { from: "draft", to: "published" },
        audienceMode: "entire_tenant",
        confirmedRecipientCount: 0,
        audienceSnapshot: { mode: "entire_tenant", targets: [] },
      },
      previousHash,
      currentHash: "",
      keyVersion,
      integrityFormatVersion: AUDIT_INTEGRITY_FORMAT_VERSION,
      eventContractVersion: AUDIT_EVENT_CONTRACT_VERSION,
    };
    const currentHash = computeAuditCurrentHash(
      auditEventToIntegrityEnvelope(event),
      signingKey,
    );
    const signedEvent = { ...event, currentHash };
    rows.push(signedEvent);
    previousHash = currentHash;
  }

  return rows;
}

function pageDatabase(pages: readonly (readonly AuditEventRow[])[]) {
  let pageIndex = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => pages[pageIndex++] ?? [],
          }),
        }),
      }),
    }),
  } as never;
}

function verificationRepository(
  pages: readonly (readonly AuditEventRow[])[],
  keyProvider = new StaticAuditIntegrityKeyProvider(1, new Map([[1, key]])),
) {
  return new DrizzleAuditEventRepository({
    database: pageDatabase(pages),
    keyProvider,
  });
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

  it("fails closed for malformed final and middle rows", async () => {
    const rows = auditRows(3);
    const malformedFinal = { ...rows[2], eventFacts: {} } as AuditEventRow;
    const malformedMiddle = { ...rows[1], currentHash: "not-a-hash" };

    await expect(
      verificationRepository([[rows[0]!, rows[1]!, malformedFinal]]).verifyAuditChainForTenant(
        tenantId,
      ),
    ).resolves.toBe(false);
    await expect(
      verificationRepository([[rows[0]!, malformedMiddle, rows[2]!]]).verifyAuditChainForTenant(
        tenantId,
      ),
    ).resolves.toBe(false);
  });

  it("fails closed for wrong HMAC, missing historical key, sequence gaps, and previous-hash mismatches", async () => {
    const rows = auditRows(3);
    const wrongHmac = { ...rows[2], currentHash: "0".repeat(64) };
    const gap = { ...rows[1], sequence: 4 };
    const brokenPreviousHash = { ...rows[1], previousHash: "0".repeat(64) };
    const historicalRows = auditRows(2, {
      keyVersion: 2,
      key: historicalKey,
    });

    await expect(
      verificationRepository([[rows[0]!, rows[1]!, wrongHmac]]).verifyAuditChainForTenant(
        tenantId,
      ),
    ).resolves.toBe(false);
    await expect(
      verificationRepository([[historicalRows[0]!, historicalRows[1]!]]).verifyAuditChainForTenant(
        tenantId,
      ),
    ).resolves.toBe(false);
    await expect(
      verificationRepository([[rows[0]!, gap, rows[2]!]]).verifyAuditChainForTenant(
        tenantId,
      ),
    ).resolves.toBe(false);
    await expect(
      verificationRepository([[rows[0]!, brokenPreviousHash, rows[2]!]]).verifyAuditChainForTenant(
        tenantId,
      ),
    ).resolves.toBe(false);
  });

  it("verifies valid chains across pages and consumes more than 1000 events", async () => {
    const rows = auditRows(1001);
    await expect(
      verificationRepository([
        rows.slice(0, 500),
        rows.slice(500, 1000),
        rows.slice(1000),
      ]).verifyAuditChainForTenant(tenantId),
    ).resolves.toBe(true);
  });

  it("rejects a malformed event after the old 1000-row prefix", async () => {
    const rows = auditRows(1001);
    const malformedTail = {
      ...rows[1000],
      eventFacts: { unexpected: true },
    } as AuditEventRow;

    await expect(
      verificationRepository([
        rows.slice(0, 500),
        rows.slice(500, 1000),
        [malformedTail],
      ]).verifyAuditChainForTenant(tenantId),
    ).resolves.toBe(false);
  });

  it("never accepts a row from another Tenant", async () => {
    const rows = auditRows(2);
    const mixed = { ...rows[1], tenantId: "00000000-0000-4000-8000-000000000099" };

    await expect(
      verificationRepository([[rows[0]!, mixed]]).verifyAuditChainForTenant(
        tenantId,
      ),
    ).resolves.toBe(false);
  });
});
