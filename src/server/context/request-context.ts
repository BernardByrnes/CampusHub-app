import "server-only";

import type { AssuranceLevel } from "@/domain/authorization/assurance-level";

/**
 * A future auth/membership resolver will supply this from server-owned state.
 * Client headers, query parameters, and form fields are never authoritative.
 */
export type RequestContext = Readonly<{
  userId: string;
  tenantId: string;
  membershipId: string;
  assuranceLevel: AssuranceLevel;
}>;

export interface RequestContextResolver {
  resolve(request: Request): Promise<RequestContext | null>;
}
