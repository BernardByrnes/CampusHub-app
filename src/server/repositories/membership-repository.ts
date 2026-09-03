import "server-only";

import { and, eq } from "drizzle-orm";

import {
  isMembership,
  parseMembershipLifecycle,
  type Membership,
} from "@/domain/membership/membership";
import {
  isMembershipAudienceFacts,
  parseMembershipResidenceState,
  parseProfileFieldProvenance,
  type MembershipAudienceFacts,
} from "@/domain/membership/membership-audience";
import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";
import { isUuid } from "@/domain/identifiers/uuid";
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

function toMembershipAudienceFacts(
  row: MembershipRow,
): MembershipAudienceFacts | null {
  const campusProvenance = parseProfileFieldProvenance(row.campusProvenance);
  const academicDivisionProvenance = parseProfileFieldProvenance(
    row.academicDivisionProvenance,
  );
  const programmeProvenance = parseProfileFieldProvenance(
    row.programmeProvenance,
  );
  const academicYearProvenance = parseProfileFieldProvenance(
    row.academicYearProvenance,
  );
  const residenceProvenance = parseProfileFieldProvenance(
    row.residenceProvenance,
  );
  const residenceState = parseMembershipResidenceState(row.residenceState);

  if (
    campusProvenance === null ||
    academicDivisionProvenance === null ||
    programmeProvenance === null ||
    academicYearProvenance === null ||
    residenceProvenance === null ||
    residenceState === null
  ) {
    return null;
  }

  const candidate = {
    membershipId: row.id,
    tenantId: row.tenantId,
    campus: {
      value: row.campusId,
      provenance: campusProvenance,
    },
    academicDivision: {
      value: row.academicDivisionId,
      provenance: academicDivisionProvenance,
    },
    programme: {
      value: row.programmeId,
      provenance: programmeProvenance,
    },
    academicYear: {
      value: row.academicYear,
      provenance: academicYearProvenance,
    },
    residence: {
      state: residenceState,
      residenceId: row.residenceId,
      provenance: residenceProvenance,
    },
  };

  return isMembershipAudienceFacts(candidate) ? candidate : null;
}

export class DrizzleMembershipRepository implements MembershipContextReader {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async findMembershipByIdForTenant(
    tenantId: string,
    membershipId: string,
  ): Promise<Membership | null> {
    if (!isUuid(tenantId) || !isUuid(membershipId)) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.id, membershipId),
        ),
      )
      .limit(1);

    return rows[0] ? toMembership(rows[0]) : null;
  }

  public async findMembershipAudienceFactsByIdForTenant(
    tenantId: string,
    membershipId: string,
  ): Promise<MembershipAudienceFacts | null> {
    if (!isUuid(tenantId) || !isUuid(membershipId)) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.id, membershipId),
        ),
      )
      .limit(1);

    return rows[0] ? toMembershipAudienceFacts(rows[0]) : null;
  }

  public async findMembershipForIdentityAndTenant(
    identitySubjectId: string,
    tenantId: string,
  ): Promise<Membership | null> {
    if (
      typeof identitySubjectId !== "string" ||
      identitySubjectId.trim().length === 0 ||
      !isUuid(tenantId)
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
