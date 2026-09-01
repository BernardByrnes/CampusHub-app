import "server-only";

import { parseAssuranceLevel } from "./assurance-level";
import type { TrustedRequestContext } from "./trusted-request-context";
import {
  isTenant,
  isTenantLifecycleOperationalForProtectedActions,
  type Tenant,
} from "@/domain/tenancy/tenant";
import {
  isMembership,
  isMembershipLifecycleActionable,
  parseMembershipLifecycle,
  type Membership,
} from "@/domain/membership/membership";

export const CONTEXT_FAILURE_CODES = [
  "IDENTITY_REQUIRED",
  "TENANT_REQUIRED",
  "TENANT_UNAVAILABLE",
  "TENANT_INACTIVE",
  "MEMBERSHIP_REQUIRED",
  "MEMBERSHIP_INACTIVE",
  "INVALID_ASSURANCE",
  "CONTEXT_MISMATCH",
] as const;

export type ContextFailureCode = (typeof CONTEXT_FAILURE_CODES)[number];

export type RequestContextResolution =
  | Readonly<{ allowed: true; context: TrustedRequestContext }>
  | Readonly<{ allowed: false; code: ContextFailureCode }>;

export type ContextValidationInput = Readonly<{
  identitySubjectId: unknown;
  tenant: Tenant | unknown | null;
  membership: Membership | unknown | null;
}>;

function denied(code: ContextFailureCode): RequestContextResolution {
  return { allowed: false, code };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates all trust-boundary joins before a context can become trusted.
 * This function returns either a complete context or a code-only denial; it
 * never returns a partially validated object.
 */
export function validateRequestContext(
  input: ContextValidationInput,
): RequestContextResolution {
  if (!isNonEmptyString(input.identitySubjectId)) {
    return denied("IDENTITY_REQUIRED");
  }

  if (input.tenant === null || input.tenant === undefined) {
    return denied("TENANT_UNAVAILABLE");
  }

  if (!isTenant(input.tenant)) {
    return denied("TENANT_UNAVAILABLE");
  }

  if (!isTenantLifecycleOperationalForProtectedActions(input.tenant.status)) {
    return denied("TENANT_INACTIVE");
  }

  if (input.membership === null || input.membership === undefined) {
    return denied("MEMBERSHIP_REQUIRED");
  }

  if (!isMembership(input.membership)) {
    const candidate = input.membership as Record<string, unknown>;
    return parseAssuranceLevel(candidate.assuranceLevel) === null
      ? denied("INVALID_ASSURANCE")
      : denied("MEMBERSHIP_INACTIVE");
  }

  if (
    input.membership.tenantId !== input.tenant.id ||
    input.membership.identitySubjectId !== input.identitySubjectId
  ) {
    return denied("CONTEXT_MISMATCH");
  }

  const assuranceLevel = parseAssuranceLevel(input.membership.assuranceLevel);
  if (assuranceLevel === null) {
    return denied("INVALID_ASSURANCE");
  }

  const membershipStatus = parseMembershipLifecycle(input.membership.lifecycle);
  if (
    membershipStatus === null ||
    !isMembershipLifecycleActionable(membershipStatus)
  ) {
    return denied("MEMBERSHIP_INACTIVE");
  }

  return {
    allowed: true,
    context: {
      identitySubjectId: input.identitySubjectId,
      tenantId: input.tenant.id,
      membershipId: input.membership.id,
      assuranceLevel,
      membershipStatus,
    },
  };
}
