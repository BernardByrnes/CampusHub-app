import "server-only";

import { isCapabilityAuthorizationDecision, type CapabilityAuthorizationRequest, type CapabilityAuthorizer } from "@/domain/authorization/capability-authorization";
import { CAPABILITIES } from "@/domain/authorization/capability";
import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";
import { isUuid } from "@/domain/identifiers/uuid";
import {
  parseEventDescription,
  parseEventExpectedVersion,
  parseEventReason,
  parseEventTimestamp,
  parseEventTitle,
  parseEventVenue,
  type CreateEventInput,
  type Event,
  type CancelEventInput,
  type PostponeEventInput,
  type RepublishEventInput,
  type PublishEventInput,
  type UpdateEventInput,
} from "@/domain/events/events";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { EventRecord, EventMutationResult } from "@/server/repositories/event-repository";

export const EVENT_MANAGEMENT_DENIAL_CODES = [
  "INVALID_INPUT",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_STATE",
  "NOT_READY",
  "PERSISTENCE_FAILED",
] as const;
export type EventManagementDenialCode = (typeof EVENT_MANAGEMENT_DENIAL_CODES)[number];
export type EventManagementDenied = Readonly<{ outcome: "DENIED"; code: EventManagementDenialCode }>;
export type EventManagementResult =
  | Readonly<{ outcome: "CREATED" | "UPDATED" | "PUBLISHED" | "POSTPONED" | "REPUBLISHED" | "CANCELLED"; event: Event; audience: EventRecord["audience"] }>
  | Readonly<{ outcome: "NOOP"; event: Event; audience: EventRecord["audience"] }>
  | EventManagementDenied;

export type CreateEventCommand = Readonly<{ trustedContext: TrustedRequestContext; requestedTenantId: string; event: unknown }>;
export type EditEventCommand = Readonly<{ trustedContext: TrustedRequestContext; requestedTenantId: string; eventId: string; edit: unknown }>;
export type PublishEventCommand = Readonly<{ trustedContext: TrustedRequestContext; requestedTenantId: string; eventId: string; publish: unknown }>;
export type PostponeEventCommand = Readonly<{ trustedContext: TrustedRequestContext; requestedTenantId: string; eventId: string; postpone: unknown }>;
export type RepublishEventCommand = Readonly<{ trustedContext: TrustedRequestContext; requestedTenantId: string; eventId: string; republish: unknown }>;
export type CancelEventCommand = Readonly<{ trustedContext: TrustedRequestContext; requestedTenantId: string; eventId: string; cancel: unknown }>;

export type AuthorizedEventManagementGateway = Readonly<{
  createEvent(request: CapabilityAuthorizationRequest, tenantId: string, input: CreateEventInput): Promise<EventMutationResult>;
  updateEvent(request: CapabilityAuthorizationRequest, tenantId: string, eventId: string, input: UpdateEventInput): Promise<EventMutationResult>;
  publishEvent(request: CapabilityAuthorizationRequest, tenantId: string, eventId: string, input: PublishEventInput): Promise<EventMutationResult>;
  postponeEvent(request: CapabilityAuthorizationRequest, tenantId: string, eventId: string, input: PostponeEventInput): Promise<EventMutationResult>;
  republishEvent(request: CapabilityAuthorizationRequest, tenantId: string, eventId: string, input: RepublishEventInput): Promise<EventMutationResult>;
  cancelEvent(request: CapabilityAuthorizationRequest, tenantId: string, eventId: string, input: CancelEventInput): Promise<EventMutationResult>;
}>;

export type EventManagementServiceDependencies = Readonly<{
  capabilityAuthorizer: CapabilityAuthorizer;
  gateway: AuthorizedEventManagementGateway;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTrustedRequestContext(value: unknown): value is TrustedRequestContext {
  return isRecord(value) &&
    isNonEmptyString(value.identitySubjectId) &&
    isUuid(value.tenantId) &&
    isUuid(value.membershipId) &&
    parseTenantLifecycle(value.tenantStatus) !== null &&
    parseAssuranceLevel(value.assuranceLevel) !== null &&
    parseMembershipLifecycle(value.membershipStatus) !== null;
}

function scoped(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!isRecord(value) || !isTrustedRequestContext(value.trustedContext) || !isUuid(value.requestedTenantId) || value.trustedContext.tenantId !== value.requestedTenantId) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function parseAudience(value: unknown): unknown | null {
  return isRecord(value) ? value : null;
}

function parseOptionalOrganiserId(value: unknown): Readonly<{ valid: boolean; value: string | null }> {
  return value === undefined || value === null
    ? { valid: true, value: null }
    : isUuid(value)
      ? { valid: true, value }
      : { valid: false, value: null };
}

function parseCreate(value: unknown): CreateEventInput | null {
  if (!isRecord(value) ||
    !Object.keys(value).every((key) => ["title", "description", "venue", "startsAt", "endsAt", "campusId", "organiserId", "visibility", "audienceMode", "rsvpEnabled", "audience"].includes(key)) ||
    Object.keys(value).length < 10 || Object.keys(value).length > 11) return null;
  const title = parseEventTitle(value.title);
  const description = parseEventDescription(value.description);
  const venue = parseEventVenue(value.venue);
  const startsAt = parseEventTimestamp(value.startsAt);
  const endsAt = value.endsAt === null ? null : parseEventTimestamp(value.endsAt);
  if (title === null || description === null || venue === null || startsAt === null || (value.endsAt !== null && endsAt === null) || !isUuid(value.campusId) || (value.visibility !== "PUBLIC" && value.visibility !== "MEMBERS" && value.visibility !== "VERIFIED_MEMBERS") || (value.audienceMode !== "entire_tenant" && value.audienceMode !== "targeted") || typeof value.rsvpEnabled !== "boolean") return null;
  if (endsAt !== null && endsAt.getTime() <= startsAt.getTime()) return null;
  const audience = parseAudience(value.audience);
  const organiserId = parseOptionalOrganiserId(value.organiserId);
  return audience === null || !organiserId.valid ? null : { title, description, venue, startsAt, endsAt, campusId: value.campusId, organiserId: organiserId.value, visibility: value.visibility, audienceMode: value.audienceMode, rsvpEnabled: value.rsvpEnabled, audience };
}

function parseUpdate(value: unknown): UpdateEventInput | null {
  if (!isRecord(value)) return null;
  const fields = { ...value };
  delete fields.expectedVersion;
  const parsed = parseCreate(fields);
  if (parsed === null) return null;
  const expectedVersion = parseEventExpectedVersion(value.expectedVersion);
  return expectedVersion === null ? null : { ...parsed, expectedVersion };
}

function parsePublish(value: unknown): PublishEventInput | null {
  if (!isRecord(value) || Object.keys(value).length !== 1) return null;
  const expectedVersion = parseEventExpectedVersion(value.expectedVersion);
  return expectedVersion === null ? null : { expectedVersion };
}

function parsePostpone(value: unknown): PostponeEventInput | null {
  if (!isRecord(value) || Object.keys(value).length !== 4 || !Object.keys(value).every((key) => ["expectedVersion", "startsAt", "endsAt", "reason"].includes(key)) || !Object.prototype.hasOwnProperty.call(value, "endsAt")) return null;
  const expectedVersion = parseEventExpectedVersion(value.expectedVersion);
  const startsAt = parseEventTimestamp(value.startsAt);
  const endsAt = value.endsAt === null ? null : parseEventTimestamp(value.endsAt);
  const reason = parseEventReason(value.reason);
  if (expectedVersion === null || startsAt === null || (value.endsAt !== null && endsAt === null) || reason === null || (endsAt !== null && endsAt.getTime() <= startsAt.getTime())) return null;
  return { expectedVersion, startsAt, endsAt, reason };
}

function parseRepublish(value: unknown): RepublishEventInput | null {
  if (!isRecord(value) || Object.keys(value).length !== 1) return null;
  const expectedVersion = parseEventExpectedVersion(value.expectedVersion);
  return expectedVersion === null ? null : { expectedVersion };
}

function parseCancel(value: unknown): CancelEventInput | null {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.keys(value).every((key) => ["expectedVersion", "reason"].includes(key))) return null;
  const expectedVersion = parseEventExpectedVersion(value.expectedVersion);
  const reason = parseEventReason(value.reason);
  return expectedVersion === null || reason === null ? null : { expectedVersion, reason };
}

function request(context: TrustedRequestContext, tenantId: string): CapabilityAuthorizationRequest {
  return {
    actor: { identitySubjectId: context.identitySubjectId, tenantId: context.tenantId, membershipId: context.membershipId },
    context: { tenantStatus: context.tenantStatus, membershipStatus: context.membershipStatus, assuranceLevel: context.assuranceLevel },
    capability: CAPABILITIES.EVENT_MANAGE,
    scope: { tenantId, module: "event", resource: "event" },
  };
}

function denied(code: EventManagementDenialCode): EventManagementDenied {
  return { outcome: "DENIED", code };
}

function map(result: EventMutationResult, outcome: "CREATED" | "UPDATED" | "PUBLISHED" | "POSTPONED" | "REPUBLISHED" | "CANCELLED"): EventManagementResult {
  if (!result.ok) return denied(result.error);
  return result.changed ? { outcome, event: result.record.event, audience: result.record.audience } : { outcome: "NOOP", event: result.record.event, audience: result.record.audience };
}

export class EventManagementService {
  public constructor(private readonly dependencies: EventManagementServiceDependencies) {}

  private async authorized(context: TrustedRequestContext, tenantId: string): Promise<boolean> {
    try {
      const decision = await this.dependencies.capabilityAuthorizer.authorize(request(context, tenantId));
      return isCapabilityAuthorizationDecision(decision) && decision.allowed;
    } catch {
      return false;
    }
  }

  public async createEvent(command: CreateEventCommand): Promise<EventManagementResult> {
    if (!scoped(command, ["trustedContext", "requestedTenantId", "event"])) return denied("INVALID_INPUT");
    const input = parseCreate(command.event);
    if (input === null) return denied("INVALID_INPUT");
    if (!(await this.authorized(command.trustedContext, command.requestedTenantId))) return denied("PERMISSION_DENIED");
    try {
      return map(await this.dependencies.gateway.createEvent(request(command.trustedContext, command.requestedTenantId), command.requestedTenantId, input), "CREATED");
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async editEvent(command: EditEventCommand): Promise<EventManagementResult> {
    if (!scoped(command, ["trustedContext", "requestedTenantId", "eventId", "edit"]) || !isUuid(command.eventId)) return denied("INVALID_INPUT");
    const input = parseUpdate(command.edit);
    if (input === null) return denied("INVALID_INPUT");
    if (!(await this.authorized(command.trustedContext, command.requestedTenantId))) return denied("PERMISSION_DENIED");
    try {
      return map(await this.dependencies.gateway.updateEvent(request(command.trustedContext, command.requestedTenantId), command.requestedTenantId, command.eventId, input), "UPDATED");
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async publishEvent(command: PublishEventCommand): Promise<EventManagementResult> {
    if (!scoped(command, ["trustedContext", "requestedTenantId", "eventId", "publish"]) || !isUuid(command.eventId)) return denied("INVALID_INPUT");
    const input = parsePublish(command.publish);
    if (input === null) return denied("INVALID_INPUT");
    if (!(await this.authorized(command.trustedContext, command.requestedTenantId))) return denied("PERMISSION_DENIED");
    try {
      return map(await this.dependencies.gateway.publishEvent(request(command.trustedContext, command.requestedTenantId), command.requestedTenantId, command.eventId, input), "PUBLISHED");
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async postponeEvent(command: PostponeEventCommand): Promise<EventManagementResult> {
    if (!scoped(command, ["trustedContext", "requestedTenantId", "eventId", "postpone"]) || !isUuid(command.eventId)) return denied("INVALID_INPUT");
    const input = parsePostpone(command.postpone);
    if (input === null) return denied("INVALID_INPUT");
    if (!(await this.authorized(command.trustedContext, command.requestedTenantId))) return denied("PERMISSION_DENIED");
    try {
      return map(await this.dependencies.gateway.postponeEvent(request(command.trustedContext, command.requestedTenantId), command.requestedTenantId, command.eventId, input), "POSTPONED");
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async republishEvent(command: RepublishEventCommand): Promise<EventManagementResult> {
    if (!scoped(command, ["trustedContext", "requestedTenantId", "eventId", "republish"]) || !isUuid(command.eventId)) return denied("INVALID_INPUT");
    const input = parseRepublish(command.republish);
    if (input === null) return denied("INVALID_INPUT");
    if (!(await this.authorized(command.trustedContext, command.requestedTenantId))) return denied("PERMISSION_DENIED");
    try {
      return map(await this.dependencies.gateway.republishEvent(request(command.trustedContext, command.requestedTenantId), command.requestedTenantId, command.eventId, input), "REPUBLISHED");
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async cancelEvent(command: CancelEventCommand): Promise<EventManagementResult> {
    if (!scoped(command, ["trustedContext", "requestedTenantId", "eventId", "cancel"]) || !isUuid(command.eventId)) return denied("INVALID_INPUT");
    const input = parseCancel(command.cancel);
    if (input === null) return denied("INVALID_INPUT");
    if (!(await this.authorized(command.trustedContext, command.requestedTenantId))) return denied("PERMISSION_DENIED");
    try {
      return map(await this.dependencies.gateway.cancelEvent(request(command.trustedContext, command.requestedTenantId), command.requestedTenantId, command.eventId, input), "CANCELLED");
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }
}
