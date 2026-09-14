import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

import type { Capability, CapabilityModuleScope } from "@/domain/authorization/capability";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import { isUuid } from "@/domain/identifiers/uuid";
import { tenantHasFullFunctionality } from "@/domain/tenancy/tenant";
import type { CampusHubDatabase } from "@/server/db/client";
import { memberships } from "@/server/db/schema/membership";
import { guildTerms, roleGrants } from "@/server/db/schema/governance";
import { tenants } from "@/server/db/schema/tenant";

export type PrivilegedMutationTransactionDatabase = Pick<
  CampusHubDatabase,
  "select" | "execute"
>;

export type PrivilegedMutationDenied = Readonly<{
  ok: false;
  code:
    | "PERMISSION_DENIED"
    | "NOT_FOUND"
    | "VERSION_CONFLICT"
    | "INVALID_STATE"
    | "NOT_READY"
    | "PERSISTENCE_FAILED";
}>;

export type PrivilegedMutationAllowed<T> = Readonly<{
  ok: true;
  value: T;
  actorMembershipId: string;
  databaseTime: Date;
}>;

export type PrivilegedMutationResult<T> =
  | PrivilegedMutationDenied
  | PrivilegedMutationAllowed<T>;

export type PrivilegedMutationAuthorityOptions<T> = Readonly<{
  request: CapabilityAuthorizationRequest;
  capability: Capability;
  moduleScope: CapabilityModuleScope;
  resource: string;
  prepareResource: () => Promise<true | PrivilegedMutationDenied["code"]>;
  beforeFinalClockCheck?: () => Promise<void>;
  guardedMutation: (input: Readonly<{ databaseTime: Date; actorMembershipId: string }>) => Promise<T>;
}>;

type AuthorityFacts = Readonly<{
  actorMembershipId: string;
  grantExpiresAt: Date;
  termEndsAt: Date;
}>;

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

async function databaseClock(
  database: Pick<CampusHubDatabase, "execute">,
): Promise<Date | null> {
  try {
    const result = await database.execute(
      sql`select clock_timestamp() as database_time`,
    );
    const value = (result.rows[0] as { database_time?: unknown } | undefined)
      ?.database_time;
    if (value instanceof Date) {
      return isValidDate(value) ? value : null;
    }
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      return isValidDate(parsed) ? parsed : null;
    }
    return null;
  } catch {
    return null;
  }
}

function validRequest(
  request: CapabilityAuthorizationRequest,
  capability: Capability,
  moduleScope: CapabilityModuleScope,
  resource: string,
): boolean {
  return (
    request.capability === capability &&
    request.scope.module === moduleScope &&
    request.scope.resource === resource &&
    resource.trim().length > 0 &&
    request.actor.tenantId === request.scope.tenantId &&
    isUuid(request.actor.tenantId) &&
    isUuid(request.actor.membershipId) &&
    typeof request.actor.identitySubjectId === "string" &&
    request.actor.identitySubjectId.trim().length > 0
  );
}

/**
 * Commit-time Privileged Mutation Authority Freshness Boundary (PMAFB).
 *
 * The API deliberately does not return a reusable permit. It locks the
 * authority rows, lets the caller lock and validate its resource, re-reads
 * those authority rows and PostgreSQL clock_timestamp(), then compares the
 * fresh clock with the earliest grant/term expiry before invoking the guarded
 * mutation while every lock remains held by the caller's transaction.
 */
export class PostgresPrivilegedMutationAuthority {
  public constructor() {}

  public async run<T>(
    database: PrivilegedMutationTransactionDatabase,
    options: PrivilegedMutationAuthorityOptions<T>,
  ): Promise<PrivilegedMutationResult<T>> {
    try {
      if (
        !validRequest(
          options.request,
          options.capability,
          options.moduleScope,
          options.resource,
        )
      ) {
        return { ok: false, code: "PERMISSION_DENIED" };
      }

      const initialAuthority = await this.lockAndReadAuthority(
        database,
        options.request,
        options.capability,
        options.moduleScope,
      );
      if (initialAuthority === null) {
        return { ok: false, code: "PERMISSION_DENIED" };
      }

      const prepared = await options.prepareResource();
      if (prepared !== true) {
        return { ok: false, code: prepared };
      }

      const finalAuthority = await this.lockAndReadAuthority(
        database,
        options.request,
        options.capability,
        options.moduleScope,
      );
      if (
        finalAuthority === null ||
        finalAuthority.actorMembershipId !== initialAuthority.actorMembershipId
      ) {
        return { ok: false, code: "PERMISSION_DENIED" };
      }

      await options.beforeFinalClockCheck?.();
      const finalTime = await databaseClock(database);
      if (finalTime === null) {
        return { ok: false, code: "PERMISSION_DENIED" };
      }
      const earliestApplicableExpiry = Math.min(
        finalAuthority.grantExpiresAt.getTime(),
        finalAuthority.termEndsAt.getTime(),
      );
      if (finalTime.getTime() >= earliestApplicableExpiry) {
        return { ok: false, code: "PERMISSION_DENIED" };
      }

      let value: T;
      try {
        value = await options.guardedMutation({
          databaseTime: finalTime,
          actorMembershipId: finalAuthority.actorMembershipId,
        });
      } catch {
        return { ok: false, code: "PERSISTENCE_FAILED" };
      }
      return {
        ok: true,
        value,
        actorMembershipId: finalAuthority.actorMembershipId,
        databaseTime: finalTime,
      };
    } catch {
      return { ok: false, code: "PERMISSION_DENIED" };
    }
  }

  private async lockAndReadAuthority(
    database: PrivilegedMutationTransactionDatabase,
    request: CapabilityAuthorizationRequest,
    capability: Capability,
    moduleScope: CapabilityModuleScope,
  ): Promise<AuthorityFacts | null> {
    const databaseTime = await databaseClock(database);
    if (databaseTime === null || request.actor.membershipId === undefined) {
      return null;
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
      return null;
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
      membership.identitySubjectId !== request.actor.identitySubjectId ||
      membership.lifecycle !== "verified"
    ) {
      return null;
    }

    const termRows = await database
      .select()
      .from(guildTerms)
      .where(
        and(
          eq(guildTerms.tenantId, tenant.id),
          eq(guildTerms.status, "active"),
        ),
      )
      .orderBy(asc(guildTerms.tenantId), asc(guildTerms.id))
      .for("update");
    const activeTerms = termRows.filter(
      (term) =>
        term.startsAt <= databaseTime &&
        databaseTime < term.endsAt &&
        term.status === "active",
    );
    if (activeTerms.length !== 1) {
      return null;
    }
    const term = activeTerms[0];

    const grantRows = await database
      .select()
      .from(roleGrants)
      .where(
        and(
          eq(roleGrants.tenantId, tenant.id),
          eq(roleGrants.guildTermId, term.id),
          eq(roleGrants.membershipId, membership.id),
          eq(roleGrants.capability, capability),
          eq(roleGrants.moduleScope, moduleScope),
        ),
      )
      .orderBy(asc(roleGrants.tenantId), asc(roleGrants.id))
      .for("update");
    const validGrants = grantRows.filter(
      (grant) =>
        grant.revokedAt === null &&
        grant.expiresAt > databaseTime &&
        grant.expiresAt <= term.endsAt,
    );
    if (validGrants.length !== 1) {
      return null;
    }

    return {
      actorMembershipId: membership.id,
      grantExpiresAt: validGrants[0]!.expiresAt,
      termEndsAt: term.endsAt,
    };
  }
}
