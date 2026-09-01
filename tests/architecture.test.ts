import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const serverOnlyModules = [
  "src/server/config/env.ts",
  "src/server/context/request-context.ts",
  "src/server/context/create-request-context-resolver.ts",
  "src/server/db/client.ts",
  "src/server/tenancy/tenant-surface-registry.ts",
  "src/server/repositories/membership-repository.ts",
  "src/server/repositories/publication-repository.ts",
  "src/server/repositories/tenant-repository.ts",
  "src/application/context/resolve-request-context.ts",
  "src/application/content/read-publication.ts",
  "src/application/content/list-publications.ts",
  "src/application/content/publication-read-resolvers.ts",
  "src/domain/authorization/context-policy.ts",
  "src/domain/authorization/trusted-request-context.ts",
  "src/domain/authorization/resource-read-policy.ts",
  "src/domain/authorization/publication-read-contract.ts",
  "src/domain/authorization/publication-read-mapper.ts",
  "src/domain/membership/institutional-email-policy.ts",
] as const;

describe("server-only architecture boundary", () => {
  it("marks sensitive modules with the server-only boundary", () => {
    for (const relativePath of serverOnlyModules) {
      const source = readFileSync(path.join(process.cwd(), relativePath), "utf8");
      expect(source).toContain('import "server-only"');
    }
  });

  it("keeps Publication reads tenant-scoped", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/server/repositories/publication-repository.ts",
      ),
      "utf8",
    );

    expect(source).toContain("findPublicationByIdForTenant");
    expect(source).toContain("eq(publications.tenantId, tenantId)");
    expect(source).toContain("eq(publications.id, publicationId)");
    expect(source).not.toMatch(/findPublicationById\s*\(/);
  });

  it("does not expose an ordinary unscoped Membership-by-ID lookup", () => {
    const readerSource = readFileSync(
      path.join(process.cwd(), "src/application/context/context-readers.ts"),
      "utf8",
    );
    const repositorySource = readFileSync(
      path.join(
        process.cwd(),
        "src/server/repositories/membership-repository.ts",
      ),
      "utf8",
    );

    expect(readerSource).not.toMatch(/findMembershipById\s*\(/);
    expect(repositorySource).not.toMatch(/findMembershipById\s*\(/);
    expect(readerSource).toContain("findMembershipByIdForTenant");
    expect(repositorySource).toContain("eq(memberships.tenantId, tenantId)");
  });

  it("keeps Publication collection queries tenant-scoped and keyset-based", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/server/repositories/publication-repository.ts",
      ),
      "utf8",
    );

    expect(source).toContain("listPublicationCandidatesForTenant");
    expect(source).toContain("eq(publications.tenantId, input.tenantId)");
    expect(source).toContain('eq(publications.audienceMode, "entire_tenant")');
    expect(source).toContain("orderBy(desc(publications.publishAt)");
    expect(source).not.toMatch(/listPublications\s*\(/);
    expect(source).not.toMatch(/\.offset\s*\(/i);
    expect(source).not.toContain("OFFSET");
  });

  it("routes Publication reads through the canonical policy and pure mapper", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "src/application/content/read-publication.ts",
      ),
      "utf8",
    );

    expect(source).toContain("authorizeResourceRead");
    expect(source).toContain("isResourceReadViewer");
    expect(source).toContain("isUuid");
    expect(source).toContain("mapPublicationToResourceAccessFacts");
    expect(source).toContain("exposureResolver");
    expect(source).toContain("audienceResolver");
    expect(source).toContain("resolveAudience");
    const inputSection = source.slice(
      source.indexOf("export type ReadPublicationInput"),
      source.indexOf("export type ReadPublicationResult"),
    );
    expect(inputSection).not.toContain("contentExposure");
    expect(inputSection).not.toContain("audienceDecision");
    expect(source).not.toContain("assuranceAtLeast");
    expect(source).not.toContain("MEMBERSHIP_NOT_ELIGIBLE");
    expect(source).not.toContain("VERIFIED_MEMBERS");
  });

  it("routes Publication collections through the canonical policy and stays server-only", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/application/content/list-publications.ts"),
      "utf8",
    );

    expect(source).toContain('import "server-only"');
    expect(source).toContain("authorizeResourceRead");
    expect(source).toContain("mapPublicationToResourceAccessFacts");
    expect(source).toContain("resolveExposure");
    expect(source).toContain("MAX_PUBLICATION_CANDIDATES_SCANNED");
    expect(source).toContain("MIN_PUBLICATION_CANDIDATE_BATCH_SIZE");
    expect(source).toContain("MAX_PUBLICATION_COLLECTION_QUERY_ROUNDS");
    expect(source).toContain("queryRounds");
    expect(source).not.toContain("audienceDecision: { evaluated: true");
    expect(source).not.toMatch(/\.offset\s*\(/i);
    expect(source).not.toContain("supabase");
  });
});
