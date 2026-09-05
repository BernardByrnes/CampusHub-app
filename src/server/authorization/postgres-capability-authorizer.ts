import "server-only";

import type {
  MembershipContextReader,
  TenantContextReader,
} from "@/application/context/context-readers";
import {
  parseAssuranceLevel,
} from "@/domain/authorization/assurance-level";
import {
  CAPABILITIES,
  parseCapability,
  parseCapabilityModuleScope,
} from "@/domain/authorization/capability";
import {
  isCapabilityAuthorizationDecision,
  type CapabilityAuthorizationRequest,
  type CapabilityAuthorizer,
} from "@/domain/authorization/capability-authorization";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { tenantHasFullFunctionality } from "@/domain/tenancy/tenant";
import type { GuildTermAuthorizationReader } from "@/server/repositories/guild-term-repository";
import type { RoleGrantAuthorizationReader } from "@/server/repositories/role-grant-repository";

export type CapabilityClock = Readonly<{
  now(): Date;
}>;

export type PostgresCapabilityAuthorizerDependencies = Readonly<{
  tenants: Pick<TenantContextReader, "findTenantById">;
  memberships: Pick<MembershipContextReader, "findMembershipByIdForTenant">;
  guildTerms: GuildTermAuthorizationReader;
  roleGrants: RoleGrantAuthorizationReader;
  clock?: CapabilityClock;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isAuthorizationRequest(
  value: unknown,
): value is CapabilityAuthorizationRequest {
  if (
    !isRecord(value) ||
    !isRecord(value.actor) ||
    !isRecord(value.context) ||
    !isRecord(value.scope)
  ) {
    return false;
  }

  return (
    isNonEmptyString(value.actor.identitySubjectId) &&
    isUuid(value.actor.tenantId) &&
    isUuid(value.actor.membershipId) &&
    parseCapability(value.capability) !== null &&
    isUuid(value.scope.tenantId) &&
    parseCapabilityModuleScope(value.scope.module) !== null &&
    (value.scope.resource === undefined || isNonEmptyString(value.scope.resource)) &&
    tenantHasFullFunctionality(value.context.tenantStatus) &&
    parseMembershipLifecycle(value.context.membershipStatus) !== null &&
    parseAssuranceLevel(value.context.assuranceLevel) !== null
  );
}

/**
 * Current production capability path for Membership-backed Tenant actors.
 * Every decision reloads authoritative lifecycle, term, membership and grant
 * state; no request snapshot or cache is treated as permission.
 */
export class PostgresCapabilityAuthorizer implements CapabilityAuthorizer {
  public constructor(
    private readonly dependencies: PostgresCapabilityAuthorizerDependencies,
  ) {}

  public async authorize(
    request: CapabilityAuthorizationRequest,
  ): Promise<Readonly<{ allowed: true }> | Readonly<{ allowed: false }>> {
    try {
      if (!isAuthorizationRequest(request)) {
        return { allowed: false };
      }

      if (
        request.capability !== CAPABILITIES.PUBLICATION_CREATE ||
        request.scope.module !== "publication" ||
        (request.scope.resource !== undefined &&
          request.scope.resource !== "publication") ||
        request.actor.tenantId !== request.scope.tenantId
      ) {
        return { allowed: false };
      }

      const membershipId = request.actor.membershipId;
      if (membershipId === undefined) {
        return { allowed: false };
      }

      const now = this.dependencies.clock?.now() ?? new Date();
      if (!isValidDate(now)) {
        return { allowed: false };
      }

      const tenant = await this.dependencies.tenants.findTenantById(
        request.scope.tenantId,
      );
      if (
        tenant === null ||
        tenant.id !== request.scope.tenantId ||
        !tenantHasFullFunctionality(tenant.status)
      ) {
        return { allowed: false };
      }

      const membership =
        await this.dependencies.memberships.findMembershipByIdForTenant(
          tenant.id,
          membershipId,
        );
      if (
        membership === null ||
        membership.id !== membershipId ||
        membership.tenantId !== tenant.id ||
        membership.identitySubjectId !== request.actor.identitySubjectId ||
        membership.lifecycle !== "verified"
      ) {
        return { allowed: false };
      }

      const term =
        await this.dependencies.guildTerms.findActiveGuildTermForTenant(
          tenant.id,
          now,
        );
      if (
        term === null ||
        term.tenantId !== tenant.id ||
        term.status !== "active" ||
        now < term.startsAt ||
        now >= term.endsAt
      ) {
        return { allowed: false };
      }

      const grant =
        await this.dependencies.roleGrants.findCapabilityGrantForTenant({
          tenantId: tenant.id,
          guildTermId: term.id,
          membershipId: membership.id,
          capability: CAPABILITIES.PUBLICATION_CREATE,
          moduleScope: "publication",
          now,
        });
      if (
        grant === null ||
        grant.tenantId !== tenant.id ||
        grant.guildTermId !== term.id ||
        grant.membershipId !== membership.id ||
        grant.capability !== CAPABILITIES.PUBLICATION_CREATE ||
        grant.moduleScope !== "publication" ||
        grant.revokedAt !== null ||
        grant.expiresAt <= now ||
        grant.expiresAt > term.endsAt
      ) {
        return { allowed: false };
      }

      const decision: Readonly<{ allowed: true }> = { allowed: true };
      return isCapabilityAuthorizationDecision(decision)
        ? decision
        : { allowed: false };
    } catch {
      return { allowed: false };
    }
  }
}
