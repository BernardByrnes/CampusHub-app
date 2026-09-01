import "server-only";

import type { MembershipLifecycle } from "@/domain/membership/membership";
import type { TenantLifecycle } from "@/domain/tenancy/tenant";

import type { AssuranceLevel } from "./assurance-level";

/**
 * A server-produced trusted fact snapshot. It intentionally contains IDs,
 * lifecycle facts, and assurance only; profile data, client hints, and
 * operation decisions do not belong in the trusted context.
 */
export type TrustedRequestContext = Readonly<{
  identitySubjectId: string;
  tenantId: string;
  tenantStatus: TenantLifecycle;
  membershipId: string;
  assuranceLevel: AssuranceLevel;
  membershipStatus: MembershipLifecycle;
}>;
