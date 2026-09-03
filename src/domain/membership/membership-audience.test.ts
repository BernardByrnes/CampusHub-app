import { describe, expect, it } from "vitest";

import {
  isMembershipAudienceFacts,
  isProfileFieldProvenance,
  parseProfileFieldProvenance,
  type MembershipAudienceFacts,
} from "./membership-audience";

const membershipId = "22222222-2222-4222-8222-222222222222";
const tenantId = "11111111-1111-4111-8111-111111111111";
const campusId = "33333333-3333-4333-8333-333333333333";
const divisionId = "44444444-4444-4444-8444-444444444444";
const programmeId = "55555555-5555-4555-8555-555555555555";
const residenceId = "66666666-6666-4666-8666-666666666666";

function validFacts(): MembershipAudienceFacts {
  return {
    membershipId,
    tenantId,
    campus: { value: campusId, provenance: "roster_derived" },
    academicDivision: { value: divisionId, provenance: "institution_verified" },
    programme: { value: programmeId, provenance: "roster_derived" },
    academicYear: { value: 2, provenance: "roster_derived" },
    residence: {
      state: "resident",
      residenceId,
      provenance: "institution_verified",
    },
  };
}

function omitFacts(
  facts: MembershipAudienceFacts,
  omittedKeys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(facts).filter(([key]) => !omittedKeys.includes(key)),
  );
}

describe("Membership audience facts", () => {
  it("uses one fail-closed field-provenance vocabulary", () => {
    expect(parseProfileFieldProvenance("institution_verified")).toBe(
      "institution_verified",
    );
    expect(parseProfileFieldProvenance("roster_derived")).toBe("roster_derived");
    expect(parseProfileFieldProvenance("self_declared")).toBe("self_declared");
    expect(parseProfileFieldProvenance("optional")).toBe("optional");
    expect(parseProfileFieldProvenance("assurance_high")).toBeNull();
    expect(isProfileFieldProvenance("unknown")).toBe(false);
  });

  it("accepts complete facts and omitted optional attributes", () => {
    expect(isMembershipAudienceFacts(validFacts())).toBe(true);

    const withoutOptionalAttributes = omitFacts(validFacts(), [
      "academicDivision",
      "programme",
      "academicYear",
    ]);
    expect(isMembershipAudienceFacts(withoutOptionalAttributes)).toBe(true);

    expect(
      isMembershipAudienceFacts({
        ...withoutOptionalAttributes,
        academicDivision: { value: null, provenance: "optional" },
        programme: { value: null, provenance: "optional" },
        academicYear: { value: null, provenance: "optional" },
      }),
    ).toBe(true);
  });

  it("requires a verified or roster-derived campus fact", () => {
    const facts = validFacts();

    expect(
      isMembershipAudienceFacts({
        ...facts,
        campus: { value: null, provenance: "optional" },
      }),
    ).toBe(false);
    expect(
      isMembershipAudienceFacts({
        ...facts,
        campus: { value: "not-a-uuid", provenance: "roster_derived" },
      }),
    ).toBe(false);
    expect(
      isMembershipAudienceFacts({
        ...facts,
        academicDivision: { value: divisionId, provenance: "optional" },
      }),
    ).toBe(false);
  });

  it("rejects malformed persisted identifiers", () => {
    const facts = validFacts();

    expect(isMembershipAudienceFacts({ ...facts, membershipId: "bad" })).toBe(false);
    expect(isMembershipAudienceFacts({ ...facts, tenantId: "bad" })).toBe(false);
    expect(
      isMembershipAudienceFacts({
        ...facts,
        residence: {
          ...facts.residence,
          residenceId: "bad",
        },
      }),
    ).toBe(false);
  });

  it("accepts only positive integer academic years without a global maximum", () => {
    expect(
      isMembershipAudienceFacts({
        ...validFacts(),
        academicYear: { value: 999999, provenance: "roster_derived" },
      }),
    ).toBe(true);

    for (const value of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        isMembershipAudienceFacts({
          ...validFacts(),
          academicYear: { value, provenance: "roster_derived" },
        }),
      ).toBe(false);
    }
  });

  it("enforces the residence discriminated shape", () => {
    const facts = validFacts();

    expect(
      isMembershipAudienceFacts({
        ...facts,
        residence: {
          state: "non_resident",
          residenceId: null,
          provenance: "roster_derived",
        },
      }),
    ).toBe(true);
    expect(
      isMembershipAudienceFacts({
        ...facts,
        residence: {
          state: "unknown",
          residenceId: null,
          provenance: "optional",
        },
      }),
    ).toBe(true);
    expect(
      isMembershipAudienceFacts({
        ...facts,
        residence: {
          state: "resident",
          residenceId: null,
          provenance: "roster_derived",
        },
      }),
    ).toBe(false);
    expect(
      isMembershipAudienceFacts({
        ...facts,
        residence: {
          state: "non_resident",
          residenceId,
          provenance: "roster_derived",
        },
      }),
    ).toBe(false);
    expect(
      isMembershipAudienceFacts({
        ...facts,
        residence: {
          state: "unknown",
          residenceId,
          provenance: "optional",
        },
      }),
    ).toBe(false);
  });

  it("rejects unknown provenance and non-optional provenance for absent values", () => {
    const facts = validFacts();

    expect(
      isMembershipAudienceFacts({
        ...facts,
        programme: { value: programmeId, provenance: "unknown" },
      }),
    ).toBe(false);
    expect(
      isMembershipAudienceFacts({
        ...facts,
        academicYear: { value: null, provenance: "self_declared" },
      }),
    ).toBe(false);
  });
});
