import { describe, expect, it } from "vitest";

import {
  isOrganiser,
  parseOrganiserExpectedVersion,
  parseOrganiserListLimit,
  parseOrganiserName,
} from "./organisers";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ORGANISER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-09-20T10:00:00.000Z");

describe("Organiser domain", () => {
  it("normalizes bounded names and rejects empty or oversized names", () => {
    expect(parseOrganiserName("  Student Affairs  ")).toBe("Student Affairs");
    expect(parseOrganiserName(" ")).toBeNull();
    expect(parseOrganiserName("x".repeat(121))).toBeNull();
  });

  it("accepts only positive expected versions and bounded list limits", () => {
    expect(parseOrganiserExpectedVersion(1)).toBe(1);
    expect(parseOrganiserExpectedVersion(0)).toBeNull();
    expect(parseOrganiserExpectedVersion(1.5)).toBeNull();
    expect(parseOrganiserListLimit(undefined)).toBe(50);
    expect(parseOrganiserListLimit(100)).toBe(100);
    expect(parseOrganiserListLimit(101)).toBeNull();
  });

  it("validates Tenant-owned resource identity and timestamps", () => {
    expect(isOrganiser({
      id: ORGANISER_ID,
      tenantId: TENANT_ID,
      version: 1,
      name: "Student Affairs",
      createdAt: NOW,
      updatedAt: NOW,
    })).toBe(true);
    expect(isOrganiser({
      id: ORGANISER_ID,
      tenantId: TENANT_ID,
      version: 1,
      name: "Student Affairs",
      createdAt: NOW,
      updatedAt: "not-a-date",
    })).toBe(false);
  });
});
