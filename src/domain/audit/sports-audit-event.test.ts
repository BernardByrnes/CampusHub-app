import { describe, expect, it } from "vitest";

import {
  isSportsAuditEventFacts,
  normalizeAuditIntegrityEnvelope,
  normalizeSportsAuditEventFacts,
  SPORTS_AUDIT_EVENT_TYPES,
} from "./audit-event";

const sportId = "00000000-0000-4000-8000-000000000001";
const campusId = "00000000-0000-4000-8000-000000000002";

const factsByResource = {
  sport: {
    action: "created",
    name: "Football",
    status: "active",
    version: 1,
    sportId: null,
    campusId: null,
    tableMode: null,
  },
  competition: {
    action: "created",
    name: "Campus League",
    status: "active",
    version: 1,
    sportId,
    campusId,
    tableMode: "none",
  },
  team: {
    action: "created",
    name: "Campus United",
    status: "active",
    version: 1,
    sportId,
    campusId: null,
    tableMode: null,
  },
} as const;

describe("Sports audit event contracts", () => {
  it("accepts every closed create/change/deactivate event with its resource shape", () => {
    for (const eventType of SPORTS_AUDIT_EVENT_TYPES) {
      const resource = eventType.split(".")[0] as keyof typeof factsByResource;
      const action = eventType.split(".")[1] as
        | "created"
        | "changed"
        | "deactivated";
      const facts = {
        ...factsByResource[resource],
        action,
        status: action === "deactivated" ? "inactive" : "active",
      };

      expect(normalizeSportsAuditEventFacts(facts, eventType, resource)).toEqual(
        facts,
      );
      expect(isSportsAuditEventFacts(facts, eventType, resource)).toBe(true);
    }
  });

  it("rejects mismatched resources, extra facts, invalid statuses, and invalid identifiers", () => {
    expect(
      normalizeSportsAuditEventFacts(
        factsByResource.sport,
        "sport.created",
        "team",
      ),
    ).toBeNull();
    expect(
      normalizeSportsAuditEventFacts(
        { ...factsByResource.sport, extra: true },
        "sport.created",
        "sport",
      ),
    ).toBeNull();
    expect(
      normalizeSportsAuditEventFacts(
        { ...factsByResource.sport, status: "inactive" },
        "sport.created",
        "sport",
      ),
    ).toBeNull();
    expect(
      normalizeSportsAuditEventFacts(
        { ...factsByResource.team, sportId: "not-a-uuid" },
        "team.created",
        "team",
      ),
    ).toBeNull();
  });

  it("accepts Sports facts in the canonical integrity envelope and rejects pair drift", () => {
    const envelope = {
      integrityFormatVersion: 1,
      eventContractVersion: 1,
      tenantId: "00000000-0000-4000-8000-000000000003",
      sequence: 1,
      eventId: "00000000-0000-4000-8000-000000000004",
      eventType: "competition.created",
      actorMembershipId: "00000000-0000-4000-8000-000000000005",
      resourceType: "competition",
      resourceId: "00000000-0000-4000-8000-000000000006",
      resourceVersion: 1,
      occurredAt: "2026-09-10T12:00:00.000Z",
      eventFacts: factsByResource.competition,
      previousHash: "0".repeat(64),
      keyVersion: 1,
    };

    expect(normalizeAuditIntegrityEnvelope(envelope)).toMatchObject(envelope);
    expect(
      normalizeAuditIntegrityEnvelope({
        ...envelope,
        eventType: "team.created",
      }),
    ).toBeNull();
  });
});
