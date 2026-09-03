import { existsSync, readFileSync } from "node:fs";
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

function currentRegistryValidationInputWithSourceOverrides(
  sourceOverrides: Readonly<Record<string, string>>,
  baseInput: RegistryValidationInput = currentRegistryValidationInput(),
): RegistryValidationInput {
  const overriddenPaths = new Set(
    baseInput.governedImplementationPaths.filter(
      (implementationPath) => sourceOverrides[implementationPath] !== undefined,
    ),
  );
  const overriddenOperations = [...overriddenPaths].flatMap(
    (implementationPath) =>
      discoverOperationsFromSource(
        implementationPath,
        sourceOverrides[implementationPath]!,
      ),
  );
  const overriddenUnsupported = [...overriddenPaths].flatMap(
    (implementationPath) =>
      discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceOverrides[implementationPath]!,
      ),
  );

  return {
    ...baseInput,
    discoveredOperations: [
      ...baseInput.discoveredOperations.filter(
        (operation) => !overriddenPaths.has(operation.implementationPath),
      ),
      ...overriddenOperations,
    ],
    discoveredUnsupportedOperationForms: [
      ...baseInput.discoveredUnsupportedOperationForms.filter(
        (form) => !overriddenPaths.has(form.implementationPath),
      ),
      ...overriddenUnsupported,
    ],
  };
}

function expectFullRegistryValidationFailure(
  sourceOverrides: Readonly<Record<string, string>>,
  implementationPath: string,
  baseInput?: RegistryValidationInput,
): void {
  const errors = validateTenantSurfaceRegistry(
    currentRegistryValidationInputWithSourceOverrides(sourceOverrides, baseInput),
  );
  expect(errors).toEqual(
    expect.arrayContaining([
      expect.stringContaining(implementationPath),
    ]),
  );
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
  }, 30_000);

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

  it("fails closed for unresolved callable factories regardless of the exposed name", () => {
    const cases = [
      {
        implementationPath: "src/server/services/direct-factory.ts",
        sourceText: "export const x = makeService();",
        exposedName: "x",
      },
      {
        implementationPath: "src/server/services/aliased-factory.ts",
        sourceText: "const x = makeService(); export { x };",
        exposedName: "x",
      },
      {
        implementationPath: "src/server/services/default-factory.ts",
        sourceText: "export default makeService();",
        exposedName: "default",
      },
      {
        implementationPath: "src/server/services/object-factory.ts",
        sourceText: "export const holder = { x: makeService() };",
        exposedName: "holder.x",
      },
      {
        implementationPath: "src/server/services/class-field-factory.ts",
        sourceText: "export class Example { public x = makeService(); }",
        exposedName: "Example.x",
      },
      {
        implementationPath: "src/server/services/bind-factory.ts",
        sourceText: "export const x = existingFunction.bind(null);",
        exposedName: "x",
      },
      {
        implementationPath: "src/server/services/new-factory.ts",
        sourceText: "export const x = new Service();",
        exposedName: "x",
      },
    ];

    for (const testCase of cases) {
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        testCase.implementationPath,
        testCase.sourceText,
      );

      expect(unsupported.length).toBeGreaterThan(0);
      const errors = validateTenantSurfaceRegistry(
        fixtureInput({
          discoveredTenantModels: [],
          governedImplementationPaths: [testCase.implementationPath],
          discoveredUnsupportedOperationForms: unsupported,
        }),
      );
      expect(
        errors.some(
          (error) =>
            error.startsWith(
              `unsupported governed callable form: ${testCase.implementationPath}:`,
            ) && error.includes(testCase.exposedName),
        ),
      ).toBe(true);
    }
  });

  it("accounts for every mandatory runtime export surface form", () => {
    const cases = [
      {
        implementationPath: "src/server/services/destructured-object.ts",
        sourceText: "export const { x } = makeService();",
      },
      {
        implementationPath: "src/server/services/destructured-array.ts",
        sourceText: "export const [x] = makeService();",
      },
      {
        implementationPath: "src/server/services/exported-late-binding.ts",
        sourceText: "export let x; x = makeService();",
      },
      {
        implementationPath: "src/server/services/named-late-binding.ts",
        sourceText: "let x; export { x }; x = makeService();",
      },
      {
        implementationPath: "src/server/services/wildcard-reexport.ts",
        sourceText: 'export * from "./service";',
      },
      {
        implementationPath: "src/server/services/namespace-reexport.ts",
        sourceText: 'export * as service from "./service";',
      },
      {
        implementationPath: "src/server/services/constructor-only.ts",
        sourceText: "export class Dangerous { constructor() {} }",
      },
      {
        implementationPath: "src/server/services/object-late-dot.ts",
        sourceText: "export const holder = {}; holder.x = makeService();",
      },
      {
        implementationPath: "src/server/services/object-late-element.ts",
        sourceText: 'export const holder = {}; holder["x"] = makeService();',
      },
      {
        implementationPath: "src/server/services/object-late-computed.ts",
        sourceText: "export const holder = {}; holder[key] = makeService();",
      },
      {
        implementationPath: "src/server/services/commonjs-dot-module.ts",
        sourceText: "module.exports.x = makeService();",
      },
      {
        implementationPath: "src/server/services/commonjs-element-module.ts",
        sourceText: 'module.exports["x"] = makeService();',
      },
      {
        implementationPath: "src/server/services/commonjs-dot-exports.ts",
        sourceText: "exports.x = makeService();",
      },
      {
        implementationPath: "src/server/services/commonjs-element-exports.ts",
        sourceText: 'exports["x"] = makeService();',
      },
      {
        implementationPath: "src/server/services/commonjs-computed.ts",
        sourceText: "module.exports[key] = makeService();",
      },
    ];

    for (const testCase of cases) {
      const operations = discoverOperationsFromSource(
        testCase.implementationPath,
        testCase.sourceText,
      );
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        testCase.implementationPath,
        testCase.sourceText,
      );

      expect(operations.length + unsupported.length).toBeGreaterThan(0);
    }

    expect(
      discoverOperationsFromSource(
        "src/server/services/constructor-only.ts",
        "export class Dangerous { constructor() {} }",
      ),
    ).toContainEqual({
      implementationPath: "src/server/services/constructor-only.ts",
      operation: "Dangerous.constructor",
      kind: "class_method",
    });
  });

  it("fails closed when CommonJS export objects reach unknown call or mutation APIs", () => {
    const cases = [
      "Object.assign(module.exports, { x: makeService() });",
      "Object.assign(exports, { x: makeService() });",
      `Object.defineProperty(exports, "x", {
         value: makeService(),
       });`,
      `Object.defineProperty(module.exports, "x", {
         value: makeService(),
       });`,
      `Object.defineProperties(exports, {
         x: { value: makeService() },
       });`,
      `Object.defineProperties(module.exports, {
         x: { value: makeService() },
       });`,
      "Reflect.set(exports, \"x\", makeService());",
      "mutateExports(module.exports);",
      "const out = module.exports; out.x = makeService();",
      'const out = exports; out["x"] = makeService();',
    ];

    for (const [index, sourceText] of cases.entries()) {
      const implementationPath =
        `src/server/services/commonjs-escape-${index}.ts`;
      const operations = discoverOperationsFromSource(
        implementationPath,
        sourceText,
      );
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );

      expect(operations.length + unsupported.length).toBeGreaterThan(0);
    }
  });

  it("accounts for CommonJS export-object references outside direct assignments", () => {
    const escapeCases = [
      "let out; out = module.exports;",
      "let out; out = exports;",
      "const holder = {}; holder.out = module.exports;",
      "const holder = {}; holder.out = exports;",
      "function getExports() { return module.exports; }",
      "function getExports() { return exports; }",
    ];

    for (const [index, sourceText] of escapeCases.entries()) {
      const implementationPath =
        `src/server/services/commonjs-reference-escape-${index}.ts`;
      const operations = discoverOperationsFromSource(
        implementationPath,
        sourceText,
      );
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );

      expect(operations.length + unsupported.length).toBeGreaterThan(0);
    }
  });

  it("keeps direct CommonJS assignments governed without generic escape findings", () => {
    const directAssignments = [
      "module.exports = () => true;",
      "module.exports.x = () => true;",
      'module.exports["x"] = () => true;',
      "exports.x = () => true;",
      'exports["x"] = () => true;',
    ];

    for (const [index, sourceText] of directAssignments.entries()) {
      const implementationPath =
        `src/server/services/commonjs-direct-${index}.ts`;
      const operations = discoverOperationsFromSource(
        implementationPath,
        sourceText,
      );
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );

      expect(operations.length).toBeGreaterThan(0);
      expect(unsupported).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description:
              "CommonJS export object reference is not part of a recognised direct export assignment",
          }),
        ]),
      );
    }

    for (const [index, sourceText] of [
      "module.exports[key] = () => true;",
      "exports[key] = () => true;",
    ].entries()) {
      const implementationPath =
        `src/server/services/commonjs-computed-direct-${index}.ts`;
      const operations = discoverOperationsFromSource(
        implementationPath,
        sourceText,
      );
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );

      expect(operations.length + unsupported.length).toBeGreaterThan(0);
    }
  });

  it("only exempts an exact reviewed DI constructor with an empty body", () => {
    const implementationPath = "src/application/content/create-publication.ts";
    const emptyBodySource = `
      export class CreatePublicationService {
          public constructor(
          private readonly dependencies: CreatePublicationServiceDependencies,
        ) {}
      }
    `;
    const executableBodySource = `
      export class CreatePublicationService {
          public constructor(
          private readonly dependencies: CreatePublicationServiceDependencies,
        ) {
          performTenantSensitiveWork();
        }
      }
    `;

    expect(
      discoverOperationsFromSource(implementationPath, emptyBodySource),
    ).toEqual([]);
    expect(
      discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        emptyBodySource,
      ),
    ).toEqual([]);

    expect(
      discoverOperationsFromSource(implementationPath, executableBodySource),
    ).toContainEqual({
      implementationPath,
      operation: "CreatePublicationService.constructor",
      kind: "class_method",
    });

    const defaultInitializerSource = `
      export class CreatePublicationService {
        public constructor(
          private readonly dependencies: Dependencies = defaultDependencies,
        ) {}
      }
    `;
    expect(
      discoverOperationsFromSource(
        implementationPath,
        defaultInitializerSource,
      ),
    ).toContainEqual({
      implementationPath,
      operation: "CreatePublicationService.constructor",
      kind: "class_method",
    });
  });

  it("binds all reviewed repository constructors to exact safe shapes", () => {
    const repositories = [
      {
        implementationPath: "src/server/repositories/membership-repository.ts",
        classIdentity: "DrizzleMembershipRepository",
      },
      {
        implementationPath: "src/server/repositories/publication-repository.ts",
        classIdentity: "DrizzlePublicationRepository",
      },
      {
        implementationPath: "src/server/repositories/tenant-repository.ts",
        classIdentity: "DrizzleTenantRepository",
      },
    ];
    const safeConstructor =
      "public constructor(private readonly database: CampusHubDatabase = db) {}";
    const baseInput = currentRegistryValidationInput();

    for (const repository of repositories) {
      const sourceText = readFileSync(
        path.join(repositoryRoot, repository.implementationPath),
        "utf8",
      );
      const operations = discoverOperationsFromSource(
        repository.implementationPath,
        sourceText,
      );
      expect(operations).not.toContainEqual(
        expect.objectContaining({
          operation: `${repository.classIdentity}.constructor`,
        }),
      );
      expect(
        discoverUnsupportedOperationFormsFromSource(
          repository.implementationPath,
          sourceText,
        ),
      ).toEqual([]);

      const driftCases = [
        {
          name: "default initializer call",
          replacement:
            "public constructor(private readonly database: CampusHubDatabase = performTenantSensitiveWork()) {}",
        },
        {
          name: "wrapped default initializer",
          replacement:
            "public constructor(private readonly database: CampusHubDatabase = (db)) {}",
        },
        {
          name: "constructor body call",
          replacement:
            "public constructor(private readonly database: CampusHubDatabase = db) { performTenantSensitiveWork(); }",
        },
        {
          name: "extra executable parameter initializer",
          replacement:
            "public constructor(private readonly database: CampusHubDatabase = db, extra = performTenantSensitiveWork()) {}",
        },
        {
          name: "additional dependency parameter",
          replacement:
            "public constructor(private readonly database: CampusHubDatabase = db, extra: CampusHubDatabase) {}",
        },
      ];

      for (const driftCase of driftCases) {
        const mutatedSource = sourceText.replace(
          safeConstructor,
          driftCase.replacement,
        );
        expect(mutatedSource, driftCase.name).not.toBe(sourceText);
        expectFullRegistryValidationFailure(
          { [repository.implementationPath]: mutatedSource },
          repository.implementationPath,
          baseInput,
        );
      }
    }

    expect(
      tenantSurfaceRegistry.some((entry) =>
        entry.id.endsWith("-repository.constructor"),
      ),
    ).toBe(false);
  }, 30_000);

  it("does not review a constructor when eager class initialization changes", () => {
    const implementationPath =
      "src/server/repositories/membership-repository.ts";
    const sourceText = readFileSync(
      path.join(repositoryRoot, implementationPath),
      "utf8",
    );
    const mutatedSource = sourceText.replace(
      "export class DrizzleMembershipRepository implements MembershipContextReader {",
      "export class DrizzleMembershipRepository implements MembershipContextReader {\n  private hidden = performTenantSensitiveWork();",
    );

    expect(mutatedSource).not.toBe(sourceText);
    expectFullRegistryValidationFailure(
      { [implementationPath]: mutatedSource },
      implementationPath,
    );
    expect(
      discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        mutatedSource,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: expect.stringContaining(
            "non-public class field DrizzleMembershipRepository.hidden",
          ),
        }),
      ]),
    );
  }, 30_000);

  it("fails closed for private, protected, and private-identifier eager initializers", () => {
    const cases = [
      "export class Example { private hidden = performTenantSensitiveWork(); }",
      "export class Example { protected hidden = performTenantSensitiveWork(); }",
      "export class Example { #hidden = performTenantSensitiveWork(); }",
    ];

    for (const [index, sourceText] of cases.entries()) {
      const implementationPath =
        `src/server/services/non-public-field-${index}.ts`;
      const operations = discoverOperationsFromSource(
        implementationPath,
        sourceText,
      );
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );

      expect(operations.length + unsupported.length).toBeGreaterThan(0);
      expect(unsupported.length).toBeGreaterThan(0);
    }
  });

  it("does not create operations for inert private initialization", () => {
    const implementationPath = "src/server/services/inert-private-fields.ts";
    const sourceText = `
      export class Example {
        private retries = 0;
        private label = "publication";
        private enabled = false;
        private ids = [];
        private callback = () => doSomething();
      }
    `;
    const operations = discoverOperationsFromSource(implementationPath, sourceText);
    const unsupported = discoverUnsupportedOperationFormsFromSource(
      implementationPath,
      sourceText,
    );

    expect(unsupported).toEqual([]);
    expect(operations).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: expect.stringContaining(".retries") }),
        expect.objectContaining({ operation: expect.stringContaining(".label") }),
        expect.objectContaining({ operation: expect.stringContaining(".enabled") }),
        expect.objectContaining({ operation: expect.stringContaining(".ids") }),
        expect.objectContaining({ operation: expect.stringContaining(".callback") }),
      ]),
    );
  });

  it("fails closed for executable static initialization blocks, including multiple blocks", () => {
    const singleBlockSource = `
      export class StaticBlockService {
        static {
          performInitialization();
        }
      }
    `;
    const multipleBlockSource = `
      export class StaticBlockService {
        static { performFirstInitialization(); }
        static { performSecondInitialization(); }
      }
    `;

    for (const [index, sourceText] of [
      singleBlockSource,
      multipleBlockSource,
    ].entries()) {
      const implementationPath =
        `src/server/services/static-block-${index}.ts`;
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );

      expect(unsupported).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining(
              "exported class StaticBlockService has an executable static initialization block",
            ),
          }),
        ]),
      );
    }

    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/services/static-block-multiple.ts",
        multipleBlockSource,
      ),
    ).toHaveLength(2);

    const nonExportedClassSource = `
      class ModuleLoadedClass {
        static { performModuleInitialization(); }
      }
    `;
    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/services/static-block-non-exported.ts",
        nonExportedClassSource,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: expect.stringContaining(
            "class ModuleLoadedClass has an executable static initialization block",
          ),
        }),
      ]),
    );
  });

  it("fails closed when exported bindings are passed to mutation or unknown calls", () => {
    const cases = [
      "export const holder = {}; Object.assign(holder, { x: makeService() });",
      `export const holder = {}; Object.defineProperty(holder, "x", {
         value: makeService(),
       });`,
      "export const holder = {}; Reflect.set(holder, \"x\", makeService());",
      "export const holder = {}; mutate(holder);",
      "export const holder = {}; mutate({ holder });",
      "export const holder = []; mutate(holder);",
    ];

    for (const [index, sourceText] of cases.entries()) {
      const implementationPath =
        `src/server/services/esm-exported-binding-escape-${index}.ts`;
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );

      expect(unsupported).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining(
              "exported binding(s) holder are passed to a call",
            ),
          }),
        ]),
      );
    }

    const existingGovernedPath =
      "src/application/content/publication-read-resolvers.ts";
    expect(
      discoverUnsupportedOperationFormsFromSource(
        existingGovernedPath,
        "export const holder = {}; Object.assign(holder, { x: makeService() });",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          implementationPath: existingGovernedPath,
          description: expect.stringContaining(
            "exported binding(s) holder are passed to a call",
          ),
        }),
      ]),
    );
  });

  it("accounts for module-load executable forms and inert initializers", () => {
    const moduleLoadExpressions = [
      "performTenantSensitiveWork();",
      "new TenantService();",
      "await performTenantSensitiveWork();",
      "value = factory();",
      "counter++;",
      "tag`value`;",
      "performTenantSensitiveWork() as unknown;",
    ];

    for (const [index, sourceText] of moduleLoadExpressions.entries()) {
      const implementationPath =
        `src/server/services/module-load-expression-${index}.ts`;
      expect(
        discoverUnsupportedOperationFormsFromSource(
          implementationPath,
          sourceText,
        ).length,
      ).toBeGreaterThan(0);
    }

    const moduleLoadInitializers = [
      "const hidden = performTenantSensitiveWork();",
      "const service = new TenantService();",
      "const value = factory();",
    ];
    for (const [index, sourceText] of moduleLoadInitializers.entries()) {
      const implementationPath =
        `src/server/services/module-load-initializer-${index}.ts`;
      expect(
        discoverUnsupportedOperationFormsFromSource(
          implementationPath,
          sourceText,
        ).length,
      ).toBeGreaterThan(0);
    }

    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/services/module-load-directive.ts",
        '"use strict";',
      ),
    ).toEqual([]);
    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/services/module-load-function-value.ts",
        "const callback = () => doSomething();",
      ),
    ).toEqual([]);
  });

  it("fails full validation for module-load additions on a real governed path", () => {
    const implementationPath =
      "src/application/content/publication-read-resolvers.ts";
    const sourceText = readFileSync(
      path.join(repositoryRoot, implementationPath),
      "utf8",
    );

    expectFullRegistryValidationFailure(
      { [implementationPath]: `${sourceText}\nperformTenantSensitiveWork();\n` },
      implementationPath,
    );
    expectFullRegistryValidationFailure(
      {
        [implementationPath]:
          `${sourceText}\nconst hidden = performTenantSensitiveWork();\n`,
      },
      implementationPath,
    );
    expectFullRegistryValidationFailure(
      {
        [implementationPath]:
          `${sourceText}\nexport class ExistingClass { private hidden = performTenantSensitiveWork(); }\n`,
      },
      implementationPath,
    );
  }, 30_000);

  it("fails closed for exported-binding aliases, composites, and receivers", () => {
    const aliasCases = [
      "export const holder = {}; const alias = holder;",
      "export const holder = {}; let alias; alias = holder;",
      "export const holder = {}; const someObject = {}; someObject.value = holder;",
      "export const holder = {}; const wrapper = { holder };",
      "export const holder = {}; const wrapper = [holder];",
      `
        export const holder = {};
        function escape() {
          const alias = holder;
          Object.assign(alias, {});
        }
      `,
    ];
    for (const [index, sourceText] of aliasCases.entries()) {
      const implementationPath =
        `src/server/services/exported-binding-alias-${index}.ts`;
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );
      expect(unsupported).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining("lose provenance"),
          }),
        ]),
      );
    }

    const receiverCases = [
      "export const holder = {}; holder.mutate();",
      'export const holder = {}; holder["mutate"]();',
      "export const holder = {}; holder[method]();",
      "export const holder = {}; const alias = holder; alias.mutate();",
    ];
    for (const [index, sourceText] of receiverCases.entries()) {
      const implementationPath =
        `src/server/services/exported-binding-receiver-${index}.ts`;
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );
      expect(unsupported.length).toBeGreaterThan(0);
    }

    const existingGovernedPath =
      "src/application/content/publication-read-resolvers.ts";
    const sourceText = readFileSync(
      path.join(repositoryRoot, existingGovernedPath),
      "utf8",
    );
    expectFullRegistryValidationFailure(
      {
        [existingGovernedPath]: `${sourceText}
          export const a2Holder = {};
          const a2Alias = a2Holder;
          Object.assign(a2Alias, { x: makeService() });
        `,
      },
      existingGovernedPath,
    );
    expectFullRegistryValidationFailure(
      {
        [existingGovernedPath]: `${sourceText}
          export const a2ReceiverHolder = {};
          a2ReceiverHolder.mutate();
        `,
      },
      existingGovernedPath,
    );
  }, 30_000);

  it("preserves direct exported-binding mutation and unknown-call protection", () => {
    const directCallCases = [
      "Object.assign(holder, {});",
      'Object.defineProperty(holder, "x", {});',
      'Object.defineProperties(holder, {});',
      'Reflect.set(holder, "x", value);',
      "mutate(holder);",
    ];

    for (const [index, call] of directCallCases.entries()) {
      const implementationPath =
        `src/server/services/exported-binding-direct-call-${index}.ts`;
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        `export const holder = {}; ${call}`,
      );
      expect(unsupported).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description: expect.stringContaining("exported binding(s) holder"),
          }),
        ]),
      );
    }
  });

  it("accounts for static CommonJS template members and fails closed on computed templates", () => {
    const directAssignments = [
      "module[`exports`] = () => true;",
      "module[`exports`].x = () => true;",
      "module[`exports`][`x`] = () => true;",
      "exports[`x`] = () => true;",
    ];

    for (const [index, sourceText] of directAssignments.entries()) {
      const implementationPath =
        `src/server/services/commonjs-template-direct-${index}.ts`;
      const operations = discoverOperationsFromSource(
        implementationPath,
        sourceText,
      );
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );

      expect(operations.length).toBeGreaterThan(0);
      expect(unsupported).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            description:
              "CommonJS export object reference is not part of a recognised direct export assignment",
          }),
        ]),
      );
    }

    for (const [index, sourceText] of [
      "module[`exp${name}`] = () => true;",
      "module[`exports${name}`].x = () => true;",
      "exports[`x${name}`] = () => true;",
    ].entries()) {
      const implementationPath =
        `src/server/services/commonjs-template-computed-${index}.ts`;
      const unsupported = discoverUnsupportedOperationFormsFromSource(
        implementationPath,
        sourceText,
      );

      expect(unsupported.length).toBeGreaterThan(0);
    }
  });

  it("does not collapse distinct export names that share one callable binding", () => {
    const operations = discoverOperationsFromSource(
      "src/server/services/shared-binding.ts",
      `
        const handler = () => true;
        export { handler as first, handler as second };
      `,
    );

    expect(operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "first" }),
        expect.objectContaining({ operation: "second" }),
      ]),
    );
  });

  it("requires an exact reviewed path/name/form for legitimate non-callable factories", () => {
    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/db/schema/tenant.ts",
        "export const tenants = pgTable(\"tenants\", {});",
      ),
    ).toEqual([]);
    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/db/schema/other.ts",
        "export const tenants = pgTable(\"tenants\", {});",
      ),
    ).not.toEqual([]);
    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/db/schema/tenant.ts",
        "export const x = pgTable(\"tenants\", {});",
      ),
    ).not.toEqual([]);
  });

  it("keeps schema wildcard re-exports exact and rejects new wildcard or namespace edges", () => {
    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/db/schema/index.ts",
        'export * from "./membership";',
      ),
    ).toEqual([]);
    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/db/schema/index.ts",
        'export * from "./new-service";',
      ),
    ).not.toEqual([]);
    expect(
      discoverUnsupportedOperationFormsFromSource(
        "src/server/db/schema/index.ts",
        'export * as service from "./membership";',
      ),
    ).not.toEqual([]);
  });

  it("does not let an existing governed file declaration authorize a new callable", () => {
    const implementationPath =
      "src/application/content/publication-read-resolvers.ts";
    const existingEntry = tenantSurfaceRegistry.find(
      (entry) => entry.id === "publication.authorization.resolvers",
    );
    if (existingEntry === undefined) {
      throw new Error("expected the existing Publication resolver registry entry");
    }

    const unsupported = discoverUnsupportedOperationFormsFromSource(
      implementationPath,
      "export const x = makeService();",
    );
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [existingEntry],
        discoveredTenantModels: [],
        governedImplementationPaths: [implementationPath],
        discoveredUnsupportedOperationForms: unsupported,
        isolationProbeIds: new Set(["publication.direct"]),
      }),
    );

    expect(errors.some((error) => error.includes("unsupported governed callable form"))).toBe(
      true,
    );
  });

  it("does not let an existing governed file authorize a late exported mutation", () => {
    const implementationPath =
      "src/application/content/publication-read-resolvers.ts";
    const existingEntry = tenantSurfaceRegistry.find(
      (entry) => entry.id === "publication.authorization.resolvers",
    );
    if (existingEntry === undefined) {
      throw new Error("expected the existing Publication resolver registry entry");
    }

    const unsupported = discoverUnsupportedOperationFormsFromSource(
      implementationPath,
      "export const holder = {}; holder.x = makeService();",
    );
    const errors = validateTenantSurfaceRegistry(
      fixtureInput({
        registry: [existingEntry],
        discoveredTenantModels: [],
        governedImplementationPaths: [implementationPath],
        discoveredUnsupportedOperationForms: unsupported,
        isolationProbeIds: new Set(["publication.direct"]),
      }),
    );

    expect(errors.some((error) => error.includes("unsupported governed callable form"))).toBe(
      true,
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
