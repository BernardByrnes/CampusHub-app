import { getTableConfig } from "drizzle-orm/pg-core";
import { expect, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: {} }));

import { validateRequestContext } from "@/domain/authorization/context-policy";
import {
  PersistedPublicationAudienceBatchResolver,
  PersistedPublicationAudienceResolver,
} from "@/application/content/publication-read-resolvers";
import type { ResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import type { ResolvedTenantReadFacts } from "@/domain/authorization/publication-read-contract";
import type { Publication } from "@/domain/content/publication";
import type { CreatePublicationDraftInput } from "@/domain/content/publication-draft";
import type { UpdatePublicationDraftInput } from "@/domain/content/publication-draft-edit";
import type { PublishPublicationInput } from "@/domain/content/publication-publish";
import { CreatePublicationService } from "@/application/content/create-publication";
import { CampusHomeService } from "@/application/content/campus-home";
import { EditPublicationDraftService } from "@/application/content/edit-publication-draft";
import { PublishPublicationService } from "@/application/content/publish-publication";
import { ListPublicationsService } from "@/application/content/list-publications";
import { ReadPublicationService } from "@/application/content/read-publication";
import { SportsManagementService } from "@/application/sports/manage-sports";
import { FixtureManagementService } from "@/application/sports/manage-fixtures";
import { ListFixturesService } from "@/application/sports/list-fixtures";
import { ListResultsService } from "@/application/sports/list-results";
import { ResultManagementService } from "@/application/sports/manage-results";
import {
  getPublicationAudienceReadinessForTenant,
  validatePublicationAudienceConfirmationForTenant,
} from "@/application/content/publication-audience-readiness";
import { validatePublicationAudienceConfirmation } from "@/domain/authorization/publication-audience-confirmation";
import { RequestContextService } from "@/application/context/resolve-request-context";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import type { CampusHubDatabase } from "@/server/db/client";
import {
  academicDivisions,
  auditEvents,
  campuses,
  guildTerms,
  memberships,
  publicationAudienceCriteria,
  programmes,
  publications,
  residences,
  roleGrants,
  competitions,
  fixtures,
  resultRevisions,
  results,
  sports,
  teams,
  tenantAcademicYearConfig,
  tenants,
  type MembershipRow,
} from "@/server/db/schema";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import { DrizzlePublicationRepository } from "@/server/repositories/publication-repository";
import { DrizzleGuildTermRepository } from "@/server/repositories/guild-term-repository";
import { DrizzleRoleGrantRepository } from "@/server/repositories/role-grant-repository";
import { PostgresCapabilityAuthorizer } from "@/server/authorization/postgres-capability-authorizer";
import { PostgresAuthorizedSportsManagementExecutor } from "@/server/authorization/postgres-authorized-sports";

const tenantAId = "00000000-0000-4000-8000-000000000001";
const tenantBId = "00000000-0000-4000-8000-000000000002";
const membershipAId = "00000000-0000-4000-8000-000000000011";
const membershipBId = "00000000-0000-4000-8000-000000000012";
const termId = "00000000-0000-4000-8000-000000000013";
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
  version: 1,
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
const publicationDraftA: Publication = {
  ...publicationA,
  lifecycle: "draft",
  publishAt: null,
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

function auditPersistenceProbe(): void {
  expectTenantOwnedTable(auditEvents);
  expectForeignKey(auditEvents, ["tenant_id"], ["id"]);
  expectForeignKey(
    auditEvents,
    ["tenant_id", "actor_membership_id"],
    ["tenant_id", "id"],
  );

  const config = getTableConfig(auditEvents);
  expect(Object.values(config.columns).map((column) => column.name)).toEqual(
    expect.arrayContaining([
      "id",
      "tenant_id",
      "sequence",
      "event_type",
      "actor_membership_id",
      "resource_type",
      "resource_id",
      "resource_version",
      "occurred_at",
      "event_facts",
      "previous_hash",
      "current_hash",
      "key_version",
      "integrity_format_version",
      "event_contract_version",
    ]),
  );
  expect(config.uniqueConstraints.map((constraint) => constraint.name)).toContain(
    "audit_events_tenant_sequence_unique",
  );
  expect(config.indexes.map((index) => index.config.name)).toEqual(
    expect.arrayContaining([
      "audit_events_tenant_resource",
      "audit_events_tenant_event_type",
    ]),
  );
  expect(config.checks.map((constraint) => constraint.name)).toEqual(
    expect.arrayContaining([
      "audit_events_sequence_positive",
      "audit_events_event_type_closed",
      "audit_events_resource_type_closed",
      "audit_events_resource_version_positive",
      "audit_events_event_facts_object",
      "audit_events_hash_shape",
      "audit_events_key_version_positive",
      "audit_events_integrity_format_supported",
      "audit_events_event_contract_supported",
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

async function publicationAudienceDefinitionBatchProbe(): Promise<void> {
  let selectCalls = 0;
  const database = {
    select: () => {
      selectCalls += 1;
      throw new Error("invalid batch audience input reached SQL");
    },
  } as unknown as CampusHubDatabase;
  const repository = new DrizzlePublicationRepository(database);

  await expect(
    repository.findPublicationAudienceDefinitionsForTenant(
      "banana",
      [publicationId],
    ),
  ).resolves.toEqual(new Map());
  await expect(
    repository.findPublicationAudienceDefinitionsForTenant(
      tenantAId,
      ["banana"],
    ),
  ).resolves.toEqual(new Map());
  await expect(
    repository.findPublicationAudienceDefinitionsForTenant(
      tenantAId,
      [publicationId, publicationId],
    ),
  ).resolves.toEqual(new Map());
  await expect(
    repository.findPublicationAudienceDefinitionsForTenant(tenantAId, []),
  ).resolves.toEqual(new Map());
  expect(selectCalls).toBe(0);
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
      1,
      definition,
    ),
  ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  await expect(
    repository.replaceDraftPublicationAudienceForTenant(
      tenantAId,
      "banana",
      1,
      definition,
    ),
  ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });

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
      1,
      { ...definition, publicationId: foreignPublicationId },
    ),
  ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
}

async function publicationAudienceTargetValidityProbe(): Promise<void> {
  const repository = new DrizzlePublicationRepository(
    publicationAudienceNoSqlDatabase(),
  );
  const entireDefinition = {
    tenantId: tenantAId,
    publicationId,
    mode: "entire_tenant" as const,
    groups: [],
  };

  await expect(
    repository.arePublicationAudienceTargetsCurrentlyValidForTenant(
      tenantAId,
      entireDefinition,
    ),
  ).resolves.toBe(true);
  await expect(
    repository.arePublicationAudienceTargetsCurrentlyValidForTenant(
      tenantBId,
      entireDefinition,
    ),
  ).resolves.toBe(false);
  await expect(
    repository.arePublicationAudienceTargetsCurrentlyValidForTenant(
      tenantAId,
      "banana",
    ),
  ).resolves.toBe(false);
}

async function publicationAudienceCountProbe(): Promise<void> {
  let selectCalls = 0;
  const emptyDatabase = {
    select: () => {
      selectCalls += 1;
      return {
        from: () => ({
          where: () => ({ limit: async () => [] }),
        }),
      };
    },
  } as unknown as CampusHubDatabase;
  const repository = new DrizzlePublicationRepository(emptyDatabase);

  await expect(
    repository.countPublicationAudienceMembershipsForTenant(
      "banana",
      publicationId,
    ),
  ).resolves.toBeNull();
  await expect(
    repository.countPublicationAudienceMembershipsForTenant(
      tenantAId,
      "banana",
    ),
  ).resolves.toBeNull();
  await expect(
    repository.countPublicationAudienceMembershipsForTenant(
      tenantAId,
      foreignPublicationId,
    ),
  ).resolves.toBeNull();
  expect(selectCalls).toBe(1);
}

async function publicationAudienceAtomicProbe(): Promise<void> {
  const repository = new DrizzlePublicationRepository(
    publicationAudienceNoSqlDatabase(),
  );

  await expect(
    repository.readPublicationAudienceReadinessSnapshotForTenant(
      "banana",
      publicationId,
    ),
  ).resolves.toBeNull();
  await expect(
    repository.readPublicationAudienceReadinessSnapshotForTenant(
      tenantAId,
      "banana",
    ),
  ).resolves.toBeNull();
  await expect(
    repository.validatePublicationAudienceConfirmationAtomicallyForTenant(
      "banana",
      publicationId,
      { expectedPublicationVersion: 1, confirmedRecipientCount: 0 },
    ),
  ).resolves.toBeNull();
  await expect(
    repository.validatePublicationAudienceConfirmationAtomicallyForTenant(
      tenantAId,
      "banana",
      { expectedPublicationVersion: 1, confirmedRecipientCount: 0 },
    ),
  ).resolves.toBeNull();
}

async function publicationAudienceReadinessProbe(): Promise<void> {
  const calls: string[] = [];
  const dependencies = {
    publications: {
      readPublicationAudienceReadinessSnapshotForTenant: async (
        tenantId: string,
        id: string,
      ) => {
        calls.push(`snapshot:${tenantId}:${id}`);
        return id === publicationId && tenantId === tenantAId
          ? {
              publication: publicationA,
              definition: null,
              targetsCurrentlyValid: false,
              estimatedRecipientCount: null,
            }
          : null;
      },
      validatePublicationAudienceConfirmationAtomicallyForTenant: async () => null,
    },
  };

  await expect(
    getPublicationAudienceReadinessForTenant(
      dependencies,
      tenantAId,
      foreignPublicationId,
    ),
  ).resolves.toBeNull();
  await expect(
    getPublicationAudienceReadinessForTenant(
      dependencies,
      tenantAId,
      publicationId,
    ),
  ).resolves.toMatchObject({
    audienceDefinitionValid: false,
    targetsCurrentlyValid: false,
    estimatedRecipientCount: null,
  });
  expect(calls).toEqual([
    `snapshot:${tenantAId}:${foreignPublicationId}`,
    `snapshot:${tenantAId}:${publicationId}`,
  ]);
}

async function publicationAudienceConfirmationProbe(): Promise<void> {
  const dependencies = {
    publications: {
      readPublicationAudienceReadinessSnapshotForTenant: async () => null,
      validatePublicationAudienceConfirmationAtomicallyForTenant: async (
        tenantId: string,
        id: string,
        input: unknown,
      ) =>
        tenantId === tenantAId && id === publicationId
          ? validatePublicationAudienceConfirmation(input, {
              publicationVersion: 1,
              estimatedRecipientCount: 2,
              audienceDefinitionValid: true,
              targetsCurrentlyValid: true,
            })
          : null,
    },
  };

  await expect(
    validatePublicationAudienceConfirmationForTenant(
      dependencies,
      tenantBId,
      publicationId,
      { expectedPublicationVersion: 1, confirmedRecipientCount: 2 },
    ),
  ).resolves.toBeNull();
  await expect(
    validatePublicationAudienceConfirmationForTenant(
      dependencies,
      tenantAId,
      publicationId,
      {
        expectedPublicationVersion: 1,
        confirmedRecipientCount: 2,
        identitySubjectIds: ["must-not-be-accepted"],
      },
    ),
  ).resolves.toEqual({ ok: false, error: "RECONFIRM_REQUIRED" });
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

  const targetedPublication = {
    ...publicationA,
    visibility: "PUBLIC" as const,
    lifecycle: "published" as const,
    audienceMode: "targeted" as const,
    publishAt: new Date("2026-01-10T12:00:00.000Z"),
  };
  let definitionCalls = 0;
  let membershipFactsCalls = 0;
  const audienceResolver = new PersistedPublicationAudienceResolver({
    publications: {
      findPublicationAudienceDefinitionForTenant: async (tenantId, id) => {
        definitionCalls += 1;
        return {
          tenantId,
          publicationId: id,
          mode: "targeted" as const,
          groups: [
            {
              dimension: "campus" as const,
              provenancePolicy: "authoritative_only" as const,
              campusIds: ["00000000-0000-4000-8000-000000000031"],
            },
          ],
        };
      },
    },
    memberships: {
      findMembershipAudienceFactsByIdForTenant: async () => {
        membershipFactsCalls += 1;
        return null;
      },
    },
  });
  const targetedService = new ReadPublicationService({
    publications: {
      findPublicationByIdForTenant: async () => targetedPublication,
    },
    exposureResolver: {
      resolveExposure: (candidates) =>
        new Map(candidates.map((candidate) => [candidate.id, "READABLE" as const])),
    },
    audienceResolver,
  });
  await expect(
    targetedService.getPublicationForRead({
      tenantId: tenantAId,
      publicationId,
      viewer: anonymousViewerA,
      tenantFacts: tenantFactsA,
      now,
    }),
  ).resolves.toEqual({ outcome: "NOT_FOUND" });
  expect(definitionCalls).toBe(1);
  expect(membershipFactsCalls).toBe(0);
}

async function publicationAudienceResolverProbe(): Promise<void> {
  const targetedPublication = {
    ...publicationA,
    visibility: "PUBLIC" as const,
    lifecycle: "published" as const,
    audienceMode: "targeted" as const,
    publishAt: new Date("2026-01-10T12:00:00.000Z"),
  };
  const definition = {
    tenantId: tenantAId,
    publicationId,
    mode: "targeted" as const,
    groups: [
      {
        dimension: "campus" as const,
        provenancePolicy: "authoritative_only" as const,
        campusIds: ["00000000-0000-4000-8000-000000000031"],
      },
    ],
  };
  const membershipViewerA: Extract<
    ResourceReadViewer,
    { kind: "membership" }
  > = {
    kind: "membership",
    context: {
      identitySubjectId: "identity-a",
      tenantId: tenantAId,
      tenantStatus: "active",
      membershipId: membershipAId,
      assuranceLevel: "L2",
      membershipStatus: "verified",
    },
  };
  const membershipViewerB: Extract<
    ResourceReadViewer,
    { kind: "membership" }
  > = {
    kind: "membership",
    context: {
      ...membershipViewerA.context,
      tenantId: tenantBId,
      membershipId: membershipBId,
    },
  };
  const definitionCalls: Array<readonly [string, string]> = [];
  const membershipFactsCalls: Array<readonly [string, string]> = [];
  const resolver = new PersistedPublicationAudienceResolver({
    publications: {
      findPublicationAudienceDefinitionForTenant: async (tenantId, id) => {
        definitionCalls.push([tenantId, id]);
        return definition;
      },
    },
    memberships: {
      findMembershipAudienceFactsByIdForTenant: async (tenantId, id) => {
        membershipFactsCalls.push([tenantId, id]);
        return null;
      },
    },
  });

  await expect(
    resolver.resolveAudience({
      publication: targetedPublication,
      viewer: membershipViewerB,
    }),
  ).resolves.toEqual({ evaluated: true, eligible: false });
  expect(definitionCalls).toEqual([]);
  expect(membershipFactsCalls).toEqual([]);

  await expect(
    resolver.resolveAudience({
      publication: targetedPublication,
      viewer: anonymousViewerA,
    }),
  ).resolves.toEqual({ evaluated: true, eligible: false });
  expect(definitionCalls).toEqual([[tenantAId, publicationId]]);
  expect(membershipFactsCalls).toEqual([]);

  await expect(
    resolver.resolveAudience({
      publication: targetedPublication,
      viewer: membershipViewerA,
    }),
  ).resolves.toEqual({ evaluated: true, eligible: false });
  expect(definitionCalls).toEqual([
    [tenantAId, publicationId],
    [tenantAId, publicationId],
  ]);
  expect(membershipFactsCalls).toEqual([[tenantAId, membershipAId]]);

  const malformedResolver = new PersistedPublicationAudienceResolver({
    publications: {
      findPublicationAudienceDefinitionForTenant: async () => null,
    },
    memberships: {
      findMembershipAudienceFactsByIdForTenant: async () => {
        throw new Error("Membership lookup must not run for malformed definition");
      },
    },
  });
  await expect(
    malformedResolver.resolveAudience({
      publication: targetedPublication,
      viewer: membershipViewerA,
    }),
  ).resolves.toEqual({ evaluated: true, eligible: false });
}

async function publicationAudienceBatchResolverProbe(): Promise<void> {
  const targetedPublication = {
    ...publicationA,
    visibility: "PUBLIC" as const,
    lifecycle: "published" as const,
    audienceMode: "targeted" as const,
    publishAt: new Date("2026-01-10T12:00:00.000Z"),
  };
  const entireTenantPublication = publicationA;
  const definition = {
    tenantId: tenantAId,
    publicationId,
    mode: "targeted" as const,
    groups: [
      {
        dimension: "campus" as const,
        provenancePolicy: "authoritative_only" as const,
        campusIds: ["00000000-0000-4000-8000-000000000031"],
      },
    ],
  };
  const membershipFacts = {
    membershipId: membershipAId,
    tenantId: tenantAId,
    campus: {
      value: "00000000-0000-4000-8000-000000000031",
      provenance: "roster_derived" as const,
    },
    residence: {
      state: "non_resident" as const,
      residenceId: null,
      provenance: "roster_derived" as const,
    },
  };
  const definitionCalls: Array<readonly [string, readonly string[]]> = [];
  const membershipCalls: Array<readonly [string, string]> = [];
  const resolver = new PersistedPublicationAudienceBatchResolver({
    publications: {
      findPublicationAudienceDefinitionsForTenant: async (tenantId, ids) => {
        definitionCalls.push([tenantId, ids]);
        return new Map([[publicationId, definition]]);
      },
    },
    memberships: {
      findMembershipAudienceFactsByIdForTenant: async (tenantId, id) => {
        membershipCalls.push([tenantId, id]);
        return membershipFacts;
      },
    },
  });
  const membershipViewerA: Extract<
    ResourceReadViewer,
    { kind: "membership" }
  > = {
    kind: "membership",
    context: {
      identitySubjectId: "identity-a",
      tenantId: tenantAId,
      tenantStatus: "active",
      membershipId: membershipAId,
      assuranceLevel: "L2",
      membershipStatus: "verified",
    },
  };
  const membershipViewerB: Extract<
    ResourceReadViewer,
    { kind: "membership" }
  > = {
    kind: "membership",
    context: {
      ...membershipViewerA.context,
      tenantId: tenantBId,
      membershipId: membershipBId,
    },
  };

  await expect(
    resolver.resolveAudienceBatch({
      tenantId: tenantAId,
      publications: [targetedPublication],
      viewer: membershipViewerB,
    }),
  ).resolves.toEqual(new Map());
  expect(definitionCalls).toEqual([]);
  expect(membershipCalls).toEqual([]);

  await expect(
    resolver.resolveAudienceBatch({
      tenantId: tenantAId,
      publications: [targetedPublication],
      viewer: anonymousViewerA,
    }),
  ).resolves.toEqual(
    new Map([[publicationId, { evaluated: true, eligible: false }]]),
  );
  expect(definitionCalls).toEqual([]);
  expect(membershipCalls).toEqual([]);

  await expect(
    resolver.resolveAudienceBatch({
      tenantId: tenantAId,
      publications: [targetedPublication],
      viewer: membershipViewerA,
    }),
  ).resolves.toEqual(
    new Map([[publicationId, { evaluated: true, eligible: true }]]),
  );
  expect(definitionCalls).toEqual([[tenantAId, [publicationId]]]);
  expect(membershipCalls).toEqual([[tenantAId, membershipAId]]);

  await expect(
    resolver.resolveAudienceBatch({
      tenantId: tenantAId,
      publications: [entireTenantPublication],
      viewer: membershipViewerA,
    }),
  ).resolves.toEqual(new Map());
  await expect(
    resolver.resolveAudienceBatch({
      tenantId: tenantAId,
      publications: [{ ...targetedPublication, tenantId: tenantBId }],
      viewer: membershipViewerA,
    }),
  ).resolves.toEqual(new Map());
  expect(definitionCalls).toHaveLength(1);
  expect(membershipCalls).toHaveLength(1);
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

async function homeCollectionProbe(): Promise<void> {
  const foreign = {
    ...publicationA,
    id: foreignPublicationId,
    tenantId: tenantBId,
  };
  let observedTenantId: string | undefined;
  const list = new ListPublicationsService({
    publications: {
      listPublicationCandidatesForTenant: async (query) => {
        observedTenantId = query.tenantId;
        return { items: [foreign], hasMoreCandidateRows: false };
      },
    },
    exposureResolver: {
      resolveExposure: (candidates) =>
        new Map(
          candidates.map((candidate) => [candidate.id, "READABLE" as const]),
        ),
    },
  });
  const home = new CampusHomeService({
    listPublications: list,
    readPublication: {
      getPublicationForRead: async () => ({ outcome: "NOT_FOUND" as const }),
    },
  });
  const context: TrustedRequestContext = {
    identitySubjectId: "same-identity",
    tenantId: tenantAId,
    tenantStatus: "active",
    membershipId: membershipAId,
    assuranceLevel: "L2",
    membershipStatus: "verified",
  };

  await expect(
    home.getFeed({
      context,
      tenantFacts: tenantFactsA,
      tenantDisplayName: tenantA.displayName,
      tenantTimezone: tenantA.timezone,
      now,
      limit: 1,
    }),
  ).resolves.toEqual({
    outcome: "READY",
    tenantDisplayName: tenantA.displayName,
    items: [],
    nextCursor: null,
  });
  expect(observedTenantId).toBe(tenantAId);
}

async function homeDetailProbe(): Promise<void> {
  const foreign = {
    ...publicationA,
    id: foreignPublicationId,
    tenantId: tenantBId,
    title: "Tenant B publication",
    body: "Tenant B body",
  };
  const candidates = [publicationA, foreign];
  const observedLookups: Array<readonly [string, string]> = [];
  const read = new ReadPublicationService({
    publications: {
      findPublicationByIdForTenant: async (tenantId, id) => {
        observedLookups.push([tenantId, id]);
        return (
          candidates.find(
            (candidate) =>
              candidate.tenantId === tenantId && candidate.id === id,
          ) ?? null
        );
      },
    },
    exposureResolver: {
      resolveExposure: (items) =>
        new Map(items.map((item) => [item.id, "READABLE" as const])),
    },
  });
  const list = new ListPublicationsService({
    publications: {
      listPublicationCandidatesForTenant: async () => ({
        items: [],
        hasMoreCandidateRows: false,
      }),
    },
    exposureResolver: {
      resolveExposure: (items) =>
        new Map(items.map((item) => [item.id, "READABLE" as const])),
    },
  });
  const home = new CampusHomeService({
    listPublications: list,
    readPublication: read,
  });
  const context: TrustedRequestContext = {
    identitySubjectId: "same-identity",
    tenantId: tenantAId,
    tenantStatus: "active",
    membershipId: membershipAId,
    assuranceLevel: "L2",
    membershipStatus: "verified",
  };
  const detailInput = (id: string) => ({
    context,
    tenantFacts: tenantFactsA,
    tenantDisplayName: tenantA.displayName,
    tenantTimezone: tenantA.timezone,
    publicationId: id,
    now,
  });

  const found = await home.getDetail(detailInput(publicationId));
  expect(found.outcome).toBe("FOUND");
  if (found.outcome === "FOUND") {
    expect(found.publication.id).toBe(publicationId);
    expect(found.publication.title).toBe(publicationA.title);
    expect(found.publication.body).toBe(publicationA.body);
  }

  const foreignResult = await home.getDetail(
    detailInput(foreignPublicationId),
  );
  const nonexistentResult = await home.getDetail(
    detailInput("00000000-0000-4000-8000-000000000023"),
  );
  expect(foreignResult).toEqual({ outcome: "NOT_FOUND" });
  expect(nonexistentResult).toEqual({ outcome: "NOT_FOUND" });
  expect(foreignResult).toEqual(nonexistentResult);
  expect(observedLookups).toEqual([
    [tenantAId, publicationId],
    [tenantAId, foreignPublicationId],
    [tenantAId, "00000000-0000-4000-8000-000000000023"],
  ]);

  const deniedHome = new CampusHomeService({
    listPublications: list,
    readPublication: {
      getPublicationForRead: async () => ({
        outcome: "DENIED" as const,
        code: "MEMBERSHIP_REQUIRED" as const,
      }),
    },
  });
  await expect(
    deniedHome.getDetail(detailInput(publicationId)),
  ).resolves.toEqual({ outcome: "NOT_FOUND" });
}

async function publicationCreateProbe(): Promise<void> {
  const calls: Array<{
    tenantId: string;
    input: CreatePublicationDraftInput;
  }> = [];
  const service = new CreatePublicationService({
    authorizedPublicationCreate: {
      createAuthorizedPublication: async (_request, tenantId, input) => {
        calls.push({ tenantId, input });
        return { outcome: "CREATED", publication: publicationDraftA };
      },
    },
    capabilityAuthorizer: {
      authorize: async () => ({ allowed: true }),
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
  const publicationInput: CreatePublicationDraftInput = {
    type: "news",
    title: "Tenant A create probe",
    body: "Tenant A create probe body",
    audienceMode: "entire_tenant",
    authorOfficeLabel: "Communications",
  };
  const canonicalPublicationInput = {
    ...publicationInput,
    priority: "standard" as const,
    visibility: "MEMBERS" as const,
    expiresAt: null,
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
  ).resolves.toEqual({ outcome: "CREATED", publication: publicationDraftA });
  expect(calls).toEqual([
    { tenantId: tenantAId, input: canonicalPublicationInput },
  ]);
}

async function publicationEditProbe(): Promise<void> {
  const calls: Array<{ tenantId: string; publicationId: string }> = [];
  const tenantBMutations: string[] = [];
  const service = new EditPublicationDraftService({
    authorizedPublicationDraftEdit: {
      editAuthorizedPublication: async (
        _request,
        tenantId,
        publicationId,
      ) => {
        calls.push({ tenantId, publicationId });
        if (tenantId === tenantBId) {
          tenantBMutations.push(publicationId);
        }
        return { outcome: "DENIED", code: "NOT_FOUND" };
      },
    },
    capabilityAuthorizer: {
      authorize: async () => ({ allowed: true }),
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
  const editInput: UpdatePublicationDraftInput = {
    expectedVersion: 1,
    type: "notice",
    title: "Tenant A edit probe",
    body: "Tenant A edit probe body",
    priority: "standard",
    visibility: "MEMBERS",
    authorOfficeLabel: "Communications",
    expiresAt: null,
  };

  await expect(
    service.editPublicationDraft({
      trustedContext,
      requestedTenantId: tenantAId,
      publicationId: foreignPublicationId,
      edit: editInput,
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "NOT_FOUND" });
  expect(calls).toEqual([
    { tenantId: tenantAId, publicationId: foreignPublicationId },
  ]);
  expect(tenantBMutations).toHaveLength(0);

  await expect(
    service.editPublicationDraft({
      trustedContext,
      requestedTenantId: tenantBId,
      publicationId: foreignPublicationId,
      edit: editInput,
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "TENANT_SCOPE_NOT_FOUND" });
  expect(calls).toHaveLength(1);
  expect(tenantBMutations).toHaveLength(0);
}

async function publicationPublishProbe(): Promise<void> {
  const calls: Array<{
    tenantId: string;
    publicationId: string;
    input: PublishPublicationInput;
  }> = [];
  const service = new PublishPublicationService({
    authorizedPublicationPublish: {
      publishAuthorizedPublication: async (
        _request,
        tenantId,
        publicationId,
        input,
      ) => {
        calls.push({ tenantId, publicationId, input });
        return { outcome: "DENIED", code: "NOT_FOUND" };
      },
    },
    capabilityAuthorizer: {
      authorize: async () => ({ allowed: true }),
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
  const publishInput = {
    expectedVersion: 1,
    confirmedRecipientCount: 0,
  };

  await expect(
    service.publishPublication({
      trustedContext,
      requestedTenantId: tenantAId,
      publicationId: foreignPublicationId,
      publish: publishInput,
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "NOT_FOUND" });
  expect(calls).toEqual([
    {
      tenantId: tenantAId,
      publicationId: foreignPublicationId,
      input: publishInput,
    },
  ]);

  await expect(
    service.publishPublication({
      trustedContext,
      requestedTenantId: tenantBId,
      publicationId: foreignPublicationId,
      publish: publishInput,
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "TENANT_SCOPE_NOT_FOUND" });
  expect(calls).toHaveLength(1);
}

async function guildTermActiveProbe(): Promise<void> {
  const database = {
    select: () => {
      throw new Error("malformed Guild Term Tenant UUID reached SQL");
    },
  } as unknown as CampusHubDatabase;

  await expect(
    new DrizzleGuildTermRepository(database).findActiveGuildTermForTenant(
      "banana",
      now,
    ),
  ).resolves.toBeNull();
}

async function roleGrantCapabilityProbe(): Promise<void> {
  const database = {
    select: () => {
      throw new Error("malformed Role Grant Tenant UUID reached SQL");
    },
  } as unknown as CampusHubDatabase;

  await expect(
    new DrizzleRoleGrantRepository(database).findCapabilityGrantForTenant({
      tenantId: "banana",
      guildTermId: termId,
      membershipId: membershipAId,
      capability: "publication.create",
      moduleScope: "publication",
      now,
      termEndsAt: new Date("2026-12-31T23:59:59.000Z"),
    }),
  ).resolves.toBeNull();
}

async function capabilityAuthorizationProbe(): Promise<void> {
  const authorizer = new PostgresCapabilityAuthorizer({
    tenants: {
      findTenantById: async () => tenantA,
    },
    memberships: {
      findMembershipByIdForTenant: async () => membershipA,
    },
    guildTerms: {
      findActiveGuildTermForTenant: async () => ({
        id: termId,
        tenantId: tenantAId,
        label: "Term A",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-12-31T23:59:59.000Z"),
        status: "active" as const,
        createdAt: tenantA.createdAt,
        updatedAt: tenantA.updatedAt,
      }),
    },
    roleGrants: {
      findCapabilityGrantForTenant: async () => ({
        id: "00000000-0000-4000-8000-000000000031",
        tenantId: tenantAId,
        guildTermId: termId,
        membershipId: membershipAId,
        role: "publisher" as const,
        capability: "publication.create" as const,
        moduleScope: "publication" as const,
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        revokedAt: null,
        createdAt: tenantA.createdAt,
        updatedAt: tenantA.updatedAt,
      }),
    },
    clock: { now: () => now },
  });

  await expect(
    authorizer.authorize({
      actor: {
        identitySubjectId: "same-identity",
        tenantId: tenantAId,
        membershipId: membershipAId,
      },
      context: {
        tenantStatus: "active",
        membershipStatus: "verified",
        assuranceLevel: "L2",
      },
      capability: "publication.create",
      scope: {
        tenantId: tenantAId,
        module: "publication",
        resource: "publication",
      },
    }),
  ).resolves.toEqual({ allowed: true });

  await expect(
    authorizer.authorize({
      actor: {
        identitySubjectId: "same-identity",
        tenantId: tenantAId,
        membershipId: membershipAId,
      },
      context: {
        tenantStatus: "active",
        membershipStatus: "verified",
        assuranceLevel: "L2",
      },
      capability: "publication.create",
      scope: {
        tenantId: tenantBId,
        module: "publication",
        resource: "publication",
      },
    }),
  ).resolves.toEqual({ allowed: false });
}

async function sportsManagementProbe(): Promise<void> {
  const trustedContext: TrustedRequestContext = {
    identitySubjectId: "same-identity",
    tenantId: tenantAId,
    tenantStatus: "active",
    membershipId: membershipAId,
    assuranceLevel: "L2",
    membershipStatus: "verified",
  };
  const calls: string[] = [];
  const service = new SportsManagementService({
    capabilityAuthorizer: {
      authorize: async () => {
        calls.push("authorize");
        return { allowed: true };
      },
    },
    gateway: {
      createSport: async () => {
        calls.push("createSport");
        return { ok: false, error: "PERMISSION_DENIED" };
      },
      updateSport: async () => {
        calls.push("updateSport");
        return { ok: false, error: "PERMISSION_DENIED" };
      },
      deactivateSport: async () => {
        calls.push("deactivateSport");
        return { ok: false, error: "PERMISSION_DENIED" };
      },
      createCompetition: async () => {
        calls.push("createCompetition");
        return { ok: false, error: "PERMISSION_DENIED" };
      },
      updateCompetition: async () => {
        calls.push("updateCompetition");
        return { ok: false, error: "PERMISSION_DENIED" };
      },
      deactivateCompetition: async () => {
        calls.push("deactivateCompetition");
        return { ok: false, error: "PERMISSION_DENIED" };
      },
      createTeam: async () => {
        calls.push("createTeam");
        return { ok: false, error: "PERMISSION_DENIED" };
      },
      updateTeam: async () => {
        calls.push("updateTeam");
        return { ok: false, error: "PERMISSION_DENIED" };
      },
      deactivateTeam: async () => {
        calls.push("deactivateTeam");
        return { ok: false, error: "PERMISSION_DENIED" };
      },
    },
    sports: { listSportsForTenant: async () => [] },
    competitions: { listCompetitionsForTenant: async () => [] },
    teams: { listTeamsForTenant: async () => [] },
  });

  await expect(
    service.createSport({
      trustedContext,
      requestedTenantId: tenantBId,
      sport: { name: "Tenant B must not be reachable" },
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  expect(calls).toEqual([]);
}

async function sportsAuthorizationProbe(): Promise<void> {
  const authorizer = new PostgresCapabilityAuthorizer({
    tenants: {
      findTenantById: async () => tenantA,
    },
    memberships: {
      findMembershipByIdForTenant: async () => membershipA,
    },
    guildTerms: {
      findActiveGuildTermForTenant: async () => ({
        id: termId,
        tenantId: tenantAId,
        label: "Term A",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-12-31T23:59:59.000Z"),
        status: "active" as const,
        createdAt: tenantA.createdAt,
        updatedAt: tenantA.updatedAt,
      }),
    },
    roleGrants: {
      findCapabilityGrantForTenant: async () => ({
        id: "00000000-0000-4000-8000-000000000032",
        tenantId: tenantAId,
        guildTermId: termId,
        membershipId: membershipAId,
        role: "publisher" as const,
        capability: "sport.manage" as const,
        moduleScope: "sports" as const,
        expiresAt: new Date("2026-12-01T00:00:00.000Z"),
        revokedAt: null,
        createdAt: tenantA.createdAt,
        updatedAt: tenantA.updatedAt,
      }),
    },
    clock: { now: () => now },
  });

  const actor = {
    identitySubjectId: "same-identity",
    tenantId: tenantAId,
    membershipId: membershipAId,
  };
  const context = {
    tenantStatus: "active" as const,
    membershipStatus: "verified" as const,
    assuranceLevel: "L2" as const,
  };

  await expect(
    authorizer.authorize({
      actor,
      context,
      capability: "sport.manage",
      scope: { tenantId: tenantAId, module: "sports", resource: "team" },
    }),
  ).resolves.toEqual({ allowed: true });

  await expect(
    authorizer.authorize({
      actor,
      context,
      capability: "sport.manage",
      scope: { tenantId: tenantAId, module: "publication", resource: "team" },
    }),
  ).resolves.toEqual({ allowed: false });

  await expect(
    authorizer.authorize({
      actor,
      context,
      capability: "sport.manage",
      scope: { tenantId: tenantAId, module: "sports", resource: "fixture" },
    }),
  ).resolves.toEqual({ allowed: true });
}

async function fixturesManagementProbe(): Promise<void> {
  const calls: string[] = [];
  const service = new FixtureManagementService({
    capabilityAuthorizer: {
      authorize: async () => {
        calls.push("authorize");
        return { allowed: true };
      },
    },
    gateway: {
      createFixture: async () => ({ ok: false, error: "PERMISSION_DENIED" }),
      updateFixture: async () => ({ ok: false, error: "PERMISSION_DENIED" }),
      postponeFixture: async () => ({ ok: false, error: "PERMISSION_DENIED" }),
      cancelFixture: async () => ({ ok: false, error: "PERMISSION_DENIED" }),
      completeFixture: async () => ({ ok: false, error: "PERMISSION_DENIED" }),
      abandonFixture: async () => ({ ok: false, error: "PERMISSION_DENIED" }),
    },
    fixtures: { listFixturesForTenant: async () => [] },
  });
  const trustedContext = {
    identitySubjectId: "fixture-probe-identity",
    tenantId: tenantAId,
    membershipId: membershipAId,
    tenantStatus: "active" as const,
    membershipStatus: "verified" as const,
    assuranceLevel: "L2" as const,
  };
  await expect(
    service.createFixture({
      trustedContext,
      requestedTenantId: tenantBId,
      fixture: {},
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  expect(calls).toEqual([]);
}

async function fixturesStudentReadProbe(): Promise<void> {
  let repositoryCalled = false;
  const service = new ListFixturesService({
    fixtures: {
      listFixturesForTenant: async () => {
        repositoryCalled = true;
        return [];
      },
    },
  });
  const trustedContext = {
    identitySubjectId: "fixture-read-probe-identity",
    tenantId: tenantAId,
    membershipId: membershipAId,
    tenantStatus: "active" as const,
    membershipStatus: "verified" as const,
    assuranceLevel: "L2" as const,
  };
  await expect(
    service.listFixtures({
      trustedContext,
      requestedTenantId: tenantBId,
      filters: {},
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  expect(repositoryCalled).toBe(false);
}

async function resultsAuthorizationProbe(): Promise<void> {
  const executor = new PostgresAuthorizedSportsManagementExecutor({
    database: {} as never,
    authorizer: {} as never,
    auditEvents: {} as never,
  });
  await expect(
    executor.publishResult(
      {
        actor: {
          identitySubjectId: "result-probe-identity",
          tenantId: tenantAId,
          membershipId: membershipAId,
        },
        context: {
          tenantStatus: "active",
          membershipStatus: "verified",
          assuranceLevel: "L2",
        },
        capability: "publication.create" as never,
        scope: { tenantId: tenantAId, module: "sports", resource: "result" },
      },
      tenantAId,
      "00000000-0000-4000-8000-000000000099",
      { expectedVersion: 1 },
    ),
  ).resolves.toEqual({ ok: false, error: "PERMISSION_DENIED" });
}

async function resultsManagementProbe(): Promise<void> {
  let gatewayCalled = false;
  const service = new ResultManagementService({
    capabilityAuthorizer: { authorize: vi.fn() } as never,
    gateway: {
      createResult: async () => {
        gatewayCalled = true;
        return { ok: false, error: "PERSISTENCE_FAILED" };
      },
      updateResultDraft: async () => ({ ok: false, error: "PERSISTENCE_FAILED" }),
      publishResult: async () => ({ ok: false, error: "PERSISTENCE_FAILED" }),
      correctResult: async () => ({ ok: false, error: "PERSISTENCE_FAILED" }),
    },
    results: {
      listManagedResultsForTenant: async () => [],
      listResultRevisionsForTenant: async () => ({ ok: true as const, items: [] }),
    },
  });
  await expect(
    service.createDraftResult({
      trustedContext: {
        identitySubjectId: "result-management-probe",
        tenantId: tenantAId,
        membershipId: membershipAId,
        tenantStatus: "active",
        membershipStatus: "verified",
        assuranceLevel: "L2",
      },
      requestedTenantId: tenantBId,
      result: {
        fixtureId: publicationId,
        homeScore: 1,
        awayScore: 0,
      },
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  expect(gatewayCalled).toBe(false);
}

async function resultsStudentReadProbe(): Promise<void> {
  let repositoryCalled = false;
  const service = new ListResultsService({
    results: {
      listPublishedResultsForTenant: async () => {
        repositoryCalled = true;
        return [];
      },
      listResultRevisionsForTenant: async () => ({ ok: true as const, items: [] }),
    },
  });
  await expect(
    service.listResults({
      trustedContext: {
        identitySubjectId: "result-read-probe",
        tenantId: tenantAId,
        membershipId: membershipAId,
        tenantStatus: "active",
        membershipStatus: "verified",
        assuranceLevel: "L2",
      },
      requestedTenantId: tenantBId,
      filters: {},
    }),
  ).resolves.toEqual({ outcome: "DENIED", code: "INVALID_INPUT" });
  expect(repositoryCalled).toBe(false);
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
  "audit.persistence": auditPersistenceProbe,
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
  "guild-term.persistence": () => {
    expectTenantOwnedTable(guildTerms);
    expectTenantCompositeIdentity(guildTerms);
  },
  "role-grant.persistence": () => {
    expectTenantOwnedTable(roleGrants);
    expectTenantCompositeIdentity(roleGrants);
    expectForeignKey(
      roleGrants,
      ["tenant_id", "guild_term_id"],
      ["tenant_id", "id"],
    );
    expectForeignKey(
      roleGrants,
      ["tenant_id", "membership_id"],
      ["tenant_id", "id"],
    );
  },
  "guild-term.active": guildTermActiveProbe,
  "role-grant.capability": roleGrantCapabilityProbe,
  "capability.authorization": capabilityAuthorizationProbe,
  "sports.authorization": sportsAuthorizationProbe,
  "publication.direct": publicationDirectProbe,
  "publication.audience-resolver": publicationAudienceResolverProbe,
  "publication.collection": publicationCollectionProbe,
  "home.collection": homeCollectionProbe,
  "home.detail": homeDetailProbe,
  "publication.create": publicationCreateProbe,
  "publication.edit": publicationEditProbe,
  "publication.publish": publicationPublishProbe,
  "sports.management": sportsManagementProbe,
  "fixtures.authorization": sportsAuthorizationProbe,
  "fixtures.management": fixturesManagementProbe,
  "fixtures.student-read": fixturesStudentReadProbe,
  "results.authorization": resultsAuthorizationProbe,
  "results.management": resultsManagementProbe,
  "results.student-read": resultsStudentReadProbe,
  "sports.persistence": () => {
    expectTenantOwnedTable(sports);
    expectTenantCompositeIdentity(sports);
    expectTenantOwnedTable(competitions);
    expectTenantCompositeIdentity(competitions);
    expectForeignKey(
      competitions,
      ["tenant_id", "sport_id"],
      ["tenant_id", "id"],
    );
    expectForeignKey(
      competitions,
      ["tenant_id", "campus_id"],
      ["tenant_id", "id"],
    );
    expectTenantOwnedTable(teams);
    expectTenantCompositeIdentity(teams);
    expectForeignKey(teams, ["tenant_id", "sport_id"], ["tenant_id", "id"]);
  },
  "competition.persistence": () => {
    expectTenantOwnedTable(competitions);
    expectTenantCompositeIdentity(competitions);
    expectForeignKey(
      competitions,
      ["tenant_id", "sport_id"],
      ["tenant_id", "id"],
    );
    expectForeignKey(
      competitions,
      ["tenant_id", "campus_id"],
      ["tenant_id", "id"],
    );
  },
  "team.persistence": () => {
    expectTenantOwnedTable(teams);
    expectTenantCompositeIdentity(teams);
    expectForeignKey(teams, ["tenant_id", "sport_id"], ["tenant_id", "id"]);
  },
  "fixtures.persistence": () => {
    expectTenantOwnedTable(fixtures);
    expectTenantCompositeIdentity(fixtures);
    expectForeignKey(
      fixtures,
      ["tenant_id", "competition_id"],
      ["tenant_id", "id"],
    );
    expectForeignKey(
      fixtures,
      ["tenant_id", "home_team_id"],
      ["tenant_id", "id"],
    );
    expectForeignKey(
      fixtures,
      ["tenant_id", "away_team_id"],
      ["tenant_id", "id"],
    );
    expectForeignKey(
      fixtures,
      ["tenant_id", "campus_id"],
      ["tenant_id", "id"],
    );
  },
  "results.persistence": () => {
    expectTenantOwnedTable(results);
    expectTenantCompositeIdentity(results);
    expectForeignKey(
      results,
      ["tenant_id", "fixture_id"],
      ["tenant_id", "id"],
    );
  },
  "result-revisions.persistence": () => {
    expectTenantOwnedTable(resultRevisions);
    expectTenantCompositeIdentity(resultRevisions);
    expectForeignKey(
      resultRevisions,
      ["tenant_id", "result_id"],
      ["tenant_id", "id"],
    );
    expectForeignKey(
      resultRevisions,
      ["tenant_id", "actor_membership_id"],
      ["tenant_id", "id"],
    );
  },
  "publication.audience-definition": publicationAudienceDefinitionProbe,
  "publication.audience-definition-batch":
    publicationAudienceDefinitionBatchProbe,
  "publication.audience-batch-resolver": publicationAudienceBatchResolverProbe,
  "publication.audience-replacement": publicationAudienceReplacementProbe,
  "publication.audience-target-validity": publicationAudienceTargetValidityProbe,
  "publication.audience-count": publicationAudienceCountProbe,
  "publication.audience-atomic": publicationAudienceAtomicProbe,
  "publication.audience-readiness": publicationAudienceReadinessProbe,
  "publication.audience-confirmation": publicationAudienceConfirmationProbe,
};
