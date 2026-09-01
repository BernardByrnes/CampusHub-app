import "server-only";

import {
  validateRequestContext,
  type ContextFailureCode,
  type RequestContextResolution,
} from "@/domain/authorization/context-policy";
import type {
  AuthenticatedIdentity,
  RequestContext,
  RequestContextResolver,
  TenantHint,
} from "@/server/context/request-context";

import type {
  MembershipContextReader,
  TenantContextReader,
} from "./context-readers";

export type ResolveRequestContextDependencies = Readonly<{
  tenants: TenantContextReader;
  memberships: MembershipContextReader;
}>;

type TenantLookup =
  | Readonly<{ kind: "id"; value: string }>
  | Readonly<{ kind: "slug"; value: string }>;

type TenantHintDecision =
  | Readonly<{ lookup: TenantLookup }>
  | Readonly<{ denied: ContextFailureCode }>;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function selectTenantLookup(hint: unknown): TenantHintDecision {
  if (typeof hint !== "object" || hint === null) {
    return { denied: "TENANT_REQUIRED" };
  }

  const candidate = hint as Record<string, unknown>;
  const hasTenantId = nonEmptyString(candidate.tenantId);
  const hasSlug = nonEmptyString(candidate.slug);

  if (hasTenantId === hasSlug) {
    return {
      denied: hasTenantId ? "CONTEXT_MISMATCH" : "TENANT_REQUIRED",
    };
  }

  return hasTenantId
    ? { lookup: { kind: "id", value: candidate.tenantId as string } }
    : { lookup: { kind: "slug", value: candidate.slug as string } };
}

/**
 * Resolves the tenant first, then loads only the Membership bound to both the
 * authenticated identity and that tenant. The final domain guard repeats the
 * joins before returning a complete trusted context.
 */
export class RequestContextService implements RequestContextResolver {
  public constructor(
    private readonly dependencies: ResolveRequestContextDependencies,
  ) {}

  public async resolveRequestContext(
    authenticatedIdentity: AuthenticatedIdentity,
    tenantHint?: TenantHint,
  ): Promise<RequestContextResolution> {
    const identitySubjectId =
      typeof authenticatedIdentity?.identitySubjectId === "string"
        ? authenticatedIdentity.identitySubjectId
        : null;

    if (!nonEmptyString(identitySubjectId)) {
      return { allowed: false, code: "IDENTITY_REQUIRED" };
    }

    const tenantHintDecision = selectTenantLookup(tenantHint);
    if ("denied" in tenantHintDecision) {
      return { allowed: false, code: tenantHintDecision.denied };
    }

    const tenant =
      tenantHintDecision.lookup.kind === "id"
        ? await this.dependencies.tenants.findTenantById(
            tenantHintDecision.lookup.value,
          )
        : await this.dependencies.tenants.findTenantBySlug(
            tenantHintDecision.lookup.value,
          );

    if (tenant === null) {
      return { allowed: false, code: "TENANT_UNAVAILABLE" };
    }

    const membership =
      await this.dependencies.memberships.findMembershipForIdentityAndTenant(
        identitySubjectId,
        tenant.id,
      );

    return validateRequestContext({
      identitySubjectId,
      tenant,
      membership,
    });
  }

  public resolve(
    authenticatedIdentity: AuthenticatedIdentity,
    tenantHint?: TenantHint,
  ): Promise<RequestContextResolution> {
    return this.resolveRequestContext(authenticatedIdentity, tenantHint);
  }
}

export type ResolvedRequestContext = RequestContext;
