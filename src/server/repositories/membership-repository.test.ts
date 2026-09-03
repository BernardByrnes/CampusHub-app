import { expect, vi, describe, it } from "vitest";

vi.mock("@/server/db/client", () => ({ db: {} }));

import { isMembershipAudienceFacts } from "@/domain/membership/membership-audience";
import type { CampusHubDatabase } from "@/server/db/client";
import { DrizzleMembershipRepository } from "./membership-repository";

const tenantId = "11111111-1111-4111-8111-111111111111";
const membershipId = "22222222-2222-4222-8222-222222222222";
const campusId = "33333333-3333-4333-8333-333333333333";
const divisionId = "44444444-4444-4444-8444-444444444444";
const programmeId = "55555555-5555-4555-8555-555555555555";
const residenceId = "66666666-6666-4666-8666-666666666666";

function databaseReturning(row: Record<string, unknown> | null): CampusHubDatabase {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
  } as unknown as CampusHubDatabase;
}

function completeRow(): Record<string, unknown> {
  return {
    id: membershipId,
    tenantId,
    campusId,
    campusProvenance: "self_declared",
    academicDivisionId: divisionId,
    academicDivisionProvenance: "roster_derived",
    programmeId,
    programmeProvenance: "self_declared",
    academicYear: 2,
    academicYearProvenance: "institution_verified",
    residenceState: "resident",
    residenceId,
    residenceProvenance: "self_declared",
  };
}

describe("DrizzleMembershipRepository audience facts", () => {
  it("maps a complete row without upgrading provenance", async () => {
    const repository = new DrizzleMembershipRepository(
      databaseReturning(completeRow()),
    );

    const result = await repository.findMembershipAudienceFactsByIdForTenant(
      tenantId,
      membershipId,
    );

    expect(isMembershipAudienceFacts(result)).toBe(true);
    expect(result).toMatchObject({
      campus: { value: campusId, provenance: "self_declared" },
      academicDivision: { value: divisionId, provenance: "roster_derived" },
      programme: { value: programmeId, provenance: "self_declared" },
      academicYear: { value: 2, provenance: "institution_verified" },
      residence: {
        state: "resident",
        residenceId,
        provenance: "self_declared",
      },
    });
  });

  it("maps optional fields and unknown Residence canonically", async () => {
    const repository = new DrizzleMembershipRepository(
      databaseReturning({
        ...completeRow(),
        academicDivisionId: null,
        academicDivisionProvenance: "optional",
        programmeId: null,
        programmeProvenance: "optional",
        academicYear: null,
        academicYearProvenance: "optional",
        residenceState: "unknown",
        residenceId: null,
        residenceProvenance: "optional",
      }),
    );

    const result = await repository.findMembershipAudienceFactsByIdForTenant(
      tenantId,
      membershipId,
    );

    expect(result).toMatchObject({
      academicDivision: { value: null, provenance: "optional" },
      programme: { value: null, provenance: "optional" },
      academicYear: { value: null, provenance: "optional" },
      residence: { state: "unknown", residenceId: null, provenance: "optional" },
    });
  });

  it("returns null for missing Campus and invalid persisted facts", async () => {
    const missingCampus = new DrizzleMembershipRepository(
      databaseReturning({
        ...completeRow(),
        campusId: null,
        campusProvenance: null,
      }),
    );
    const invalidFacts = new DrizzleMembershipRepository(
      databaseReturning({
        ...completeRow(),
        academicYear: 0,
        residenceState: "unknown",
        residenceId: null,
        residenceProvenance: "self_declared",
      }),
    );

    await expect(
      missingCampus.findMembershipAudienceFactsByIdForTenant(
        tenantId,
        membershipId,
      ),
    ).resolves.toBeNull();
    await expect(
      invalidFacts.findMembershipAudienceFactsByIdForTenant(
        tenantId,
        membershipId,
      ),
    ).resolves.toBeNull();
  });

  it("rejects malformed identifiers before querying", async () => {
    const repository = new DrizzleMembershipRepository({
      select: () => {
        throw new Error("malformed identifier reached SQL");
      },
    } as unknown as CampusHubDatabase);

    await expect(
      repository.findMembershipAudienceFactsByIdForTenant("bad", membershipId),
    ).resolves.toBeNull();
    await expect(
      repository.findMembershipAudienceFactsByIdForTenant(tenantId, "bad"),
    ).resolves.toBeNull();
  });

  it("returns null when the Tenant-scoped query finds no row", async () => {
    const repository = new DrizzleMembershipRepository(databaseReturning(null));

    await expect(
      repository.findMembershipAudienceFactsByIdForTenant(
        tenantId,
        membershipId,
      ),
    ).resolves.toBeNull();
  });
});
