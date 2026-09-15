import "server-only";

import {
  isCapabilityAuthorizationDecision,
  type CapabilityAuthorizationRequest,
  type CapabilityAuthorizer,
} from "@/domain/authorization/capability-authorization";
import { CAPABILITIES } from "@/domain/authorization/capability";
import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";
import {
  parseOrganiserExpectedVersion,
  parseOrganiserListLimit,
  parseOrganiserName,
  type CreateOrganiserInput,
  type Organiser,
  type UpdateOrganiserInput,
} from "@/domain/organisers/organisers";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type {
  DrizzleOrganiserRepository,
  OrganiserMutationResult,
} from "@/server/repositories/organiser-repository";

export const ORGANISER_MANAGEMENT_DENIAL_CODES = [
  "INVALID_INPUT",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_STATE",
  "NOT_READY",
  "PERSISTENCE_FAILED",
] as const;
export type OrganiserManagementDenialCode = (typeof ORGANISER_MANAGEMENT_DENIAL_CODES)[number];
export type OrganiserManagementDenied = Readonly<{
  outcome: "DENIED";
  code: OrganiserManagementDenialCode;
}>;
export type OrganiserManagementResult =
  | Readonly<{ outcome: "CREATED" | "UPDATED"; organiser: Organiser }>
  | Readonly<{ outcome: "NOOP"; organiser: Organiser }>
  | Readonly<{ outcome: "LISTED"; organisers: readonly Organiser[] }>
  | OrganiserManagementDenied;

export type CreateOrganiserCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  organiser: unknown;
}>;
export type EditOrganiserCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  organiserId: string;
  edit: unknown;
}>;
export type ListOrganisersCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  limit?: unknown;
}>;

export type AuthorizedOrganiserManagementGateway = Readonly<{
  createOrganiser(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateOrganiserInput,
  ): Promise<OrganiserMutationResult>;
  updateOrganiser(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    organiserId: string,
    input: UpdateOrganiserInput,
  ): Promise<OrganiserMutationResult>;
}>;

export type OrganiserManagementServiceDependencies = Readonly<{
  capabilityAuthorizer: CapabilityAuthorizer;
  gateway: AuthorizedOrganiserManagementGateway;
  organisers: Pick<DrizzleOrganiserRepository, "listOrganisersForTenant">;
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

function scoped(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value) ||
    !isTrustedRequestContext(value.trustedContext) ||
    !isUuid(value.requestedTenantId) ||
    value.trustedContext.tenantId !== value.requestedTenantId) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function parseCreate(value: unknown): CreateOrganiserInput | null {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.keys(value).every((key) => key === "name")) return null;
  const name = parseOrganiserName(value.name);
  return name === null ? null : { name };
}

function parseUpdate(value: unknown): UpdateOrganiserInput | null {
  if (!isRecord(value) || Object.keys(value).length !== 2 || !Object.keys(value).every((key) => key === "name" || key === "expectedVersion")) return null;
  const name = parseOrganiserName(value.name);
  const expectedVersion = parseOrganiserExpectedVersion(value.expectedVersion);
  return name === null || expectedVersion === null ? null : { name, expectedVersion };
}

function request(context: TrustedRequestContext, tenantId: string): CapabilityAuthorizationRequest {
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
    capability: CAPABILITIES.ORGANISER_MANAGE,
    scope: { tenantId, module: "tenant", resource: "organiser" },
  };
}

function denied(code: OrganiserManagementDenialCode): OrganiserManagementDenied {
  return { outcome: "DENIED", code };
}

function map(
  result: OrganiserMutationResult,
  outcome: "CREATED" | "UPDATED",
): OrganiserManagementResult {
  if (!result.ok) return denied(result.error);
  return result.changed
    ? { outcome, organiser: result.organiser }
    : { outcome: "NOOP", organiser: result.organiser };
}

export class OrganiserManagementService {
  public constructor(private readonly dependencies: OrganiserManagementServiceDependencies) {}

  private async authorized(context: TrustedRequestContext, tenantId: string): Promise<boolean> {
    try {
      const decision = await this.dependencies.capabilityAuthorizer.authorize(request(context, tenantId));
      return isCapabilityAuthorizationDecision(decision) && decision.allowed;
    } catch {
      return false;
    }
  }

  public async createOrganiser(command: CreateOrganiserCommand): Promise<OrganiserManagementResult> {
    if (!scoped(command, ["trustedContext", "requestedTenantId", "organiser"])) return denied("INVALID_INPUT");
    const input = parseCreate(command.organiser);
    if (input === null) return denied("INVALID_INPUT");
    if (!(await this.authorized(command.trustedContext, command.requestedTenantId))) return denied("PERMISSION_DENIED");
    try {
      return map(await this.dependencies.gateway.createOrganiser(request(command.trustedContext, command.requestedTenantId), command.requestedTenantId, input), "CREATED");
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async editOrganiser(command: EditOrganiserCommand): Promise<OrganiserManagementResult> {
    if (!scoped(command, ["trustedContext", "requestedTenantId", "organiserId", "edit"]) || !isUuid(command.organiserId)) return denied("INVALID_INPUT");
    const input = parseUpdate(command.edit);
    if (input === null) return denied("INVALID_INPUT");
    if (!(await this.authorized(command.trustedContext, command.requestedTenantId))) return denied("PERMISSION_DENIED");
    try {
      return map(await this.dependencies.gateway.updateOrganiser(request(command.trustedContext, command.requestedTenantId), command.requestedTenantId, command.organiserId, input), "UPDATED");
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async listOrganisers(command: ListOrganisersCommand): Promise<OrganiserManagementResult> {
    if (!scoped(command, ["trustedContext", "requestedTenantId"], ["limit"])) return denied("INVALID_INPUT");
    const limit = parseOrganiserListLimit(command.limit);
    if (limit === null) return denied("INVALID_INPUT");
    if (!(await this.authorized(command.trustedContext, command.requestedTenantId))) return denied("PERMISSION_DENIED");
    try {
      return {
        outcome: "LISTED",
        organisers: await this.dependencies.organisers.listOrganisersForTenant(command.requestedTenantId, limit),
      };
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }
}
