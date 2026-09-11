import { describe, expect, it } from "vitest";

import {
  canTransitionFixture,
  isFixture,
  parseFixtureReason,
  parseFixtureState,
  parseFixtureTimestamp,
  parseFixtureVenue,
} from "./fixtures";

const tenantId = "00000000-0000-4000-8000-000000000001";
const date = new Date("2026-09-10T12:00:00.000Z");

describe("Fixture domain contract", () => {
  it("closes the lifecycle and transition vocabulary", () => {
    expect(parseFixtureState("scheduled")).toBe("scheduled");
    expect(parseFixtureState("completed")).toBe("completed");
    expect(parseFixtureState("deleted")).toBeNull();
    expect(canTransitionFixture("scheduled", "postponed")).toBe(true);
    expect(canTransitionFixture("postponed", "cancelled")).toBe(true);
    expect(canTransitionFixture("completed", "scheduled")).toBe(false);
    expect(canTransitionFixture("cancelled", "completed")).toBe(false);
  });

  it("normalizes canonical timestamps and bounded text", () => {
    expect(parseFixtureTimestamp("2026-09-10T12:00:00.000Z")).toEqual(date);
    expect(parseFixtureTimestamp("2026-09-10")).toBeNull();
    expect(parseFixtureVenue("  Main pitch  ")).toBe("Main pitch");
    expect(parseFixtureVenue(" ")).toBeNull();
    expect(parseFixtureReason("  Weather  ")).toBe("Weather");
    expect(parseFixtureReason(" ")).toBeNull();
  });

  it("recognizes a canonical Fixture and rejects a same-team matchup", () => {
    const fixture = {
      id: "00000000-0000-4000-8000-000000000002",
      tenantId,
      competitionId: "00000000-0000-4000-8000-000000000003",
      homeTeamId: "00000000-0000-4000-8000-000000000004",
      awayTeamId: "00000000-0000-4000-8000-000000000005",
      campusId: "00000000-0000-4000-8000-000000000006",
      startsAt: date,
      venue: "Main pitch",
      state: "scheduled" as const,
      reason: null,
      version: 1,
      createdAt: date,
      updatedAt: date,
    };
    expect(isFixture(fixture)).toBe(true);
    expect(isFixture({ ...fixture, awayTeamId: fixture.homeTeamId })).toBe(false);
  });
});
