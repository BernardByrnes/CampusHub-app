import "server-only";

import { isCapabilityAuthorizationDecision, type CapabilityAuthorizer } from "@/domain/authorization/capability-authorization";
import { CAPABILITIES } from "@/domain/authorization/capability";
import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";
import {
  parseEventRsvpCommand,
  type EventRsvpResult,
} from "@/domain/events/event-rsvp";
import type {
  DrizzleEventRsvpRepository,
  EventRsvpAggregateResult,
  EventRsvpReadResult,
} from "@/server/repositories/event-rsvp-repository";

export const EVENT_RSVP_SERVICE_DENIAL_CODES = [
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
  "PERMISSION_DENIED",
  "PERSISTENCE_FAILED",
] as const;

export type EventRsvpServiceDenialCode = (typeof EVENT_RSVP_SERVICE_DENIAL_CODES)[number];

export type EventRsvpServiceResult = EventRsvpResult;

export type EventRsvpServiceDependencies = Readonly<{
  rsvps: Pick<DrizzleEventRsvpRepository, "changeParticipation" | "findOwnParticipation" | "getAggregateCounts">;
  capabilityAuthorizer?: CapabilityAuthorizer;
}>;

export type EventRsvpChangeCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  participation: unknown;
}>;

export type EventRsvpReadCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  eventId: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTrustedRequestContext(value: unknown): value is TrustedRequestContext {
  return isRecord(value) &&
    typeof value.identitySubjectId === "string" && value.identitySubjectId.trim().length > 0 &&
    isUuid(value.tenantId) &&
    isUuid(value.membershipId) &&
    parseTenantLifecycle(value.tenantStatus) !== null &&
    parseMembershipLifecycle(value.membershipStatus) !== null &&
    parseAssuranceLevel(value.assuranceLevel) !== null;
}

function denied(error: EventRsvpServiceDenialCode): { ok: false; error: EventRsvpServiceDenialCode } {
  return { ok: false, error };
}

function managementRequest(context: TrustedRequestContext) {
  return {
    actor: {
      identitySubjectId: context.identitySubjectId,
      tenantId: context.tenantId,
      membershipId: context.membershipId,
    },
    context: {
      tenantStatus: context.tenantStatus,
      membershipStatus: context.membershipStatus,
      assuranceLevel: context.assuranceLevel,
    },
    capability: CAPABILITIES.EVENT_MANAGE,
    scope: {
      tenantId: context.tenantId,
      module: "event" as const,
      resource: "event" as const,
    },
  };
}

export class EventRsvpService {
  public constructor(private readonly dependencies: EventRsvpServiceDependencies) {}

  public async changeParticipation(command: EventRsvpChangeCommand): Promise<EventRsvpServiceResult> {
    if (!isRecord(command) || !isTrustedRequestContext(command.trustedContext) || Object.keys(command).length !== 2) return denied("INVALID_INPUT") as EventRsvpServiceResult;
    const input = parseEventRsvpCommand(command.participation);
    if (input === null) return denied("INVALID_INPUT") as EventRsvpServiceResult;
    // This seam deliberately carries trusted identity facts, not a client
    // capability. The transaction re-reads the Membership and Tenant facts.
    try {
      return await this.dependencies.rsvps.changeParticipation(
        command.trustedContext.tenantId,
        command.trustedContext.membershipId,
        command.trustedContext.identitySubjectId,
        input,
      );
    } catch {
      return denied("PERSISTENCE_FAILED") as EventRsvpServiceResult;
    }
  }

  public async changeRsvp(command: EventRsvpChangeCommand): Promise<EventRsvpServiceResult> {
    return this.changeParticipation(command);
  }

  public async getOwnParticipation(command: EventRsvpReadCommand): Promise<EventRsvpReadResult> {
    if (!isRecord(command) || !isTrustedRequestContext(command.trustedContext) || Object.keys(command).length !== 2 || !isUuid(command.eventId)) return { ok: false, error: "PERSISTENCE_FAILED" };
    try {
      return await this.dependencies.rsvps.findOwnParticipation(
        command.trustedContext.tenantId,
        command.eventId,
        command.trustedContext.membershipId,
        command.trustedContext.identitySubjectId,
      );
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async getCurrentParticipation(command: EventRsvpReadCommand): Promise<EventRsvpReadResult> {
    return this.getOwnParticipation(command);
  }

  public async getManagementCounts(command: EventRsvpReadCommand): Promise<EventRsvpAggregateResult | { ok: false; error: EventRsvpServiceDenialCode }> {
    if (!isRecord(command) || !isTrustedRequestContext(command.trustedContext) || Object.keys(command).length !== 2 || !isUuid(command.eventId)) return denied("INVALID_INPUT");
    if (this.dependencies.capabilityAuthorizer === undefined) return denied("PERMISSION_DENIED");
    try {
      const decision = await this.dependencies.capabilityAuthorizer.authorize(managementRequest(command.trustedContext));
      if (!isCapabilityAuthorizationDecision(decision) || !decision.allowed) return denied("PERMISSION_DENIED");
      return await this.dependencies.rsvps.getAggregateCounts(command.trustedContext.tenantId, command.eventId);
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }
}
