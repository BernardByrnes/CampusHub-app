import { describe, expect, it } from "vitest";

import {
  FIXTURE_AUDIT_EVENT_TYPES,
  normalizeFixtureAuditEventFacts,
  normalizeAuditIntegrityEnvelope,
} from "./audit-event";

const facts = {
  action: "created" as const,
  state: "scheduled" as const,
  version: 1,
  competitionId: "00000000-0000-4000-8000-000000000001",
  homeTeamId: "00000000-0000-4000-8000-000000000002",
  awayTeamId: "00000000-0000-4000-8000-000000000003",
  campusId: "00000000-0000-4000-8000-000000000004",
  startsAt: "2026-09-10T12:00:00.000Z",
  venue: "Main pitch",
  reason: null,
};

describe("Fixture audit event contract", () => {
  it("accepts the create contract and closes the event/resource pair", () => {
    expect(normalizeFixtureAuditEventFacts(facts, "fixture.created")).toEqual(facts);
    expect(
      normalizeFixtureAuditEventFacts({ ...facts, state: "completed" }, "fixture.created"),
    ).toBeNull();
    expect(
      normalizeFixtureAuditEventFacts({ ...facts, extra: true }, "fixture.created"),
    ).toBeNull();
  });

  it("accepts each lifecycle event only with its matching state", () => {
    const states = {
      "fixture.created": ["created", "scheduled", null],
      "fixture.changed": ["changed", "postponed", null],
      "fixture.postponed": ["postponed", "postponed", "Weather"],
      "fixture.cancelled": ["cancelled", "cancelled", "Cancelled"],
      "fixture.completed": ["completed", "completed", null],
      "fixture.abandoned": ["abandoned", "abandoned", "Abandoned"],
    } as const;
    for (const eventType of FIXTURE_AUDIT_EVENT_TYPES) {
      const [action, state, reason] = states[eventType];
      expect(
        normalizeFixtureAuditEventFacts(
          { ...facts, action, state, reason },
          eventType,
        ),
      ).not.toBeNull();
    }
  });

  it("dispatches Fixture facts through the integrity envelope", () => {
    const envelope = {
      integrityFormatVersion: 1,
      eventContractVersion: 1,
      tenantId: "00000000-0000-4000-8000-000000000005",
      sequence: 1,
      eventId: "00000000-0000-4000-8000-000000000006",
      eventType: "fixture.created",
      actorMembershipId: "00000000-0000-4000-8000-000000000007",
      resourceType: "fixture",
      resourceId: "00000000-0000-4000-8000-000000000008",
      resourceVersion: 1,
      occurredAt: "2026-09-10T12:00:00.000Z",
      eventFacts: facts,
      previousHash: "0".repeat(64),
      keyVersion: 1,
    };
    expect(normalizeAuditIntegrityEnvelope(envelope)).toMatchObject(envelope);
  });
});
