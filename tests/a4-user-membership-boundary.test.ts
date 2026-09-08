import { readFileSync } from "node:fs";
import path from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: {} }));

import { RequestContextService } from "@/application/context/resolve-request-context";
import * as schema from "@/server/db/schema";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";

const inventoryPath = path.join(
  process.cwd(),
  "docs/security/a4-identifier-inventory.md",
);
const adrPath = path.join(
  process.cwd(),
  "docs/adr/0005-user-membership-boundary.md",
);

const identitySubjectId = "identity-a4-dual-membership";
const tenantA = {
  id: "00000000-0000-4000-8000-0000000000a1",
  slug: "tenant-a4-a",
  displayName: "Tenant A4 A",
  status: "active" as const,
  timezone: "Africa/Kampala",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};
const tenantB = {
  ...tenantA,
  id: "00000000-0000-4000-8000-0000000000b1",
  slug: "tenant-a4-b",
  displayName: "Tenant A4 B",
};
const membershipA = {
  id: "00000000-0000-4000-8000-0000000000a2",
  tenantId: tenantA.id,
  identitySubjectId,
  assuranceLevel: "L1" as const,
  lifecycle: "verified" as const,
  createdAt: tenantA.createdAt,
  updatedAt: tenantA.updatedAt,
};
const membershipB = {
  ...membershipA,
  id: "00000000-0000-4000-8000-0000000000b2",
  tenantId: tenantB.id,
  assuranceLevel: "L3" as const,
  lifecycle: "on_leave" as const,
};

const forbiddenGlobalFieldVocabulary = [
  "xp",
  "level",
  "streak",
  "poll",
  "voice",
  "engagement",
  "eventActivity",
  "opportunityActivity",
  "tenantBehavior",
  "campusProfile",
  "studentNumber",
  "programme",
  "academicYear",
  "residence",
] as const;

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function forbiddenGlobalFields(fields: readonly string[]): string[] {
  const normalizedVocabulary = forbiddenGlobalFieldVocabulary.map(
    normalizeFieldName,
  );
  return fields.filter((field) => {
    const normalizedField = normalizeFieldName(field);
    return normalizedVocabulary.some((term) => normalizedField.includes(term));
  });
}

function tableConfigs() {
  return Object.values(schema).flatMap((candidate) => {
    try {
      return [getTableConfig(candidate as never)];
    } catch {
      return [];
    }
  });
}

function columnNames(tableName: string): string[] {
  const tableConfig = tableConfigs().find((config) => config.name === tableName);
  if (!tableConfig) {
    return [];
  }

  return Object.values(tableConfig.columns).map((column) => column.name);
}

function createContextService(lookups: Array<[string, string]> = []) {
  const tenantsById = new Map([
    [tenantA.id, tenantA],
    [tenantB.id, tenantB],
  ]);
  const tenantsBySlug = new Map([
    [tenantA.slug, tenantA],
    [tenantB.slug, tenantB],
  ]);
  const membershipsByTenant = new Map<string, typeof membershipA | typeof membershipB>([
    [tenantA.id, membershipA],
    [tenantB.id, membershipB],
  ]);

  return new RequestContextService({
    tenants: {
      findTenantById: async (id) => tenantsById.get(id) ?? null,
      findTenantBySlug: async (slug) => tenantsBySlug.get(slug) ?? null,
    },
    memberships: {
      findMembershipByIdForTenant: async () => null,
      findMembershipForIdentityAndTenant: async (
        requestedIdentitySubjectId,
        tenantId,
      ) => {
        lookups.push([requestedIdentitySubjectId, tenantId]);
        return requestedIdentitySubjectId === identitySubjectId
          ? membershipsByTenant.get(tenantId) ?? null
          : null;
      },
    },
  });
}

describe("A4 User/Membership boundary", () => {
  it("exposes only Tenant-bound Membership repository operations", () => {
    const methodNames = Object.getOwnPropertyNames(
      DrizzleMembershipRepository.prototype,
    );

    expect(methodNames).toEqual(
      expect.arrayContaining([
        "findMembershipForIdentityAndTenant",
        "findMembershipByIdForTenant",
      ]),
    );
    expect(methodNames).not.toContain("findMembershipById");
    expect(methodNames).not.toContain("findAllMembershipsForIdentity");
    expect(
      DrizzleMembershipRepository.prototype.findMembershipForIdentityAndTenant,
    ).toHaveLength(2);
    expect(
      DrizzleMembershipRepository.prototype.findMembershipByIdForTenant,
    ).toHaveLength(2);
  });

  it("requires explicit Tenant context and returns exactly one trusted Membership", async () => {
    const lookups: Array<[string, string]> = [];
    const service = createContextService(lookups);

    await expect(
      service.resolveRequestContext({ identitySubjectId }),
    ).resolves.toEqual({ resolved: false, code: "TENANT_REQUIRED" });
    expect(lookups).toEqual([]);

    const contextA = await service.resolveRequestContext(
      { identitySubjectId },
      { tenantId: tenantA.id },
    );
    const contextB = await service.resolveRequestContext(
      { identitySubjectId },
      { tenantId: tenantB.id },
    );

    expect(contextA).toEqual({
      resolved: true,
      context: {
        identitySubjectId,
        tenantId: tenantA.id,
        tenantStatus: tenantA.status,
        membershipId: membershipA.id,
        assuranceLevel: membershipA.assuranceLevel,
        membershipStatus: membershipA.lifecycle,
      },
    });
    expect(contextB).toEqual({
      resolved: true,
      context: {
        identitySubjectId,
        tenantId: tenantB.id,
        tenantStatus: tenantB.status,
        membershipId: membershipB.id,
        assuranceLevel: membershipB.assuranceLevel,
        membershipStatus: membershipB.lifecycle,
      },
    });

    if (!contextA.resolved || !contextB.resolved) {
      return;
    }

    expect(Object.keys(contextA.context).sort()).toEqual([
      "assuranceLevel",
      "identitySubjectId",
      "membershipId",
      "membershipStatus",
      "tenantId",
      "tenantStatus",
    ]);
    expect("memberships" in contextA.context).toBe(false);
    expect(JSON.stringify(contextA)).not.toContain(tenantB.id);
    expect(JSON.stringify(contextA)).not.toContain(tenantB.displayName);
    expect(JSON.stringify(contextA)).not.toContain(membershipB.id);
    expect(JSON.stringify(contextB)).not.toContain(tenantA.id);
    expect(JSON.stringify(contextB)).not.toContain(tenantA.displayName);
    expect(JSON.stringify(contextB)).not.toContain(membershipA.id);
  });

  it("has no current Global User/account/session persistence", () => {
    const currentTableConfigs = tableConfigs();
    const currentTableNames = currentTableConfigs.map((config) => config.name).sort();
    expect(currentTableNames).toEqual([
      "academic_divisions",
      "campuses",
      "guild_terms",
      "memberships",
      "programmes",
      "publication_audience_criteria",
      "publications",
      "residences",
      "role_grants",
      "tenant_academic_year_config",
      "tenants",
    ]);

    const globalIdentityTableConfigs = currentTableConfigs.filter((config) =>
      /^(?:global_)?(?:users?|accounts?|sessions?)$/i.test(config.name),
    );
    expect(globalIdentityTableConfigs).toEqual([]);

    const futureGlobalAccountViolations = globalIdentityTableConfigs.flatMap(
      (config) =>
        forbiddenGlobalFields(
          Object.values(config.columns).map((column) => column.name),
        ).map((field) => `${config.name}.${field}`),
    );
    expect(futureGlobalAccountViolations).toEqual([]);
  });

  it("structurally finds every current Tenant-owned ID-bearing model in the inventory", () => {
    const inventory = readFileSync(inventoryPath, "utf8");
    const tenantOwnedTables = tableConfigs()
      .filter((config) =>
        columnNames(config.name).includes("tenant_id"),
      )
      .map((config) => config.name)
      .sort();

    expect(tenantOwnedTables).toEqual([
      "academic_divisions",
      "campuses",
      "guild_terms",
      "memberships",
      "programmes",
      "publication_audience_criteria",
      "publications",
      "residences",
      "role_grants",
      "tenant_academic_year_config",
    ]);
    for (const identifier of [
      "tenant.id",
      "tenant.slug",
      "identitySubjectId",
      "membership.id",
      "membership.tenantId",
      "membership.identitySubjectId",
      "membership.campusId",
      "membership.academicDivisionId",
      "membership.programmeId",
      "membership.residenceId",
      "publication.id",
      "publication.tenantId",
      "campus.id",
      "campus.tenantId",
      "academicDivision.id",
      "academicDivision.tenantId",
      "academicDivision.parentAcademicDivisionId",
      "academicDivision.mergedIntoAcademicDivisionId",
      "programme.id",
      "programme.tenantId",
      "programme.academicDivisionId",
      "programme.mergedIntoProgrammeId",
      "residence.id",
      "residence.tenantId",
      "tenantAcademicYearConfig.tenantId",
      "guildTerm.id",
      "guildTerm.tenantId",
      "roleGrant.id",
      "roleGrant.tenantId",
      "roleGrant.guildTermId",
      "roleGrant.membershipId",
      "RequestContext.tenantId",
      "RequestContext.membershipId",
      "Publication collection cursor.id",
      "Publication collection cursor.publishAt",
      "memberships.tenant_id -> tenants.id",
      "memberships.(tenant_id,campus_id) -> campuses.(tenant_id,id)",
      "memberships.(tenant_id,academic_division_id) -> academic_divisions.(tenant_id,id)",
      "memberships.(tenant_id,programme_id,academic_division_id) -> programmes.(tenant_id,id,academic_division_id)",
      "memberships.(tenant_id,residence_id) -> residences.(tenant_id,id)",
      "publications.tenant_id -> tenants.id",
      "campuses.tenant_id -> tenants.id",
      "academic_divisions.tenant_id -> tenants.id",
      "academic_divisions.(tenant_id,parent_academic_division_id) -> academic_divisions.(tenant_id,id)",
      "academic_divisions.(tenant_id,merged_into_academic_division_id) -> academic_divisions.(tenant_id,id)",
      "programmes.tenant_id -> tenants.id",
      "programmes.(tenant_id,academic_division_id) -> academic_divisions.(tenant_id,id)",
      "programmes.(tenant_id,merged_into_programme_id) -> programmes.(tenant_id,id)",
      "residences.tenant_id -> tenants.id",
      "tenant_academic_year_config.tenant_id -> tenants.id",
      "guild_terms.tenant_id -> tenants.id",
      "role_grants.tenant_id -> tenants.id",
      "role_grants.(tenant_id,guild_term_id) -> guild_terms.(tenant_id,id)",
      "role_grants.(tenant_id,membership_id) -> memberships.(tenant_id,id)",
    ]) {
      expect(inventory).toContain(`| \`${identifier}\``);
    }
  });

  it("classifies current Membership fields as Tenant-local and guards future Global account fields", () => {
    const inventory = readFileSync(inventoryPath, "utf8");
    const adr = readFileSync(adrPath, "utf8");
    const membershipColumnNames = columnNames("memberships");

    expect(membershipColumnNames).toEqual(
      expect.arrayContaining([
        "id",
        "tenant_id",
        "identity_subject_id",
        "assurance_level",
        "lifecycle",
      ]),
    );
    expect(inventory).toContain("| `membership.id`");
    expect(inventory).toContain("| `membership.tenantId`");
    expect(inventory).toContain("| `membership.identitySubjectId`");
    expect(adr).toContain(
      "university-specific profile, assurance, lifecycle, and behavioral data",
    );
    expect(adr).toContain("These fields are forbidden on Global User.");
    expect(adr).toContain("`assuranceLevel`");
    expect(adr).toContain("`lifecycle`");

    expect(
      forbiddenGlobalFields([
        "email",
        "verifiedContactChannel",
        "mfaState",
        "recoveryState",
        "sessionSecurityState",
        "consentVersion",
      ]),
    ).toEqual([]);
    expect(
      forbiddenGlobalFields([
        "xp",
        "student_number",
        "academic_year",
        "eventActivity",
        "opportunity_activity",
        "tenant_behavior",
        "campusProfile",
        "residence",
        "voiceHistory",
      ]),
    ).toEqual([
      "xp",
      "student_number",
      "academic_year",
      "eventActivity",
      "opportunity_activity",
      "tenant_behavior",
      "campusProfile",
      "residence",
      "voiceHistory",
    ]);
  });

  it("documents the future global behavioral prohibition and neutral security boundary", () => {
    const adr = readFileSync(adrPath, "utf8");
    const inventory = readFileSync(inventoryPath, "utf8");

    expect(adr).toMatch(
      /A Global User must never become a cross-university behavioral\s+profile\./,
    );
    expect(adr).toContain(
      "Security/account notifications may remain Tenant-neutral",
    );
    expect(adr).toMatch(
      /Account recovery, contact-channel verification, session security, and security\s+communication are global\/account-level and Tenant-neutral\./,
    );
    expect(inventory).toContain("FORBIDDEN_GLOBAL_BEHAVIORAL_LINK");
    expect(inventory).toContain("FUTURE_REQUIRED");
  });
});
