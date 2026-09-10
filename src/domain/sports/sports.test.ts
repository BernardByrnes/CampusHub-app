import { describe, expect, it } from "vitest";

import {
  isCompetition,
  isSport,
  isTeam,
  parseAffiliationLabel,
  parseCompetitionTableMode,
  parseExpectedVersion,
  parseSeasonLabel,
  parseSportLifecycle,
  parseSportName,
  parseSportsListLimit,
} from "./sports";

const tenantId = "00000000-0000-4000-8000-000000000001";
const sportId = "00000000-0000-4000-8000-000000000002";
const campusId = "00000000-0000-4000-8000-000000000003";
const createdAt = new Date("2026-01-01T00:00:00.000Z");

describe("Sports domain contracts", () => {
  it("accepts only the closed lifecycle and competition table vocabularies", () => {
    expect(parseSportLifecycle("active")).toBe("active");
    expect(parseSportLifecycle("inactive")).toBe("inactive");
    expect(parseSportLifecycle("deleted")).toBeNull();
    expect(parseCompetitionTableMode("none")).toBe("none");
    expect(parseCompetitionTableMode("manual")).toBe("manual");
    expect(parseCompetitionTableMode("automatic")).toBeNull();
  });

  it("normalizes bounded labels and rejects blank or oversized input", () => {
    expect(parseSportName("  Football  ")).toBe("Football");
    expect(parseSeasonLabel("  2026  ")).toBe("2026");
    expect(parseAffiliationLabel("  School  ")).toBe("School");
    expect(parseAffiliationLabel(null)).toBeNull();
    expect(parseAffiliationLabel(undefined)).toBeUndefined();
    expect(parseAffiliationLabel(" ")).toBeUndefined();
    expect(parseSportName(" ")).toBeNull();
    expect(parseSeasonLabel(" ".repeat(81))).toBeNull();
    expect(parseAffiliationLabel("x".repeat(161))).toBeUndefined();
  });

  it("bounds versions and list requests", () => {
    expect(parseExpectedVersion(1)).toBe(1);
    expect(parseExpectedVersion(0)).toBeNull();
    expect(parseExpectedVersion(1.5)).toBeNull();
    expect(parseSportsListLimit(undefined)).toBe(50);
    expect(parseSportsListLimit(100)).toBe(100);
    expect(parseSportsListLimit(101)).toBeNull();
  });

  it("recognizes canonical Sport, Competition, and Team values", () => {
    const sport = {
      id: sportId,
      tenantId,
      name: "Football",
      status: "active" as const,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const competition = {
      id: "00000000-0000-4000-8000-000000000004",
      tenantId,
      sportId,
      name: "Campus League",
      seasonLabel: "2026",
      campusId,
      tableMode: "none" as const,
      status: "active" as const,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const team = {
      id: "00000000-0000-4000-8000-000000000005",
      tenantId,
      sportId,
      name: "Campus United",
      affiliationLabel: null,
      status: "active" as const,
      version: 1,
      createdAt,
      updatedAt: createdAt,
    };

    expect(isSport(sport)).toBe(true);
    expect(isCompetition(competition)).toBe(true);
    expect(isTeam(team)).toBe(true);
    expect(isTeam({ ...team, affiliationLabel: "" })).toBe(false);
  });
});
