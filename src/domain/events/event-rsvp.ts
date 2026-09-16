import "server-only";

import {
  assuranceAtLeast,
  parseAssuranceLevel,
  type AssuranceLevel,
} from "@/domain/authorization/assurance-level";
import { isUuid } from "@/domain/identifiers/uuid";
import {
  membershipDefaultParticipationEligible,
  parseMembershipLifecycle,
  type MembershipLifecycle,
} from "@/domain/membership/membership";
import {
  parseTenantLifecycle,
  tenantHasFullFunctionality,
} from "@/domain/tenancy/tenant";

import { isEventAudienceDefinition, evaluateEventAudience } from "./event-audience";
import { isEventPast, type Event } from "./events";
import { isMembershipAudienceFacts } from "@/domain/membership/membership-audience";

export const EVENT_RSVP_STATES = [
  "going",
  "interested",
  "withdrawn",
] as const;

export type EventRsvpState = (typeof EVENT_RSVP_STATES)[number];

export const EVENT_RSVP_OPERATION_FAMILIES = ["participation"] as const;
export type EventRsvpOperationFamily = (typeof EVENT_RSVP_OPERATION_FAMILIES)[number];

export const EVENT_RSVP_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_SCOPE_NOT_FOUND",
  "TENANT_SUSPENDED",
  "MODULE_DISABLED",
  "NOT_FOUND",
  "RESOURCE_NOT_ACTIVE",
  "INVALID_STATE",
  "MEMBERSHIP_STATE_INELIGIBLE",
  "ASSURANCE_REQUIRED",
  "AUDIENCE_INELIGIBLE",
  "PREREQUISITE_MISSING",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "PERSISTENCE_FAILED",
] as const;

export type EventRsvpDenialCode = (typeof EVENT_RSVP_DENIAL_CODES)[number];

export type EventRsvpCommand = Readonly<{
  eventId: string;
  requestedState: EventRsvpState;
  expectedParticipationVersion: number;
  idempotencyKey: string;
}>;

export type EventRsvpSuccess = Readonly<{
  outcome: "CHANGED" | "NOOP";
  state: EventRsvpState;
  participationVersion: number;
  changed: boolean;
}>;

export type EventRsvpResult =
  | Readonly<{ ok: true; value: EventRsvpSuccess }>
  | Readonly<{ ok: false; error: EventRsvpDenialCode }>;

export type EventRsvpAudienceEvaluation =
  | Readonly<{ eligible: true }>
  | Readonly<{ eligible: false; reason: "AUDIENCE_INELIGIBLE" | "PREREQUISITE_MISSING" }>;

export type EventParticipationEvaluationInput = Readonly<{
  tenantStatus: unknown;
  moduleEnabled: unknown;
  event: Pick<
    Event,
    "tenantId" | "lifecycle" | "startsAt" | "endsAt" | "rsvpEnabled" | "audienceMode" | "visibility" | "cancellationRetentionUntil"
  > | null;
  membershipLifecycle: unknown;
  assuranceLevel: unknown;
  audience: unknown;
  membershipFacts: unknown;
  now: Date;
}>;

function isRsvpState(value: unknown): value is EventRsvpState {
  return typeof value === "string" && (EVENT_RSVP_STATES as readonly string[]).includes(value);
}

function isNonEmptyText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

export function parseEventRsvpState(value: unknown): EventRsvpState | null {
  return isRsvpState(value) ? value : null;
}

export function parseEventRsvpExpectedParticipationVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function parseEventRsvpCommand(value: unknown): EventRsvpCommand | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const keys = ["eventId", "requestedState", "expectedParticipationVersion", "idempotencyKey"];
  if (Object.keys(candidate).length !== keys.length || Object.keys(candidate).some((key) => !keys.includes(key))) return null;
  const requestedState = parseEventRsvpState(candidate.requestedState);
  const expectedParticipationVersion = parseEventRsvpExpectedParticipationVersion(candidate.expectedParticipationVersion);
  if (!isUuid(candidate.eventId) || requestedState === null || expectedParticipationVersion === null || !isNonEmptyText(candidate.idempotencyKey, 200)) return null;
  return {
    eventId: candidate.eventId,
    requestedState,
    expectedParticipationVersion,
    idempotencyKey: candidate.idempotencyKey.trim(),
  };
}

export function evaluateEventAudienceForParticipation(
  audience: unknown,
  membershipFacts: unknown,
): EventRsvpAudienceEvaluation {
  if (!isEventAudienceDefinition(audience)) {
    return { eligible: false, reason: "PREREQUISITE_MISSING" };
  }

  if (audience.mode === "entire_tenant") {
    return { eligible: true };
  }

  if (!isMembershipAudienceFacts(membershipFacts)) {
    return { eligible: false, reason: "PREREQUISITE_MISSING" };
  }

  const decision = evaluateEventAudience(audience, membershipFacts);
  return decision.eligible
    ? { eligible: true }
    : { eligible: false, reason: "AUDIENCE_INELIGIBLE" };
}

export function requiredEventRsvpAssurance(
  visibility: unknown,
): AssuranceLevel {
  return visibility === "VERIFIED_MEMBERS" ? "L2" : "L1";
}

export function evaluateEventParticipation(
  input: EventParticipationEvaluationInput,
): { allowed: true } | Readonly<{ allowed: false; code: EventRsvpDenialCode }> {
  const tenantStatus = parseTenantLifecycle(input.tenantStatus);
  if (tenantStatus === null || !tenantHasFullFunctionality(tenantStatus)) {
    return { allowed: false, code: "TENANT_SUSPENDED" };
  }

  // A missing authoritative module row is intentionally indistinguishable
  // from a disabled module. Active Tenant status never enables Event by itself.
  if (input.moduleEnabled !== true) {
    return { allowed: false, code: "MODULE_DISABLED" };
  }

  const event = input.event;
  if (event === null || event.tenantId.length === 0) {
    return { allowed: false, code: "NOT_FOUND" };
  }
  if (event.lifecycle === "cancelled") {
    return { allowed: false, code: "INVALID_STATE" };
  }
  if (
    event.lifecycle !== "published" ||
    !event.rsvpEnabled ||
    !(input.now instanceof Date) ||
    Number.isNaN(input.now.getTime()) ||
    input.now.getTime() >= event.startsAt.getTime() ||
    isEventPast(event, input.now)
  ) {
    return { allowed: false, code: "RESOURCE_NOT_ACTIVE" };
  }

  const membershipLifecycle = parseMembershipLifecycle(input.membershipLifecycle);
  if (membershipLifecycle === null || !membershipDefaultParticipationEligible(membershipLifecycle)) {
    return { allowed: false, code: "MEMBERSHIP_STATE_INELIGIBLE" };
  }

  const assuranceLevel = parseAssuranceLevel(input.assuranceLevel);
  if (!assuranceAtLeast(assuranceLevel, requiredEventRsvpAssurance(event.visibility))) {
    return { allowed: false, code: "ASSURANCE_REQUIRED" };
  }

  const audience = evaluateEventAudienceForParticipation(input.audience, input.membershipFacts);
  if (!audience.eligible) {
    return { allowed: false, code: audience.reason };
  }

  return { allowed: true };
}

export function resolveEventRsvpTransition(
  current: Readonly<{ state: EventRsvpState; version: number }> | null,
  command: Pick<EventRsvpCommand, "requestedState" | "expectedParticipationVersion">,
): Readonly<{
  kind: "CREATE" | "UPDATE" | "NOOP" | "INVALID_STATE" | "VERSION_CONFLICT";
  nextVersion?: number;
}> {
  if (current === null) {
    if (command.requestedState === "withdrawn") return { kind: "INVALID_STATE" };
    if (command.expectedParticipationVersion !== 0) return { kind: "VERSION_CONFLICT" };
    return { kind: "CREATE", nextVersion: 1 };
  }

  if (current.state === command.requestedState) {
    return { kind: "NOOP", nextVersion: current.version };
  }
  if (command.expectedParticipationVersion !== current.version) {
    return { kind: "VERSION_CONFLICT" };
  }
  return { kind: "UPDATE", nextVersion: current.version + 1 };
}

export function parseEventRsvpStateForPersistence(value: unknown): EventRsvpState | null {
  return isRsvpState(value) ? value : null;
}

export function isEventRsvpMembershipLifecycle(value: unknown): value is MembershipLifecycle {
  return parseMembershipLifecycle(value) !== null;
}
