import { getTableConfig } from "drizzle-orm/pg-core";
import { expect, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: {} }));

import { validateRequestContext } from "@/domain/authorization/context-policy";
import type { ResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import type { ResolvedTenantReadFacts } from "@/domain/authorization/publication-read-contract";
import type { Publication } from "@/domain/content/publication";
import { CreatePublicationService } from "@/application/content/create-publication";
import { ListPublicationsService } from "@/application/content/list-publications";
import { ReadPublicationService } from "@/application/content/read-publication";
import { RequestContextService } from "@/application/context/resolve-request-context";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { CampusHubDatabase } from "@/server/db/client";
import {
  academicDivisions,
  campuses,
  memberships,
  publicationAudienceCriteria,
  programmes,
  publications,
  residences,
  tenantAcademicYearConfig,
  tenants,
  type MembershipRow,
} from "@/server/db/schema";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import { DrizzlePublicationRepository } from "@/server/repositories/publication-repository";
import type { CreatePublicationInput } from "@/server/repositories/publication-repository";

const tenantAId = "00000000-0000-4000-8000-000000000001";
const tenantBId = "00000000-0000-4000-8000-000000000002";
const membershipAId = "00000000-0000-4000-8000-000000000011";
const membershipBId = "00000000-0000-4000-8000-000000000012";
const publicationId = "00000000-0000-4000-8000-000000000021";
const foreignPublicationId = "00000000-0000-4000-8000-000000000022";
const now = new Date("2026-01-15T12:00:00.000Z");

const tenantA = {
  id: tenantAId,
  slug: "tenant-a",
  displayName: "Tenant A",
  status: "active" as const,
  timezone: "Africa/Kampala",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const tenantB = { ...tenantA, id: tenantBId, slug: "tenant-b" };
const membershipA = {
  id: membershipAId,
  tenantId: tenantAId,
  identitySubjectId: "same-identity",
  assuranceLevel: "L2" as const,
  lifecycle: "verified" as const,
  createdAt: tenantA.createdAt,
  updatedAt: tenantA.updatedAt,
};
const membershipB = { ...membershipA, id: membershipBId, tenantId: tenantBId };

const tenantFactsA: ResolvedTenantReadFacts = {
  tenantId: tenantAId,
  tenantStatus: "active",
  publicSurfacePermitted: true,
  onLeaveReadEnabled: true,
  alumniPublicReadEnabled: true,
};
const anonymousViewerA: ResourceReadViewer = {
  kind: "anonymous",
  tenantId: tenantAId,
};
const publicationA: Publication = {
  id: publicationId,
  tenantId: tenantAId,
  type: "news",
  title: "Tenant A publication",
  body: "Tenant A body",
  priority: "standard",
  visibility: "PUBLIC",
  lifecycle: "published",
  audienceMode: "entire_tenant",
  authorOfficeLabel: "Communications",
  publishAt: new Date("2026-01-10T12:00:00.000Z"),
  expiresAt: null,
  createdAt: tenantA.createdAt,
  updatedAt: tenantA.updatedAt,
};

function expectTenantOwnedTable(table: unknown): void {
  const config = getTableConfig(table as never);
  const columns = Object.values(config.columns) as Array<{ name: string }>;
  expect(columns.map((column) => column.name)).toContain("tenant_id");
  expect(config.foreignKeys.length).toBeGreaterThan(0);
}

function expectForeignKey(
  table: unknown,
  localColumns: readonly string[],
  foreignColumns: readonly string[],
): void {
  const config = getTableConfig(table as never);
  const found = config.foreignKeys.some((foreignKey) => {
    const reference = foreignKey.reference();
    return (
      reference.columns.map((column) => column.name).join(",") ===
        localColumns.join(",") &&
      reference.foreignColumns.map((column) => column.name).join(",") ===
        foreignColumns.join(",") &&
      foreignKey.onDelete === "restrict" &&
      foreignKey.onUpdate === "cascade"
    );
  });

  expect(found).toBe(true);
}

function expectTenantCompositeIdentity(table: unknown): void {
  const config = getTableConfig(table as never);
  const uniqueConstraintNames = config.uniqueConstraints.map(
    (constraint) => constraint.name,
  );
  expect(uniqueConstraintNames).toContain(`${config.name}_tenant_id_id_unique`);
  expectForeignKey(table, ["tenant_id"], ["id"]);
}

async function membershipContextProbe(): Promise<void> {
  const service = new RequestContextService({
    tenants: {
      findTenantById: async (id) => (id === tenantAId ? tenantA : tenantB),
      findTenantBySlug: async (slug) => (slug === tenantA.slug ? tenantA : tenantB),
    },
    memberships: {
      findMembershipByIdForTenant: async () => null,
      findMembershipForIdentityAndTenant: async (_identity, tenantId) =>
        tenantId === tenantAId ? membershipA : membershipB,
    },
  });

  const contextA = await service.resolveRequestContext(
    { identitySubjectId: "same-identity" },
    { tenantId: tenantAId },
  );
  const contextB = await service.resolveRequestContext(
    { identitySubjectId: "same-identity" },
    { tenantId: tenantBId },
  );

  expect(contextA).toMatchObject({
    resolved: true,
    context: { tenantId: tenantAId, membershipId: membershipAId },
  });
  expect(contextB).toMatchObject({
    resolved: true,
    context: { tenantId: tenantBId, membershipId: membershipBId },
  });
  expect(
    validateRequestContext({
      identitySubjectId: "same-identity",
      tenant: tenantB,
      membership: membershipA,
    }),
  ).toEqual({ resolved: false, code: "CONTEXT_MISMATCH" });
}

async function membershipIdProbe(): Promise<void> {
  const database = {
    select: () => {
      throw new Error("malformed Membership UUID reached SQL");
    },
  } as unknown as CampusHubDatabase;
  const repository = new DrizzleMembershipRepository(database);

  await expect(
    repository.findMembershipByIdForTenant("banana", membershipAId),
  ).resolves.toBeNull();
  await expect(
    repository.findMembershipByIdForTenant(tenantAId, "banana"),
  ).resolves.toBeNull();
}

function audienceFactsRow(): Pick<
  MembershipRow,
  | "id"
  | "tenantId"
  | "campusId"
  | "campusProvenance"
  | "academicDivisionId"
  | "academicDivisionProvenance"
  | "programmeId"
  | "programmeProvenance"
  | "academicYear"
  | "academicYearProvenance"
  | "residenceState"
  | "residenceId"
  | "residenceProvenance"
> {
  return {
    id: membershipAId,
    tenantId: tenantAId,
    campusId: "00000000-0000-4000-8000-000000000031",
    campusProvenance: "self_declared",
    academicDivisionId: "00000000-0000-4000-8000-000000000032",
    academicDivisionProvenance: "roster_derived",
    programmeId: "00000000-0000-4000-8000-000000000033",
    programmeProvenance: "self_declared",
    academicYear: 2,
    academicYearProvenance: "institution_verified",
    residenceState: "non_resident",
    residenceId: null,
    residenceProvenance: "roster_derived",
  };
}

function audienceFactsDatabase(
  rows: readonly Record<string, unknown>[],
): CampusHubDatabase {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => rows,
        }),
      }),
    }),
  } as unknown as CampusHubDatabase;
}

async function membershipAudienceFactsProbe(): Promise<void> {
  const malformedDatabase = {
    select: () => {
      throw new Error("malformed audience-facts UUID reached SQL");
    },
  } as unknown as CampusHubDatabase;
  const malformedRepository = new DrizzleMembershipRepository(
    malformedDatabase,
  );

  await expect(
    malformedRepository.findMembershipAudienceFactsByIdForTenant(
      "banana",
      membershipAId,
    ),
  ).resolves.toBeNull();
  await expect(
    malformedRepository.findMembershipAudienceFactsByIdForTenant(
      tenantAId,
      "banana",
    ),
  ).resolves.toBeNull();

  const repository = new DrizzleMembershipRepository(
    audienceFactsDatabase([audienceFactsRow()]),
  );
  await expect(
    repository.findMembershipAudienceFactsByIdForTenant(
      tenantAId,
      membershipAId,
    ),
  ).resolves.toMatchObject({
    membershipId: membershipAId,
    tenantId: tenantAId,
    campus: { provenance: "self_declared" },
  });

  const missingCampusRepository = new DrizzleMembershipRepository(
    audienceFactsDatabase([
      { ...audienceFactsRow(), campusId: null, campusProvenance: null },
    ]),
  );
  await expect(
    missingCampusRepository.findMembershipAudienceFactsByIdForTenant(
      tenantAId,
      membershipAId,
    ),
  ).resolves.toBeNull();

  const foreignOrMissingRepository = new DrizzleMembershipRepository(
    audienceFactsDatabase([]),
  );
  await expect(
    foreignOrMissingRepository.findMembershipAudienceFactsByIdForTenant(
      tenantAId,
      membershipBId,
    ),
  ).resolves.toBeNull();
}

function membershipPersistenceProbe(): void {
  expectTenantOwnedTable(memberships);
  expectForeignKey(memberships, ["tenant_id", "campus_id"], ["tenant_id", "id"]);
  expectForeignKey(
    memberships,
    ["tenant_id", "academic_division_id"],
    ["tenant_id", "id"],
  );
  expectForeignKey(
    memberships,
    ["tenant_id", "programme_id", "academic_division_id"],
    ["tenant_id", "id", "academic_division_id"],
  );
  expectForeignKey(
    memberships,
    ["tenant_id", "residence_id"],
    ["tenant_id", "id"],
  );
}

function publicationAudienceCriteriaPersistenceProbe(): void {
  expectTenantOwnedTable(publicationAudienceCriteria);
  expectForeignKey(
    publicationAudienceCriteria,
    ["tenant_id", "publication_id"],
    ["tenant_id", "id"],
  );
  expectForeignKey(
    publicationAudienceCriteria,
    ["tenant_id", "campus_id"],
    ["tenant_id", "id"],
  );
  expectForeignKey(
    publicationAudienceCriteria,
    ["tenant_id", "academic_division_id"],
    ["tenant_id", "id"],
  );
  expectForeignKey(
    publicationAudienceCriteria,
    ["tenant_id", "programme_id"],
    ["tenant_id", "id"],
  );
  expectForeignKey(
    publicationAudienceCriteria,
    ["tenant_id", "residence_id"],
    ["tenant_id", "id"],
  );

  const config = getTableConfig(publicationAudienceCriteria);
  expect(config.checks.map((constraint) => constraint.name)).toContain(
    "publication_audience_criteria_payload_shape",
  );
  expect(config.indexes.map((index) => index.config.name)).toEqual(
    expect.arrayContaining([
      "publication_audience_criteria_campus_unique",
      "publication_audience_criteria_division_unique",
      "publication_audience_criteria_programme_unique",
      "publication_audience_criteria_academic_year_unique",
      "publication_audience_criteria_specific_residence_unique",
      "publication_audience_criteria_residence_target_unique",
    ]),
  );
}

function publicationAudienceNoSqlDatabase(): CampusHubDatabase {
  return {
    select: () => {
      throw new Error("invalid audience repository input reached SQL");
    },
    transaction: () => {
      throw new Error("invalid audience repository input reached transaction");
    },
  } as unknown as CampusHubDatabase;
}

async function publicationAudienceDefinitionProbe(): Promise<void> {
  const repository = new DrizzlePublicationRepository(
    publicationAudienceNoSqlDatabase(),
  );

  await expect(
    repository.findPublicationAudienceDefinitionForTenant(
      "banana",
      publicationId,
    ),
  ).resolves.toBeNull();
  await expect(
    repository.findPublicationAudienceDefinitionForTenant(
      tenantAId,
      "banana",
    ),
  ).resolves.toBeNull();

  const emptyDatabase = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  } as unknown as CampusHubDatabase;
  const foreignPublicationRepository = new DrizzlePublicationRepository(
    emptyDatabase,
  );
  await expect(
    foreignPublicationRepository.findPublicationAudienceDefinitionForTenant(
      tenantAId,
      foreignPublicationId,
    ),
  ).resolves.toBeNull();
}

async function publicationAudienceReplacementProbe(): Promise<void> {
  const repository = new DrizzlePublicationRepository(
    publicationAudienceNoSqlDatabase(),
  );
  const definition = {
    tenantId: tenantAId,
    publicationId,
    mode: "entire_tenant" as const,
    groups: [],
  };

  await expect(
    repository.replaceDraftPublicationAudienceForTenant(
      "banana",
      publicationId,
      definition,
    ),
  ).resolves.toBeNull();
  await expect(
    repository.replaceDraftPublicationAudienceForTenant(
      tenantAId,
      "banana",
      definition,
    ),
  ).resolves.toBeNull();

  const emptyTransactionDatabase = {
    transaction: async (
      callback: (transaction: CampusHubDatabase) => Promise<unknown>,
    ) =>
      callback({
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({ limit: async () => [] }),
            }),
          }),
        }),
      } as unknown as CampusHubDatabase),
  } as unknown as CampusHubDatabase;
  const foreignPublicationRepository = new DrizzlePublicationRepository(
    emptyTransactionDatabase,
  );
  await expect(
    foreignPublicationRepository.replaceDraftPublicationAudienceForTenant(
      tenantAId,
      foreignPublicationId,
      { ...definition, publicationId: foreignPublicationId },
    ),
  ).resolves.toBeNull();
}

async function publicationDirectProbe(): Promise<void> {
  const draft = { ...publicationA, lifecycle: "draft" as const };
  const service = new ReadPublicationService({
    publications: {
      findPublicationByIdForTenant: async (_tenantId, id) =>
        id === publicationId ? draft : null,
    },
    exposureResolver: {
      resolveExposure: (candidates) =>
        new Map(candidates.map((candidate) => [candidate.id, "READABLE" as const])),
    },
  });
  const input = (id: string) => ({
    tenantId: tenantAId,
    publicationId: id,
    viewer: anonymousViewerA,
    tenantFacts: tenantFactsA,
    now,
  });

  const hidden = await service.getPublicationForRead(input(publicationId));
  const nonexistent = await service.getPublicationForRead(
    input(foreignPublicationId),
  );
  expect(hidden).toEqual({ outcome: "NOT_FOUND" });
  expect(hidden).toEqual(nonexistent);
}

async function publicationCollectionProbe(): Promise<void> {
  const foreign = { ...publicationA, id: foreignPublicationId, tenantId: tenantBId };
  let observedTenantId: string | undefined;
  const service = new ListPublicationsService({
    publications: {
      listPublicationCandidatesForTenant: async (query) => {
        observedTenantId = query.tenantId;
        return { items: [foreign], hasMoreCandidateRows: false };
      },
    },
    exposureResolver: {
      resolveExposure: (candidates) =>
        new Map(candidates.map((candidate) => [candidate.id, "READABLE" as const])),
    },
  });

  const result = await service.listPublications({
    tenantId: tenantAId,
    surface: "ACTIVE",
    viewer: anonymousViewerA,
    tenantFacts: tenantFactsA,
    now,
    limit: 1,
  });
  expect(result).toEqual({ outcome: "OK", items: [], nextCursor: null });
  expect(observedTenantId).toBe(tenantAId);
}

async function publicationCreateProbe(): Promise<void> {
  const calls: Array<{ tenantId: string; input: CreatePublicationInput }> = [];
  const service = new CreatePublicationService({
    publications: {
      createPublication: async (tenantId, input) => {
        calls.push({ tenantId, input });
        return publicationA;
      },
    },
  });
  const trustedContext: TrustedRequestContext = {
    identitySubjectId: "same-identity",
    tenantId: tenantAId,
    tenantStatus: "active",
    membershipId: membershipAId,
    assuranceLevel: "L2",
    membershipStatus: "verified",
  };
  const publicationInput: CreatePublicationInput = {
    type: "news",
    title: "Tenant A create probe",
    body: "Tenant A create probe body",
    audienceMode: "entire_tenant",
    authorOfficeLabel: "Communications",
  };

  await expect(
    service.createPublication({
      trustedContext,
      requestedTenantId: tenantBId,
      publication: publicationInput,
    }),
  ).resolves.toEqual({
    outcome: "DENIED",
    code: "TENANT_SCOPE_NOT_FOUND",
  });
  await expect(
    service.createPublication({
      trustedContext,
      requestedTenantId: "banana",
      publication: publicationInput,
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  expect(calls).toHaveLength(0);

  await expect(
    service.createPublication({
      trustedContext,
      requestedTenantId: tenantAId,
      publication: publicationInput,
    }),
  ).resolves.toEqual({ outcome: "CREATED", publication: publicationA });
  expect(calls).toEqual([
    { tenantId: tenantAId, input: publicationInput },
  ]);
}

export type TenantIsolationProbe = () => void | Promise<void>;

export const tenantIsolationProbeRegistry: Readonly<
  Record<string, TenantIsolationProbe>
> = {
  "tenant.root.contract": () => {
    expect(getTableConfig(tenants).name).toBe("tenants");
  },
  "membership.persistence": membershipPersistenceProbe,
  "membership.context": membershipContextProbe,
  "membership.identity-tenant": membershipContextProbe,
  "membership.id-tenant": membershipIdProbe,
  "membership.audience-facts": membershipAudienceFactsProbe,
  "publication.persistence": () => {
    expectTenantOwnedTable(publications);
    expectTenantCompositeIdentity(publications);
  },
  "publication-audience-criteria.persistence":
    publicationAudienceCriteriaPersistenceProbe,
  "campus.persistence": () => {
    expectTenantOwnedTable(campuses);
    expectTenantCompositeIdentity(campuses);
  },
  "academic-division.persistence": () => {
    expectTenantOwnedTable(academicDivisions);
    expectTenantCompositeIdentity(academicDivisions);
    expectForeignKey(
      academicDivisions,
      ["tenant_id", "parent_academic_division_id"],
      ["tenant_id", "id"],
    );
    expectForeignKey(
      academicDivisions,
      ["tenant_id", "merged_into_academic_division_id"],
      ["tenant_id", "id"],
    );
  },
  "programme.persistence": () => {
    expectTenantOwnedTable(programmes);
    expectTenantCompositeIdentity(programmes);
    expectForeignKey(
      programmes,
      ["tenant_id", "academic_division_id"],
      ["tenant_id", "id"],
    );
    expectForeignKey(
      programmes,
      ["tenant_id", "merged_into_programme_id"],
      ["tenant_id", "id"],
    );
  },
  "residence.persistence": () => {
    expectTenantOwnedTable(residences);
    expectTenantCompositeIdentity(residences);
  },
  "tenant-academic-year-config.persistence": () => {
    expectTenantOwnedTable(tenantAcademicYearConfig);
    const config = getTableConfig(tenantAcademicYearConfig);
    expect(
      config.columns.find((column) => column.name === "tenant_id")?.primary,
    ).toBe(true);
    expectForeignKey(tenantAcademicYearConfig, ["tenant_id"], ["id"]);
  },
  "publication.direct": publicationDirectProbe,
  "publication.collection": publicationCollectionProbe,
  "publication.create": publicationCreateProbe,
  "publication.audience-definition": publicationAudienceDefinitionProbe,
  "publication.audience-replacement": publicationAudienceReplacementProbe,
};
