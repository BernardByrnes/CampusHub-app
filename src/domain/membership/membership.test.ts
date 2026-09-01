import { describe, expect, it } from "vitest";

import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";

import {
  isMembership,
  membershipDefaultParticipationEligible,
  MEMBERSHIP_LIFECYCLE_STATUSES,
  parseMembershipLifecycle,
  type Membership,
} from "./membership";

const baseMembership: Membership = {
  id: "membership-alpha-a",
  tenantId: "tenant-alpha",
  identitySubjectId: "identity-a",
  assuranceLevel: "L2",
  lifecycle: "verified",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("Membership domain", () => {
  it("accepts a valid membership and preserves the identity seam", () => {
    expect(isMembership(baseMembership)).toBe(true);
    expect(parseAssuranceLevel(baseMembership.assuranceLevel)).toBe("L2");
    expect(MEMBERSHIP_LIFECYCLE_STATUSES).toEqual([
      "unverified",
      "pending_review",
      "verified",
      "stale",
      "on_leave",
      "alumni",
      "transferred_out",
      "participation_suspended",
      "suspended",
      "closed",
    ]);
  });

  it("allows the same identity to hold memberships in different tenants", () => {
    expect(
      isMembership({
        ...baseMembership,
        id: "membership-beta-a",
        tenantId: "tenant-beta",
      }),
    ).toBe(true);
  });

  it("keeps unknown lifecycle and assurance values invalid", () => {
    expect(parseMembershipLifecycle("active")).toBeNull();
    expect(isMembership({ ...baseMembership, lifecycle: "active" })).toBe(false);
    expect(isMembership({ ...baseMembership, assuranceLevel: "L4" })).toBe(false);
  });

  it("keeps default participation classification narrow for future policies", () => {
    expect(membershipDefaultParticipationEligible("verified")).toBe(true);
    expect(membershipDefaultParticipationEligible("on_leave")).toBe(true);
    expect(membershipDefaultParticipationEligible("stale")).toBe(false);
    expect(membershipDefaultParticipationEligible("participation_suspended")).toBe(
      false,
    );
    expect(membershipDefaultParticipationEligible("closed")).toBe(false);
  });
});
