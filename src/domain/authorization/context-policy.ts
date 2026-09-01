import "server-only";

import { parseAssuranceLevel } from "./assurance-level";
import type { TrustedRequestContext } from "./trusted-request-context";
import { isTenant, type Tenant } from "@/domain/tenancy/tenant";
import {
  isMembership,
  parseMembershipLifecycle,
  type Membership,
} from "@/domain/membership/membership";

export const CONTEXT_FAILURE_CODES = [
  "IDENTITY_REQUIRED",
  "TENANT_REQUIRED",
  "TENANT_SCOPE_NOT_FOUND",
  "TENANT_UNAVAILABLE",
  "INVALID_TENANT",
  "MEMBERSHIP_REQUIRED",
  "INVALID_MEMBERSHIP",
  "INVALID_ASSURANCE",
  "CONTEXT_MISMATCH",
] as const;

export type ContextFailureCode = (typeof CONTEXT_FAILURE_CODES)[number];

/** A resolution result, not an operation-authorization decision. */
export type RequestContextResolution =
  | Readonly<{ resolved: true; context: TrustedRequestContext }>
  | Readonly<{ resolved: false; code: ContextFailureCode }>;

export type ContextValidationInput = Readonly<{
  identitySubjectId: unknown;
  tenant: Tenant | unknown | null;
  membership: Membership | unknown | null;
}>;

function denied(code: ContextFailureCode): RequestContextResolution {
  return { resolved: false, code };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Validates all trust-boundary joins before a context can become trusted.
 * This function returns either a complete fact snapshot or a code-only
 * resolution failure; it never returns a partially validated object and it
 * does not decide whether any operation is authorized.
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
    return denied("INVALID_TENANT");
  }

  if (input.membership === null || input.membership === undefined) {
    return denied("MEMBERSHIP_REQUIRED");
  }

  if (!isRecord(input.membership)) {
    return denied("INVALID_MEMBERSHIP");
  }

  const assuranceLevel = parseAssuranceLevel(input.membership.assuranceLevel);
  if (assuranceLevel === null) {
    return denied("INVALID_ASSURANCE");
  }

  const membershipStatus = parseMembershipLifecycle(
    input.membership.lifecycle,
  );
  if (membershipStatus === null) {
    return denied("INVALID_MEMBERSHIP");
  }

  if (!isMembership(input.membership)) {
    return denied("INVALID_MEMBERSHIP");
  }

  if (
    input.membership.tenantId !== input.tenant.id ||
    input.membership.identitySubjectId !== input.identitySubjectId
  ) {
    return denied("CONTEXT_MISMATCH");
  }

  return {
    resolved: true,
    context: {
      identitySubjectId: input.identitySubjectId,
      tenantId: input.tenant.id,
      tenantStatus: input.tenant.status,
      membershipId: input.membership.id,
      assuranceLevel,
      membershipStatus,
    },
  };
}
