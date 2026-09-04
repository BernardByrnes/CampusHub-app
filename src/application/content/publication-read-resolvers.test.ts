import { describe, expect, it, vi } from "vitest";

import type { Publication } from "@/domain/content/publication";
import type { ResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import {
  PersistedPublicationAudienceBatchResolver,
  PersistedPublicationAudienceResolver,
} from "./publication-read-resolvers";

const tenantId = "00000000-0000-4000-8000-000000000001";
const foreignTenantId = "00000000-0000-4000-8000-000000000002";
const publicationId = "00000000-0000-4000-8000-000000000011";
const membershipId = "00000000-0000-4000-8000-000000000021";
const foreignMembershipId = "00000000-0000-4000-8000-000000000022";
const campusId = "00000000-0000-4000-8000-000000000031";
const divisionId = "00000000-0000-4000-8000-000000000032";
const programmeId = "00000000-0000-4000-8000-000000000033";
const residenceId = "00000000-0000-4000-8000-000000000034";

const targetedPublication: Publication = {
  id: publicationId,
  tenantId,
  version: 1,
  type: "news",
  title: "Targeted publication",
  body: "Targeted publication body",
  priority: "standard",
  visibility: "PUBLIC",
  lifecycle: "published",
  audienceMode: "targeted",
  authorOfficeLabel: "Communications",
  publishAt: new Date("2026-01-10T12:00:00.000Z"),
  expiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const membershipViewer: Extract<
  ResourceReadViewer,
  { kind: "membership" }
> = {
  kind: "membership",
  context: {
    identitySubjectId: "identity-alpha",
    tenantId,
    tenantStatus: "active",
    membershipId,
    assuranceLevel: "L2",
    membershipStatus: "verified",
  },
};

const anonymousViewer: ResourceReadViewer = {
  kind: "anonymous",
  tenantId,
};

const facts = {
  membershipId,
  tenantId,
  campus: { value: campusId, provenance: "institution_verified" as const },
  academicDivision: {
    value: divisionId,
    provenance: "roster_derived" as const,
  },
  programme: { value: programmeId, provenance: "roster_derived" as const },
  academicYear: { value: 2, provenance: "institution_verified" as const },
  residence: {
    state: "resident" as const,
    residenceId,
    provenance: "roster_derived" as const,
  },
};

const definition = {
  tenantId,
  publicationId,
  mode: "targeted" as const,
  groups: [
    {
      dimension: "campus" as const,
      provenancePolicy: "authoritative_only" as const,
      campusIds: [campusId],
    },
    {
      dimension: "programme" as const,
      provenancePolicy: "authoritative_only" as const,
      programmeIds: [programmeId],
    },
    {
      dimension: "academic_year" as const,
      provenancePolicy: "authoritative_only" as const,
      academicYears: [2],
    },
    {
      dimension: "residence" as const,
      provenancePolicy: "authoritative_only" as const,
      residenceTargets: [{ kind: "specific_residence" as const, residenceId }],
    },
  ],
};

function createResolver(
  persistedDefinition: unknown = definition,
  persistedFacts: unknown = facts,
) {
  const definitionReader = vi.fn(async () => persistedDefinition);
  const factsReader = vi.fn(async () => persistedFacts);
  const resolver = new PersistedPublicationAudienceResolver({
    publications: {
      findPublicationAudienceDefinitionForTenant: definitionReader,
    },
    memberships: {
      findMembershipAudienceFactsByIdForTenant: factsReader,
    },
  });

  return { resolver, definitionReader, factsReader };
}

describe("PersistedPublicationAudienceResolver", () => {
  it("evaluates the persisted multi-dimension definition with current Membership facts", async () => {
    const { resolver, definitionReader, factsReader } = createResolver();

    await expect(
      resolver.resolveAudience({
        publication: targetedPublication,
        viewer: membershipViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: true });
    expect(definitionReader).toHaveBeenCalledWith(tenantId, publicationId);
    expect(factsReader).toHaveBeenCalledWith(tenantId, membershipId);
  });

  it.each([
    ["missing definition", null],
    ["malformed definition", { ...definition, groups: "not-groups" }],
    ["entire-Tenant definition", { ...definition, mode: "entire_tenant", groups: [] }],
  ] as const)("fails closed for %s", async (_label, persistedDefinition) => {
    const { resolver, factsReader } = createResolver(persistedDefinition);

    await expect(
      resolver.resolveAudience({
        publication: targetedPublication,
        viewer: membershipViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: false });
    expect(factsReader).not.toHaveBeenCalled();
  });

  it("does not load Membership facts for an anonymous targeted viewer", async () => {
    const { resolver, definitionReader, factsReader } = createResolver();

    await expect(
      resolver.resolveAudience({
        publication: targetedPublication,
        viewer: anonymousViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: false });
    expect(definitionReader).toHaveBeenCalledWith(tenantId, publicationId);
    expect(factsReader).not.toHaveBeenCalled();
  });

  it("fails closed for incomplete and foreign Membership facts without a global lookup", async () => {
    const incomplete = createResolver(definition, null);
    await expect(
      incomplete.resolver.resolveAudience({
        publication: targetedPublication,
        viewer: membershipViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: false });

    const foreignViewer: ResourceReadViewer = {
      kind: "membership",
      context: {
        ...membershipViewer.context,
        membershipId: foreignMembershipId,
      },
    };
    const foreign = createResolver(definition, null);
    await expect(
      foreign.resolver.resolveAudience({
        publication: targetedPublication,
        viewer: foreignViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: false });
    expect(foreign.factsReader).toHaveBeenCalledWith(
      tenantId,
      foreignMembershipId,
    );
  });

  it("stops before any persisted query for a cross-Tenant viewer", async () => {
    const { resolver, definitionReader, factsReader } = createResolver();
    const crossTenantViewer: ResourceReadViewer = {
      kind: "membership",
      context: {
        ...membershipViewer.context,
        tenantId: foreignTenantId,
      },
    };

    await expect(
      resolver.resolveAudience({
        publication: targetedPublication,
        viewer: crossTenantViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: false });
    expect(definitionReader).not.toHaveBeenCalled();
    expect(factsReader).not.toHaveBeenCalled();
  });

  it("uses canonical provenance and residence rules", async () => {
    const selfDeclaredFacts = {
      ...facts,
      programme: { value: programmeId, provenance: "self_declared" as const },
    };
    const authoritativeOnly = createResolver(definition, selfDeclaredFacts);
    await expect(
      authoritativeOnly.resolver.resolveAudience({
        publication: targetedPublication,
        viewer: membershipViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: false });

    const allowSelfDeclared = createResolver(
      {
        ...definition,
        groups: definition.groups.map((group) =>
          group.dimension === "programme"
            ? { ...group, provenancePolicy: "allow_self_declared" as const }
            : group,
        ),
      },
      selfDeclaredFacts,
    );
    await expect(
      allowSelfDeclared.resolver.resolveAudience({
        publication: targetedPublication,
        viewer: membershipViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: true });

    const anyResident = createResolver({
      ...definition,
      groups: definition.groups.map((group) =>
        group.dimension === "residence"
          ? {
              ...group,
              residenceTargets: [{ kind: "any_resident" as const }],
            }
          : group,
      ),
    });
    await expect(
      anyResident.resolver.resolveAudience({
        publication: targetedPublication,
        viewer: membershipViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: true });
  });

  it("never resolves an entire-Tenant Publication through persisted audience data", async () => {
    const { resolver, definitionReader, factsReader } = createResolver();
    const entireTenantPublication = {
      ...targetedPublication,
      audienceMode: "entire_tenant" as const,
    };

    await expect(
      resolver.resolveAudience({
        publication: entireTenantPublication,
        viewer: membershipViewer,
      }),
    ).resolves.toEqual({ evaluated: true, eligible: false });
    expect(definitionReader).not.toHaveBeenCalled();
    expect(factsReader).not.toHaveBeenCalled();
  });
});

describe("PersistedPublicationAudienceBatchResolver", () => {
  function secondPublication(): Publication {
    return {
      ...targetedPublication,
      id: "00000000-0000-4000-8000-000000000012",
      title: "Second targeted publication",
    };
  }

  function definitionFor(
    id: string,
    groups: typeof definition.groups = definition.groups,
  ) {
    return { ...definition, publicationId: id, groups };
  }

  function createBatchResolver(
    definitions: unknown = new Map([
      [publicationId, definition],
      [secondPublication().id, definitionFor(secondPublication().id)],
    ]),
    persistedFacts: unknown = facts,
  ) {
    const definitionReader = vi.fn(async () => definitions);
    const factsReader = vi.fn(async () => persistedFacts);
    const resolver = new PersistedPublicationAudienceBatchResolver({
      publications: {
        findPublicationAudienceDefinitionsForTenant: definitionReader,
      },
      memberships: {
        findMembershipAudienceFactsByIdForTenant: factsReader,
      },
    });

    return { resolver, definitionReader, factsReader };
  }

  it("resolves multiple targeted Publications through one definition and Membership batch", async () => {
    const { resolver, definitionReader, factsReader } = createBatchResolver();
    const second = secondPublication();

    await expect(
      resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication, second],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(
      new Map([
        [publicationId, { evaluated: true, eligible: true }],
        [second.id, { evaluated: true, eligible: true }],
      ]),
    );
    expect(definitionReader).toHaveBeenCalledTimes(1);
    expect(definitionReader).toHaveBeenCalledWith(tenantId, [
      publicationId,
      second.id,
    ]);
    expect(factsReader).toHaveBeenCalledTimes(1);
    expect(factsReader).toHaveBeenCalledWith(tenantId, membershipId);
  });

  it("keeps malformed and missing definitions ineligible without corrupting valid decisions", async () => {
    const second = secondPublication();
    const { resolver, factsReader } = createBatchResolver(
      new Map<string, unknown>([
        [publicationId, definition],
        [second.id, { ...definition, publicationId: second.id, groups: "bad" }],
      ]),
    );

    await expect(
      resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication, second],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(
      new Map([
        [publicationId, { evaluated: true, eligible: true }],
        [second.id, { evaluated: true, eligible: false }],
      ]),
    );
    expect(factsReader).toHaveBeenCalledTimes(1);

    const missing = createBatchResolver(new Map([[publicationId, definition]]));
    await expect(
      missing.resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication, second],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(
      new Map([
        [publicationId, { evaluated: true, eligible: true }],
        [second.id, { evaluated: true, eligible: false }],
      ]),
    );
  });

  it("uses the canonical evaluator for provenance and Residence behavior", async () => {
    const selfDeclaredFacts = {
      ...facts,
      programme: { value: programmeId, provenance: "self_declared" as const },
    };
    const authoritative = createBatchResolver(definition, selfDeclaredFacts);
    await expect(
      authoritative.resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(
      new Map([[publicationId, { evaluated: true, eligible: false }]]),
    );

    const allowSelfDeclaredDefinition = {
      ...definition,
      groups: definition.groups.map((group) =>
        group.dimension === "programme"
          ? { ...group, provenancePolicy: "allow_self_declared" as const }
          : group,
      ),
    };
    const allowSelfDeclared = createBatchResolver(
      new Map([[publicationId, allowSelfDeclaredDefinition]]),
      selfDeclaredFacts,
    );
    await expect(
      allowSelfDeclared.resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(
      new Map([[publicationId, { evaluated: true, eligible: true }]]),
    );

    const anyResidentDefinition = {
      ...definition,
      groups: definition.groups.map((group) =>
        group.dimension === "residence"
          ? { ...group, residenceTargets: [{ kind: "any_resident" as const }] }
          : group,
      ),
    };
    const anyResident = createBatchResolver(
      new Map([[publicationId, anyResidentDefinition]]),
    );
    await expect(
      anyResident.resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(
      new Map([[publicationId, { evaluated: true, eligible: true }]]),
    );
  });

  it("fails closed for missing or incomplete Membership facts", async () => {
    const missing = createBatchResolver(new Map([[publicationId, definition]]), null);
    await expect(
      missing.resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(
      new Map([[publicationId, { evaluated: true, eligible: false }]]),
    );

    const foreignFacts = createBatchResolver(new Map([[publicationId, definition]]), {
      ...facts,
      tenantId: foreignTenantId,
    });
    await expect(
      foreignFacts.resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(
      new Map([[publicationId, { evaluated: true, eligible: false }]]),
    );
  });

  it("does not query for anonymous, cross-Tenant, entire-Tenant, duplicate, or excessive input", async () => {
    const { resolver, definitionReader, factsReader } = createBatchResolver();
    const second = secondPublication();
    const foreignViewer: ResourceReadViewer = {
      kind: "membership",
      context: { ...membershipViewer.context, tenantId: foreignTenantId },
    };

    await expect(
      resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication],
        viewer: anonymousViewer,
      }),
    ).resolves.toEqual(
      new Map([[publicationId, { evaluated: true, eligible: false }]]),
    );
    await expect(
      resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication],
        viewer: foreignViewer,
      }),
    ).resolves.toEqual(new Map());
    await expect(
      resolver.resolveAudienceBatch({
        tenantId,
        publications: [{ ...targetedPublication, tenantId: foreignTenantId }],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(new Map());
    await expect(
      resolver.resolveAudienceBatch({
        tenantId,
        publications: [
          { ...targetedPublication, audienceMode: "entire_tenant" as const },
        ],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(new Map());
    await expect(
      resolver.resolveAudienceBatch({
        tenantId,
        publications: [targetedPublication, targetedPublication],
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(new Map());
    await expect(
      resolver.resolveAudienceBatch({
        tenantId,
        publications: Array.from({ length: 151 }, (_, index) => ({
          ...targetedPublication,
          id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
        })),
        viewer: membershipViewer,
      }),
    ).resolves.toEqual(new Map());
    expect(second.id).not.toBe(publicationId);
    expect(definitionReader).not.toHaveBeenCalled();
    expect(factsReader).not.toHaveBeenCalled();
  });
});
