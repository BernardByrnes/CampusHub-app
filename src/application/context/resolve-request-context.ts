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
import { isUuid } from "@/domain/identifiers/uuid";
import { isValidTenantSlug } from "@/domain/tenancy/tenant";

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
  | Readonly<{ failure: ContextFailureCode }>;

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function selectTenantLookup(hint: unknown): TenantHintDecision {
  if (typeof hint !== "object" || hint === null) {
    return { failure: "TENANT_REQUIRED" };
  }

  const candidate = hint as Record<string, unknown>;
  const hasTenantId = nonEmptyString(candidate.tenantId);
  const hasSlug = nonEmptyString(candidate.slug);

  if (hasTenantId === hasSlug) {
    return {
      failure: hasTenantId ? "CONTEXT_MISMATCH" : "TENANT_REQUIRED",
    };
  }

  if (hasTenantId) {
    return isUuid(candidate.tenantId)
      ? { lookup: { kind: "id", value: candidate.tenantId } }
      : { failure: "TENANT_SCOPE_NOT_FOUND" };
  }

  return isValidTenantSlug(candidate.slug)
    ? { lookup: { kind: "slug", value: candidate.slug } }
    : { failure: "TENANT_SCOPE_NOT_FOUND" };
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
      return { resolved: false, code: "IDENTITY_REQUIRED" };
    }

    const tenantHintDecision = selectTenantLookup(tenantHint);
    if ("failure" in tenantHintDecision) {
      return { resolved: false, code: tenantHintDecision.failure };
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
      return { resolved: false, code: "TENANT_SCOPE_NOT_FOUND" };
    }

    const membership =
      await this.dependencies.memberships.findMembershipForIdentityAndTenant(
        identitySubjectId,
        tenant.id,
      );

    const resolution = validateRequestContext({
      identitySubjectId,
      tenant,
      membership,
    });

    if (
      !resolution.resolved &&
      (resolution.code === "TENANT_UNAVAILABLE" ||
        resolution.code === "MEMBERSHIP_REQUIRED")
    ) {
      return { resolved: false, code: "TENANT_SCOPE_NOT_FOUND" };
    }

    return resolution;
  }

  public resolve(
    authenticatedIdentity: AuthenticatedIdentity,
    tenantHint?: TenantHint,
  ): Promise<RequestContextResolution> {
    return this.resolveRequestContext(authenticatedIdentity, tenantHint);
  }
}

export type ResolvedRequestContext = RequestContext;
