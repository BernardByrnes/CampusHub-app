import { describe, expect, it } from "vitest";

import {
  evaluateEventAudienceForParticipation,
  evaluateEventParticipation,
  parseEventRsvpCommand,
  resolveEventRsvpTransition,
} from "./event-rsvp";
import type { Event } from "./events";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const CAMPUS_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CAMPUS_ID = "44444444-4444-4444-8444-444444444444";
const MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-16T10:00:00.000Z");
const STARTS_AT = new Date("2026-09-16T12:00:00.000Z");

function event(overrides: Partial<Event> = {}): Event {
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
    organiserId: null,
    visibility: "MEMBERS",
    audienceMode: "entire_tenant",
    rsvpEnabled: true,
    lifecycle: "published",
    cancellationRetentionUntil: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const entireTenantAudience = {
  eventId: EVENT_ID,
  tenantId: TENANT_ID,
  mode: "entire_tenant" as const,
  groups: [],
};

const campusAudience = {
  eventId: EVENT_ID,
  tenantId: TENANT_ID,
  mode: "targeted" as const,
  groups: [{
    dimension: "campus" as const,
    provenancePolicy: "authoritative_only" as const,
    campusIds: [CAMPUS_ID],
  }],
};

const campusFacts = {
  membershipId: MEMBERSHIP_ID,
  tenantId: TENANT_ID,
  campus: { value: CAMPUS_ID, provenance: "institution_verified" as const },
  residence: { state: "non_resident" as const, residenceId: null, provenance: "institution_verified" as const },
};

function participationInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantStatus: "active",
    moduleEnabled: true,
    moduleVersion: 1,
    event: event(),
    membershipLifecycle: "verified",
    membershipBindingValid: true,
    assuranceLevel: "L1",
    audience: entireTenantAudience,
    membershipFacts: null,
    now: NOW,
    ...overrides,
  };
}

describe("Event RSVP domain contract", () => {
  it("accepts only the narrow, versioned, idempotent command shape", () => {
    expect(parseEventRsvpCommand({
      eventId: EVENT_ID,
      requestedState: "going",
      expectedParticipationVersion: 0,
      idempotencyKey: "  rsvp-1  ",
    })).toEqual({
      eventId: EVENT_ID,
      requestedState: "going",
      expectedParticipationVersion: 0,
      idempotencyKey: "rsvp-1",
    });
    expect(parseEventRsvpCommand({
      eventId: EVENT_ID,
      requestedState: "withdrawn",
      expectedParticipationVersion: 0,
      idempotencyKey: "withdrawal",
    })).not.toBeNull();
    expect(parseEventRsvpCommand({
      eventId: EVENT_ID,
      requestedState: "going",
      expectedParticipationVersion: 0,
      idempotencyKey: "rsvp-1",
      tenantId: TENANT_ID,
    })).toBeNull();
    expect(parseEventRsvpCommand({
      eventId: EVENT_ID,
      requestedState: "going",
      expectedParticipationVersion: -1,
      idempotencyKey: "rsvp-1",
    })).toBeNull();
  });

  it("evaluates GSC-14 prerequisites in the fail-closed order", () => {
    expect(evaluateEventParticipation(participationInput({
      tenantStatus: "suspended",
      moduleEnabled: false,
    }))).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
    expect(evaluateEventParticipation(participationInput({ moduleEnabled: false }))).toEqual({
      allowed: false,
      code: "MODULE_DISABLED",
    });
    expect(evaluateEventParticipation(participationInput({ event: null }))).toEqual({
      allowed: false,
      code: "NOT_FOUND",
    });
    expect(evaluateEventParticipation(participationInput({ event: event({ lifecycle: "cancelled" }) }))).toEqual({
      allowed: false,
      code: "INVALID_STATE",
    });
    expect(evaluateEventParticipation(participationInput({ event: event({ lifecycle: "draft" }) }))).toEqual({
      allowed: false,
      code: "RESOURCE_NOT_ACTIVE",
    });
  });

  it("closes RSVP at the authoritative start instant and respects the module boundary", () => {
    expect(evaluateEventParticipation(participationInput({ moduleVersion: 0 }))).toEqual({
      allowed: false,
      code: "MODULE_DISABLED",
    });
    expect(evaluateEventParticipation(participationInput({ moduleVersion: "1" }))).toEqual({
      allowed: false,
      code: "MODULE_DISABLED",
    });
    expect(evaluateEventParticipation(participationInput({ now: STARTS_AT }))).toEqual({
      allowed: false,
      code: "RESOURCE_NOT_ACTIVE",
    });
    expect(evaluateEventParticipation(participationInput({
      event: event({ endsAt: new Date("2026-09-16T14:00:00.000Z") }),
      now: new Date("2026-09-16T12:00:00.000Z"),
    }))).toEqual({ allowed: false, code: "RESOURCE_NOT_ACTIVE" });
  });

  it("distinguishes an audience mismatch from missing audience facts", () => {
    expect(evaluateEventAudienceForParticipation(campusAudience, {
      ...campusFacts,
      campus: { value: OTHER_CAMPUS_ID, provenance: "institution_verified" },
    })).toEqual({ eligible: false, reason: "AUDIENCE_INELIGIBLE" });
    expect(evaluateEventAudienceForParticipation(campusAudience, null)).toEqual({
      eligible: false,
      reason: "PREREQUISITE_MISSING",
    });
    expect(evaluateEventAudienceForParticipation(entireTenantAudience, null)).toEqual({ eligible: true });
  });

  it("returns missing prerequisites for unknown or insufficient audience facts", () => {
    const targeted = {
      eventId: EVENT_ID,
      tenantId: TENANT_ID,
      mode: "targeted" as const,
      groups: [
        { dimension: "academic_division" as const, provenancePolicy: "authoritative_only" as const, academicDivisionIds: [CAMPUS_ID] },
      ],
    };
    expect(evaluateEventAudienceForParticipation(targeted, {
      ...campusFacts,
      academicDivision: { value: null, provenance: "optional" },
    })).toEqual({ eligible: false, reason: "PREREQUISITE_MISSING" });
    expect(evaluateEventAudienceForParticipation({
      ...targeted,
      groups: [{ dimension: "residence" as const, provenancePolicy: "authoritative_only" as const, residenceTargets: [{ kind: "any_resident" as const }] }],
    }, {
      ...campusFacts,
      residence: { state: "unknown" as const, residenceId: null, provenance: "optional" as const },
    })).toEqual({ eligible: false, reason: "PREREQUISITE_MISSING" });
    expect(evaluateEventAudienceForParticipation(campusAudience, {
      ...campusFacts,
      campus: { value: CAMPUS_ID, provenance: "self_declared" },
    })).toEqual({ eligible: false, reason: "PREREQUISITE_MISSING" });
  });

  it("lets a definitive mismatch win over a later missing dimension", () => {
    const multiDimension = {
      eventId: EVENT_ID,
      tenantId: TENANT_ID,
      mode: "targeted" as const,
      groups: [
        { dimension: "campus" as const, provenancePolicy: "authoritative_only" as const, campusIds: [OTHER_CAMPUS_ID] },
        { dimension: "academic_division" as const, provenancePolicy: "authoritative_only" as const, academicDivisionIds: [CAMPUS_ID] },
      ],
    };
    expect(evaluateEventAudienceForParticipation(multiDimension, campusFacts)).toEqual({
      eligible: false,
      reason: "AUDIENCE_INELIGIBLE",
    });
  });

  it("preserves GSC-14 semantic precedence when identity binding is wrong", () => {
    expect(evaluateEventParticipation(participationInput({ tenantStatus: "suspended", membershipBindingValid: false }))).toEqual({ allowed: false, code: "TENANT_SUSPENDED" });
    expect(evaluateEventParticipation(participationInput({ moduleEnabled: false, membershipBindingValid: false }))).toEqual({ allowed: false, code: "MODULE_DISABLED" });
    expect(evaluateEventParticipation(participationInput({ event: null, membershipBindingValid: false }))).toEqual({ allowed: false, code: "NOT_FOUND" });
    expect(evaluateEventParticipation(participationInput({ membershipBindingValid: false }))).toEqual({ allowed: false, code: "TENANT_SCOPE_NOT_FOUND" });
    expect(evaluateEventParticipation(participationInput({ membershipLifecycle: "stale", assuranceLevel: "L0", membershipBindingValid: true }))).toEqual({ allowed: false, code: "MEMBERSHIP_STATE_INELIGIBLE" });
    expect(evaluateEventParticipation(participationInput({ assuranceLevel: "L0", audience: campusAudience, membershipFacts: { ...campusFacts, campus: { value: OTHER_CAMPUS_ID, provenance: "institution_verified" } }, membershipBindingValid: true }))).toEqual({ allowed: false, code: "ASSURANCE_REQUIRED" });
  });

  it("requires verified or on-leave membership before assurance and audience checks", () => {
    expect(evaluateEventParticipation(participationInput({
      membershipLifecycle: "pending_review",
      assuranceLevel: "L0",
      audience: null,
    }))).toEqual({ allowed: false, code: "MEMBERSHIP_STATE_INELIGIBLE" });
    expect(evaluateEventParticipation(participationInput({
      assuranceLevel: "L0",
    }))).toEqual({ allowed: false, code: "ASSURANCE_REQUIRED" });
  });

  it("implements create, update, withdrawal, conflict, and semantic no-op rules", () => {
    expect(resolveEventRsvpTransition(null, {
      requestedState: "going",
      expectedParticipationVersion: 0,
    })).toEqual({ kind: "CREATE", nextVersion: 1 });
    expect(resolveEventRsvpTransition(null, {
      requestedState: "withdrawn",
      expectedParticipationVersion: 0,
    })).toEqual({ kind: "INVALID_STATE" });
    expect(resolveEventRsvpTransition(null, {
      requestedState: "interested",
      expectedParticipationVersion: 2,
    })).toEqual({ kind: "VERSION_CONFLICT" });
    expect(resolveEventRsvpTransition({ state: "going", version: 3 }, {
      requestedState: "going",
      expectedParticipationVersion: 0,
    })).toEqual({ kind: "NOOP", nextVersion: 3 });
    expect(resolveEventRsvpTransition({ state: "going", version: 3 }, {
      requestedState: "interested",
      expectedParticipationVersion: 2,
    })).toEqual({ kind: "VERSION_CONFLICT" });
    expect(resolveEventRsvpTransition({ state: "going", version: 3 }, {
      requestedState: "withdrawn",
      expectedParticipationVersion: 3,
    })).toEqual({ kind: "UPDATE", nextVersion: 4 });
  });
});
