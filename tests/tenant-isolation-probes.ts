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
import { memberships, publications, tenants } from "@/server/db/schema";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
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
  "membership.persistence": () => expectTenantOwnedTable(memberships),
  "membership.context": membershipContextProbe,
  "membership.identity-tenant": membershipContextProbe,
  "membership.id-tenant": membershipIdProbe,
  "publication.persistence": () => expectTenantOwnedTable(publications),
  "publication.direct": publicationDirectProbe,
  "publication.collection": publicationCollectionProbe,
  "publication.create": publicationCreateProbe,
};
