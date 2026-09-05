import "server-only";

import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";

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
import type { CampusHubDatabase } from "@/server/db/client";
import { memberships } from "@/server/db/schema/membership";
import { guildTerms, roleGrants } from "@/server/db/schema/governance";
import { tenants } from "@/server/db/schema/tenant";
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

type CapabilityTransactionDatabase = Pick<CampusHubDatabase, "select">;

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
        // Current Membership-backed Publication authority accepts only the
        // conservative verified-Membership subset. This is not the permanent
        // privileged-principal model; OD-02/OD-03 and Product §11.3 remain.
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
          termEndsAt: term.endsAt,
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

  /**
   * Authoritative commit-time check for Publication creation. The caller must
   * invoke this with the transaction that will perform the Publication INSERT.
   * Locks are acquired in Tenant, Membership, GuildTerm, RoleGrant order so
   * authority-invalidating updates serialize with the mutation.
   */
  public async authorizePublicationCreateInTransaction(
    database: CapabilityTransactionDatabase,
    request: CapabilityAuthorizationRequest,
  ): Promise<Readonly<{ allowed: true }> | Readonly<{ allowed: false }>> {
    try {
      if (
        !isAuthorizationRequest(request) ||
        request.capability !== CAPABILITIES.PUBLICATION_CREATE ||
        request.scope.module !== "publication" ||
        (request.scope.resource !== undefined &&
          request.scope.resource !== "publication") ||
        request.actor.tenantId !== request.scope.tenantId ||
        request.actor.membershipId === undefined
      ) {
        return { allowed: false };
      }

      const now = this.dependencies.clock?.now() ?? new Date();
      if (!isValidDate(now)) {
        return { allowed: false };
      }

      const tenantRows = await database
        .select()
        .from(tenants)
        .where(eq(tenants.id, request.scope.tenantId))
        .for("update")
        .limit(1);
      const tenant = tenantRows[0];
      if (
        tenant === undefined ||
        tenant.id !== request.scope.tenantId ||
        !tenantHasFullFunctionality(tenant.status)
      ) {
        return { allowed: false };
      }

      const membershipRows = await database
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.tenantId, tenant.id),
            eq(memberships.id, request.actor.membershipId),
          ),
        )
        .for("update")
        .limit(1);
      const membership = membershipRows[0];
      if (
        membership === undefined ||
        membership.tenantId !== tenant.id ||
        membership.id !== request.actor.membershipId ||
        membership.identitySubjectId !== request.actor.identitySubjectId ||
        // Keep the current conservative verified-Membership subset narrow;
        // privileged identity and non-student principal semantics remain
        // gated by OD-02/OD-03 and Product §11.3.
        membership.lifecycle !== "verified"
      ) {
        return { allowed: false };
      }

      const termRows = await database
        .select()
        .from(guildTerms)
        .where(
          and(
            eq(guildTerms.tenantId, tenant.id),
            eq(guildTerms.status, "active"),
            lte(guildTerms.startsAt, now),
            gt(guildTerms.endsAt, now),
          ),
        )
        .orderBy(asc(guildTerms.id))
        .for("update")
        .limit(1);
      const term = termRows[0];
      if (
        term === undefined ||
        term.tenantId !== tenant.id ||
        term.status !== "active" ||
        now < term.startsAt ||
        now >= term.endsAt
      ) {
        return { allowed: false };
      }

      const grantRows = await database
        .select()
        .from(roleGrants)
        .where(
          and(
            eq(roleGrants.tenantId, tenant.id),
            eq(roleGrants.guildTermId, term.id),
            eq(roleGrants.membershipId, membership.id),
            eq(roleGrants.capability, CAPABILITIES.PUBLICATION_CREATE),
            eq(roleGrants.moduleScope, "publication"),
            isNull(roleGrants.revokedAt),
            gt(roleGrants.expiresAt, now),
            lte(roleGrants.expiresAt, term.endsAt),
          ),
        )
        .orderBy(asc(roleGrants.createdAt), asc(roleGrants.id))
        .for("update");

      const currentGrant = grantRows.find(
        (grant) =>
          grant.tenantId === tenant.id &&
          grant.guildTermId === term.id &&
          grant.membershipId === membership.id &&
          grant.capability === CAPABILITIES.PUBLICATION_CREATE &&
          grant.moduleScope === "publication" &&
          grant.revokedAt === null &&
          grant.expiresAt > now &&
          grant.expiresAt <= term.endsAt,
      );

      return currentGrant === undefined
        ? { allowed: false }
        : { allowed: true };
    } catch {
      return { allowed: false };
    }
  }
}
