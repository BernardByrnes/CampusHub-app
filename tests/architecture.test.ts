import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findProductionImportBoundaryViolations,
  findProductionImportBoundaryViolationsFromSources,
} from "./tenant-isolation-discovery";

const serverOnlyModules = [
  "src/server/config/env.ts",
  "src/server/context/request-context.ts",
  "src/server/context/create-request-context-resolver.ts",
  "src/server/db/client.ts",
  "src/server/tenancy/tenant-surface-registry.ts",
  "src/server/repositories/membership-repository.ts",
  "src/server/repositories/publication-repository.ts",
  "src/server/repositories/tenant-repository.ts",
  "src/server/repositories/guild-term-repository.ts",
  "src/server/repositories/role-grant-repository.ts",
  "src/server/authorization/postgres-capability-authorizer.ts",
  "src/application/context/resolve-request-context.ts",
  "src/application/content/read-publication.ts",
  "src/application/content/list-publications.ts",
  "src/application/content/create-publication.ts",
  "src/application/content/publication-read-resolvers.ts",
  "src/domain/authorization/context-policy.ts",
  "src/domain/authorization/capability.ts",
  "src/domain/authorization/capability-authorization.ts",
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

  it("rejects production imports into excluded test/spec paths while permitting test-to-test imports", () => {
    expect(findProductionImportBoundaryViolations(process.cwd())).toEqual([]);

    const violations = findProductionImportBoundaryViolationsFromSources([
      {
        relativePath: "src/server/service.ts",
        sourceText: `
          import "./tests/live-tenant-service";
          import "./fixtures/helper.test-helper";
          import "@/server/fixtures/helper.spec";
          import "./jobs/process.e2e";
          import "./fixtures/allowed";
        `,
      },
      {
        relativePath: "src/server/tests/live-tenant-service.ts",
        sourceText: "export const liveTenantService = true;",
      },
      {
        relativePath: "src/server/fixtures/helper.test-helper.ts",
        sourceText: "export const testHelper = true;",
      },
      {
        relativePath: "src/server/fixtures/helper.spec.ts",
        sourceText: "export const specHelper = true;",
      },
      {
        relativePath: "src/server/jobs/process.e2e.ts",
        sourceText: "export const e2eProcess = true;",
      },
      {
        relativePath: "src/server/fixtures/allowed.ts",
        sourceText: "export const allowed = true;",
      },
      {
        relativePath: "src/server/repositories/repository.test.ts",
        sourceText: `import "./repository.test-helper";`,
      },
      {
        relativePath: "src/server/repositories/repository.test-helper.ts",
        sourceText: "export const repositoryTestHelper = true;",
      },
    ]);

    expect(violations).toEqual(
      expect.arrayContaining([
        {
          fromPath: "src/server/service.ts",
          specifier: "./tests/live-tenant-service",
          resolvedPath: "src/server/tests/live-tenant-service.ts",
        },
        {
          fromPath: "src/server/service.ts",
          specifier: "./fixtures/helper.test-helper",
          resolvedPath: "src/server/fixtures/helper.test-helper.ts",
        },
        {
          fromPath: "src/server/service.ts",
          specifier: "@/server/fixtures/helper.spec",
          resolvedPath: "src/server/fixtures/helper.spec.ts",
        },
        {
          fromPath: "src/server/service.ts",
          specifier: "./jobs/process.e2e",
          resolvedPath: "src/server/jobs/process.e2e.ts",
        },
      ]),
    );
    expect(violations).toHaveLength(4);
  });

  it("resolves repository-root tests and every static local import form fail closed", () => {
    const violations = findProductionImportBoundaryViolationsFromSources([
      {
        relativePath: "src/server/services/example.ts",
        sourceText: `
          import "../../../tests/root.test-helper";
          import "../tests/in-src.test";
          import "@/server/fixtures/alias.spec";
          import "../jobs/process.e2e";
          import helper = require("../../../tests/import-equals.test");
          const dynamic = import("../../../tests/dynamic.test");
          const required = require("../../../tests/require.test");
          export { helper } from "../../../tests/reexport.test";
          import "../../../../tests/escape.test";
        `,
      },
      {
        relativePath: "tests/root.test-helper.ts",
        sourceText: "export const rootHelper = true;",
      },
      {
        relativePath: "src/server/tests/in-src.test.ts",
        sourceText: "export const inSrcTest = true;",
      },
      {
        relativePath: "src/server/fixtures/alias.spec.ts",
        sourceText: "export const aliasSpec = true;",
      },
      {
        relativePath: "src/server/jobs/process.e2e.ts",
        sourceText: "export const e2eProcess = true;",
      },
      {
        relativePath: "tests/import-equals.test.ts",
        sourceText: "export const importEquals = true;",
      },
      {
        relativePath: "tests/dynamic.test.ts",
        sourceText: "export const dynamic = true;",
      },
      {
        relativePath: "tests/require.test.ts",
        sourceText: "export const required = true;",
      },
      {
        relativePath: "tests/reexport.test.ts",
        sourceText: "export const helper = true;",
      },
      {
        relativePath: "tests/escape.test.ts",
        sourceText: "export const escape = true;",
      },
      {
        relativePath: "tests/test-to-test.test.ts",
        sourceText: 'import "./root.test-helper";',
      },
    ]);

    expect(violations).toEqual(
      expect.arrayContaining([
        {
          fromPath: "src/server/services/example.ts",
          specifier: "../../../tests/root.test-helper",
          resolvedPath: "tests/root.test-helper.ts",
        },
        {
          fromPath: "src/server/services/example.ts",
          specifier: "../tests/in-src.test",
          resolvedPath: "src/server/tests/in-src.test.ts",
        },
        {
          fromPath: "src/server/services/example.ts",
          specifier: "@/server/fixtures/alias.spec",
          resolvedPath: "src/server/fixtures/alias.spec.ts",
        },
        {
          fromPath: "src/server/services/example.ts",
          specifier: "../jobs/process.e2e",
          resolvedPath: "src/server/jobs/process.e2e.ts",
        },
        {
          fromPath: "src/server/services/example.ts",
          specifier: "../../../tests/import-equals.test",
          resolvedPath: "tests/import-equals.test.ts",
        },
        {
          fromPath: "src/server/services/example.ts",
          specifier: "../../../tests/dynamic.test",
          resolvedPath: "tests/dynamic.test.ts",
        },
        {
          fromPath: "src/server/services/example.ts",
          specifier: "../../../tests/require.test",
          resolvedPath: "tests/require.test.ts",
        },
        {
          fromPath: "src/server/services/example.ts",
          specifier: "../../../tests/reexport.test",
          resolvedPath: "tests/reexport.test.ts",
        },
      ]),
    );
    expect(violations).toHaveLength(8);
    expect(
      violations.some(
        (violation) =>
          violation.specifier === "../../../../tests/escape.test" ||
          violation.resolvedPath.startsWith("../"),
      ),
    ).toBe(false);
  });

  it("covers template and module.require loaders while failing closed for unresolved loaders", () => {
    const violations = findProductionImportBoundaryViolationsFromSources([
      {
        relativePath: "src/server/services/loader-matrix.ts",
        sourceText: [
          'const requiredRoot = require("../../../tests/loader-require-root.test");',
          'const requiredInSrc = require("../tests/loader-require-in-src.test");',
          'const templateRequiredRoot = require(`../../../tests/loader-template-require-root.test`);',
          'const templateRequiredInSrc = require(`../tests/loader-template-require-in-src.test`);',
          'const dynamicRoot = import("../../../tests/loader-dynamic-root.test");',
          'const dynamicInSrc = import(`../tests/loader-dynamic-in-src.test`);',
          'const moduleRequiredRoot = module.require("../../../tests/loader-module-require-root.test");',
          'const moduleRequiredInSrc = module.require(`../tests/loader-module-require-in-src.test`);',
          'const moduleElementRoot = module["require"]("../../../tests/loader-module-element-root.test");',
          'const moduleElementInSrc = module[`require`](`../tests/loader-module-element-in-src.test`);',
          'const unresolvedStatic = require("../tests/missing-loader");',
          'const unresolvedRequire = require(`../../../tests/${name}`);',
          'const unresolvedDynamic = import(`../tests/${name}`);',
          'const unresolvedModuleRequire = module.require(loaderPath);',
          'import "some-package";',
          'require("some-package");',
          'require(`some-template-package`);',
          'import("some-dynamic-package");',
          'module.require("some-module-package");',
          'module["require"](`some-element-package`);',
        ].join("\n"),
      },
      ...[
        "tests/loader-require-root.test.ts",
        "src/server/tests/loader-require-in-src.test.ts",
        "tests/loader-template-require-root.test.ts",
        "src/server/tests/loader-template-require-in-src.test.ts",
        "tests/loader-dynamic-root.test.ts",
        "src/server/tests/loader-dynamic-in-src.test.ts",
        "tests/loader-module-require-root.test.ts",
        "src/server/tests/loader-module-require-in-src.test.ts",
        "tests/loader-module-element-root.test.ts",
        "src/server/tests/loader-module-element-in-src.test.ts",
      ].map((relativePath) => ({
        relativePath,
        sourceText: "export const fixture = true;",
      })),
    ]);

    const resolvedBoundaryViolations = violations.filter(
      (violation) => violation.kind === undefined,
    );
    expect(resolvedBoundaryViolations).toEqual(
      expect.arrayContaining([
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../../../tests/loader-require-root.test",
          resolvedPath: "tests/loader-require-root.test.ts",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../tests/loader-require-in-src.test",
          resolvedPath: "src/server/tests/loader-require-in-src.test.ts",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../../../tests/loader-template-require-root.test",
          resolvedPath: "tests/loader-template-require-root.test.ts",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../tests/loader-template-require-in-src.test",
          resolvedPath: "src/server/tests/loader-template-require-in-src.test.ts",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../../../tests/loader-dynamic-root.test",
          resolvedPath: "tests/loader-dynamic-root.test.ts",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../tests/loader-dynamic-in-src.test",
          resolvedPath: "src/server/tests/loader-dynamic-in-src.test.ts",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../../../tests/loader-module-require-root.test",
          resolvedPath: "tests/loader-module-require-root.test.ts",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../tests/loader-module-require-in-src.test",
          resolvedPath: "src/server/tests/loader-module-require-in-src.test.ts",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../../../tests/loader-module-element-root.test",
          resolvedPath: "tests/loader-module-element-root.test.ts",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../tests/loader-module-element-in-src.test",
          resolvedPath: "src/server/tests/loader-module-element-in-src.test.ts",
        },
      ]),
    );
    expect(resolvedBoundaryViolations).toHaveLength(10);

    const unresolvedLoaderViolations = violations.filter(
      (violation) => violation.kind === "unresolved_loader",
    );
    expect(unresolvedLoaderViolations).toEqual(
      expect.arrayContaining([
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "../tests/missing-loader",
          resolvedPath: "<unresolved local loader>",
          kind: "unresolved_loader",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "<non-static require loader argument>",
          resolvedPath: "<unresolved local loader>",
          kind: "unresolved_loader",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "<non-static dynamic-import loader argument>",
          resolvedPath: "<unresolved local loader>",
          kind: "unresolved_loader",
        },
        {
          fromPath: "src/server/services/loader-matrix.ts",
          specifier: "<non-static module-require loader argument>",
          resolvedPath: "<unresolved local loader>",
          kind: "unresolved_loader",
        },
      ]),
    );
    expect(unresolvedLoaderViolations).toHaveLength(4);
    expect(
      violations.some((violation) =>
        violation.specifier.includes("some-package"),
      ),
    ).toBe(false);
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
    expect(source).not.toContain('eq(publications.audienceMode, "entire_tenant")');
    expect(source).toContain("findPublicationAudienceDefinitionsForTenant");
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
