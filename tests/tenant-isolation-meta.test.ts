import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";
import {
  GOVERNED_SURFACE_ROOTS,
  type RegistryValidationInput,
  type TenantSurfaceRegistryEntry,
  tenantSurfaceRegistry,
  validateTenantSurfaceRegistry,
} from "@/server/tenancy/tenant-surface-registry";

import { tenantIsolationProbeRegistry } from "./tenant-isolation-probes";

const repositoryRoot = process.cwd();

function toRepositoryPath(filePath: string): string {
  return path.relative(repositoryRoot, filePath).split(path.sep).join("/");
}

function collectGovernedImplementationPaths(
  relativeDirectory: string,
  collected: string[] = [],
): string[] {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  if (!existsSync(absoluteDirectory)) {
    return collected;
  }

  for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
    const absoluteEntryPath = path.join(absoluteDirectory, entry.name);
    if (entry.isDirectory()) {
      collectGovernedImplementationPaths(
        path.join(relativeDirectory, entry.name),
        collected,
      );
      continue;
    }

    if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      collected.push(toRepositoryPath(absoluteEntryPath));
    }
  }

  return collected.sort();
}

function implementationPathForDatabaseObject(
  databaseObjectName: string,
): string {
  const knownPaths: Record<string, string> = {
    tenants: "src/server/db/schema/tenant.ts",
    memberships: "src/server/db/schema/membership.ts",
    publications: "src/server/db/schema/publication.ts",
  };

  return (
    knownPaths[databaseObjectName] ??
    `src/server/db/schema/${databaseObjectName}.ts`
  );
}

function discoverTenantModels() {
  const discoveredModels = [];

  for (const candidate of Object.values(schema)) {
    let tableConfig;
    try {
      tableConfig = getTableConfig(candidate as never);
    } catch {
      continue;
    }

    const columns = Object.values(tableConfig.columns) as Array<{
      name: string;
    }>;
    const isTenantRoot = tableConfig.name === "tenants";
    const isTenantScoped = columns.some((column) => column.name === "tenant_id");
    if (!isTenantRoot && !isTenantScoped) {
      continue;
    }

    discoveredModels.push({
      databaseObjectName: tableConfig.name,
      implementationPath: implementationPathForDatabaseObject(tableConfig.name),
      tenantScope: isTenantRoot ? ("TENANT_ROOT" as const) : ("TENANT_SCOPED" as const),
    });
  }

  return discoveredModels;
}

function currentRegistryValidationInput(): RegistryValidationInput {
  return {
    registry: tenantSurfaceRegistry,
    discoveredTenantModels: discoverTenantModels(),
    governedImplementationPaths: GOVERNED_SURFACE_ROOTS.flatMap((root) =>
      collectGovernedImplementationPaths(root),
    ),
    implementationPathExists: (implementationPath) =>
      existsSync(path.join(repositoryRoot, implementationPath)),
    isolationProbeIds: new Set(Object.keys(tenantIsolationProbeRegistry)),
  };
}

function fixtureEntry(
  overrides: Partial<TenantSurfaceRegistryEntry> = {},
): TenantSurfaceRegistryEntry {
  return {
    id: "fixture.model",
    category: "model",
    implementationPath: "src/fixture.ts",
    surface: "fixtures",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "fixture Tenant predicate",
    requiredNegativeTestIds: ["fixture.probe"],
    databaseObjectName: "fixtures",
    ...overrides,
  };
}

function fixtureInput(
  overrides: Partial<RegistryValidationInput> = {},
): RegistryValidationInput {
  return {
    registry: [fixtureEntry()],
    discoveredTenantModels: [
      {
        databaseObjectName: "fixtures",
        implementationPath: "src/fixture.ts",
        tenantScope: "TENANT_SCOPED",
      },
    ],
    governedImplementationPaths: ["src/fixture.ts"],
    implementationPathExists: () => true,
    isolationProbeIds: new Set(["fixture.probe"]),
    ...overrides,
  };
}

describe("Tenant isolation governance registry", () => {
  it("declares discovered Tenant models and every governed implementation path", () => {
    expect(validateTenantSurfaceRegistry(currentRegistryValidationInput())).toEqual(
      [],
    );
  });

  for (const [probeId, probe] of Object.entries(tenantIsolationProbeRegistry)) {
    it(`executes required isolation probe ${probeId}`, async () => {
      await probe();
    });
  }

  it("fails when a governed surface has no registry entry", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({ governedImplementationPaths: ["src/undeclared.ts"] }),
    );
    expect(errors).toContain("governed surface is undeclared: src/undeclared.ts");
  });

  it("fails when a scoped declaration has no executable isolation probe", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [fixtureEntry({ requiredNegativeTestIds: ["missing.probe"] })],
        isolationProbeIds: new Set(),
      }),
    );
    expect(errors).toContain(
      "missing isolation probe missing.probe required by fixture.model",
    );
  });

  it("fails on duplicate stable registry IDs", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [
          fixtureEntry(),
          fixtureEntry({
            implementationPath: "src/other-fixture.ts",
            databaseObjectName: "other-fixtures",
          }),
        ],
        governedImplementationPaths: [
          "src/fixture.ts",
          "src/other-fixture.ts",
        ],
      }),
    );
    expect(errors).toContain("duplicate registry ID: fixture.model");
  });

  it("fails on an invalid scoped declaration", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [
          fixtureEntry({ isolationStrategy: "", requiredNegativeTestIds: [] }),
        ],
      }),
    );
    expect(errors).toContain(
      "TENANT_SCOPED entry lacks isolation strategy: fixture.model",
    );
    expect(errors).toContain(
      "TENANT_SCOPED entry lacks negative-test obligation: fixture.model",
    );
  });

  it("fails when structural discovery finds an undeclared Tenant-owned model", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        discoveredTenantModels: [
          {
            databaseObjectName: "future_records",
            implementationPath: "src/server/db/schema/future-record.ts",
            tenantScope: "TENANT_SCOPED",
          },
        ],
      }),
    );
    expect(errors).toContain(
      "discovered Tenant-owned model is undeclared: future_records",
    );
  });

  it("fails when a declared implementation path disappears", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [fixtureEntry({ implementationPath: "src/missing.ts" })],
        discoveredTenantModels: [],
        governedImplementationPaths: ["src/missing.ts"],
        implementationPathExists: () => false,
      }),
    );
    expect(errors).toContain(
      "implementation path missing for fixture.model: src/missing.ts",
    );
  });

  it("fails when a future sensitive surface appears without an explicit declaration", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        governedImplementationPaths: ["src/server/jobs/send-digest.ts"],
      }),
    );
    expect(errors).toContain(
      "governed surface is undeclared: src/server/jobs/send-digest.ts",
    );
  });
});
