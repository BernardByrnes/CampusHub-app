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
    cancellationRetentionUntil: null,
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
  history: [],
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
  const postponeEvent = vi.fn(async () => ({ ok: true as const, record: eventRecord, changed: true }));
  const republishEvent = vi.fn(async () => ({ ok: true as const, record: eventRecord, changed: true }));
  const cancelEvent = vi.fn(async () => ({ ok: true as const, record: eventRecord, changed: true }));
  return {
    service: new EventManagementService({
      capabilityAuthorizer: { authorize },
      gateway: { createEvent, updateEvent, publishEvent, postponeEvent, republishEvent, cancelEvent },
    }),
    authorize,
    createEvent,
    updateEvent,
    publishEvent,
    postponeEvent,
    republishEvent,
    cancelEvent,
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

  it("parses and authorizes the bounded lifecycle transition commands", async () => {
    const fixture = service();
    await expect(fixture.service.postponeEvent({
      trustedContext: context,
      requestedTenantId: TENANT_ID,
      eventId: EVENT_ID,
      postpone: {
        expectedVersion: 2,
        startsAt: "2026-10-01T10:00:00.000Z",
        endsAt: null,
        reason: "  Venue unavailable  ",
      },
    })).resolves.toMatchObject({ outcome: "POSTPONED" });
    expect(fixture.postponeEvent).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      EVENT_ID,
      expect.objectContaining({ expectedVersion: 2, reason: "Venue unavailable" }),
    );

    await expect(fixture.service.republishEvent({
      trustedContext: context,
      requestedTenantId: TENANT_ID,
      eventId: EVENT_ID,
      republish: { expectedVersion: 3 },
    })).resolves.toMatchObject({ outcome: "REPUBLISHED" });
    await expect(fixture.service.cancelEvent({
      trustedContext: context,
      requestedTenantId: TENANT_ID,
      eventId: EVENT_ID,
      cancel: { expectedVersion: 4, reason: "  Cancelled by organiser  " },
    })).resolves.toMatchObject({ outcome: "CANCELLED" });
    expect(fixture.republishEvent).toHaveBeenCalledTimes(1);
    expect(fixture.cancelEvent).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      EVENT_ID,
      expect.objectContaining({ expectedVersion: 4, reason: "Cancelled by organiser" }),
    );
  });

  it("rejects malformed lifecycle transition payloads before authorization", async () => {
    const fixture = service();
    await expect(fixture.service.postponeEvent({
      trustedContext: context,
      requestedTenantId: TENANT_ID,
      eventId: EVENT_ID,
      postpone: {
        expectedVersion: 1,
        startsAt: "2026-10-01T10:00:00.000Z",
        endsAt: null,
        reason: "",
        forged: true,
      },
    })).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    await expect(fixture.service.cancelEvent({
      trustedContext: context,
      requestedTenantId: TENANT_ID,
      eventId: EVENT_ID,
      cancel: { expectedVersion: 1, reason: "x", extra: "nope" },
    })).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
    expect(fixture.authorize).not.toHaveBeenCalled();
  });
});
