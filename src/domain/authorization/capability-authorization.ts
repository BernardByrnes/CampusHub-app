import "server-only";

import type { AssuranceLevel } from "./assurance-level";
import type { Capability } from "./capability";
import type { MembershipLifecycle } from "@/domain/membership/membership";
import type { TenantLifecycle } from "@/domain/tenancy/tenant";

/**
 * Server-owned actor facts. Membership is optional so future non-Membership
 * Tenant principals can use the same boundary without creating fake members.
 */
export type CapabilityAuthorizationActor = Readonly<{
  identitySubjectId: string;
  tenantId: string;
  membershipId?: string;
}>;

/** Trusted lifecycle facts available to the capability evaluator. */
export type CapabilityAuthorizationContext = Readonly<{
  tenantStatus: TenantLifecycle;
  membershipStatus?: MembershipLifecycle;
  assuranceLevel?: AssuranceLevel;
}>;

/** Explicit Tenant/module/resource scope for a capability decision. */
export type CapabilityAuthorizationScope = Readonly<{
  tenantId: string;
  module: string;
  resource?: string;
}>;

export type CapabilityAuthorizationRequest = Readonly<{
  actor: CapabilityAuthorizationActor;
  context: CapabilityAuthorizationContext;
  capability: Capability;
  scope: CapabilityAuthorizationScope;
}>;

export type CapabilityAuthorizationDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false }>;

export type CapabilityAuthorizer = Readonly<{
  authorize(
    request: CapabilityAuthorizationRequest,
  ): Promise<CapabilityAuthorizationDecision>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Runtime guard for the minimal decision crossing the authorization seam.
 * Anything other than exactly { allowed: boolean } is fail-closed by callers.
 */
export function isCapabilityAuthorizationDecision(
  value: unknown,
): value is CapabilityAuthorizationDecision {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value.allowed === "boolean"
  );
}
