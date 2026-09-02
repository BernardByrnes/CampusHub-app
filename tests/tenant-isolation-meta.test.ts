import { existsSync } from "node:fs";
import path from "node:path";

import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "@/server/db/schema";
import {
  type RegistryValidationInput,
  type TenantSurfaceRegistryEntry,
  tenantSurfaceRegistry,
  validateTenantSurfaceRegistry,
} from "@/server/tenancy/tenant-surface-registry";

import {
  discoverGovernedImplementationPaths,
  discoverGovernedImplementationPathsFromRelativePaths,
  discoverGovernedOperations,
  discoverGovernedUnsupportedOperationForms,
  discoverMigrationPaths,
  discoverMigrationPathsFromRelativePaths,
  discoverOperationsFromSource,
  discoverUnsupportedOperationFormsFromSource,
  findProductionImportBoundaryViolations,
} from "./tenant-isolation-discovery";
import { tenantIsolationProbeRegistry } from "./tenant-isolation-probes";

const repositoryRoot = process.cwd();

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
  const governedImplementationPaths = discoverGovernedImplementationPaths(
    repositoryRoot,
  );

  return {
    registry: tenantSurfaceRegistry,
    discoveredTenantModels: discoverTenantModels(),
    governedImplementationPaths,
    discoveredOperations: discoverGovernedOperations(
      repositoryRoot,
      governedImplementationPaths,
    ),
    discoveredUnsupportedOperationForms:
      discoverGovernedUnsupportedOperationForms(
        repositoryRoot,
        governedImplementationPaths,
      ),
    productionImportBoundaryViolations:
      findProductionImportBoundaryViolations(repositoryRoot),
    discoveredMigrationPaths: discoverMigrationPaths(repositoryRoot),
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
    isolationStrategy: "Fixture Tenant predicate and negative probe.",
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
    discoveredOperations: [],
    discoveredUnsupportedOperationForms: [],
    productionImportBoundaryViolations: [],
    discoveredMigrationPaths: [],
    implementationPathExists: () => true,
    isolationProbeIds: new Set(["fixture.probe"]),
    ...overrides,
  };
}

describe("Tenant isolation governance registry", () => {
  it("declares discovered Tenant models, operations, migrations, and every governed path", () => {
    expect(validateTenantSurfaceRegistry(currentRegistryValidationInput())).toEqual(
      [],
    );
  });

  for (const [probeId, probe] of Object.entries(tenantIsolationProbeRegistry)) {
    it(`executes required isolation probe ${probeId}`, async () => {
      await probe();
    });
  }

  it("discovers every governed source extension, including alternate server and API files", () => {
    const discovered = discoverGovernedImplementationPathsFromRelativePaths([
      "src/app/api/future/route.ts",
      "src/app/api/future/route.tsx",
      "src/app/api/future/route.js",
      "src/app/api/future/route.jsx",
      "src/app/api/future/route.mts",
      "src/app/api/future/route.cts",
      "src/app/api/future/route.mjs",
      "src/app/api/future/route.cjs",
      "src/server/services/event-service.ts",
      "src/server/services/nested/event-service.js",
      "src/server/jobs/send-notifications.mts",
      "src/server/jobs/worker.cjs",
      "src/app/api/future/route.test.ts",
      "src/server/jobs/worker.spec.ts",
    ]);

    expect(discovered).toEqual([
      "src/app/api/future/route.cjs",
      "src/app/api/future/route.cts",
      "src/app/api/future/route.js",
      "src/app/api/future/route.jsx",
      "src/app/api/future/route.mjs",
      "src/app/api/future/route.mts",
      "src/app/api/future/route.ts",
      "src/app/api/future/route.tsx",
      "src/server/jobs/send-notifications.mts",
      "src/server/jobs/worker.cjs",
      "src/server/services/event-service.ts",
      "src/server/services/nested/event-service.js",
    ]);

    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        governedImplementationPaths: discovered,
        implementationPathExists: (implementationPath) =>
          implementationPath === "src/fixture.ts",
      }),
    );
    for (const implementationPath of discovered) {
      expect(errors).toContain(`governed surface is undeclared: ${implementationPath}`);
    }
  });

  it("discovers route handler operations as well as exported public functions", () => {
    const operations = discoverOperationsFromSource(
      "src/app/api/example/route.ts",
      `export function GET() { return new Response(); }
       export const POST = () => new Response();`,
    );

    expect(operations).toEqual([
      {
        implementationPath: "src/app/api/example/route.ts",
        operation: "GET",
        kind: "route_handler",
      },
      {
        implementationPath: "src/app/api/example/route.ts",
        operation: "POST",
        kind: "route_handler",
      },
    ]);
  });

  it("fails when an alternate server directory has no registry entry", () => {
    const paths = discoverGovernedImplementationPathsFromRelativePaths([
      "src/server/services/event-service.ts",
      "src/server/services/nested/event-service.ts",
      "src/app/api/admin/route.ts",
    ]);
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({ governedImplementationPaths: paths }),
    );

    expect(errors).toContain(
      "governed surface is undeclared: src/server/services/event-service.ts",
    );
    expect(errors).toContain(
      "governed surface is undeclared: src/server/services/nested/event-service.ts",
    );
    expect(errors).toContain(
      "governed surface is undeclared: src/app/api/admin/route.ts",
    );
  });

  it("discovers common callable export forms and requires each operation declaration", () => {
    const fixtures = [
      {
        implementationPath: "src/server/services/class-fields.ts",
        category: "application_service" as const,
        sourceText: `
          export class FieldService {
            public classField = async () => true;
            public static staticField = () => true;
            public overloaded(value: string): boolean;
            public overloaded(value: unknown) { return Boolean(value); }
            private hidden = () => false;
          }
        `,
      },
      {
        implementationPath: "src/server/services/exported-object.ts",
        category: "application_service" as const,
        sourceText: `
          export const service = {
            create() { return true; },
            read: () => true,
          };
        `,
      },
      {
        implementationPath: "src/app/api/aliases/route.ts",
        category: "route" as const,
        sourceText: `
          const postHandler = () => new Response();
          function getHandler() { return new Response(); }
          export { postHandler as POST, getHandler as GET };
        `,
      },
      {
        implementationPath: "src/server/services/anonymous-default.ts",
        category: "application_service" as const,
        sourceText: `
          export default class {
            public execute() { return true; }
          }
        `,
      },
    ];

    for (const [fixtureIndex, fixture] of fixtures.entries()) {
      const discoveredOperations = discoverOperationsFromSource(
        fixture.implementationPath,
        fixture.sourceText,
      );
      expect(discoveredOperations.length).toBeGreaterThan(0);

      const registry = discoveredOperations.map((operation, operationIndex) =>
        fixtureEntry({
          id: `callable.fixture.${fixtureIndex}.${operationIndex}`,
          category: fixture.category,
          implementationPath: fixture.implementationPath,
          operation: operation.operation,
          databaseObjectName: undefined,
        }),
      );
      const input = fixtureInput({
        registry,
        discoveredTenantModels: [],
        governedImplementationPaths: [fixture.implementationPath],
        discoveredOperations,
        implementationPathExists: () => true,
      });

      expect(validateTenantSurfaceRegistry(input)).toEqual([]);

      for (const operation of discoveredOperations) {
        const errors = validateTenantSurfaceRegistry({
          ...input,
          registry: registry.filter(
            (entry) => entry.operation !== operation.operation,
          ),
        });
        expect(errors).toContain(
          `governed operation is undeclared: ${fixture.implementationPath}#${operation.operation}`,
        );
      }
    }

    expect(
      discoverOperationsFromSource(
        "src/server/services/class-fields.ts",
        fixtures[0].sourceText,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "FieldService.classField" }),
        expect.objectContaining({ operation: "FieldService.staticField" }),
        expect.objectContaining({ operation: "FieldService.overloaded" }),
      ]),
    );
    expect(
      discoverOperationsFromSource(
        "src/app/api/aliases/route.ts",
        fixtures[2].sourceText,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "GET", kind: "route_handler" }),
        expect.objectContaining({ operation: "POST", kind: "route_handler" }),
      ]),
    );
    expect(
      discoverOperationsFromSource(
        "src/server/services/anonymous-default.ts",
        fixtures[3].sourceText,
      ),
    ).toContainEqual({
      implementationPath: "src/server/services/anonymous-default.ts",
      operation:
        "default@src/server/services/anonymous-default.ts.execute",
      kind: "class_method",
    });
  });

  it("fails closed on an unresolved exported callable factory form", () => {
    const implementationPath = "src/server/services/factory-service.ts";
    const unsupported = discoverUnsupportedOperationFormsFromSource(
      implementationPath,
      `export const service = makeService();`,
    );

    expect(unsupported).toHaveLength(1);
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        discoveredTenantModels: [],
        governedImplementationPaths: [implementationPath],
        discoveredUnsupportedOperationForms: unsupported,
      }),
    );
    expect(errors).toContain(
      "unsupported governed callable form: src/server/services/factory-service.ts: exported service factory call has no statically discoverable callable target",
    );
  });

  it("fails when a newly discovered SQL migration is not in the declared history/head", () => {
    const currentMigrations = [
      "drizzle/0000_young_adam_warlock.sql",
      "drizzle/0001_luxuriant_monster_badoon.sql",
      "drizzle/0002_talented_timeslip.sql",
      "drizzle/0003_skinny_boom_boom.sql",
      "drizzle/0004_right_whizzer.sql",
    ];
    const discoveredMigrations = discoverMigrationPathsFromRelativePaths([
      ...currentMigrations,
      "drizzle/0005_new.sql",
      "drizzle/meta/not-a-migration.json",
    ]);
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [
          fixtureEntry(),
          {
            id: "fixture.migrations",
            category: "migration",
            implementationPath: "drizzle/0004_right_whizzer.sql",
            surface: "fixture migration history",
            tenantScope: "GLOBAL_NON_TENANT",
            isolationStrategy: "Fixture migration governance.",
            requiredNegativeTestIds: [],
            globalExemptionReason: "Fixture migration metadata changes schema only, not resource data.",
            declaredImplementationPaths: currentMigrations,
            migrationHead: "drizzle/0004_right_whizzer.sql",
          },
        ],
        discoveredMigrationPaths: discoveredMigrations,
      }),
    );

    expect(errors).toContain(
      "migration history declaration does not match discovered SQL migrations",
    );
    expect(errors).toContain(
      "migration head is not the current discovered head: drizzle/0004_right_whizzer.sql",
    );
  });

  it("fails when an existing route or job is declared FUTURE_NOT_IMPLEMENTED", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [
          fixtureEntry(),
          fixtureEntry({
            id: "future.route",
            category: "route",
            implementationPath: "src/app/api/future/route.ts",
            surface: "future route",
            tenantScope: "FUTURE_NOT_IMPLEMENTED",
            requiredNegativeTestIds: [],
            isolationStrategy: "Future route requires explicit Tenant contract.",
          }),
          fixtureEntry({
            id: "future.job",
            category: "job",
            implementationPath: "src/server/jobs/future-job.ts",
            surface: "future job",
            tenantScope: "FUTURE_NOT_IMPLEMENTED",
            requiredNegativeTestIds: [],
            isolationStrategy: "Future job requires durable Tenant context.",
          }),
        ],
        governedImplementationPaths: [
          "src/fixture.ts",
          "src/app/api/future/route.ts",
          "src/server/jobs/future-job.ts",
        ],
        implementationPathExists: () => true,
      }),
    );

    expect(errors).toContain(
      "FUTURE_NOT_IMPLEMENTED entry has an existing implementation: future.route: src/app/api/future/route.ts",
    );
    expect(errors).toContain(
      "FUTURE_NOT_IMPLEMENTED entry has an existing implementation: future.job: src/server/jobs/future-job.ts",
    );
  });

  it("fails when a Tenant root classification is assigned to an ordinary application service", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [
          fixtureEntry({
            category: "application_service",
            tenantScope: "TENANT_ROOT",
          }),
        ],
      }),
    );

    expect(errors).toContain(
      "illegal category/scope pair for fixture.model: application_service/TENANT_ROOT",
    );
    expect(errors).toContain(
      "TENANT_ROOT entry is not an approved Tenant-root contract: fixture.model",
    );
  });

  it("fails when a model or repository declaration abuses FUTURE or root semantics", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [
          fixtureEntry({
            id: "future.model",
            tenantScope: "FUTURE_NOT_IMPLEMENTED",
            requiredNegativeTestIds: [],
            isolationStrategy: "Future model requires reviewed Tenant ownership.",
            implementationPath: "src/server/db/schema/future.ts",
          }),
          fixtureEntry({
            id: "publication.repository.root-abuse",
            category: "repository",
            tenantScope: "TENANT_ROOT",
            implementationPath: "src/server/repositories/publication-repository.ts",
            operation: "DrizzlePublicationRepository.createPublication",
          }),
        ],
        governedImplementationPaths: [
          "src/server/db/schema/future.ts",
          "src/server/repositories/publication-repository.ts",
        ],
        implementationPathExists: () => true,
      }),
    );

    expect(errors).toContain(
      "TENANT_ROOT entry is not an approved Tenant-root contract: publication.repository.root-abuse",
    );
    expect(errors).toContain(
      "FUTURE_NOT_IMPLEMENTED entry has an existing implementation: future.model: src/server/db/schema/future.ts",
    );
  });

  it("fails on an illegal migration-scoped classification", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [
          fixtureEntry({
            category: "migration",
            tenantScope: "TENANT_SCOPED",
          }),
        ],
      }),
    );

    expect(errors).toContain(
      "illegal category/scope pair for fixture.model: migration/TENANT_SCOPED",
    );
  });

  it("fails when a GLOBAL_NON_TENANT entry has no specific exemption", () => {
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [
          fixtureEntry({
            tenantScope: "GLOBAL_NON_TENANT",
            requiredNegativeTestIds: [],
            globalExemptionReason: "global",
          }),
        ],
      }),
    );

    expect(errors).toContain(
      "GLOBAL_NON_TENANT entry lacks a specific exemption reason: fixture.model",
    );
  });

  it("rejects plausible falsely-global Publication, Job, Route, and Cache entries", () => {
    const falselyGlobalEntries = [
      fixtureEntry({
        id: "publication.create",
        category: "application_service",
        implementationPath: "src/application/content/create-publication.ts",
        surface: "CreatePublicationService.createPublication",
        tenantScope: "GLOBAL_NON_TENANT",
        operation: "CreatePublicationService.createPublication",
        requiredNegativeTestIds: [],
        globalExemptionReason:
          "A publication writer is treated as global for a shared process service.",
      }),
      fixtureEntry({
        id: "global.fake.job",
        category: "job",
        implementationPath: "src/server/jobs/fake-job.ts",
        surface: "fake Tenant job",
        tenantScope: "GLOBAL_NON_TENANT",
        requiredNegativeTestIds: [],
        globalExemptionReason:
          "This scheduled job runs globally and therefore needs no Tenant context.",
      }),
      fixtureEntry({
        id: "global.fake.route",
        category: "route",
        implementationPath: "src/app/api/fake/route.ts",
        surface: "POST /api/fake",
        tenantScope: "GLOBAL_NON_TENANT",
        operation: "POST",
        requiredNegativeTestIds: [],
        globalExemptionReason:
          "This route is globally reachable and returns a process-level response.",
      }),
      fixtureEntry({
        id: "global.fake.cache",
        category: "cache",
        implementationPath: "src/server/cache/fake-cache.ts",
        surface: "fake cache",
        tenantScope: "GLOBAL_NON_TENANT",
        requiredNegativeTestIds: [],
        globalExemptionReason:
          "This cache is shared process infrastructure and is therefore global.",
      }),
    ];

    for (const entry of falselyGlobalEntries) {
      const errors = validateTenantSurfaceRegistry(
        fixtureInput({ registry: [entry] }),
      );
      expect(errors).toContain(
        `GLOBAL_NON_TENANT entry is not on the reviewed allowlist: ${entry.id}`,
      );
    }

    const tamperedReviewedEntry = fixtureEntry({
      id: "global.health.route",
      category: "route",
      implementationPath: "src/app/api/fake/route.ts",
      surface: "POST /api/fake",
      tenantScope: "GLOBAL_NON_TENANT",
      operation: "POST",
      requiredNegativeTestIds: [],
      globalExemptionReason:
        "This route is globally reachable and returns a process-level response.",
    });
    expect(
      validateTenantSurfaceRegistry(
        fixtureInput({ registry: [tamperedReviewedEntry] }),
      ),
    ).toContain(
      "GLOBAL_NON_TENANT entry does not match its reviewed contract: global.health.route",
    );
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

  it("fails when a public method in a declared file is not registered", () => {
    const implementationPath = "src/server/services/event-service.ts";
    const discoveredOperations = discoverOperationsFromSource(
      implementationPath,
      `export class EventService {
         public allowed() { return true; }
         public unregistered() { return false; }
       }`,
    );
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [
          fixtureEntry({
            id: "event.service",
            category: "application_service",
            implementationPath,
            operation: "EventService.allowed",
            databaseObjectName: undefined,
          }),
        ],
        discoveredTenantModels: [],
        governedImplementationPaths: [implementationPath],
        discoveredOperations,
        implementationPathExists: () => true,
      }),
    );

    expect(errors).toContain(
      "governed operation is undeclared: src/server/services/event-service.ts#EventService.unregistered",
    );
  });

  it("fails when the Publication create operation is removed from the registry", () => {
    const current = currentRegistryValidationInput();
    const errors = validateTenantSurfaceRegistry({
      ...current,
      registry: tenantSurfaceRegistry.filter(
        (entry) => entry.id !== "publication.create",
      ),
    });

    expect(errors).toContain(
      "governed operation is undeclared: src/application/content/create-publication.ts#CreatePublicationService.createPublication",
    );
  });
});
