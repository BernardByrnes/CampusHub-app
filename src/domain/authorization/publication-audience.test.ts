import { describe, expect, it } from "vitest";

import {
  evaluatePublicationAudience,
  isPublicationAudienceDefinition,
  isPublicationAudienceProvenancePolicy,
  parsePublicationAudienceProvenancePolicy,
  type PublicationAudienceDefinition,
  type PublicationAudienceGroup,
  type PublicationResidenceTarget,
} from "./publication-audience";
import {
  isMembershipAudienceFacts,
  type MembershipAudienceFacts,
} from "../membership/membership-audience";

const publicationId = "77777777-7777-4777-8777-777777777777";
const tenantId = "11111111-1111-4111-8111-111111111111";
const otherTenantId = "88888888-8888-4888-8888-888888888888";
const membershipId = "22222222-2222-4222-8222-222222222222";
const campusId = "33333333-3333-4333-8333-333333333333";
const otherCampusId = "99999999-9999-4999-8999-999999999999";
const divisionId = "44444444-4444-4444-8444-444444444444";
const programmeId = "55555555-5555-4555-8555-555555555555";
const otherProgrammeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const residenceId = "66666666-6666-4666-8666-666666666666";
const otherResidenceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function definition(
  groups: readonly PublicationAudienceGroup[],
  mode: "entire_tenant" | "targeted" = "targeted",
  definitionTenantId = tenantId,
): PublicationAudienceDefinition {
  return {
    publicationId,
    tenantId: definitionTenantId,
    mode,
    groups,
  };
}

function omitFacts(
  facts: MembershipAudienceFacts,
  omittedKeys: readonly string[],
): unknown {
  return Object.fromEntries(
    Object.entries(facts).filter(([key]) => !omittedKeys.includes(key)),
  );
}

function campusGroup(
  campusIds: readonly string[] = [campusId],
  provenancePolicy: "authoritative_only" | "allow_self_declared" = "authoritative_only",
): PublicationAudienceGroup {
  return { dimension: "campus", provenancePolicy, campusIds };
}

function divisionGroup(
  academicDivisionIds: readonly string[] = [divisionId],
  provenancePolicy: "authoritative_only" | "allow_self_declared" = "authoritative_only",
): PublicationAudienceGroup {
  return {
    dimension: "academic_division",
    provenancePolicy,
    academicDivisionIds,
  };
}

function programmeGroup(
  programmeIds: readonly string[] = [programmeId],
  provenancePolicy: "authoritative_only" | "allow_self_declared" = "authoritative_only",
): PublicationAudienceGroup {
  return { dimension: "programme", provenancePolicy, programmeIds };
}

function yearGroup(
  academicYears: readonly number[] = [2],
  provenancePolicy: "authoritative_only" | "allow_self_declared" = "authoritative_only",
): PublicationAudienceGroup {
  return { dimension: "academic_year", provenancePolicy, academicYears };
}

function residenceGroup(
  residenceTargets: readonly PublicationResidenceTarget[],
  provenancePolicy: "authoritative_only" | "allow_self_declared" = "authoritative_only",
): PublicationAudienceGroup {
  return { dimension: "residence", provenancePolicy, residenceTargets };
}

describe("Publication audience definitions", () => {
  it("validates unrestricted and targeted canonical forms", () => {
    expect(isPublicationAudienceDefinition(definition([], "entire_tenant"))).toBe(true);
    expect(isPublicationAudienceDefinition(definition([campusGroup()], "targeted"))).toBe(true);
    expect(isPublicationAudienceDefinition(definition([], "targeted"))).toBe(false);
    expect(isPublicationAudienceDefinition(definition([campusGroup()], "entire_tenant"))).toBe(false);
  });

  it("rejects duplicate dimensions, empty values, malformed identifiers, and policies", () => {
    expect(
      isPublicationAudienceDefinition(
        definition([campusGroup(), campusGroup([otherCampusId])]),
      ),
    ).toBe(false);
    expect(
      isPublicationAudienceDefinition(
        definition([{ dimension: "campus", provenancePolicy: "authoritative_only", campusIds: [] }]),
      ),
    ).toBe(false);
    expect(
      isPublicationAudienceDefinition(
        {
          ...definition([], "targeted"),
          groups: [
            { dimension: "campus", provenancePolicy: "unknown", campusIds: [campusId] },
          ],
        },
      ),
    ).toBe(false);
    expect(
      isPublicationAudienceDefinition(
        definition([{ dimension: "campus", provenancePolicy: "authoritative_only", campusIds: ["bad"] }]),
      ),
    ).toBe(false);
    expect(
      isPublicationAudienceDefinition(
        definition([{ dimension: "academic_year", provenancePolicy: "authoritative_only", academicYears: [2, 2] }]),
      ),
    ).toBe(false);
    expect(
      isPublicationAudienceDefinition(
        definition([
          residenceGroup([
            { kind: "specific_residence", residenceId },
            { kind: "specific_residence", residenceId },
          ]),
        ]),
      ),
    ).toBe(false);
    expect(
      isPublicationAudienceDefinition(
        definition([residenceGroup([{ kind: "specific_residence", residenceId: "bad" }])]),
      ),
    ).toBe(false);
    expect(
      isPublicationAudienceDefinition({
        ...definition([]),
        publicationId: "bad",
      }),
    ).toBe(false);
  });

  it("rejects foreign semantic payloads from every other dimension", () => {
    const foreignPayloadCases = [
      {
        dimension: "campus",
        provenancePolicy: "authoritative_only",
        campusIds: [campusId],
        programmeIds: [programmeId],
      },
      {
        dimension: "academic_division",
        provenancePolicy: "authoritative_only",
        academicDivisionIds: [divisionId],
        campusIds: [campusId],
      },
      {
        dimension: "programme",
        provenancePolicy: "authoritative_only",
        programmeIds: [programmeId],
        academicYears: [2],
      },
      {
        dimension: "academic_year",
        provenancePolicy: "authoritative_only",
        academicYears: [2],
        residenceTargets: [{ kind: "non_resident" }],
      },
      {
        dimension: "residence",
        provenancePolicy: "authoritative_only",
        residenceTargets: [{ kind: "non_resident" }],
        programmeIds: [programmeId],
      },
    ];

    for (const group of foreignPayloadCases) {
      expect(
        isPublicationAudienceDefinition({
          ...definition([], "targeted"),
          groups: [group],
        }),
      ).toBe(false);
    }
  });

  it("requires exact residence target shapes", () => {
    expect(
      isPublicationAudienceDefinition(
        definition([
          residenceGroup([{ kind: "specific_residence", residenceId }]),
        ]),
      ),
    ).toBe(true);
    expect(
      isPublicationAudienceDefinition(
        definition([residenceGroup([{ kind: "any_resident" }])]),
      ),
    ).toBe(true);
    expect(
      isPublicationAudienceDefinition(
        definition([residenceGroup([{ kind: "non_resident" }])]),
      ),
    ).toBe(true);

    for (const target of [
      { kind: "any_resident", residenceId },
      { kind: "non_resident", residenceId },
    ]) {
      expect(
        isPublicationAudienceDefinition({
          ...definition([], "targeted"),
          groups: [
            {
              dimension: "residence",
              provenancePolicy: "authoritative_only",
              residenceTargets: [target],
            },
          ],
        }),
      ).toBe(false);
    }
  });

  it("parses only the approved provenance policies", () => {
    expect(parsePublicationAudienceProvenancePolicy("authoritative_only")).toBe(
      "authoritative_only",
    );
    expect(parsePublicationAudienceProvenancePolicy("allow_self_declared")).toBe(
      "allow_self_declared",
    );
    expect(parsePublicationAudienceProvenancePolicy("optional")).toBeNull();
    expect(isPublicationAudienceProvenancePolicy("authoritative_only")).toBe(true);
    expect(isPublicationAudienceProvenancePolicy("unknown")).toBe(false);
  });
});

describe("Publication audience evaluation", () => {
  it("leaves an entire-tenant publication unrestricted while binding supplied facts to its tenant", () => {
    const unrestricted = definition([], "entire_tenant");

    expect(evaluatePublicationAudience(unrestricted, undefined)).toEqual({
      evaluated: true,
      eligible: true,
    });
    expect(evaluatePublicationAudience(unrestricted, null)).toEqual({
      evaluated: true,
      eligible: true,
    });
    expect(evaluatePublicationAudience(unrestricted, validFacts())).toEqual({
      evaluated: true,
      eligible: true,
    });
    expect(
      evaluatePublicationAudience(unrestricted, {
        ...validFacts(),
        tenantId: otherTenantId,
      }),
    ).toEqual({ evaluated: true, eligible: false });
    expect(evaluatePublicationAudience(unrestricted, { malformed: true })).toEqual({
      evaluated: true,
      eligible: false,
    });
  });

  it("fails closed for targeted anonymous, malformed, and cross-tenant evaluation", () => {
    const targeted = definition([campusGroup()]);

    expect(evaluatePublicationAudience(targeted, undefined)).toEqual({
      evaluated: true,
      eligible: false,
    });
    expect(evaluatePublicationAudience(targeted, null)).toEqual({
      evaluated: true,
      eligible: false,
    });
    expect(evaluatePublicationAudience(targeted, { membershipId })).toEqual({
      evaluated: true,
      eligible: false,
    });
    expect(
      evaluatePublicationAudience(targeted, {
        ...validFacts(),
        tenantId: otherTenantId,
      }),
    ).toEqual({ evaluated: true, eligible: false });
    expect(evaluatePublicationAudience(definition([], "targeted"), validFacts())).toEqual({
      evaluated: true,
      eligible: false,
    });
  });

  it("uses OR semantics within campus, programme, and academic-year groups", () => {
    const facts = validFacts();

    expect(evaluatePublicationAudience(definition([campusGroup([otherCampusId, campusId])]), facts).eligible).toBe(true);
    expect(evaluatePublicationAudience(definition([campusGroup([otherCampusId])]), facts).eligible).toBe(false);
    expect(evaluatePublicationAudience(definition([programmeGroup([otherProgrammeId, programmeId])]), facts).eligible).toBe(true);
    expect(evaluatePublicationAudience(definition([programmeGroup([otherProgrammeId])]), facts).eligible).toBe(false);
    expect(evaluatePublicationAudience(definition([yearGroup([3, 2])]), facts).eligible).toBe(true);
    expect(evaluatePublicationAudience(definition([yearGroup([3])]), facts).eligible).toBe(false);
  });

  it("uses AND semantics across dimensions and denies when one dimension fails", () => {
    const facts = validFacts();

    expect(
      evaluatePublicationAudience(
        definition([campusGroup(), programmeGroup()]),
        facts,
      ).eligible,
    ).toBe(true);
    expect(
      evaluatePublicationAudience(
        definition([
          programmeGroup(),
          yearGroup(),
          residenceGroup([{ kind: "specific_residence", residenceId }]),
        ]),
        facts,
      ).eligible,
    ).toBe(true);
    expect(
      evaluatePublicationAudience(
        definition([campusGroup(), programmeGroup([otherProgrammeId])]),
        facts,
      ).eligible,
    ).toBe(false);
  });

  it("applies authoritative-only and explicit self-declared policies", () => {
    expect(
      evaluatePublicationAudience(
        definition([campusGroup()], "targeted"),
        validFacts(),
      ).eligible,
    ).toBe(true);

    const selfDeclaredFacts = {
      ...validFacts(),
      programme: { value: programmeId, provenance: "self_declared" as const },
    };
    expect(evaluatePublicationAudience(definition([programmeGroup()]), selfDeclaredFacts).eligible).toBe(false);
    expect(
      evaluatePublicationAudience(
        definition([programmeGroup([programmeId], "allow_self_declared")]),
        selfDeclaredFacts,
      ).eligible,
    ).toBe(true);

    const optionalFacts = {
      ...validFacts(),
      programme: { value: null, provenance: "optional" as const },
    };
    expect(evaluatePublicationAudience(definition([programmeGroup()]), optionalFacts).eligible).toBe(false);
    expect(isMembershipAudienceFacts(optionalFacts)).toBe(true);
  });

  it("denies missing optional dimensions without falling back to entire-tenant access", () => {
    const factsWithoutOptionalDimensions = omitFacts(validFacts(), [
      "academicDivision",
      "programme",
      "academicYear",
    ]);

    expect(
      evaluatePublicationAudience(
        definition([campusGroup()]),
        factsWithoutOptionalDimensions,
      ).eligible,
    ).toBe(true);
    expect(
      evaluatePublicationAudience(
        definition([divisionGroup()]),
        factsWithoutOptionalDimensions,
      ).eligible,
    ).toBe(false);
    expect(
      evaluatePublicationAudience(
        definition([programmeGroup()]),
        factsWithoutOptionalDimensions,
      ).eligible,
    ).toBe(false);
    expect(
      evaluatePublicationAudience(
        definition([yearGroup()]),
        factsWithoutOptionalDimensions,
      ).eligible,
    ).toBe(false);
  });

  it("matches only explicit stable division and programme IDs", () => {
    const factsWithoutDivision = omitFacts(validFacts(), ["academicDivision"]);
    const factsWithoutProgramme = omitFacts(validFacts(), ["programme"]);

    expect(evaluatePublicationAudience(definition([programmeGroup()]), factsWithoutDivision).eligible).toBe(true);
    expect(evaluatePublicationAudience(definition([divisionGroup()]), factsWithoutDivision).eligible).toBe(false);
    expect(evaluatePublicationAudience(definition([divisionGroup()]), factsWithoutProgramme).eligible).toBe(true);
    expect(evaluatePublicationAudience(definition([programmeGroup()]), factsWithoutProgramme).eligible).toBe(false);
    expect(
      isPublicationAudienceDefinition(
        {
          ...definition([], "targeted"),
          groups: [
            {
              dimension: "programme",
              provenancePolicy: "authoritative_only",
              programmeName: "Engineering",
            },
          ],
        },
      ),
    ).toBe(false);
  });

  it("matches numeric academic years exactly", () => {
    expect(evaluatePublicationAudience(definition([yearGroup([2, 3])]), validFacts()).eligible).toBe(true);
    expect(evaluatePublicationAudience(definition([yearGroup([3])]), validFacts()).eligible).toBe(false);
    expect(
      evaluatePublicationAudience(
        definition([yearGroup([999999])]),
        { ...validFacts(), academicYear: { value: 999999, provenance: "roster_derived" } },
      ).eligible,
    ).toBe(true);
  });

  it("implements specific, any-resident, non-resident, and unknown residence behavior", () => {
    const facts = validFacts();

    expect(evaluatePublicationAudience(definition([residenceGroup([{ kind: "specific_residence", residenceId }])]), facts).eligible).toBe(true);
    expect(evaluatePublicationAudience(definition([residenceGroup([{ kind: "specific_residence", residenceId: otherResidenceId }])]), facts).eligible).toBe(false);
    expect(evaluatePublicationAudience(definition([residenceGroup([{ kind: "any_resident" }])]), facts).eligible).toBe(true);

    const nonResidentFacts = {
      ...facts,
      residence: {
        state: "non_resident" as const,
        residenceId: null,
        provenance: "roster_derived" as const,
      },
    };
    expect(evaluatePublicationAudience(definition([residenceGroup([{ kind: "non_resident" }])]), nonResidentFacts).eligible).toBe(true);
    expect(evaluatePublicationAudience(definition([residenceGroup([{ kind: "any_resident" }])]), nonResidentFacts).eligible).toBe(false);

    const unknownFacts = {
      ...facts,
      residence: {
        state: "unknown" as const,
        residenceId: null,
        provenance: "optional" as const,
      },
    };
    expect(isMembershipAudienceFacts(unknownFacts)).toBe(true);
    for (const target of [
      { kind: "specific_residence" as const, residenceId },
      { kind: "any_resident" as const },
      { kind: "non_resident" as const },
    ]) {
      expect(evaluatePublicationAudience(definition([residenceGroup([target])]), unknownFacts).eligible).toBe(false);
    }
  });

  it("rejects an invalid resident fact instead of interpreting it as another state", () => {
    const malformedResident = {
      ...validFacts(),
      residence: {
        state: "resident" as const,
        residenceId: null,
        provenance: "roster_derived" as const,
      },
    };

    expect(isMembershipAudienceFacts(malformedResident)).toBe(false);
    expect(
      evaluatePublicationAudience(
        definition([residenceGroup([{ kind: "any_resident" }])]),
        malformedResident,
      ),
    ).toEqual({ evaluated: true, eligible: false });
  });
});
