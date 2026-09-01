import "server-only";

import type {
  RequestContextResolution,
} from "@/domain/authorization/context-policy";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";

/**
 * This is the only identity input accepted by the context resolver. A future
 * authentication/session boundary will produce it from server-owned state.
 * Client headers, query parameters, and form fields are never authoritative.
 */
export type AuthenticatedIdentity = Readonly<{
  identitySubjectId: string;
}>;

/** A routing hint narrows lookup; it never grants tenant authority. */
export type TenantHint = Readonly<{
  tenantId?: string;
  slug?: string;
}>;

export type RequestContext = TrustedRequestContext;

export interface RequestContextResolver {
  resolve(
    authenticatedIdentity: AuthenticatedIdentity,
    tenantHint?: TenantHint,
  ): Promise<RequestContextResolution>;
}
