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
import { publications } from "@/server/db/schema/publication";
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

type SupportedPublicationCapability =
  | typeof CAPABILITIES.PUBLICATION_CREATE
  | typeof CAPABILITIES.PUBLICATION_EDIT;

export type PublicationEditTransactionDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      code:
        | "PERMISSION_DENIED"
        | "NOT_FOUND"
        | "VERSION_CONFLICT"
        | "INVALID_STATE";
    }>;

type PublicationMutationTransactionOptions = Readonly<{
  publicationId?: string;
  expectedVersion?: number;
  beforeFinalCheck?: () => Promise<void>;
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

function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isSupportedPublicationCapability(
  value: unknown,
): value is SupportedPublicationCapability {
  return (
    value === CAPABILITIES.PUBLICATION_CREATE ||
    value === CAPABILITIES.PUBLICATION_EDIT
  );
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

      const capability = request.capability;
      if (
        !isSupportedPublicationCapability(capability) ||
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
          capability,
          moduleScope: "publication",
          now,
          termEndsAt: term.endsAt,
        });
      if (
        grant === null ||
        grant.tenantId !== tenant.id ||
        grant.guildTermId !== term.id ||
        grant.membershipId !== membership.id ||
        grant.capability !== capability ||
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
   * Shared commit-time authority evaluator for the two currently supported
   * Publication mutations. When an edit target is supplied, the Publication
   * lock is acquired after the authority locks and before the fresh check.
   */
  private async authorizePublicationMutationInTransaction(
    database: CapabilityTransactionDatabase,
    request: CapabilityAuthorizationRequest,
    expectedCapability: SupportedPublicationCapability,
    options: PublicationMutationTransactionOptions = {},
  ): Promise<PublicationEditTransactionDecision> {
    try {
      const isEdit = expectedCapability === CAPABILITIES.PUBLICATION_EDIT;
      if (
        !isAuthorizationRequest(request) ||
        request.capability !== expectedCapability ||
        request.scope.module !== "publication" ||
        (request.scope.resource !== undefined &&
          request.scope.resource !== "publication") ||
        request.actor.tenantId !== request.scope.tenantId ||
        request.actor.membershipId === undefined ||
        (isEdit &&
          (!isUuid(options.publicationId) ||
            !isPositiveVersion(options.expectedVersion)))
      ) {
        return { allowed: false, code: "PERMISSION_DENIED" };
      }

      const initialNow = this.dependencies.clock?.now() ?? new Date();
      if (!isValidDate(initialNow)) {
        return { allowed: false, code: "PERMISSION_DENIED" };
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
        return { allowed: false, code: "PERMISSION_DENIED" };
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
        return { allowed: false, code: "PERMISSION_DENIED" };
      }

      const termRows = await database
        .select()
        .from(guildTerms)
        .where(
          and(
            eq(guildTerms.tenantId, tenant.id),
            eq(guildTerms.status, "active"),
            lte(guildTerms.startsAt, initialNow),
            gt(guildTerms.endsAt, initialNow),
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
        initialNow < term.startsAt ||
        initialNow >= term.endsAt
      ) {
        return { allowed: false, code: "PERMISSION_DENIED" };
      }

      const grantRows = await database
        .select()
        .from(roleGrants)
        .where(
          and(
            eq(roleGrants.tenantId, tenant.id),
            eq(roleGrants.guildTermId, term.id),
            eq(roleGrants.membershipId, membership.id),
            eq(roleGrants.capability, expectedCapability),
            eq(roleGrants.moduleScope, "publication"),
            isNull(roleGrants.revokedAt),
            gt(roleGrants.expiresAt, initialNow),
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
          grant.capability === expectedCapability &&
          grant.moduleScope === "publication" &&
          grant.revokedAt === null &&
          grant.expiresAt > initialNow &&
          grant.expiresAt <= term.endsAt,
      );

      if (currentGrant === undefined) {
        return { allowed: false, code: "PERMISSION_DENIED" };
      }

      if (isEdit) {
        const publicationRows = await database
          .select()
          .from(publications)
          .where(
            and(
              eq(publications.tenantId, request.scope.tenantId),
              eq(publications.id, options.publicationId!),
            ),
          )
          .for("update")
          .limit(1);
        const publication = publicationRows[0];

        if (publication === undefined) {
          return { allowed: false, code: "NOT_FOUND" };
        }
        if (publication.version !== options.expectedVersion) {
          return { allowed: false, code: "VERSION_CONFLICT" };
        }
        if (publication.lifecycle !== "draft") {
          return { allowed: false, code: "INVALID_STATE" };
        }
      }

      // The edit hook runs after the Publication lock; the fresh authority
      // check is therefore immediately before the guarded UPDATE.
      await options.beforeFinalCheck?.();

      const finalNow = this.dependencies.clock?.now() ?? new Date();
      if (!isValidDate(finalNow)) {
        return { allowed: false, code: "PERMISSION_DENIED" };
      }

      return term.status === "active" &&
        finalNow >= term.startsAt &&
        finalNow < term.endsAt &&
        currentGrant.revokedAt === null &&
        currentGrant.expiresAt > finalNow &&
        currentGrant.expiresAt <= term.endsAt
        ? { allowed: true }
        : { allowed: false, code: "PERMISSION_DENIED" };
    } catch {
      return { allowed: false, code: "PERMISSION_DENIED" };
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
    beforeFinalCheck?: () => Promise<void>,
  ): Promise<Readonly<{ allowed: true }> | Readonly<{ allowed: false }>> {
    const decision = await this.authorizePublicationMutationInTransaction(
      database,
      request,
      CAPABILITIES.PUBLICATION_CREATE,
      { beforeFinalCheck },
    );
    return decision.allowed ? decision : { allowed: false };
  }

  /**
   * Authoritative commit-time check for a draft Publication edit. The exact
   * Tenant-bound Publication is locked after the authority rows and before
   * the final fresh time check.
   */
  public async authorizePublicationEditInTransaction(
    database: CapabilityTransactionDatabase,
    request: CapabilityAuthorizationRequest,
    publicationId: string,
    expectedVersion: number,
    beforeFinalCheck?: () => Promise<void>,
  ): Promise<PublicationEditTransactionDecision> {
    return this.authorizePublicationMutationInTransaction(
      database,
      request,
      CAPABILITIES.PUBLICATION_EDIT,
      {
        publicationId,
        expectedVersion,
        beforeFinalCheck,
      },
    );
  }
}
