import { describe, expect, it } from "vitest";

import {
  canonicalizeAuditIntegrityEnvelope,
  normalizeEventAuditEventFacts,
} from "./audit-event";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";

describe("Event audit contracts", () => {
  it("accepts only the minimized lifecycle/version facts for each Event action", () => {
    expect(normalizeEventAuditEventFacts(
      { action: "created", lifecycle: "draft", version: 1 },
      "event.created",
    )).toEqual({ action: "created", lifecycle: "draft", version: 1 });
    expect(normalizeEventAuditEventFacts(
      { action: "published", lifecycle: "published", version: 2 },
      "event.published",
    )).toEqual({ action: "published", lifecycle: "published", version: 2 });
    expect(normalizeEventAuditEventFacts(
      { action: "published", lifecycle: "draft", version: 2 },
      "event.published",
    )).toBeNull();
    expect(normalizeEventAuditEventFacts(
      { action: "changed", lifecycle: "draft", version: 2, title: "leak" },
      "event.changed",
    )).toBeNull();
    expect(normalizeEventAuditEventFacts(
      { action: "postponed", lifecycle: "postponed", version: 3, historySequence: 2 },
      "event.postponed",
    )).toEqual({ action: "postponed", lifecycle: "postponed", version: 3, historySequence: 2 });
    expect(normalizeEventAuditEventFacts(
      { action: "cancelled", lifecycle: "cancelled", version: 4, historySequence: 3, reason: "leak" },
      "event.cancelled",
    )).toBeNull();
  });

  it("includes Event envelopes in the closed integrity contract", () => {
    const envelope = {
      integrityFormatVersion: 1,
      eventContractVersion: 1,
      tenantId: TENANT_ID,
      sequence: 1,
      eventId: "44444444-4444-4444-8444-444444444444",
      eventType: "event.created" as const,
      actorMembershipId: MEMBERSHIP_ID,
      resourceType: "event" as const,
      resourceId: EVENT_ID,
      resourceVersion: 1,
      occurredAt: "2026-09-20T10:00:00.000Z",
      eventFacts: { action: "created" as const, lifecycle: "draft" as const, version: 1 },
      previousHash: "0".repeat(64),
      keyVersion: 1,
    };
    expect(canonicalizeAuditIntegrityEnvelope(envelope)).toContain('"eventType":"event.created"');
    expect(() => canonicalizeAuditIntegrityEnvelope({ ...envelope, eventFacts: { action: "created", lifecycle: "draft", version: 1, secret: "no" } })).toThrow();
  });
});
