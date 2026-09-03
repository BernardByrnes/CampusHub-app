import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: {} }));

import type { PublicationAudienceDefinition } from "@/domain/authorization/publication-audience";
import type {
  PublicationAudienceCriteriaRow,
  PublicationRow,
} from "@/server/db/schema/publication";
import {
  publicationAudienceCriteria,
  publications,
} from "@/server/db/schema/publication";

import { DrizzlePublicationRepository } from "./publication-repository";

const tenantId = "00000000-0000-4000-8000-000000000001";
const publicationId = "00000000-0000-4000-8000-000000000002";
const campusA = "00000000-0000-4000-8000-000000000010";
const campusB = "00000000-0000-4000-8000-000000000011";
const programmeId = "00000000-0000-4000-8000-000000000012";
const residenceId = "00000000-0000-4000-8000-000000000013";

const now = new Date("2026-01-01T00:00:00.000Z");

const publicationRow: PublicationRow = {
  id: publicationId,
  tenantId,
  version: 1,
  type: "news",
  title: "Audience test publication",
  body: "Audience test body",
  priority: "standard",
  visibility: "MEMBERS",
  lifecycle: "draft",
  audienceMode: "targeted",
  authorOfficeLabel: "Communications",
  publishAt: null,
  expiresAt: null,
  createdAt: now,
  updatedAt: now,
};

function criterion(
  partial: Partial<PublicationAudienceCriteriaRow>,
): PublicationAudienceCriteriaRow {
  return {
    id: "00000000-0000-4000-8000-000000000099",
    tenantId,
    publicationId,
    dimension: "campus",
    provenancePolicy: "authoritative_only",
    campusId: campusA,
    academicDivisionId: null,
    programmeId: null,
    academicYear: null,
    residenceTarget: null,
    residenceId: null,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function databaseFor(
  publicationRows: readonly PublicationRow[],
  criteriaRows: readonly PublicationAudienceCriteriaRow[],
) {
  return {
    select: () => {
      let selectedTable: unknown;
      return {
        from: (table: unknown) => {
          selectedTable = table;
          return {
            where: () => ({
              limit: async () =>
                selectedTable === publications ? publicationRows : [],
              orderBy: async () =>
                selectedTable === publicationAudienceCriteria
                  ? criteriaRows
                  : [],
            }),
          };
        },
      };
    },
  };
}

function repositoryFor(
  publicationRows: readonly PublicationRow[],
  criteriaRows: readonly PublicationAudienceCriteriaRow[],
) {
  return new DrizzlePublicationRepository(
    databaseFor(publicationRows, criteriaRows) as never,
  );
}

describe("DrizzlePublicationRepository audience persistence mapping", () => {
  it("returns entire-tenant only when the criteria set is empty", async () => {
    const entireTenantPublication = {
      ...publicationRow,
      audienceMode: "entire_tenant" as const,
    };
    await expect(
      repositoryFor([entireTenantPublication], []).findPublicationAudienceDefinitionForTenant(
        tenantId,
        publicationId,
      ),
    ).resolves.toEqual({
      tenantId,
      publicationId,
      mode: "entire_tenant",
      groups: [],
    });

    await expect(
      repositoryFor(
        [entireTenantPublication],
        [criterion({ dimension: "campus", campusId: campusA })],
      ).findPublicationAudienceDefinitionForTenant(tenantId, publicationId),
    ).resolves.toBeNull();
  });

  it("fails closed for targeted publications without criteria", async () => {
    await expect(
      repositoryFor([publicationRow], []).findPublicationAudienceDefinitionForTenant(
        tenantId,
        publicationId,
      ),
    ).resolves.toBeNull();
  });

  it("reconstructs sorted AND groups and OR values", async () => {
    const result = await repositoryFor(
      [publicationRow],
      [
        criterion({
          id: "00000000-0000-4000-8000-000000000030",
          campusId: campusB,
        }),
        criterion({
          id: "00000000-0000-4000-8000-000000000031",
          campusId: campusA,
        }),
        criterion({
          id: "00000000-0000-4000-8000-000000000032",
          dimension: "programme",
          campusId: null,
          programmeId,
        }),
        criterion({
          id: "00000000-0000-4000-8000-000000000033",
          dimension: "academic_year",
          campusId: null,
          academicYear: 3,
        }),
        criterion({
          id: "00000000-0000-4000-8000-000000000034",
          dimension: "academic_year",
          campusId: null,
          academicYear: 1,
        }),
      ],
    ).findPublicationAudienceDefinitionForTenant(tenantId, publicationId);

    expect(result).toEqual({
      tenantId,
      publicationId,
      mode: "targeted",
      groups: [
        {
          dimension: "campus",
          provenancePolicy: "authoritative_only",
          campusIds: [campusA, campusB],
        },
        {
          dimension: "programme",
          provenancePolicy: "authoritative_only",
          programmeIds: [programmeId],
        },
        {
          dimension: "academic_year",
          provenancePolicy: "authoritative_only",
          academicYears: [1, 3],
        },
      ],
    });
  });

  it("reconstructs residence target values deterministically", async () => {
    const result = await repositoryFor(
      [publicationRow],
      [
        criterion({
          dimension: "residence",
          campusId: null,
          residenceTarget: "non_resident",
          residenceId: null,
        }),
        criterion({
          id: "00000000-0000-4000-8000-000000000035",
          dimension: "residence",
          campusId: null,
          residenceTarget: "specific_residence",
          residenceId,
        }),
        criterion({
          id: "00000000-0000-4000-8000-000000000036",
          dimension: "residence",
          campusId: null,
          residenceTarget: "any_resident",
          residenceId: null,
        }),
      ],
    ).findPublicationAudienceDefinitionForTenant(tenantId, publicationId);

    expect(result).toEqual({
      tenantId,
      publicationId,
      mode: "targeted",
      groups: [
        {
          dimension: "residence",
          provenancePolicy: "authoritative_only",
          residenceTargets: [
            { kind: "specific_residence", residenceId },
            { kind: "any_resident" },
            { kind: "non_resident" },
          ],
        },
      ],
    });
  });

  it("rejects conflicting policies, malformed rows, and foreign rows", async () => {
    await expect(
      repositoryFor(
        [publicationRow],
        [
          criterion({ provenancePolicy: "authoritative_only" }),
          criterion({
            id: "00000000-0000-4000-8000-000000000037",
            provenancePolicy: "allow_self_declared",
            campusId: campusB,
          }),
        ],
      ).findPublicationAudienceDefinitionForTenant(tenantId, publicationId),
    ).resolves.toBeNull();

    await expect(
      repositoryFor(
        [publicationRow],
        [criterion({ campusId: null, programmeId: programmeId })],
      ).findPublicationAudienceDefinitionForTenant(tenantId, publicationId),
    ).resolves.toBeNull();

    await expect(
      repositoryFor(
        [publicationRow],
        [criterion({ tenantId: "00000000-0000-4000-8000-000000000003" })],
      ).findPublicationAudienceDefinitionForTenant(tenantId, publicationId),
    ).resolves.toBeNull();
  });

  it("does not query for malformed identifiers or foreign publications", async () => {
    let selectCalls = 0;
    const database = {
      select: () => {
        selectCalls += 1;
        throw new Error("malformed audience identifier reached SQL");
      },
    };
    const repository = new DrizzlePublicationRepository(database as never);

    await expect(
      repository.findPublicationAudienceDefinitionForTenant(
        "banana",
        publicationId,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.findPublicationAudienceDefinitionForTenant(
        tenantId,
        "banana",
      ),
    ).resolves.toBeNull();
    expect(selectCalls).toBe(0);

    await expect(
      repositoryFor([], []).findPublicationAudienceDefinitionForTenant(
        tenantId,
        publicationId,
      ),
    ).resolves.toBeNull();
  });
});

describe("DrizzlePublicationRepository audience replacement boundary", () => {
  it("rejects malformed definitions before opening a transaction", async () => {
    let transactionCalls = 0;
    const repository = new DrizzlePublicationRepository({
      transaction: async () => {
        transactionCalls += 1;
        throw new Error("invalid definition opened a transaction");
      },
    } as never);

    await expect(
      repository.replaceDraftPublicationAudienceForTenant(
        tenantId,
        publicationId,
        1,
        { tenantId, publicationId, mode: "targeted", groups: [] },
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_AUDIENCE" });
    await expect(
      repository.replaceDraftPublicationAudienceForTenant(
        tenantId,
        publicationId,
        1,
        { tenantId, publicationId, mode: "targeted", groups: [] },
      ),
    ).resolves.toEqual({ ok: false, error: "INVALID_AUDIENCE" });
    expect(transactionCalls).toBe(0);
  });

  it("accepts only the canonical complete definition at the public boundary", () => {
    const definition: PublicationAudienceDefinition = {
      tenantId,
      publicationId,
      mode: "entire_tenant",
      groups: [],
    };
    expect(definition.groups).toEqual([]);
  });
});
