import { describe, expect, it } from "vitest";

import {
  EVENT_RSVP_XP_DEFAULT,
  EVENT_RSVP_XP_MAX,
  EVENT_RSVP_XP_MIN,
  XP_PILOT_DAILY_CAP,
  decideEventRsvpXpAward,
} from "./xp-ledger";

describe("Event RSVP XP policy", () => {
  it("uses the approved default and range", () => {
    expect(EVENT_RSVP_XP_DEFAULT).toBe(5);
    expect(EVENT_RSVP_XP_MIN).toBe(1);
    expect(EVENT_RSVP_XP_MAX).toBe(10);
    expect(EVENT_RSVP_XP_MIN).toBeLessThanOrEqual(EVENT_RSVP_XP_DEFAULT);
    expect(EVENT_RSVP_XP_DEFAULT).toBeLessThanOrEqual(EVENT_RSVP_XP_MAX);
  });

  it("awards the whole Event RSVP amount while it fits the Tenant-local day cap", () => {
    expect(
      decideEventRsvpXpAward({
        proposedAmount: EVENT_RSVP_XP_DEFAULT,
        awardedToday: XP_PILOT_DAILY_CAP - EVENT_RSVP_XP_DEFAULT,
        tenantDay: "2026-09-17",
      }),
    ).toEqual({
      entryType: "award",
      amount: EVENT_RSVP_XP_DEFAULT,
      awardedToday: 45,
      tenantDay: "2026-09-17",
    });
  });

  it("caps a whole award to zero instead of partially awarding it", () => {
    expect(
      decideEventRsvpXpAward({
        proposedAmount: EVENT_RSVP_XP_DEFAULT,
        awardedToday: XP_PILOT_DAILY_CAP - EVENT_RSVP_XP_DEFAULT + 1,
        tenantDay: "2026-09-17",
      }),
    ).toEqual({
      entryType: "capped_award",
      amount: 0,
      awardedToday: 46,
      tenantDay: "2026-09-17",
    });
  });

  it("rejects values outside the approved rule and malformed Tenant days", () => {
    for (const proposedAmount of [0, EVENT_RSVP_XP_MAX + 1, 1.5]) {
      expect(
        decideEventRsvpXpAward({
          proposedAmount,
          awardedToday: 0,
          tenantDay: "2026-09-17",
        }),
      ).toBeNull();
    }
    expect(
      decideEventRsvpXpAward({
        proposedAmount: EVENT_RSVP_XP_DEFAULT,
        awardedToday: 0,
        tenantDay: "not-a-date",
      }),
    ).toBeNull();
  });
});
