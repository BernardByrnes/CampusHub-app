import { describe, expect, it, vi } from "vitest";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { EventRecord } from "@/server/repositories/event-repository";
import { EventManagementService } from "./manage-events";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP_ID = "22222222-2222-4222-8222-222222222222";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const CAMPUS_ID = "44444444-4444-4444-8444-444444444444";
const ORGANISER_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-20T10:00:00.000Z");

const context: TrustedRequestContext = {
  identitySubjectId: "subject-evt-001",
  tenantId: TENANT_ID,
  tenantStatus: "active",
  membershipId: MEMBERSHIP_ID,
  assuranceLevel: "L2",
  membershipStatus: "verified",
};

const eventRecord: EventRecord = {
  event: {
    id: EVENT_ID,
    tenantId: TENANT_ID,
    version: 1,
    title: "Orientation",
    description: "A campus event",
    venue: "Main Hall",
    startsAt: NOW,
    endsAt: null,
    campusId: CAMPUS_ID,
    organiserId: null,
    visibility: "MEMBERS",
    audienceMode: "entire_tenant",
    rsvpEnabled: false,
    lifecycle: "draft",
    createdAt: NOW,
    updatedAt: NOW,
  },
  audience: {
    eventId: EVENT_ID,
    tenantId: TENANT_ID,
    mode: "entire_tenant",
    groups: [],
  },
  organiser: null,
};

function createInput() {
  return {
    title: "Orientation",
    description: "A campus event",
    venue: "Main Hall",
    startsAt: NOW.toISOString(),
    endsAt: null,
    campusId: CAMPUS_ID,
    visibility: "MEMBERS",
    audienceMode: "entire_tenant",
    rsvpEnabled: false,
    audience: { mode: "entire_tenant", groups: [] },
  };
}

function command(event: unknown = createInput()) {
  return { trustedContext: context, requestedTenantId: TENANT_ID, event };
}

function service() {
  const authorize = vi.fn(async (_request: CapabilityAuthorizationRequest) => {
    void _request;
    return { allowed: true as const };
  });
  const createEvent = vi.fn(async () => ({ ok: true as const, record: eventRecord, changed: true }));
  const updateEvent = vi.fn(async () => ({ ok: true as const, record: eventRecord, changed: true }));
  const publishEvent = vi.fn(async () => ({ ok: true as const, record: { ...eventRecord, event: { ...eventRecord.event, lifecycle: "published" as const, version: 2 } }, changed: true }));
  return {
    service: new EventManagementService({
      capabilityAuthorizer: { authorize },
      gateway: { createEvent, updateEvent, publishEvent },
    }),
    authorize,
    createEvent,
    updateEvent,
    publishEvent,
  };
}

describe("EventManagementService", () => {
  it("authorizes and forwards a canonical draft create", async () => {
    const fixture = service();
    await expect(fixture.service.createEvent(command())).resolves.toMatchObject({ outcome: "CREATED" });
    expect(fixture.authorize).toHaveBeenCalledWith(expect.objectContaining({
      capability: CAPABILITIES.EVENT_MANAGE,
      scope: { tenantId: TENANT_ID, module: "event", resource: "event" },
    }));
    expect(fixture.createEvent).toHaveBeenCalledTimes(1);
  });

  it("accepts expectedVersion for draft edits instead of parsing it as an unknown field", async () => {
    const fixture = service();
    await expect(fixture.service.editEvent({
      trustedContext: context,
      requestedTenantId: TENANT_ID,
      eventId: EVENT_ID,
      edit: { ...createInput(), expectedVersion: 1 },
    })).resolves.toMatchObject({ outcome: "UPDATED" });
    expect(fixture.updateEvent).toHaveBeenCalledWith(expect.anything(), TENANT_ID, EVENT_ID, expect.objectContaining({ expectedVersion: 1 }));
  });

  it("accepts only the optional same-Tenant Organiser identity as an Event relation", async () => {
    const fixture = service();
    await expect(fixture.service.createEvent(command({ ...createInput(), organiserId: ORGANISER_ID }))).resolves.toMatchObject({ outcome: "CREATED" });
    expect(fixture.createEvent).toHaveBeenCalledWith(expect.anything(), TENANT_ID, expect.objectContaining({ organiserId: ORGANISER_ID }));
    await expect(fixture.service.createEvent(command({ ...createInput(), organiserId: "not-a-uuid" }))).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  });

  it("rejects unknown or forged command fields before authorization", async () => {
    const fixture = service();
    await expect(fixture.service.createEvent(command({ ...createInput(), tenantId: TENANT_ID }))).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(fixture.authorize).not.toHaveBeenCalled();
    await expect(fixture.service.publishEvent({
      trustedContext: context,
      requestedTenantId: TENANT_ID,
      eventId: EVENT_ID,
      publish: { expectedVersion: 1, lifecycle: "published" },
    })).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  });
});
