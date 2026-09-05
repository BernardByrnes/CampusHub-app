import "server-only";

import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";

import {
  parseCapability,
  parseCapabilityModuleScope,
  type Capability,
  type CapabilityModuleScope,
} from "@/domain/authorization/capability";
import {
  isRoleGrant,
  parseRoleGrantRole,
  type RoleGrant,
} from "@/domain/governance/role-grant";
import { isUuid } from "@/domain/identifiers/uuid";
import { db, type CampusHubDatabase } from "@/server/db/client";
import { roleGrants, type RoleGrantRow } from "@/server/db/schema";

function toRoleGrant(row: RoleGrantRow): RoleGrant | null {
  const role = parseRoleGrantRole(row.role);
  const capability = parseCapability(row.capability);
  const moduleScope = parseCapabilityModuleScope(row.moduleScope);
  if (role === null || capability === null || moduleScope === null) {
    return null;
  }

  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    guildTermId: row.guildTermId,
    membershipId: row.membershipId,
    role,
    capability,
    moduleScope,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  return isRoleGrant(candidate) ? candidate : null;
}

export type CapabilityGrantLookup = Readonly<{
  tenantId: string;
  guildTermId: string;
  membershipId: string;
  capability: Capability;
  moduleScope: CapabilityModuleScope;
  now: Date;
  termEndsAt: Date;
}>;

export type RoleGrantAuthorizationReader = Readonly<{
  findCapabilityGrantForTenant(
    input: CapabilityGrantLookup,
  ): Promise<RoleGrant | null>;
}>;

export class DrizzleRoleGrantRepository
  implements RoleGrantAuthorizationReader
{
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async findCapabilityGrantForTenant(
    input: CapabilityGrantLookup,
  ): Promise<RoleGrant | null> {
    if (
      !isUuid(input.tenantId) ||
      !isUuid(input.guildTermId) ||
      !isUuid(input.membershipId) ||
      !(input.now instanceof Date) ||
      Number.isNaN(input.now.getTime()) ||
      !(input.termEndsAt instanceof Date) ||
      Number.isNaN(input.termEndsAt.getTime())
    ) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(roleGrants)
      .where(
        and(
          eq(roleGrants.tenantId, input.tenantId),
          eq(roleGrants.guildTermId, input.guildTermId),
          eq(roleGrants.membershipId, input.membershipId),
          eq(roleGrants.capability, input.capability),
          eq(roleGrants.moduleScope, input.moduleScope),
          isNull(roleGrants.revokedAt),
          gt(roleGrants.expiresAt, input.now),
          lte(roleGrants.expiresAt, input.termEndsAt),
        ),
      )
      .orderBy(asc(roleGrants.createdAt), asc(roleGrants.id));

    return rows[0] ? toRoleGrant(rows[0]) : null;
  }
}
