import { describe, expect, it } from "vitest";

import type { ResolvedTenantReadFacts } from "@/domain/authorization/publication-read-contract";
import type { ResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import type { Organiser } from "@/domain/organisers/organisers";
import type { EventRecord } from "@/server/repositories/event-repository";
import { ReadEventService } from "./read-events";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const CAMPUS_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TENANT_ID = "44444444-4444-4444-8444-444444444444";
const ORGANISER_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-20T10:00:00.000Z");

const facts: ResolvedTenantReadFacts = {
  tenantId: TENANT_ID,
  tenantStatus: "active",
  publicSurfacePermitted: true,
  onLeaveReadEnabled: true,
  alumniPublicReadEnabled: true,
};

const publicViewer: ResourceReadViewer = { kind: "anonymous", tenantId: TENANT_ID };

function organiser(overrides: Partial<Organiser> = {}): Organiser {
  return {
    id: ORGANISER_ID,
    tenantId: TENANT_ID,
    version: 1,
    name: "Student Affairs",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function record(
  overrides: Partial<EventRecord["event"]> = {},
  attachedOrganiser: Organiser | null = null,
  history: EventRecord["history"] = [],
): EventRecord {
  return {
    event: {
      id: EVENT_ID,
      tenantId: TENANT_ID,
      version: 1,
      title: "Orientation",
      description: "A campus event",
      venue: "Main Hall",
      startsAt: new Date("2026-09-25T10:00:00.000Z"),
      endsAt: null,
      campusId: CAMPUS_ID,
      organiserId: null,
      visibility: "PUBLIC",
      audienceMode: "entire_tenant",
      rsvpEnabled: false,
      lifecycle: "published",
      cancellationRetentionUntil: null,
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    },
    audience: { eventId: EVENT_ID, tenantId: TENANT_ID, mode: "entire_tenant", groups: [] },
    organiser: attachedOrganiser,
    history,
  };
}

function service(value: EventRecord | null) {
  return new ReadEventService({
    events: {
      findEventByIdForTenant: async () => value,
      listEventsForTenant: async () => value === null ? [] : [value],
    },
    memberships: {
      findMembershipAudienceFactsByIdForTenant: async () => null,
    },
  });
}

describe("ReadEventService", () => {
  it("suppresses drafts and treats wrong-Tenant access as not found", async () => {
    const draft = service(record({ lifecycle: "draft" }));
    await expect(draft.getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toEqual({ outcome: "NOT_FOUND" });
    const retentionHidden = service(record({ lifecycle: "cancelled" }));
    await expect(retentionHidden.getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toEqual({ outcome: "NOT_FOUND" });
    const wrongTenant = await service(null).getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW });
    expect(wrongTenant).toEqual({ outcome: "NOT_FOUND" });
    await expect(service(null).listEvents({
      tenantId: TENANT_ID,
      viewer: publicViewer,
      tenantFacts: facts,
      now: NOW,
      surface: "unknown" as never,
    })).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  });

  it("exposes a bounded public projection and excludes derived-past items from collections", async () => {
    const eventService = service(record({ endsAt: new Date("2026-09-20T10:00:00.000Z") }));
    await expect(eventService.getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toMatchObject({ outcome: "FOUND", event: { lifecycle: "published", past: true } });
    await expect(eventService.listEvents({ tenantId: TENANT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toEqual({ outcome: "OK", items: [] });
    await expect(eventService.listEvents({ tenantId: TENANT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW, includePast: true })).resolves.toMatchObject({ outcome: "OK", items: [{ id: EVENT_ID, past: true }] });
  });

  it("projects postponed and cancelled lifecycle state without exposing history reasons", async () => {
    const postponedFrom = new Date("2026-09-25T10:00:00.000Z");
    const postponed = service(record({
      lifecycle: "postponed",
      startsAt: new Date("2026-10-01T10:00:00.000Z"),
      endsAt: null,
      cancellationRetentionUntil: null,
    }, null, [{
        id: "66666666-6666-4666-8666-666666666666",
        tenantId: TENANT_ID,
        eventId: EVENT_ID,
        sequence: 2,
        eventVersion: 2,
        fromLifecycle: "published",
        toLifecycle: "postponed",
        startsAt: new Date("2026-10-01T10:00:00.000Z"),
        endsAt: null,
        postponedFromStartsAt: postponedFrom,
        reason: "private reason",
        cancellationRetentionUntil: null,
        occurredAt: NOW,
      }]));
    await expect(postponed.getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toMatchObject({
      outcome: "FOUND",
      event: { lifecycle: "postponed", postponedFrom, past: false },
    });

    const cancelled = service(record({
      lifecycle: "cancelled",
      cancellationRetentionUntil: new Date("2026-09-20T11:00:00.000Z"),
    }));
    await expect(cancelled.getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toMatchObject({
      outcome: "FOUND",
      event: { lifecycle: "cancelled", postponedFrom: null, past: false },
    });
  });

  it("exposes same-Tenant Organiser attribution and rejects a foreign join", async () => {
    const local = service(record({ organiserId: ORGANISER_ID }, organiser()));
    await expect(local.getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toMatchObject({
      outcome: "FOUND",
      event: { organiserId: ORGANISER_ID, organiserName: "Student Affairs" },
    });

    const foreign = service(record({ organiserId: ORGANISER_ID }, organiser({ tenantId: OTHER_TENANT_ID })));
    await expect(foreign.getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toEqual({ outcome: "NOT_FOUND" });
    await expect(foreign.listEvents({ tenantId: TENANT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toEqual({ outcome: "OK", items: [] });
  });
});
