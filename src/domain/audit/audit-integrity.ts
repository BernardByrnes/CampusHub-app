import { createHmac, timingSafeEqual } from "node:crypto";

import {
  canonicalizeAuditIntegrityEnvelope,
  type AuditEvent,
  type AuditIntegrityEnvelopeV1,
} from "./audit-event";
import type { AuditIntegrityKeyProvider } from "./audit-integrity-key-provider";

export function auditEventToIntegrityEnvelope(
  event: AuditEvent,
): AuditIntegrityEnvelopeV1 {
  return {
    integrityFormatVersion: event.integrityFormatVersion,
    eventContractVersion: event.eventContractVersion,
    tenantId: event.tenantId,
    sequence: event.sequence,
    eventId: event.id,
    eventType: event.eventType,
    actorMembershipId: event.actorMembershipId,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    resourceVersion: event.resourceVersion,
    occurredAt: event.occurredAt.toISOString(),
    eventFacts: event.eventFacts,
    previousHash: event.previousHash,
    keyVersion: event.keyVersion,
  };
}

export function computeAuditCurrentHash(
  envelope: unknown,
  key: Uint8Array,
): string {
  const canonicalBytes = canonicalizeAuditIntegrityEnvelope(envelope);
  return createHmac("sha256", Buffer.from(key))
    .update(canonicalBytes, "utf8")
    .digest("hex");
}

export function verifyAuditEvent(
  event: AuditEvent,
  keyProvider: AuditIntegrityKeyProvider,
): boolean {
  try {
    const key = keyProvider.getVerificationKey(event.keyVersion);
    if (key === null) {
      return false;
    }
    const expected = computeAuditCurrentHash(
      auditEventToIntegrityEnvelope(event),
      key,
    );
    const actual = Buffer.from(event.currentHash, "hex");
    const expectedBytes = Buffer.from(expected, "hex");
    return (
      actual.length === expectedBytes.length &&
      timingSafeEqual(actual, expectedBytes)
    );
  } catch {
    return false;
  }
}

export function verifyAuditChain(
  events: readonly AuditEvent[],
  keyProvider: AuditIntegrityKeyProvider,
): boolean {
  let expectedSequence = 1;
  let previousHash = "0".repeat(64);

  for (const event of events) {
    if (
      event.sequence !== expectedSequence ||
      event.previousHash !== previousHash ||
      !verifyAuditEvent(event, keyProvider)
    ) {
      return false;
    }
    expectedSequence += 1;
    previousHash = event.currentHash;
  }

  return true;
}
