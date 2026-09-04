import "server-only";

import {
  assuranceAtLeast,
  parseAssuranceLevel,
  type AssuranceLevel,
} from "./assurance-level";
import type { TrustedRequestContext } from "./trusted-request-context";
import {
  parseMembershipLifecycle,
  type MembershipLifecycle,
} from "@/domain/membership/membership";
import {
  parseTenantLifecycle,
  type TenantLifecycle,
} from "@/domain/tenancy/tenant";

import {
  parseResourceVisibility,
  type ResourceVisibility,
} from "./resource-visibility";
import {
  parseArchiveNoticeState,
  type ArchiveNoticeState,
} from "./resource-read-facts";

export { RESOURCE_VISIBILITIES, parseResourceVisibility } from "./resource-visibility";
export type { ResourceVisibility } from "./resource-visibility";
export {
  ARCHIVE_NOTICE_STATES,
  parseArchiveNoticeState,
} from "./resource-read-facts";
export type { ArchiveNoticeState } from "./resource-read-facts";

export const RESOURCE_READ_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_SCOPE_NOT_FOUND",
  "TENANT_UNAVAILABLE",
  "RESOURCE_NOT_AVAILABLE",
  "PUBLIC_SURFACE_UNAVAILABLE",
  "MEMBERSHIP_REQUIRED",
  "MEMBERSHIP_NOT_ELIGIBLE",
  "ASSURANCE_INSUFFICIENT",
  "AUDIENCE_INELIGIBLE",
] as const;

export type ResourceReadDenialCode =
  (typeof RESOURCE_READ_DENIAL_CODES)[number];

/**
 * Audience is already evaluated by the later audience/resource layer. This
 * policy only consumes the small trusted result and never computes cohorts.
 */
export type ResourceReadAudience =
  | Readonly<{ restricted: false }>
  | Readonly<{ restricted: true; eligible: boolean }>;

/**
 * Authoritative resource facts needed before a targeted audience can be
 * resolved. Audience is deliberately absent so a caller cannot smuggle an
 * unevaluated or fabricated audience result into the pre-audience policy.
 * It deliberately does not model Publication, Event, or any other resource.
 */
export type ResourceReadPreAudienceFacts = Readonly<{
  resourceId: string;
  tenantId: string;
  tenantStatus: TenantLifecycle;
  visibility: ResourceVisibility;
  readable: boolean;
  publicSurfacePermitted: boolean;
  archiveNoticeState?: ArchiveNoticeState;
  onLeaveReadEnabled: boolean;
  alumniPublicReadEnabled: boolean;
}>;

/**
 * Minimal authoritative facts needed for the complete generic resource READ
 * decision. The final audience result is attached only after pre-audience
 * authorization succeeds.
 */
export type ResourceAccessFacts = ResourceReadPreAudienceFacts & Readonly<{
  audience: ResourceReadAudience;
}>;

export type AnonymousPublicViewer = Readonly<{
  kind: "anonymous";
  tenantId: string;
}>;

export type TrustedMembershipViewer = Readonly<{
  kind: "membership";
  context: TrustedRequestContext;
}>;

/** An anonymous viewer still carries an explicit Tenant boundary. */
export type ResourceReadViewer =
  | AnonymousPublicViewer
  | TrustedMembershipViewer;

export type ResourceReadPolicyInput = Readonly<{
  resource: ResourceAccessFacts;
  viewer: ResourceReadViewer;
}>;

export type ResourceReadPreAudiencePolicyInput = Readonly<{
  resource: ResourceReadPreAudienceFacts;
  viewer: ResourceReadViewer;
}>;

export type ResourceReadDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; code: ResourceReadDenialCode }>;

const MEMBER_ONLY_READ_LIFECYCLES = new Set<MembershipLifecycle>([
  "unverified",
  "pending_review",
  "verified",
  "stale",
  "on_leave",
  "participation_suspended",
]);

const REQUIRED_ASSURANCE: Readonly<
  Partial<Record<Exclude<ResourceVisibility, "PUBLIC">, AssuranceLevel>>
> = {
  MEMBERS: "L1",
  VERIFIED_MEMBERS: "L2",
};

function denied(code: ResourceReadDenialCode): ResourceReadDecision {
  return { allowed: false, code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isResourceReadAudience(value: unknown): value is ResourceReadAudience {
  if (!isRecord(value) || !hasOwn(value, "restricted")) {
    return false;
  }

  if (value.restricted === false) {
    return true;
  }

  return (
    value.restricted === true &&
    hasOwn(value, "eligible") &&
    typeof value.eligible === "boolean"
  );
}

function isResourceReadFactsBase(
  value: unknown,
): value is ResourceReadPreAudienceFacts {
  if (!isRecord(value)) {
    return false;
  }

  const tenantStatus = parseTenantLifecycle(value.tenantStatus);
  const archiveNoticeState = value.archiveNoticeState;

  if (
    !isNonEmptyString(value.resourceId) ||
    !isNonEmptyString(value.tenantId) ||
    tenantStatus === null ||
    parseResourceVisibility(value.visibility) === null ||
    typeof value.readable !== "boolean" ||
    typeof value.publicSurfacePermitted !== "boolean" ||
    typeof value.onLeaveReadEnabled !== "boolean" ||
    typeof value.alumniPublicReadEnabled !== "boolean"
  ) {
    return false;
  }

  if (
    archiveNoticeState !== undefined &&
    parseArchiveNoticeState(archiveNoticeState) === null
  ) {
    return false;
  }

  return tenantStatus !== "archived" ||
    parseArchiveNoticeState(archiveNoticeState) !== null;
}

function isResourceReadPreAudienceFacts(
  value: unknown,
): value is ResourceReadPreAudienceFacts {
  return isResourceReadFactsBase(value) &&
    !hasOwn(value as Record<string, unknown>, "audience");
}

function isResourceAccessFacts(value: unknown): value is ResourceAccessFacts {
  return (
    isResourceReadFactsBase(value) &&
    isResourceReadAudience((value as Record<string, unknown>).audience)
  );
}

function isTrustedRequestContext(
  value: unknown,
): value is TrustedRequestContext {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.identitySubjectId) &&
    isNonEmptyString(value.tenantId) &&
    isNonEmptyString(value.membershipId) &&
    parseTenantLifecycle(value.tenantStatus) !== null &&
    parseAssuranceLevel(value.assuranceLevel) !== null &&
    parseMembershipLifecycle(value.membershipStatus) !== null
  );
}

export function isResourceReadViewer(
  value: unknown,
): value is ResourceReadViewer {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }

  if (value.kind === "anonymous") {
    return isNonEmptyString(value.tenantId);
  }

  return value.kind === "membership" && isTrustedRequestContext(value.context);
}

function isResourceReadPolicyInput(
  value: unknown,
): value is ResourceReadPolicyInput {
  return (
    isRecord(value) &&
    isResourceAccessFacts(value.resource) &&
    isResourceReadViewer(value.viewer)
  );
}

function isResourceReadPreAudiencePolicyInput(
  value: unknown,
): value is ResourceReadPreAudiencePolicyInput {
  return (
    isRecord(value) &&
    isResourceReadPreAudienceFacts(value.resource) &&
    isResourceReadViewer(value.viewer)
  );
}

function tenantReadDenial(
  resource: ResourceReadPreAudienceFacts,
): ResourceReadDenialCode | null {
  if (
    resource.tenantStatus === "archived" &&
    resource.archiveNoticeState === "ENDED"
  ) {
    return "TENANT_UNAVAILABLE";
  }

  return null;
}

function membershipReadDenial(
  resource: ResourceReadPreAudienceFacts,
  viewer: TrustedMembershipViewer,
): ResourceReadDenialCode | null {
  const { membershipStatus } = viewer.context;

  if (membershipStatus === "suspended") {
    return "MEMBERSHIP_NOT_ELIGIBLE";
  }

  if (resource.visibility === "PUBLIC") {
    if (
      membershipStatus === "alumni" &&
      !resource.alumniPublicReadEnabled
    ) {
      return "MEMBERSHIP_NOT_ELIGIBLE";
    }

    // on_leave, transferred_out, and closed do not need member privileges to
    // reach PUBLIC content. Their public access is checked separately below.
    return null;
  }

  if (
    membershipStatus === "on_leave" &&
    !resource.onLeaveReadEnabled
  ) {
    return "MEMBERSHIP_NOT_ELIGIBLE";
  }

  return MEMBER_ONLY_READ_LIFECYCLES.has(membershipStatus)
    ? null
    : "MEMBERSHIP_NOT_ELIGIBLE";
}

function authorizeResourceReadBeforeAudienceFacts(
  resource: ResourceReadPreAudienceFacts,
  viewer: ResourceReadViewer,
): ResourceReadDecision {
  const viewerTenantId =
    viewer.kind === "anonymous" ? viewer.tenantId : viewer.context.tenantId;

  if (resource.tenantId !== viewerTenantId) {
    return denied("TENANT_SCOPE_NOT_FOUND");
  }

  if (
    viewer.kind === "membership" &&
    viewer.context.tenantStatus !== resource.tenantStatus
  ) {
    return denied("TENANT_UNAVAILABLE");
  }

  const tenantDenial = tenantReadDenial(resource);
  if (tenantDenial !== null) {
    return denied(tenantDenial);
  }

  if (!resource.readable) {
    return denied("RESOURCE_NOT_AVAILABLE");
  }

  if (viewer.kind === "membership") {
    const membershipDenial = membershipReadDenial(resource, viewer);
    if (membershipDenial !== null) {
      return denied(membershipDenial);
    }
  } else if (resource.visibility !== "PUBLIC") {
    return denied("MEMBERSHIP_REQUIRED");
  }

  if (
    resource.visibility === "PUBLIC" &&
    !resource.publicSurfacePermitted
  ) {
    return denied("PUBLIC_SURFACE_UNAVAILABLE");
  }

  if (resource.visibility !== "PUBLIC") {
    const requiredAssurance = REQUIRED_ASSURANCE[resource.visibility];
    if (
      viewer.kind !== "membership" ||
      requiredAssurance === undefined ||
      !assuranceAtLeast(viewer.context.assuranceLevel, requiredAssurance)
    ) {
      return denied("ASSURANCE_INSUFFICIENT");
    }
  }

  return { allowed: true };
}

/**
 * Authorizes the canonical resource READ rules that must precede targeted
 * audience resolution. It intentionally has no transport, persistence, clock,
 * participation, or audience semantics and returns no resource details on
 * denial.
 */
export function authorizeResourceReadBeforeAudience(
  input: ResourceReadPreAudiencePolicyInput,
): ResourceReadDecision {
  if (!isResourceReadPreAudiencePolicyInput(input)) {
    return denied("INVALID_INPUT");
  }

  return authorizeResourceReadBeforeAudienceFacts(input.resource, input.viewer);
}

/**
 * Authorizes only resource READ exposure. It intentionally has no transport,
 * persistence, clock, or participation semantics and returns no resource
 * details on denial. The pre-audience rules are shared with
 * authorizeResourceReadBeforeAudience so visibility cannot drift between the
 * preflight and final decisions.
 */
export function authorizeResourceRead(
  input: ResourceReadPolicyInput,
): ResourceReadDecision {
  if (!isResourceReadPolicyInput(input)) {
    return denied("INVALID_INPUT");
  }

  const preAudienceDecision = authorizeResourceReadBeforeAudienceFacts(
    input.resource,
    input.viewer,
  );
  if (!preAudienceDecision.allowed) {
    return preAudienceDecision;
  }

  if (input.resource.audience.restricted && !input.resource.audience.eligible) {
    return denied("AUDIENCE_INELIGIBLE");
  }

  return { allowed: true };
}
