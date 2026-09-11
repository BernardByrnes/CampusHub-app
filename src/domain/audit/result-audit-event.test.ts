import { describe, expect, it } from "vitest";

import {
  RESULT_AUDIT_EVENT_TYPES,
  normalizeAuditIntegrityEnvelope,
  normalizeResultAuditEventFacts,
} from "./audit-event";

const fixtureId = "00000000-0000-4000-8000-000000000001";
const facts = {
  action: "published" as const,
  lifecycle: "published" as const,
  version: 2,
  fixtureId,
  revisionNumber: 1,
  homeScore: 2,
  awayScore: 1,
  correctionReason: null,
};

describe("Result audit event contract", () => {
  it("closes each Result lifecycle event with its matching facts", () => {
    expect(normalizeResultAuditEventFacts(facts, "result.published")).toEqual(facts);
    expect(normalizeResultAuditEventFacts({ ...facts, homeScore: 1001 }, "result.published")).toBeNull();
    expect(normalizeResultAuditEventFacts({ ...facts, revisionNumber: 2 }, "result.published")).toBeNull();
    expect(normalizeResultAuditEventFacts({ ...facts, action: "corrected", lifecycle: "published", revisionNumber: 2, correctionReason: "Official correction", version: 3 }, "result.corrected")).not.toBeNull();
  });

  it("dispatches Result facts through the integrity envelope", () => {
    for (const eventType of RESULT_AUDIT_EVENT_TYPES) {
      const isCorrection = eventType === "result.corrected";
      const eventFacts = isCorrection
        ? { ...facts, action: "corrected" as const, version: 3, revisionNumber: 2, correctionReason: "Official correction" }
        : eventType === "result.published"
          ? facts
          : { ...facts, action: eventType === "result.draft_created" ? "draft_created" as const : "draft_changed" as const, lifecycle: "draft" as const, version: eventType === "result.draft_created" ? 1 : 2, revisionNumber: null, correctionReason: null };
      expect(
        normalizeAuditIntegrityEnvelope({
          integrityFormatVersion: 1,
          eventContractVersion: 1,
          tenantId: "00000000-0000-4000-8000-000000000002",
          sequence: 1,
          eventId: "00000000-0000-4000-8000-000000000003",
          eventType,
          actorMembershipId: "00000000-0000-4000-8000-000000000004",
          resourceType: "result",
          resourceId: "00000000-0000-4000-8000-000000000005",
          resourceVersion: eventFacts.version,
          occurredAt: "2026-09-10T12:00:00.000Z",
          eventFacts,
          previousHash: "0".repeat(64),
          keyVersion: 1,
        }),
      ).not.toBeNull();
    }
  });
});
