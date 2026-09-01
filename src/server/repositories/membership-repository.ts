import "server-only";

import { and, eq } from "drizzle-orm";

import {
  isMembership,
  parseMembershipLifecycle,
  type Membership,
} from "@/domain/membership/membership";
import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";
import { db, type CampusHubDatabase } from "@/server/db/client";
import { memberships, type MembershipRow } from "@/server/db/schema";

import type { MembershipContextReader } from "@/application/context/context-readers";

function toMembership(row: MembershipRow): Membership | null {
  const assuranceLevel = parseAssuranceLevel(row.assuranceLevel);
  const lifecycle = parseMembershipLifecycle(row.lifecycle);
  if (assuranceLevel === null || lifecycle === null) {
    return null;
  }

  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    identitySubjectId: row.identitySubjectId,
    assuranceLevel,
    lifecycle,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  return isMembership(candidate) ? candidate : null;
}

export class DrizzleMembershipRepository implements MembershipContextReader {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async findMembershipById(id: string): Promise<Membership | null> {
    if (typeof id !== "string" || id.trim().length === 0) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(memberships)
      .where(eq(memberships.id, id))
      .limit(1);

    return rows[0] ? toMembership(rows[0]) : null;
  }

  public async findMembershipForIdentityAndTenant(
    identitySubjectId: string,
    tenantId: string,
  ): Promise<Membership | null> {
    if (
      typeof identitySubjectId !== "string" ||
      identitySubjectId.trim().length === 0 ||
      typeof tenantId !== "string" ||
      tenantId.trim().length === 0
    ) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.identitySubjectId, identitySubjectId),
          eq(memberships.tenantId, tenantId),
        ),
      )
      .limit(1);

    return rows[0] ? toMembership(rows[0]) : null;
  }
}
