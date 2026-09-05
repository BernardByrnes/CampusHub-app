import { describe, expect, it } from "vitest";

import {
  GUILD_TERM_STATUSES,
  isGuildTerm,
  parseGuildTermStatus,
} from "./guild-term";

const createdAt = new Date("2026-01-01T00:00:00.000Z");

describe("GuildTerm domain contract", () => {
  it("keeps the lifecycle vocabulary closed", () => {
    expect(GUILD_TERM_STATUSES).toEqual(["upcoming", "active", "closed"]);
    expect(parseGuildTermStatus("active")).toBe("active");
    expect(parseGuildTermStatus("suspended")).toBeNull();
  });

  it("accepts only a nonempty, ordered term shape", () => {
    const term = {
      id: "00000000-0000-4000-8000-000000000001",
      tenantId: "00000000-0000-4000-8000-000000000002",
      label: "Guild Term 2026",
      startsAt: new Date("2026-01-01T00:00:00.000Z"),
      endsAt: new Date("2026-12-31T23:59:59.000Z"),
      status: "active" as const,
      createdAt,
      updatedAt: createdAt,
    };

    expect(isGuildTerm(term)).toBe(true);
    expect(isGuildTerm({ ...term, label: "   " })).toBe(false);
    expect(isGuildTerm({ ...term, endsAt: term.startsAt })).toBe(false);
    expect(isGuildTerm({ ...term, status: "unknown" })).toBe(false);
  });
});
