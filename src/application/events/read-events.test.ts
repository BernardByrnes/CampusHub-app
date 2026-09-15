import { describe, expect, it } from "vitest";

import type { ResolvedTenantReadFacts } from "@/domain/authorization/publication-read-contract";
import type { ResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import type { EventRecord } from "@/server/repositories/event-repository";
import { ReadEventService } from "./read-events";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const CAMPUS_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-20T10:00:00.000Z");

const facts: ResolvedTenantReadFacts = {
  tenantId: TENANT_ID,
  tenantStatus: "active",
  publicSurfacePermitted: true,
  onLeaveReadEnabled: true,
  alumniPublicReadEnabled: true,
};

const publicViewer: ResourceReadViewer = { kind: "anonymous", tenantId: TENANT_ID };

function record(overrides: Partial<EventRecord["event"]> = {}): EventRecord {
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
      createdAt: NOW,
      updatedAt: NOW,
      ...overrides,
    },
    audience: { eventId: EVENT_ID, tenantId: TENANT_ID, mode: "entire_tenant", groups: [] },
    organiser: null,
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
    const wrongTenant = await service(null).getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW });
    expect(wrongTenant).toEqual({ outcome: "NOT_FOUND" });
  });

  it("exposes a bounded public projection and excludes derived-past items from collections", async () => {
    const eventService = service(record({ endsAt: new Date("2026-09-20T10:00:00.000Z") }));
    await expect(eventService.getEventForRead({ tenantId: TENANT_ID, eventId: EVENT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toMatchObject({ outcome: "FOUND", event: { lifecycle: "published", past: true } });
    await expect(eventService.listEvents({ tenantId: TENANT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW })).resolves.toEqual({ outcome: "OK", items: [] });
    await expect(eventService.listEvents({ tenantId: TENANT_ID, viewer: publicViewer, tenantFacts: facts, now: NOW, includePast: true })).resolves.toMatchObject({ outcome: "OK", items: [{ id: EVENT_ID, past: true }] });
  });
});
