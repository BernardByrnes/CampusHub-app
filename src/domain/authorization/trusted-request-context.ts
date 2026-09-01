import "server-only";

import type { MembershipLifecycle } from "@/domain/membership/membership";

import type { AssuranceLevel } from "./assurance-level";

/**
 * A server-produced authorization snapshot. It intentionally contains IDs
 * and policy attributes only; profile data and client hints do not belong in
 * the trusted context.
 */
export type TrustedRequestContext = Readonly<{
  identitySubjectId: string;
  tenantId: string;
  membershipId: string;
  assuranceLevel: AssuranceLevel;
  membershipStatus: MembershipLifecycle;
}>;
