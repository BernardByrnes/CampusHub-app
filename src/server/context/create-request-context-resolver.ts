import "server-only";

import {
  RequestContextService,
  type ResolveRequestContextDependencies,
} from "@/application/context/resolve-request-context";
import type { RequestContextResolver } from "@/server/context/request-context";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import { DrizzleTenantRepository } from "@/server/repositories/tenant-repository";

/**
 * Wires the provider-neutral application seam to PostgreSQL repositories.
 * Authentication/session resolution remains a separate, deferred boundary.
 */
export function createRequestContextResolver(): RequestContextResolver {
  const dependencies: ResolveRequestContextDependencies = {
    tenants: new DrizzleTenantRepository(),
    memberships: new DrizzleMembershipRepository(),
  };

  return new RequestContextService(dependencies);
}
