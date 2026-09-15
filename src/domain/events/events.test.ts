import { describe, expect, it } from "vitest";

import {
  isEvent,
  isEventPast,
  isMaterialEventChange,
  parseEventDescription,
  parseEventExpectedVersion,
  parseEventReason,
  parseEventTitle,
  parseEventVenue,
} from "./events";
import type { Event } from "./events";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const CAMPUS_ID = "33333333-3333-4333-8333-333333333333";
const STARTS_AT = new Date("2026-09-20T10:00:00.000Z");

function event(overrides: Partial<Record<string, unknown>> = {}): Event {
  return {
    id: EVENT_ID,
    tenantId: TENANT_ID,
    version: 1,
    title: "Orientation",
    description: "A campus event",
    venue: "Main Hall",
    startsAt: STARTS_AT,
    endsAt: null,
    campusId: CAMPUS_ID,
    visibility: "MEMBERS",
    audienceMode: "entire_tenant",
    rsvpEnabled: false,
    lifecycle: "draft",
    cancellationRetentionUntil: null,
    createdAt: STARTS_AT,
    updatedAt: STARTS_AT,
    ...overrides,
  } as Event;
}

describe("Event domain", () => {
  it("normalizes bounded text and accepts only positive versions", () => {
    expect(parseEventTitle("  Orientation  ")).toBe("Orientation");
    expect(parseEventDescription(" ")).toBeNull();
    expect(parseEventVenue(" Main Hall ")).toBe("Main Hall");
    expect(parseEventExpectedVersion(1)).toBe(1);
    expect(parseEventExpectedVersion(0)).toBeNull();
    expect(parseEventExpectedVersion("1")).toBeNull();
  });

  it("requires an explicit endsAt field and enforces its ordering", () => {
    expect(isEvent(event())).toBe(true);
    expect(isEvent(event({ endsAt: new Date("2026-09-20T11:00:00.000Z") }))).toBe(true);
    expect(isEvent(event({ endsAt: new Date("2026-09-20T10:00:00.000Z") }))).toBe(false);
    const withoutEndsAt = { ...event() };
    delete (withoutEndsAt as Record<string, unknown>).endsAt;
    expect(isEvent(withoutEndsAt)).toBe(false);
  });

  it("derives past without changing the durable lifecycle", () => {
    const ongoing = event({ endsAt: new Date("2026-09-20T11:00:00.000Z") });
    expect(isEventPast(ongoing as never, new Date("2026-09-20T10:59:59.000Z"))).toBe(false);
    expect(isEventPast(ongoing as never, new Date("2026-09-20T11:00:00.000Z"))).toBe(true);
    expect(isEventPast(event() as never, new Date("2026-09-20T10:00:00.000Z"))).toBe(true);
    expect(ongoing.lifecycle).toBe("draft");
  });

  it("uses cancellation retention for cancelled Events and validates the reason contract", () => {
    const retention = new Date("2026-09-20T12:00:00.000Z");
    const cancelled = event({
      lifecycle: "cancelled",
      cancellationRetentionUntil: retention,
    });
    expect(isEvent(cancelled)).toBe(true);
    expect(isEventPast(cancelled, new Date("2026-09-20T11:59:59.000Z"))).toBe(false);
    expect(isEventPast(cancelled, retention)).toBe(true);
    expect(isEvent(event({ lifecycle: "cancelled" }))).toBe(false);
    expect(isEvent(event({ lifecycle: "published", cancellationRetentionUntil: retention }))).toBe(false);
    expect(parseEventReason("  venue changed  ")).toBe("venue changed");
    expect(parseEventReason(" ")).toBeNull();
    expect(parseEventReason("x".repeat(501))).toBeNull();
  });

  it("detects material edits without treating audience identity as a mutable Event fact", () => {
    const current = event();
    expect(isMaterialEventChange(current as never, {
      title: "Changed",
      description: current.description,
      venue: current.venue,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      campusId: current.campusId,
      visibility: current.visibility,
      audienceMode: current.audienceMode,
      rsvpEnabled: current.rsvpEnabled,
    })).toBe(true);
    expect(isMaterialEventChange(current as never, {
      title: current.title,
      description: current.description,
      venue: current.venue,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      campusId: current.campusId,
      visibility: current.visibility,
      audienceMode: current.audienceMode,
      rsvpEnabled: current.rsvpEnabled,
    })).toBe(false);
  });
});
