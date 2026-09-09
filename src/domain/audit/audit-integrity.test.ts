import { describe, expect, it } from "vitest";

import {
  AUDIT_EVENT_CONTRACT_VERSION,
  AUDIT_GENESIS_HASH,
  AUDIT_INTEGRITY_FORMAT_VERSION,
  canonicalizeAuditIntegrityEnvelope,
  type AuditEvent,
} from "./audit-event";
import {
  auditEventToIntegrityEnvelope,
  computeAuditCurrentHash,
  verifyAuditChain,
  verifyAuditEvent,
} from "./audit-integrity";
import { StaticAuditIntegrityKeyProvider } from "./audit-integrity-key-provider";

const key = new Uint8Array(Buffer.from("campushub-audit-test-key-2026-09-09"));
const provider = new StaticAuditIntegrityKeyProvider(1, new Map([[1, key]]));
const tenantA = "00000000-0000-4000-8000-000000000001";
const tenantB = "00000000-0000-4000-8000-000000000002";
const actorMembershipId = "00000000-0000-4000-8000-000000000003";
const publicationA = "00000000-0000-4000-8000-000000000004";
const publicationB = "00000000-0000-4000-8000-000000000005";

function makeEvent(
  overrides: Partial<AuditEvent> = {},
  eventFacts: AuditEvent["eventFacts"] = {
    transition: { from: "draft", to: "published" },
    audienceMode: "entire_tenant",
    confirmedRecipientCount: 4,
    audienceSnapshot: { mode: "entire_tenant", targets: [] },
  },
): AuditEvent {
  const event: AuditEvent = {
    id: "00000000-0000-4000-8000-000000000010",
    tenantId: tenantA,
    sequence: 1,
    eventType: "publication.published",
    actorMembershipId,
    resourceType: "publication",
    resourceId: publicationA,
    resourceVersion: 2,
    occurredAt: new Date("2026-09-09T10:00:00.000Z"),
    eventFacts,
    previousHash: AUDIT_GENESIS_HASH,
    currentHash: "",
    keyVersion: 1,
    integrityFormatVersion: AUDIT_INTEGRITY_FORMAT_VERSION,
    eventContractVersion: AUDIT_EVENT_CONTRACT_VERSION,
    ...overrides,
  };

  return {
    ...event,
    currentHash: computeAuditCurrentHash(
      auditEventToIntegrityEnvelope(event),
      key,
    ),
  };
}

describe("audit integrity", () => {
  it("verifies a signed event and a Tenant-local chain", () => {
    const first = makeEvent();
    const second = makeEvent({
      id: "00000000-0000-4000-8000-000000000011",
      sequence: 2,
      resourceId: publicationB,
      resourceVersion: 3,
      previousHash: first.currentHash,
      occurredAt: new Date("2026-09-09T10:01:00.000Z"),
    });

    expect(verifyAuditEvent(first, provider)).toBe(true);
    expect(verifyAuditEvent(second, provider)).toBe(true);
    expect(verifyAuditChain([first, second], provider)).toBe(true);
    expect(
      verifyAuditChain(
        [
          makeEvent({
            tenantId: tenantB,
            id: "00000000-0000-4000-8000-000000000012",
          }),
        ],
        provider,
      ),
    ).toBe(true);
  });

  it("binds the signature to every envelope fact and chain link", () => {
    const event = makeEvent();
    for (const mutated of [
      { ...event, resourceId: publicationB },
      { ...event, sequence: 2 },
      { ...event, previousHash: "f".repeat(64) },
      {
        ...event,
        eventFacts: {
          ...event.eventFacts,
          confirmedRecipientCount: 5,
        },
      },
      { ...event, currentHash: "0".repeat(64) },
    ]) {
      expect(verifyAuditEvent(mutated, provider)).toBe(false);
    }
    expect(verifyAuditEvent(event, new StaticAuditIntegrityKeyProvider(2, new Map([[2, key]])))).toBe(false);
    expect(
      verifyAuditChain(
        [
          event,
          makeEvent({
            id: "00000000-0000-4000-8000-000000000013",
            sequence: 3,
            previousHash: event.currentHash,
          }),
        ],
        provider,
      ),
    ).toBe(false);
  });

  it("canonicalizes target order before signing", () => {
    const targets = [
      {
        dimension: "academic_year" as const,
        targetId: null,
        targetValue: 2,
        targetLabel: null,
      },
      {
        dimension: "residence" as const,
        targetId: null,
        targetValue: "non_resident" as const,
        targetLabel: null,
      },
    ];
    const facts = {
      transition: { from: "draft" as const, to: "published" as const },
      audienceMode: "targeted" as const,
      confirmedRecipientCount: 2,
      audienceSnapshot: { mode: "targeted" as const, targets },
    };
    const reversedFacts = {
      ...facts,
      audienceSnapshot: {
        mode: "targeted" as const,
        targets: [...targets].reverse(),
      },
    };
    const first = makeEvent({ id: "00000000-0000-4000-8000-000000000014" }, facts);
    const second = makeEvent({ id: "00000000-0000-4000-8000-000000000014" }, reversedFacts);

    expect(
      canonicalizeAuditIntegrityEnvelope(auditEventToIntegrityEnvelope(first)),
    ).toBe(
      canonicalizeAuditIntegrityEnvelope(auditEventToIntegrityEnvelope(second)),
    );
    expect(first.currentHash).toBe(second.currentHash);
  });

  it("fails closed for unknown versions, keys, and malformed current hashes", () => {
    const event = makeEvent();
    expect(
      verifyAuditEvent(
        { ...event, integrityFormatVersion: 2 as 1 },
        provider,
      ),
    ).toBe(false);
    expect(
      verifyAuditEvent(
        { ...event, eventContractVersion: 2 as 1 },
        provider,
      ),
    ).toBe(false);
    expect(verifyAuditEvent({ ...event, currentHash: "not-a-hash" }, provider)).toBe(
      false,
    );
    expect(
      verifyAuditEvent(
        { ...event, keyVersion: 2 },
        provider,
      ),
    ).toBe(false);
  });
});
