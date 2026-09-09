import "server-only";

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt } from "drizzle-orm";

import {
  AUDIT_EVENT_CONTRACT_VERSION,
  AUDIT_INTEGRITY_FORMAT_VERSION,
  normalizeAuditIntegrityEnvelope,
  type AuditEvent,
  type PublicationPublishedAuditEventFacts,
} from "@/domain/audit/audit-event";
import { isUuid } from "@/domain/identifiers/uuid";
import type { CampusHubDatabase } from "@/server/db/client";
import {
  auditEvents,
  type AuditEventRow,
} from "@/server/db/schema/audit";

import {
  auditEventToIntegrityEnvelope,
  computeAuditCurrentHash,
  verifyAuditEvent,
} from "@/domain/audit/audit-integrity";
import type { AuditIntegrityKeyProvider } from "@/domain/audit/audit-integrity-key-provider";

export type PublicationPublishedAuditAppendInput = Readonly<{
  tenantId: string;
  actorMembershipId: string;
  publicationId: string;
  publicationVersion: number;
  occurredAt: Date;
  eventFacts: PublicationPublishedAuditEventFacts;
}>;

export type AuditEventTransactionDatabase = Pick<
  CampusHubDatabase,
  "select" | "insert"
>;

export type AuditEventRepositoryDependencies = Readonly<{
  database: Pick<CampusHubDatabase, "select">;
  keyProvider: AuditIntegrityKeyProvider;
  eventIdFactory?: () => string;
}>;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const AUDIT_VERIFICATION_PAGE_SIZE = 500;

function toAuditEvent(row: AuditEventRow): AuditEvent | null {
  if (
    !(row.occurredAt instanceof Date) ||
    Number.isNaN(row.occurredAt.getTime())
  ) {
    return null;
  }

  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    sequence: row.sequence,
    eventType: row.eventType,
    actorMembershipId: row.actorMembershipId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceVersion: row.resourceVersion,
    occurredAt: row.occurredAt,
    eventFacts: row.eventFacts,
    previousHash: row.previousHash,
    currentHash: row.currentHash,
    keyVersion: row.keyVersion,
    integrityFormatVersion: row.integrityFormatVersion,
    eventContractVersion: row.eventContractVersion,
  };
  const envelope = normalizeAuditIntegrityEnvelope({
    integrityFormatVersion: candidate.integrityFormatVersion,
    eventContractVersion: candidate.eventContractVersion,
    tenantId: candidate.tenantId,
    sequence: candidate.sequence,
    eventId: candidate.id,
    eventType: candidate.eventType,
    actorMembershipId: candidate.actorMembershipId,
    resourceType: candidate.resourceType,
    resourceId: candidate.resourceId,
    resourceVersion: candidate.resourceVersion,
    occurredAt: candidate.occurredAt.toISOString(),
    eventFacts: candidate.eventFacts,
    previousHash: candidate.previousHash,
    keyVersion: candidate.keyVersion,
  });

  if (
    envelope === null ||
    !isUuid(candidate.id) ||
    !/^[0-9a-f]{64}$/.test(candidate.currentHash)
  ) {
    return null;
  }

  return {
    id: envelope.eventId,
    tenantId: envelope.tenantId,
    sequence: envelope.sequence,
    eventType: envelope.eventType,
    actorMembershipId: envelope.actorMembershipId,
    resourceType: envelope.resourceType,
    resourceId: envelope.resourceId,
    resourceVersion: envelope.resourceVersion,
    occurredAt: candidate.occurredAt,
    eventFacts: envelope.eventFacts,
    previousHash: envelope.previousHash,
    currentHash: candidate.currentHash,
    keyVersion: envelope.keyVersion,
    integrityFormatVersion: envelope.integrityFormatVersion,
    eventContractVersion: envelope.eventContractVersion,
  };
}

export class DrizzleAuditEventRepository {
  public constructor(
    private readonly dependencies: AuditEventRepositoryDependencies,
  ) {}

  /**
   * Appends the closed publication.published contract to the transaction that
   * already holds the authoritative Tenant lock. There are intentionally no
   * update/delete/truncate methods on this repository.
   */
  public async appendPublicationPublishedInTransaction(
    transaction: AuditEventTransactionDatabase,
    input: PublicationPublishedAuditAppendInput,
  ): Promise<AuditEvent> {
    if (
      !isUuid(input.tenantId) ||
      !isUuid(input.actorMembershipId) ||
      !isUuid(input.publicationId) ||
      !isPositiveInteger(input.publicationVersion) ||
      !(input.occurredAt instanceof Date) ||
      Number.isNaN(input.occurredAt.getTime()) ||
      !isNonNegativeInteger(input.eventFacts.confirmedRecipientCount) ||
      input.eventFacts.audienceMode !== input.eventFacts.audienceSnapshot.mode
    ) {
      throw new Error("Invalid publication.published audit input.");
    }

    const latestRows = await transaction
      .select({
        sequence: auditEvents.sequence,
        currentHash: auditEvents.currentHash,
      })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, input.tenantId))
      .orderBy(desc(auditEvents.sequence))
      .limit(1);
    const latest = latestRows[0];
    const sequence = latest === undefined ? 1 : latest.sequence + 1;
    const previousHash = latest?.currentHash ?? "0".repeat(64);
    if (!isPositiveInteger(sequence) || !/^[0-9a-f]{64}$/.test(previousHash)) {
      throw new Error("Invalid prior Tenant audit chain state.");
    }

    const signingKey = this.dependencies.keyProvider.getActiveSigningKey();
    if (signingKey === null) {
      throw new Error("No active AuditEvent signing key is configured.");
    }

    const event: AuditEvent = {
      id: (this.dependencies.eventIdFactory ?? randomUUID)(),
      tenantId: input.tenantId.toLowerCase(),
      sequence,
      eventType: "publication.published",
      actorMembershipId: input.actorMembershipId.toLowerCase(),
      resourceType: "publication",
      resourceId: input.publicationId.toLowerCase(),
      resourceVersion: input.publicationVersion,
      occurredAt: input.occurredAt,
      eventFacts: input.eventFacts,
      previousHash,
      currentHash: "",
      keyVersion: signingKey.keyVersion,
      integrityFormatVersion: AUDIT_INTEGRITY_FORMAT_VERSION,
      eventContractVersion: AUDIT_EVENT_CONTRACT_VERSION,
    };
    const currentHash = computeAuditCurrentHash(
      auditEventToIntegrityEnvelope(event),
      signingKey.key,
    );
    const signedEvent = { ...event, currentHash };
    const rows = await transaction
      .insert(auditEvents)
      .values({
        id: signedEvent.id,
        tenantId: signedEvent.tenantId,
        sequence: signedEvent.sequence,
        eventType: signedEvent.eventType,
        actorMembershipId: signedEvent.actorMembershipId,
        resourceType: signedEvent.resourceType,
        resourceId: signedEvent.resourceId,
        resourceVersion: signedEvent.resourceVersion,
        occurredAt: signedEvent.occurredAt,
        eventFacts: signedEvent.eventFacts,
        previousHash: signedEvent.previousHash,
        currentHash: signedEvent.currentHash,
        keyVersion: signedEvent.keyVersion,
        integrityFormatVersion: signedEvent.integrityFormatVersion,
        eventContractVersion: signedEvent.eventContractVersion,
      })
      .returning();
    const persisted = rows[0] ? toAuditEvent(rows[0]) : null;
    if (persisted === null || persisted.currentHash !== currentHash) {
      throw new Error("AuditEvent append returned an invalid persisted row.");
    }
    return persisted;
  }

  public async findAuditEventByIdForTenant(
    tenantId: string,
    eventId: string,
  ): Promise<AuditEvent | null> {
    if (!isUuid(tenantId) || !isUuid(eventId)) {
      return null;
    }

    const rows = await this.dependencies.database
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, tenantId), eq(auditEvents.id, eventId)))
      .limit(1);
    return rows[0] ? toAuditEvent(rows[0]) : null;
  }

  public async listAuditEventsForTenant(
    tenantId: string,
    limit = 100,
  ): Promise<readonly AuditEvent[]> {
    if (!isUuid(tenantId) || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return [];
    }

    const rows = await this.dependencies.database
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenantId))
      .orderBy(asc(auditEvents.sequence))
      .limit(limit);
    return rows.flatMap((row) => {
      const event = toAuditEvent(row);
      return event === null ? [] : [event];
    });
  }

  public async verifyAuditChainForTenant(tenantId: string): Promise<boolean> {
    if (!isUuid(tenantId)) {
      return false;
    }

    try {
      let afterSequence: number | undefined;
      let expectedSequence = 1;
      let previousHash = "0".repeat(64);

      while (true) {
        const scope =
          afterSequence === undefined
            ? eq(auditEvents.tenantId, tenantId)
            : and(
                eq(auditEvents.tenantId, tenantId),
                gt(auditEvents.sequence, afterSequence),
              );
        const rows = await this.dependencies.database
          .select()
          .from(auditEvents)
          .where(scope)
          .orderBy(asc(auditEvents.sequence))
          .limit(AUDIT_VERIFICATION_PAGE_SIZE);

        if (rows.length === 0) {
          return true;
        }

        for (const row of rows) {
          if (row.tenantId !== tenantId) {
            return false;
          }

          const event = toAuditEvent(row);
          if (
            event === null ||
            event.tenantId !== tenantId ||
            event.sequence !== expectedSequence ||
            event.previousHash !== previousHash ||
            !verifyAuditEvent(event, this.dependencies.keyProvider)
          ) {
            return false;
          }

          expectedSequence += 1;
          previousHash = event.currentHash;
          afterSequence = event.sequence;
        }
      }
    } catch {
      return false;
    }
  }
}
