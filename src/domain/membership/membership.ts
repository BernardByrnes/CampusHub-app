import { parseAssuranceLevel, type AssuranceLevel } from "@/domain/authorization/assurance-level";

export const MEMBERSHIP_LIFECYCLE_STATUSES = [
  "unverified",
  "pending_review",
  "verified",
  "stale",
  "on_leave",
  "alumni",
  "transferred_out",
  "participation_suspended",
  "suspended",
  "closed",
] as const;

export type MembershipLifecycle = (typeof MEMBERSHIP_LIFECYCLE_STATUSES)[number];
export type MembershipStatus = MembershipLifecycle;
export const MEMBERSHIP_STATUSES = MEMBERSHIP_LIFECYCLE_STATUSES;

/** Future operation policies may use these as a default participation set. */
export const MEMBERSHIP_DEFAULT_PARTICIPATION_LIFECYCLES = [
  "verified",
  "on_leave",
] as const satisfies readonly MembershipLifecycle[];

export type Membership = Readonly<{
  id: string;
  tenantId: string;
  identitySubjectId: string;
  assuranceLevel: AssuranceLevel;
  lifecycle: MembershipLifecycle;
  createdAt: Date;
  updatedAt: Date;
}>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseMembershipLifecycle(value: unknown): MembershipLifecycle | null {
  return typeof value === "string" &&
    (MEMBERSHIP_LIFECYCLE_STATUSES as readonly string[]).includes(value)
    ? (value as MembershipLifecycle)
    : null;
}

/**
 * Narrow future participation-policy helper. It does not validate trusted
 * context and does not decide access to any specific resource or operation.
 */
export function membershipDefaultParticipationEligible(
  value: unknown,
): boolean {
  return (
    typeof value === "string" &&
    (MEMBERSHIP_DEFAULT_PARTICIPATION_LIFECYCLES as readonly string[]).includes(
      value,
    )
  );
}

export function isMembership(value: unknown): value is Membership {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    isNonEmptyString(candidate.tenantId) &&
    isNonEmptyString(candidate.identitySubjectId) &&
    parseAssuranceLevel(candidate.assuranceLevel) !== null &&
    parseMembershipLifecycle(candidate.lifecycle) !== null &&
    candidate.createdAt instanceof Date &&
    !Number.isNaN(candidate.createdAt.getTime()) &&
    candidate.updatedAt instanceof Date &&
    !Number.isNaN(candidate.updatedAt.getTime())
  );
}
