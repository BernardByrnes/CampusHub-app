import "server-only";

export const TENANT_SURFACE_CATEGORIES = [
  "model",
  "repository",
  "application_service",
  "route",
  "job",
  "export",
  "search_index",
  "cache",
  "media",
  "notification",
  "analytics",
  "backup",
  "infrastructure",
  "migration",
] as const;

export type TenantSurfaceCategory =
  (typeof TENANT_SURFACE_CATEGORIES)[number];

export const TENANT_SCOPE_CLASSIFICATIONS = [
  "TENANT_ROOT",
  "TENANT_SCOPED",
  "GLOBAL_NON_TENANT",
  "FUTURE_NOT_IMPLEMENTED",
] as const;

export type TenantScopeClassification =
  (typeof TENANT_SCOPE_CLASSIFICATIONS)[number];

type ImplementedTenantScopeClassification = Exclude<
  TenantScopeClassification,
  "FUTURE_NOT_IMPLEMENTED"
>;

/**
 * Legal ownership semantics for an implemented surface. FUTURE_NOT_IMPLEMENTED
 * is a temporal declaration handled separately: it is legal only while its
 * implementation path is absent from the repository.
 */
export const TENANT_SCOPE_MATRIX = {
  model: ["TENANT_ROOT", "TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  repository: ["TENANT_ROOT", "TENANT_SCOPED"],
  application_service: ["TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  route: ["TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  job: ["TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  export: ["TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  search_index: ["TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  cache: ["TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  media: ["TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  notification: ["TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  analytics: ["TENANT_SCOPED", "GLOBAL_NON_TENANT"],
  backup: ["GLOBAL_NON_TENANT"],
  infrastructure: ["GLOBAL_NON_TENANT"],
  migration: ["GLOBAL_NON_TENANT"],
} as const satisfies Readonly<
  Record<
    TenantSurfaceCategory,
    readonly ImplementedTenantScopeClassification[]
  >
>;

/**
 * A global classification is a reviewed exception, not a free-form escape
 * hatch. New global surfaces must be independently reviewed and added here.
 */
export const APPROVED_GLOBAL_NON_TENANT_SURFACE_IDS = [
  "global.health.route",
  "global.health.service",
  "global.database.client",
  "global.schema.barrel",
  "global.env.reader",
  "global.env.schema",
  "global.tenancy.registry",
  "global.migrations",
  "fixtures.services.factory",
  "fixtures.services.factory-list",
  "fixtures.services.factory-management",
] as const;

export type ApprovedGlobalNonTenantSurfaceId =
  (typeof APPROVED_GLOBAL_NON_TENANT_SURFACE_IDS)[number];

export const APPROVED_GLOBAL_NON_TENANT_CONTRACTS = {
  "global.health.route": {
    category: "route",
    implementationPath: "src/app/api/health/route.ts",
    operation: "GET",
  },
  "global.health.service": {
    category: "application_service",
    implementationPath: "src/application/system/get-health.ts",
    operation: "getHealth",
  },
  "global.database.client": {
    category: "infrastructure",
    implementationPath: "src/server/db/client.ts",
  },
  "global.schema.barrel": {
    category: "infrastructure",
    implementationPath: "src/server/db/schema/index.ts",
  },
  "global.env.reader": {
    category: "infrastructure",
    implementationPath: "src/server/config/env.ts",
    operation: "getServerEnv",
  },
  "global.env.schema": {
    category: "infrastructure",
    implementationPath: "src/server/config/env-schema.ts",
    operation: "parseServerEnv",
  },
  "global.tenancy.registry": {
    category: "infrastructure",
    implementationPath: "src/server/tenancy/tenant-surface-registry.ts",
    operation: "validateTenantSurfaceRegistry",
  },
  "global.migrations": {
    category: "migration",
    implementationPath: "drizzle/0014_unusual_madelyne_pryor.sql",
  },
  "fixtures.services.factory": {
    category: "infrastructure",
    implementationPath: "src/server/sports/create-fixture-services.ts",
  },
  "fixtures.services.factory-list": {
    category: "infrastructure",
    implementationPath: "src/server/sports/create-fixture-services.ts",
    operation: "createListFixturesService",
  },
  "fixtures.services.factory-management": {
    category: "infrastructure",
    implementationPath: "src/server/sports/create-fixture-services.ts",
    operation: "createFixtureManagementService",
  },
} as const satisfies Readonly<
  Record<
    ApprovedGlobalNonTenantSurfaceId,
    Readonly<{
      category: TenantSurfaceCategory;
      implementationPath: string;
      operation?: string;
    }>
  >
>;

/**
 * These are reviewed non-callable export contracts. They allow the AST gate
 * to recognize infrastructure/schema values produced by known factories
 * without granting a free-form exemption to a new export.
 */
export const REVIEWED_NON_CALLABLE_EXPORT_CONTRACTS = [
  {
    implementationPath: "src/server/db/client.ts",
    exportName: "db",
    expectedAstForm: "PropertyAccessExpression",
  },
  {
    implementationPath: "src/server/db/client.ts",
    exportName: "pool",
    expectedAstForm: "PropertyAccessExpression",
  },
  {
    implementationPath: "src/server/db/schema/tenant.ts",
    exportName: "tenantLifecycleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/tenant.ts",
    exportName: "tenants",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/organization.ts",
    exportName: "campusLifecycleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/organization.ts",
    exportName: "academicDivisionLifecycleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/organization.ts",
    exportName: "programmeLifecycleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/organization.ts",
    exportName: "residenceLifecycleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/organization.ts",
    exportName: "campuses",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/organization.ts",
    exportName: "academicDivisions",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/organization.ts",
    exportName: "programmes",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/organization.ts",
    exportName: "residences",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/organization.ts",
    exportName: "tenantAcademicYearConfig",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/membership.ts",
    exportName: "membershipAssuranceLevelEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/membership.ts",
    exportName: "membershipLifecycleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/membership.ts",
    exportName: "profileFieldProvenanceEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/membership.ts",
    exportName: "membershipResidenceStateEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/membership.ts",
    exportName: "memberships",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/governance.ts",
    exportName: "guildTermStatusEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/governance.ts",
    exportName: "roleGrantRoleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/governance.ts",
    exportName: "roleGrantCapabilityEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/governance.ts",
    exportName: "roleGrantModuleScopeEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/governance.ts",
    exportName: "guildTerms",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/governance.ts",
    exportName: "roleGrants",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publicationTypeEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publicationPriorityEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publicationLifecycleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publicationVisibilityEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publicationAudienceModeEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publicationAudienceDimensionEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publicationAudienceProvenancePolicyEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publicationAudienceResidenceTargetEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publications",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/publication.ts",
    exportName: "publicationAudienceCriteria",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/audit.ts",
    exportName: "auditEvents",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "sportLifecycleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "competitionTableModeEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "sports",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "competitions",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "teams",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "fixtureStateEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "fixtures",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "resultLifecycleEnum",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "results",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/db/schema/sports.ts",
    exportName: "resultRevisions",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/config/env-schema.ts",
    exportName: "serverEnvSchema",
    expectedAstForm: "CallExpression",
  },
  {
    implementationPath: "src/server/tenancy/tenant-surface-registry.ts",
    exportName: "TENANT_SURFACE_CATEGORIES",
    expectedAstForm: "ArrayLiteralExpression",
  },
  {
    implementationPath: "src/server/tenancy/tenant-surface-registry.ts",
    exportName: "TENANT_SCOPE_CLASSIFICATIONS",
    expectedAstForm: "ArrayLiteralExpression",
  },
  {
    implementationPath: "src/server/tenancy/tenant-surface-registry.ts",
    exportName: "TENANT_SCOPE_MATRIX",
    expectedAstForm: "ObjectLiteralExpression",
  },
  {
    implementationPath: "src/server/tenancy/tenant-surface-registry.ts",
    exportName: "APPROVED_GLOBAL_NON_TENANT_SURFACE_IDS",
    expectedAstForm: "ArrayLiteralExpression",
  },
  {
    implementationPath: "src/server/tenancy/tenant-surface-registry.ts",
    exportName: "APPROVED_GLOBAL_NON_TENANT_CONTRACTS",
    expectedAstForm: "ObjectLiteralExpression",
  },
] as const;

/**
 * These are exact schema-barrel re-export contracts. A wildcard re-export is
 * non-callable only because each currently reviewed barrel edge is limited to
 * the corresponding schema module. A new wildcard or namespace re-export is
 * therefore still rejected by the AST gate until it is reviewed explicitly.
 */
export const REVIEWED_NON_CALLABLE_REEXPORT_CONTRACTS = [
  {
    implementationPath: "src/server/db/schema/index.ts",
    moduleSpecifier: "./membership",
    exportForm: "ExportAllDeclaration",
  },
  {
    implementationPath: "src/server/db/schema/index.ts",
    moduleSpecifier: "./audit",
    exportForm: "ExportAllDeclaration",
  },
  {
    implementationPath: "src/server/db/schema/index.ts",
    moduleSpecifier: "./publication",
    exportForm: "ExportAllDeclaration",
  },
  {
    implementationPath: "src/server/db/schema/index.ts",
    moduleSpecifier: "./tenant",
    exportForm: "ExportAllDeclaration",
  },
  {
    implementationPath: "src/server/db/schema/index.ts",
    moduleSpecifier: "./organization",
    exportForm: "ExportAllDeclaration",
  },
  {
    implementationPath: "src/server/db/schema/index.ts",
    moduleSpecifier: "./governance",
    exportForm: "ExportAllDeclaration",
  },
  {
    implementationPath: "src/server/db/schema/index.ts",
    moduleSpecifier: "./sports",
    exportForm: "ExportAllDeclaration",
  },
] as const;

/**
 * Existing exported service/repository constructors are dependency-injection
 * construction details rather than independently governed operations. These
 * exact structural contracts preserve only the reviewed constructor shape:
 * explicit public construction, one reviewed parameter-property signature,
 * no executable parameter initializer beyond the named default, and no eager
 * class initialization. Any shape drift re-enters operation discovery.
 */
export type ReviewedNonOperationalConstructorContract = Readonly<{
  implementationPath: string;
  classIdentity: string;
  constructorModifiers: readonly string[];
  parameterCount: number;
  parameterNames: readonly string[];
  parameterTypeTexts: readonly string[];
  parameterPropertyModifiers: readonly (readonly string[])[];
  defaultInitializerIdentifiers: readonly (string | null)[];
}>;

export const REVIEWED_NON_OPERATIONAL_CONSTRUCTOR_CONTRACTS = [
  {
    implementationPath: "src/application/context/resolve-request-context.ts",
    classIdentity: "RequestContextService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["ResolveRequestContextDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/content/create-publication.ts",
    classIdentity: "CreatePublicationService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["CreatePublicationServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/content/edit-publication-draft.ts",
    classIdentity: "EditPublicationDraftService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["EditPublicationDraftServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/content/publish-publication.ts",
    classIdentity: "PublishPublicationService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["PublishPublicationServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/content/list-publications.ts",
    classIdentity: "ListPublicationsService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["ListPublicationsServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/content/read-publication.ts",
    classIdentity: "ReadPublicationService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["ReadPublicationServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/content/publication-read-resolvers.ts",
    classIdentity: "PersistedPublicationAudienceResolver",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["PersistedPublicationAudienceResolverDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/content/publication-read-resolvers.ts",
    classIdentity: "PersistedPublicationAudienceBatchResolver",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["PersistedPublicationAudienceBatchResolverDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/server/repositories/membership-repository.ts",
    classIdentity: "DrizzleMembershipRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath: "src/server/repositories/publication-repository.ts",
    classIdentity: "DrizzlePublicationRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath: "src/server/repositories/tenant-repository.ts",
    classIdentity: "DrizzleTenantRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath: "src/server/repositories/guild-term-repository.ts",
    classIdentity: "DrizzleGuildTermRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath: "src/server/repositories/role-grant-repository.ts",
    classIdentity: "DrizzleRoleGrantRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath:
      "src/server/authorization/postgres-capability-authorizer.ts",
    classIdentity: "PostgresCapabilityAuthorizer",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["PostgresCapabilityAuthorizerDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath:
      "src/server/authorization/postgres-authorized-publication-create.ts",
    classIdentity: "PostgresAuthorizedPublicationCreateExecutor",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: [
      "PostgresAuthorizedPublicationCreateDependencies",
    ],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath:
      "src/server/authorization/postgres-authorized-publication-draft-edit.ts",
    classIdentity: "PostgresAuthorizedPublicationDraftEditExecutor",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: [
      "PostgresAuthorizedPublicationDraftEditDependencies",
    ],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath:
      "src/server/authorization/postgres-authorized-publication-publish.ts",
    classIdentity: "PostgresAuthorizedPublicationPublishExecutor",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: [
      "PostgresAuthorizedPublicationPublishDependencies",
    ],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/server/repositories/audit-event-repository.ts",
    classIdentity: "DrizzleAuditEventRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["AuditEventRepositoryDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/content/campus-home.ts",
    classIdentity: "CampusHomeService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["CampusHomeServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/sports/manage-sports.ts",
    classIdentity: "SportsManagementService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["SportsManagementServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/server/authorization/postgres-authorized-sports.ts",
    classIdentity: "PostgresAuthorizedSportsManagementExecutor",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: [
      "PostgresAuthorizedSportsManagementDependencies",
    ],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/server/repositories/sport-repository.ts",
    classIdentity: "DrizzleSportRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath: "src/server/repositories/competition-repository.ts",
    classIdentity: "DrizzleCompetitionRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath: "src/server/repositories/team-repository.ts",
    classIdentity: "DrizzleTeamRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath: "src/server/repositories/fixture-repository.ts",
    classIdentity: "DrizzleFixtureRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath: "src/server/repositories/result-repository.ts",
    classIdentity: "DrizzleResultRepository",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["database"],
    parameterTypeTexts: ["CampusHubDatabase"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: ["db"],
  },
  {
    implementationPath: "src/application/sports/manage-fixtures.ts",
    classIdentity: "FixtureManagementService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["FixtureManagementServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/sports/list-fixtures.ts",
    classIdentity: "ListFixturesService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["FixtureReadServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/sports/manage-results.ts",
    classIdentity: "ResultManagementService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["ResultManagementServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
  {
    implementationPath: "src/application/sports/list-results.ts",
    classIdentity: "ListResultsService",
    constructorModifiers: ["public"],
    parameterCount: 1,
    parameterNames: ["dependencies"],
    parameterTypeTexts: ["ResultReadServiceDependencies"],
    parameterPropertyModifiers: [["private", "readonly"]],
    defaultInitializerIdentifiers: [null],
  },
] as const satisfies readonly ReviewedNonOperationalConstructorContract[];

/**
 * These are exact reviewed module-initializer shapes for the two existing
 * non-exported infrastructure/configuration bindings that intentionally run
 * while their modules evaluate. They are path, binding, and AST-shape bound;
 * no call-name or directory-wide exemption is granted.
 */
export const REVIEWED_NON_OPERATIONAL_MODULE_INITIALIZER_CONTRACTS = [
  {
    implementationPath: "src/server/config/env-schema.ts",
    bindingName: "postgresConnectionString",
    initializerShape: "postgres_connection_string_schema",
  },
  {
    implementationPath: "src/server/db/client.ts",
    bindingName: "database",
    initializerShape: "database_cache_or_create",
  },
] as const;

/**
 * This is the one existing top-level control-flow statement whose module-load
 * behavior has been explicitly reviewed: the development-only database cache
 * assignment. Its path and structural shape are validated by discovery; a
 * different condition or assignment is not covered by this contract.
 */
export const REVIEWED_NON_OPERATIONAL_MODULE_STATEMENT_CONTRACTS = [
  {
    implementationPath: "src/server/db/client.ts",
    statementShape: "development_database_cache_assignment",
  },
] as const;

export type TenantSurfaceRegistryEntry = Readonly<{
  id: string;
  category: TenantSurfaceCategory;
  implementationPath: string;
  surface: string;
  tenantScope: TenantScopeClassification;
  isolationStrategy: string;
  requiredNegativeTestIds: readonly string[];
  databaseObjectName?: string;
  globalExemptionReason?: string;
  /** Stable public operation metadata, when the file exposes an operation. */
  operation?: string;
  /** Explicit migration history declaration, used only by migration entries. */
  declaredImplementationPaths?: readonly string[];
  migrationHead?: string;
}>;

export type DiscoveredTenantOperation = Readonly<{
  implementationPath: string;
  operation: string;
  kind: "class_method" | "exported_function" | "route_handler";
}>;

export type DiscoveredUnsupportedOperationForm = Readonly<{
  implementationPath: string;
  description: string;
}>;

export type ProductionImportBoundaryViolation = Readonly<{
  fromPath: string;
  specifier: string;
  resolvedPath: string;
}>;

/**
 * Architecture metadata only. Authorization decisions belong to the domain
 * policies and application services, never to this registry.
 */
export const tenantSurfaceRegistry = [
  {
    id: "tenant.persistence.root",
    category: "model",
    implementationPath: "src/server/db/schema/tenant.ts",
    surface: "tenants",
    tenantScope: "TENANT_ROOT",
    isolationStrategy: "Tenant root owns the identifier namespace for child resources.",
    requiredNegativeTestIds: ["tenant.root.contract"],
    databaseObjectName: "tenants",
    operation: "table:tenants",
  },
  {
    id: "tenant.repository.find-by-id",
    category: "repository",
    implementationPath: "src/server/repositories/tenant-repository.ts",
    surface: "DrizzleTenantRepository.findTenantById",
    tenantScope: "TENANT_ROOT",
    isolationStrategy: "Tenant root lookup validates the canonical UUID before SQL.",
    requiredNegativeTestIds: ["tenant.root.contract"],
    operation: "DrizzleTenantRepository.findTenantById",
  },
  {
    id: "tenant.repository.find-by-slug",
    category: "repository",
    implementationPath: "src/server/repositories/tenant-repository.ts",
    surface: "DrizzleTenantRepository.findTenantBySlug",
    tenantScope: "TENANT_ROOT",
    isolationStrategy: "Tenant root lookup validates the canonical slug before SQL.",
    requiredNegativeTestIds: ["tenant.root.contract"],
    operation: "DrizzleTenantRepository.findTenantBySlug",
  },
  {
    id: "membership.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/membership.ts",
    surface: "memberships",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Required tenant_id ownership plus same-Tenant affiliation foreign keys and provenance/state checks.",
    requiredNegativeTestIds: ["membership.persistence"],
    databaseObjectName: "memberships",
    operation: "table:memberships",
  },
  {
    id: "guild-term.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/governance.ts",
    surface: "guild_terms",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Guild Terms require Tenant ownership, bounded lifecycle values, a valid time range, and at most one active term per Tenant.",
    requiredNegativeTestIds: ["guild-term.persistence"],
    databaseObjectName: "guild_terms",
    operation: "table:guild_terms",
  },
  {
    id: "role-grant.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/governance.ts",
    surface: "role_grants",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Role Grants are Membership-backed, Tenant-owned rows with same-Tenant Guild Term and Membership foreign keys, closed capability/module values, and revocation/expiry fields.",
    requiredNegativeTestIds: ["role-grant.persistence"],
    databaseObjectName: "role_grants",
    operation: "table:role_grants",
  },
  {
    id: "campus.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/organization.ts",
    surface: "campuses",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Campus rows require Tenant ownership and preserve a Tenant-first composite identity for downstream foreign keys.",
    requiredNegativeTestIds: ["campus.persistence"],
    databaseObjectName: "campuses",
    operation: "table:campuses",
  },
  {
    id: "academic-division.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/organization.ts",
    surface: "academic_divisions",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Academic Division rows bind parent and merge references through same-Tenant composite foreign keys.",
    requiredNegativeTestIds: ["academic-division.persistence"],
    databaseObjectName: "academic_divisions",
    operation: "table:academic_divisions",
  },
  {
    id: "programme.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/organization.ts",
    surface: "programmes",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Programme rows bind their Academic Division and merge target through same-Tenant composite foreign keys.",
    requiredNegativeTestIds: ["programme.persistence"],
    databaseObjectName: "programmes",
    operation: "table:programmes",
  },
  {
    id: "residence.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/organization.ts",
    surface: "residences",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Residence rows require Tenant ownership and retain stable Tenant-first identity.",
    requiredNegativeTestIds: ["residence.persistence"],
    databaseObjectName: "residences",
    operation: "table:residences",
  },
  {
    id: "tenant-academic-year-config.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/organization.ts",
    surface: "tenant_academic_year_config",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "The academic-year range is one-to-one with its owning Tenant through a primary-key Tenant foreign key.",
    requiredNegativeTestIds: ["tenant-academic-year-config.persistence"],
    databaseObjectName: "tenant_academic_year_config",
    operation: "table:tenant_academic_year_config",
  },
  {
    id: "membership.context.reader-contract",
    category: "application_service",
    implementationPath: "src/application/context/context-readers.ts",
    surface: "TenantContextReader/MembershipContextReader",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Membership reads expose only explicit Tenant-bound operations.",
    requiredNegativeTestIds: ["membership.context"],
  },
  {
    id: "membership.context.identity-tenant",
    category: "application_service",
    implementationPath: "src/application/context/resolve-request-context.ts",
    surface: "RequestContextService.resolveRequestContext",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "The server resolves Tenant first and binds identity plus Tenant before trusting context.",
    requiredNegativeTestIds: ["membership.context"],
    operation: "RequestContextService.resolveRequestContext",
  },
  {
    id: "membership.context.resolve",
    category: "application_service",
    implementationPath: "src/application/context/resolve-request-context.ts",
    surface: "RequestContextService.resolve",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "The public resolver alias preserves the same explicit Tenant-bound context contract.",
    requiredNegativeTestIds: ["membership.context"],
    operation: "RequestContextService.resolve",
  },
  {
    id: "membership.context.server-boundary",
    category: "application_service",
    implementationPath: "src/server/context/request-context.ts",
    surface: "AuthenticatedIdentity/TenantHint/RequestContext",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Only server-owned identity and an explicit Tenant hint enter the context seam.",
    requiredNegativeTestIds: ["membership.context"],
  },
  {
    id: "membership.context.server-wiring",
    category: "application_service",
    implementationPath: "src/server/context/create-request-context-resolver.ts",
    surface: "createRequestContextResolver",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Server wiring composes Tenant and Membership repositories behind the context resolver.",
    requiredNegativeTestIds: ["membership.context"],
    operation: "createRequestContextResolver",
  },
  {
    id: "membership.repository.identity-tenant",
    category: "repository",
    implementationPath: "src/server/repositories/membership-repository.ts",
    surface: "DrizzleMembershipRepository.findMembershipForIdentityAndTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "SQL requires both identitySubjectId and tenant_id; invalid Tenant UUIDs stop before SQL.",
    requiredNegativeTestIds: ["membership.identity-tenant"],
    operation: "DrizzleMembershipRepository.findMembershipForIdentityAndTenant",
  },
  {
    id: "membership.repository.tenant-id",
    category: "repository",
    implementationPath: "src/server/repositories/membership-repository.ts",
    surface: "DrizzleMembershipRepository.findMembershipByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "SQL requires tenant_id and Membership id; foreign or malformed IDs return null.",
    requiredNegativeTestIds: ["membership.id-tenant"],
    operation: "DrizzleMembershipRepository.findMembershipByIdForTenant",
  },
  {
    id: "membership.repository.audience-facts",
    category: "repository",
    implementationPath: "src/server/repositories/membership-repository.ts",
    surface:
      "DrizzleMembershipRepository.findMembershipAudienceFactsByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "SQL requires the explicit Tenant and Membership identifiers; incomplete or invalid affiliation facts fail closed through the canonical runtime guard.",
    requiredNegativeTestIds: ["membership.audience-facts"],
    operation:
      "DrizzleMembershipRepository.findMembershipAudienceFactsByIdForTenant",
  },
  {
    id: "guild-term.repository.active",
    category: "repository",
    implementationPath: "src/server/repositories/guild-term-repository.ts",
    surface: "DrizzleGuildTermRepository.findActiveGuildTermForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The active Guild Term lookup requires an explicit Tenant UUID and current time window; malformed and out-of-window terms fail closed.",
    requiredNegativeTestIds: ["guild-term.active"],
    operation: "DrizzleGuildTermRepository.findActiveGuildTermForTenant",
  },
  {
    id: "role-grant.repository.capability",
    category: "repository",
    implementationPath: "src/server/repositories/role-grant-repository.ts",
    surface: "DrizzleRoleGrantRepository.findCapabilityGrantForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Capability lookup binds Tenant, Guild Term, Membership, capability, module scope, revocation, and current expiry before hydration.",
    requiredNegativeTestIds: ["role-grant.capability"],
    operation: "DrizzleRoleGrantRepository.findCapabilityGrantForTenant",
  },
  {
    id: "capability.authorization.postgres",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-capability-authorizer.ts",
    surface: "PostgresCapabilityAuthorizer.authorize",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Each capability decision reloads current Tenant, Membership, active Guild Term, and Membership-backed RoleGrant state and denies on mismatch, revocation, expiry, closure, wrong module, or repository failure.",
    requiredNegativeTestIds: ["capability.authorization"],
    operation: "PostgresCapabilityAuthorizer.authorize",
  },
  {
    id: "capability.authorization.atomic-publication-create",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-capability-authorizer.ts",
    surface:
      "PostgresCapabilityAuthorizer.authorizePublicationCreateInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Commit-time Publication authority locks the exact Tenant, Membership, active Guild Term, and current valid RoleGrant in stable order before the same transaction inserts the Publication.",
    requiredNegativeTestIds: ["publication.create"],
    operation:
      "PostgresCapabilityAuthorizer.authorizePublicationCreateInTransaction",
  },
  {
    id: "capability.authorization.atomic-publication-edit",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-capability-authorizer.ts",
    surface:
      "PostgresCapabilityAuthorizer.authorizePublicationEditInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Commit-time draft-edit authority locks Tenant, Membership, active Guild Term, RoleGrant(publication.edit), and the exact Publication before a fresh authority check and version-guarded update.",
    requiredNegativeTestIds: ["publication.edit"],
    operation:
      "PostgresCapabilityAuthorizer.authorizePublicationEditInTransaction",
  },
  {
    id: "capability.authorization.atomic-publication-publish",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-capability-authorizer.ts",
    surface:
      "PostgresCapabilityAuthorizer.authorizePublicationPublishInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Commit-time manual-publish authority locks Tenant, Membership, active Guild Term, RoleGrant(publication.publish), and the exact draft Publication before a fresh authority check and version-guarded lifecycle transition.",
    requiredNegativeTestIds: ["publication.publish"],
    operation:
      "PostgresCapabilityAuthorizer.authorizePublicationPublishInTransaction",
  },
  {
    id: "capability.authorization.atomic-sports-manage",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-capability-authorizer.ts",
    surface: "PostgresCapabilityAuthorizer.authorizeSportManageInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Commit-time Sports authority locks the Tenant, Membership, active Guild Term, and current sport.manage RoleGrant before the same transaction mutates a Sports resource.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresCapabilityAuthorizer.authorizeSportManageInTransaction",
  },
  {
    id: "publication.atomic-authorized-create",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-publication-create.ts",
    surface:
      "PostgresAuthorizedPublicationCreateExecutor.createAuthorizedPublication",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The authorization decision and Publication INSERT share one PostgreSQL transaction; a preflight allowed result cannot authorize a later mutation.",
    requiredNegativeTestIds: ["publication.create"],
    operation:
      "PostgresAuthorizedPublicationCreateExecutor.createAuthorizedPublication",
  },
  {
    id: "publication.atomic-authorized-edit",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-publication-draft-edit.ts",
    surface:
      "PostgresAuthorizedPublicationDraftEditExecutor.editAuthorizedPublication",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Preflight is advisory; the authorization decision, exact Publication lock, and version-guarded draft UPDATE share one PostgreSQL transaction.",
    requiredNegativeTestIds: ["publication.edit"],
    operation:
      "PostgresAuthorizedPublicationDraftEditExecutor.editAuthorizedPublication",
  },
  {
    id: "publication.atomic-authorized-publish",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-publication-publish.ts",
    surface:
      "PostgresAuthorizedPublicationPublishExecutor.publishAuthorizedPublication",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Preflight is advisory; authorization, exact Publication lock, audience readiness/confirmation, and lifecycle UPDATE share one PostgreSQL transaction.",
    requiredNegativeTestIds: ["publication.publish"],
    operation:
      "PostgresAuthorizedPublicationPublishExecutor.publishAuthorizedPublication",
  },
  {
    id: "audit.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/audit.ts",
    surface: "audit_events",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Audit rows are Tenant-owned append-only records with same-Tenant actor Membership identity and database-enforced immutable chain fields.",
    requiredNegativeTestIds: ["audit.persistence"],
    databaseObjectName: "audit_events",
    operation: "table:audit_events",
  },
  {
    id: "publication.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/publication.ts",
    surface: "publications",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Required tenant_id ownership with a restricted foreign key to tenants.id.",
    requiredNegativeTestIds: ["publication.persistence"],
    databaseObjectName: "publications",
    operation: "table:publications",
  },
  {
    id: "publication-audience-criteria.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/publication.ts",
    surface: "publication_audience_criteria",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Each criterion is owned by an explicit Tenant and Publication and every entity target uses a same-Tenant foreign key.",
    requiredNegativeTestIds: ["publication-audience-criteria.persistence"],
    databaseObjectName: "publication_audience_criteria",
    operation: "table:publication_audience_criteria",
  },
  {
    id: "sports.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/sports.ts",
    surface: "sports",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport rows are Tenant-owned, composite Tenant-identified, versioned, and deactivated rather than deleted.",
    requiredNegativeTestIds: ["sports.persistence"],
    databaseObjectName: "sports",
    operation: "table:sports",
  },
  {
    id: "competition.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/sports.ts",
    surface: "competitions",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition rows are Tenant-owned and bind their Sport and Campus through same-Tenant composite foreign keys.",
    requiredNegativeTestIds: ["competition.persistence"],
    databaseObjectName: "competitions",
    operation: "table:competitions",
  },
  {
    id: "team.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/sports.ts",
    surface: "teams",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team rows are Tenant-owned, bind one Sport through a same-Tenant composite foreign key, and do not encode a permanent Competition relationship.",
    requiredNegativeTestIds: ["team.persistence"],
    databaseObjectName: "teams",
    operation: "table:teams",
  },
  {
    id: "publication.authorization.resolvers",
    category: "application_service",
    implementationPath: "src/application/content/publication-read-resolvers.ts",
    surface: "PublicationExposureResolver/PublicationAudienceResolver",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Authorization-critical exposure and audience facts are server-owned dependencies.",
    requiredNegativeTestIds: ["publication.direct"],
  },
  {
    id: "publication.audience.resolver",
    category: "application_service",
    implementationPath: "src/application/content/publication-read-resolvers.ts",
    surface: "PersistedPublicationAudienceResolver.resolveAudience",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The persisted audience definition and Membership facts are both loaded through the Publication Tenant before canonical audience evaluation.",
    requiredNegativeTestIds: ["publication.audience-resolver"],
    operation: "PersistedPublicationAudienceResolver.resolveAudience",
  },
  {
    id: "publication.audience.batch-resolver",
    category: "application_service",
    implementationPath: "src/application/content/publication-read-resolvers.ts",
    surface: "PersistedPublicationAudienceBatchResolver.resolveAudienceBatch",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Bounded targeted candidates resolve through one Tenant-bound definition batch and at most one current Membership audience-facts read before canonical evaluation.",
    requiredNegativeTestIds: ["publication.audience-batch-resolver"],
    operation: "PersistedPublicationAudienceBatchResolver.resolveAudienceBatch",
  },
  {
    id: "publication.repository.atomic-create",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.createPublicationDraftInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The insert helper accepts only the caller's existing PostgreSQL transaction handle and hardcodes server-owned version 1, draft lifecycle, and null publishAt values.",
    requiredNegativeTestIds: ["publication.create"],
    operation:
      "DrizzlePublicationRepository.createPublicationDraftInTransaction",
  },
  {
    id: "publication.repository.atomic-edit",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.updatePublicationDraftInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The exact Tenant and Publication, expected version, and draft lifecycle are bound in the single version-guarded UPDATE; audience criteria remain outside the edit mutation.",
    requiredNegativeTestIds: ["publication.edit"],
    operation:
      "DrizzlePublicationRepository.updatePublicationDraftInTransaction",
  },
  {
    id: "publication.repository.atomic-publish",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.publishPublicationInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The row-locked Tenant-bound draft is rechecked against the expected version and canonical audience readiness; the lifecycle update uses the same transaction handle.",
    requiredNegativeTestIds: ["publication.publish"],
    operation:
      "DrizzlePublicationRepository.publishPublicationInTransaction",
  },
  {
    id: "audit.repository.append",
    category: "repository",
    implementationPath: "src/server/repositories/audit-event-repository.ts",
    surface:
      "DrizzleAuditEventRepository.appendPublicationPublishedInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The closed publication.published event is appended through the caller's lock-ordered PostgreSQL transaction with a Tenant chain sequence, external key-provider signature, and no separate commit path.",
    requiredNegativeTestIds: ["audit.persistence"],
    operation:
      "DrizzleAuditEventRepository.appendPublicationPublishedInTransaction",
  },
  {
    id: "audit.repository.sports-append",
    category: "repository",
    implementationPath: "src/server/repositories/audit-event-repository.ts",
    surface:
      "DrizzleAuditEventRepository.appendSportsMutationInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sports create/change/deactivate events use the caller's transaction, the Tenant-local immutable audit chain, and a closed event/resource vocabulary.",
    requiredNegativeTestIds: ["audit.persistence"],
    operation:
      "DrizzleAuditEventRepository.appendSportsMutationInTransaction",
  },
  {
    id: "sports.repository.sport-create",
    category: "repository",
    implementationPath: "src/server/repositories/sport-repository.ts",
    surface: "DrizzleSportRepository.createSportInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport creation accepts an explicit Tenant and caller transaction only.",
    requiredNegativeTestIds: ["sports.persistence"],
    operation: "DrizzleSportRepository.createSportInTransaction",
  },
  {
    id: "sports.repository.sport-direct",
    category: "repository",
    implementationPath: "src/server/repositories/sport-repository.ts",
    surface: "DrizzleSportRepository.findSportByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport lookup requires both Tenant and Sport identifiers before SQL.",
    requiredNegativeTestIds: ["sports.persistence"],
    operation: "DrizzleSportRepository.findSportByIdForTenant",
  },
  {
    id: "sports.repository.sport-list",
    category: "repository",
    implementationPath: "src/server/repositories/sport-repository.ts",
    surface: "DrizzleSportRepository.listSportsForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport collection reads are explicitly Tenant-bound, ordered, and bounded.",
    requiredNegativeTestIds: ["sports.persistence"],
    operation: "DrizzleSportRepository.listSportsForTenant",
  },
  {
    id: "sports.repository.sport-update",
    category: "repository",
    implementationPath: "src/server/repositories/sport-repository.ts",
    surface: "DrizzleSportRepository.updateSportInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport edits lock the exact Tenant-owned row and require the expected version.",
    requiredNegativeTestIds: ["sports.persistence"],
    operation: "DrizzleSportRepository.updateSportInTransaction",
  },
  {
    id: "sports.repository.sport-deactivate",
    category: "repository",
    implementationPath: "src/server/repositories/sport-repository.ts",
    surface: "DrizzleSportRepository.deactivateSportInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport deactivation is the only terminal mutation and never deletes the row.",
    requiredNegativeTestIds: ["sports.persistence"],
    operation: "DrizzleSportRepository.deactivateSportInTransaction",
  },
  {
    id: "sports.repository.competition-create",
    category: "repository",
    implementationPath: "src/server/repositories/competition-repository.ts",
    surface: "DrizzleCompetitionRepository.createCompetitionInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition creation locks active same-Tenant Sport and Campus rows before insert.",
    requiredNegativeTestIds: ["competition.persistence"],
    operation:
      "DrizzleCompetitionRepository.createCompetitionInTransaction",
  },
  {
    id: "sports.repository.competition-direct",
    category: "repository",
    implementationPath: "src/server/repositories/competition-repository.ts",
    surface: "DrizzleCompetitionRepository.findCompetitionByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition lookup requires both Tenant and Competition identifiers before SQL.",
    requiredNegativeTestIds: ["competition.persistence"],
    operation:
      "DrizzleCompetitionRepository.findCompetitionByIdForTenant",
  },
  {
    id: "sports.repository.competition-list",
    category: "repository",
    implementationPath: "src/server/repositories/competition-repository.ts",
    surface: "DrizzleCompetitionRepository.listCompetitionsForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition collection reads bind the Tenant and optional same-Tenant relation filters with a bounded order.",
    requiredNegativeTestIds: ["competition.persistence"],
    operation:
      "DrizzleCompetitionRepository.listCompetitionsForTenant",
  },
  {
    id: "sports.repository.competition-update",
    category: "repository",
    implementationPath: "src/server/repositories/competition-repository.ts",
    surface: "DrizzleCompetitionRepository.updateCompetitionInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition edits lock the exact row and validate active same-Tenant Sport and Campus relations.",
    requiredNegativeTestIds: ["competition.persistence"],
    operation:
      "DrizzleCompetitionRepository.updateCompetitionInTransaction",
  },
  {
    id: "sports.repository.competition-deactivate",
    category: "repository",
    implementationPath: "src/server/repositories/competition-repository.ts",
    surface:
      "DrizzleCompetitionRepository.deactivateCompetitionInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition deactivation is a versioned status transition without delete.",
    requiredNegativeTestIds: ["competition.persistence"],
    operation:
      "DrizzleCompetitionRepository.deactivateCompetitionInTransaction",
  },
  {
    id: "sports.repository.team-create",
    category: "repository",
    implementationPath: "src/server/repositories/team-repository.ts",
    surface: "DrizzleTeamRepository.createTeamInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team creation locks an active same-Tenant Sport before insert.",
    requiredNegativeTestIds: ["team.persistence"],
    operation: "DrizzleTeamRepository.createTeamInTransaction",
  },
  {
    id: "sports.repository.team-direct",
    category: "repository",
    implementationPath: "src/server/repositories/team-repository.ts",
    surface: "DrizzleTeamRepository.findTeamByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team lookup requires both Tenant and Team identifiers before SQL.",
    requiredNegativeTestIds: ["team.persistence"],
    operation: "DrizzleTeamRepository.findTeamByIdForTenant",
  },
  {
    id: "sports.repository.team-list",
    category: "repository",
    implementationPath: "src/server/repositories/team-repository.ts",
    surface: "DrizzleTeamRepository.listTeamsForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team collection reads bind the Tenant and optional Sport filter with a bounded order.",
    requiredNegativeTestIds: ["team.persistence"],
    operation: "DrizzleTeamRepository.listTeamsForTenant",
  },
  {
    id: "sports.repository.team-update",
    category: "repository",
    implementationPath: "src/server/repositories/team-repository.ts",
    surface: "DrizzleTeamRepository.updateTeamInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team edits lock the exact row, require expected version, and validate the active same-Tenant Sport.",
    requiredNegativeTestIds: ["team.persistence"],
    operation: "DrizzleTeamRepository.updateTeamInTransaction",
  },
  {
    id: "sports.repository.team-deactivate",
    category: "repository",
    implementationPath: "src/server/repositories/team-repository.ts",
    surface: "DrizzleTeamRepository.deactivateTeamInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team deactivation is a versioned status transition without delete.",
    requiredNegativeTestIds: ["team.persistence"],
    operation: "DrizzleTeamRepository.deactivateTeamInTransaction",
  },
  {
    id: "audit.repository.direct",
    category: "repository",
    implementationPath: "src/server/repositories/audit-event-repository.ts",
    surface: "DrizzleAuditEventRepository.findAuditEventByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Audit lookup binds both Tenant and event identifiers before hydration and never exposes a cross-Tenant row.",
    requiredNegativeTestIds: ["audit.persistence"],
    operation: "DrizzleAuditEventRepository.findAuditEventByIdForTenant",
  },
  {
    id: "audit.repository.collection",
    category: "repository",
    implementationPath: "src/server/repositories/audit-event-repository.ts",
    surface: "DrizzleAuditEventRepository.listAuditEventsForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Audit collection reads are bounded, ordered by the Tenant-local sequence, and constrained by the explicit Tenant predicate.",
    requiredNegativeTestIds: ["audit.persistence"],
    operation: "DrizzleAuditEventRepository.listAuditEventsForTenant",
  },
  {
    id: "audit.repository.verify",
    category: "repository",
    implementationPath: "src/server/repositories/audit-event-repository.ts",
    surface: "DrizzleAuditEventRepository.verifyAuditChainForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Chain verification consumes only the bounded Tenant-scoped event stream and fails closed on malformed or unverifiable integrity state.",
    requiredNegativeTestIds: ["audit.persistence"],
    operation: "DrizzleAuditEventRepository.verifyAuditChainForTenant",
  },
  {
    id: "publication.repository.direct",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface: "DrizzlePublicationRepository.findPublicationByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "SQL requires tenant_id and Publication id before hydration.",
    requiredNegativeTestIds: ["publication.direct"],
    operation: "DrizzlePublicationRepository.findPublicationByIdForTenant",
  },
  {
    id: "publication.repository.collection",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface: "DrizzlePublicationRepository.listPublicationCandidatesForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "SQL requires tenant_id, surface lifecycle predicates, and keyset ordering without OFFSET.",
    requiredNegativeTestIds: ["publication.collection"],
    operation: "DrizzlePublicationRepository.listPublicationCandidatesForTenant",
  },
  {
    id: "publication.repository.audience-definition",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.findPublicationAudienceDefinitionForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Publication and criterion reads require the same explicit Tenant and Publication identifiers; malformed and foreign rows fail closed.",
    requiredNegativeTestIds: ["publication.audience-definition"],
    operation:
      "DrizzlePublicationRepository.findPublicationAudienceDefinitionForTenant",
  },
  {
    id: "publication.repository.audience-definition-batch",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.findPublicationAudienceDefinitionsForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "A bounded set-based Publication and criteria read requires the same explicit Tenant predicate; invalid, foreign, missing, or malformed definitions are omitted.",
    requiredNegativeTestIds: ["publication.audience-definition-batch"],
    operation:
      "DrizzlePublicationRepository.findPublicationAudienceDefinitionsForTenant",
  },
  {
    id: "publication.repository.audience-replacement",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.replaceDraftPublicationAudienceForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "A row-locked Tenant-bound Publication transaction validates targets before Tenant-scoped mode and criterion replacement.",
    requiredNegativeTestIds: ["publication.audience-replacement"],
    operation:
      "DrizzlePublicationRepository.replaceDraftPublicationAudienceForTenant",
  },
  {
    id: "publication.repository.audience-target-validity",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.arePublicationAudienceTargetsCurrentlyValidForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Current hierarchy and academic-year configuration are checked through the same Tenant-bound canonical audience definition.",
    requiredNegativeTestIds: ["publication.audience-target-validity"],
    operation:
      "DrizzlePublicationRepository.arePublicationAudienceTargetsCurrentlyValidForTenant",
  },
  {
    id: "publication.repository.audience-count",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.countPublicationAudienceMembershipsForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The scalar aggregate is constrained by the Tenant-bound Publication definition and Membership tenant_id; no identity fields are selected.",
    requiredNegativeTestIds: ["publication.audience-count"],
    operation:
      "DrizzlePublicationRepository.countPublicationAudienceMembershipsForTenant",
  },
  {
    id: "publication.repository.audience-readiness-snapshot",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.readPublicationAudienceReadinessSnapshotForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "A single Tenant-bound PostgreSQL transaction locks the exact Publication and reads its canonical criteria, target validity, and scalar Membership count through the same transaction handle.",
    requiredNegativeTestIds: ["publication.audience-atomic"],
    operation:
      "DrizzlePublicationRepository.readPublicationAudienceReadinessSnapshotForTenant",
  },
  {
    id: "publication.repository.audience-confirmation-atomic",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface:
      "DrizzlePublicationRepository.validatePublicationAudienceConfirmationAtomicallyForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Confirmation locks the exact Tenant-bound Publication and compares expected version, target validity, and scalar count before the transaction releases the consistent snapshot.",
    requiredNegativeTestIds: ["publication.audience-atomic"],
    operation:
      "DrizzlePublicationRepository.validatePublicationAudienceConfirmationAtomicallyForTenant",
  },
  {
    id: "publication.audience-readiness",
    category: "application_service",
    implementationPath: "src/application/content/publication-audience-readiness.ts",
    surface: "getPublicationAudienceReadinessForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Readiness is calculated only from a Tenant-bound Publication, canonical audience definition, current target validity, and scalar Membership count.",
    requiredNegativeTestIds: ["publication.audience-readiness"],
    operation: "getPublicationAudienceReadinessForTenant",
  },
  {
    id: "publication.audience-confirmation",
    category: "application_service",
    implementationPath: "src/application/content/publication-audience-readiness.ts",
    surface: "validatePublicationAudienceConfirmationForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Confirmation re-reads current readiness and accepts only the expected version and exact scalar estimate.",
    requiredNegativeTestIds: ["publication.audience-confirmation"],
    operation: "validatePublicationAudienceConfirmationForTenant",
  },
  {
    id: "publication.direct-read",
    category: "application_service",
    implementationPath: "src/application/content/read-publication.ts",
    surface: "ReadPublicationService.getPublicationForRead",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Viewer and trusted Tenant facts bind before lookup; hydrated denials normalize to NOT_FOUND.",
    requiredNegativeTestIds: ["publication.direct"],
    operation: "ReadPublicationService.getPublicationForRead",
  },
  {
    id: "publication.collection",
    category: "application_service",
    implementationPath: "src/application/content/list-publications.ts",
    surface: "ListPublicationsService.listPublications ACTIVE/ARCHIVE",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Collection input binds viewer and Tenant before bounded tenant-scoped keyset reads for both surfaces.",
    requiredNegativeTestIds: ["publication.collection"],
    operation: "ListPublicationsService.listPublications",
  },
  {
    id: "home.service",
    category: "application_service",
    implementationPath: "src/application/content/campus-home.ts",
    surface: "CampusHomeService.getFeed/getDetail",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The Home adapter forwards only the trusted RequestContext Tenant and Membership facts into the canonical ACTIVE collection and direct-read services, then maps only authorized Publication fields.",
    requiredNegativeTestIds: ["home.collection"],
  },
  {
    id: "home.service.feed",
    category: "application_service",
    implementationPath: "src/application/content/campus-home.ts",
    surface: "CampusHomeService.getFeed",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Home collection requests are fixed to ACTIVE and the trusted Tenant; denial and malformed cursor results are reduced to an unavailable state without exposing hidden-row metadata.",
    requiredNegativeTestIds: ["home.collection"],
    operation: "CampusHomeService.getFeed",
  },
  {
    id: "home.service.detail",
    category: "application_service",
    implementationPath: "src/application/content/campus-home.ts",
    surface: "CampusHomeService.getDetail",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Every detail request reuses the trusted Tenant and viewer while the canonical direct-read service reauthorizes the exact Publication before mapping it.",
    requiredNegativeTestIds: ["home.detail"],
    operation: "CampusHomeService.getDetail",
  },
  {
    id: "home.service.factory",
    category: "application_service",
    implementationPath: "src/server/home/create-campus-home-service.ts",
    surface: "createCampusHomeService",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The server-only factory composes existing Tenant-bound repositories, exposure seam, and persisted audience resolvers; it performs no query until a trusted Home operation invokes the composed services.",
    requiredNegativeTestIds: ["home.collection"],
    operation: "createCampusHomeService",
  },
  {
    id: "home.route",
    category: "route",
    implementationPath: "src/app/(student)/page.tsx",
    surface: "GET /",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The Server Component accepts no browser authority, requires a server-produced trusted context, and delegates collection authorization to CampusHomeService.",
    requiredNegativeTestIds: ["home.collection"],
    operation: "default",
  },
  {
    id: "home.detail.route",
    category: "route",
    implementationPath: "src/app/(student)/publications/[publicationId]/page.tsx",
    surface: "GET /publications/:publicationId",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The Server Component accepts no browser authority and independently reauthorizes the exact Tenant-bound Publication; denied or missing resources render the safe not-found path.",
    requiredNegativeTestIds: ["home.detail"],
    operation: "default",
  },
  {
    id: "home.loading.route",
    category: "route",
    implementationPath: "src/app/(student)/loading.tsx",
    surface: "Home loading state",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The loading shell contains no resource data or authority and is attached only to the governed Tenant Home route segment.",
    requiredNegativeTestIds: ["home.collection"],
    operation: "default",
  },
  {
    id: "publication.create",
    category: "application_service",
    implementationPath: "src/application/content/create-publication.ts",
    surface: "CreatePublicationService.createPublication",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Trusted context and requested Tenant must match before preflight authorization; the authoritative capability check and Tenant-scoped Publication INSERT then share the atomic PostgreSQL gateway transaction.",
    requiredNegativeTestIds: ["publication.create"],
    operation: "CreatePublicationService.createPublication",
  },
  {
    id: "publication.edit",
    category: "application_service",
    implementationPath: "src/application/content/edit-publication-draft.ts",
    surface: "EditPublicationDraftService.editPublicationDraft",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Trusted context and requested Tenant bind before publication.edit preflight; the atomic gateway rechecks current authority and the exact draft Publication before mutation.",
    requiredNegativeTestIds: ["publication.edit"],
    operation: "EditPublicationDraftService.editPublicationDraft",
  },
  {
    id: "publication.publish",
    category: "application_service",
    implementationPath: "src/application/content/publish-publication.ts",
    surface: "PublishPublicationService.publishPublication",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Trusted context and requested Tenant must match before publication.publish preflight; only the atomic gateway may return a published Publication after exact version and audience confirmation succeed.",
    requiredNegativeTestIds: ["publication.publish"],
    operation: "PublishPublicationService.publishPublication",
  },
  {
    id: "sports.authorized-management",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Every Sports mutation rechecks sport.manage, the exact Tenant authority rows, and actual database audit privileges in the same transaction before appending one immutable audit event.",
    requiredNegativeTestIds: ["sports.authorization"],
  },
  {
    id: "sports.authorized-create-sport",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor.createSport",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport creation is Tenant-bound, capability-gated, and audit-atomic.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresAuthorizedSportsManagementExecutor.createSport",
  },
  {
    id: "sports.authorized-update-sport",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor.updateSport",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport edits use expected-version concurrency and append a same-transaction audit event.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresAuthorizedSportsManagementExecutor.updateSport",
  },
  {
    id: "sports.authorized-deactivate-sport",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor.deactivateSport",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport deactivation is a versioned status transition; no hard-delete operation exists.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresAuthorizedSportsManagementExecutor.deactivateSport",
  },
  {
    id: "sports.authorized-create-competition",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor.createCompetition",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition creation requires active same-Tenant Sport and Campus rows and an atomic audit append.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresAuthorizedSportsManagementExecutor.createCompetition",
  },
  {
    id: "sports.authorized-update-competition",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor.updateCompetition",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition edits lock and validate same-Tenant Sport/Campus relationships under expected-version concurrency.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresAuthorizedSportsManagementExecutor.updateCompetition",
  },
  {
    id: "sports.authorized-deactivate-competition",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor.deactivateCompetition",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition deactivation is a versioned status transition without hard deletion.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresAuthorizedSportsManagementExecutor.deactivateCompetition",
  },
  {
    id: "sports.authorized-create-team",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor.createTeam",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team creation requires an active same-Tenant Sport and appends its audit event in the mutation transaction.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresAuthorizedSportsManagementExecutor.createTeam",
  },
  {
    id: "sports.authorized-update-team",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor.updateTeam",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team edits are explicit-Tenant and expected-version guarded with same-Tenant Sport validation.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresAuthorizedSportsManagementExecutor.updateTeam",
  },
  {
    id: "sports.authorized-deactivate-team",
    category: "application_service",
    implementationPath:
      "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor.deactivateTeam",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team deactivation is a versioned status transition without hard deletion.",
    requiredNegativeTestIds: ["sports.authorization"],
    operation:
      "PostgresAuthorizedSportsManagementExecutor.deactivateTeam",
  },
  {
    id: "sports.management",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Management commands accept only a server-produced trusted context, an equal requested Tenant, narrow validated fields, and the exact sport.manage capability.",
    requiredNegativeTestIds: ["sports.management"],
  },
  {
    id: "sports.management.create-sport",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.createSport",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport creation rejects malformed or cross-Tenant commands before authorization or repository access.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.createSport",
  },
  {
    id: "sports.management.edit-sport",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.editSport",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport edits require exact Tenant scope and explicit expected-version input.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.editSport",
  },
  {
    id: "sports.management.deactivate-sport",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.deactivateSport",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport deactivation requires exact Tenant scope and expected version.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.deactivateSport",
  },
  {
    id: "sports.management.list-sports",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.listSports",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Sport lists are capability-gated, Tenant-bound, status-filtered, and bounded.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.listSports",
  },
  {
    id: "sports.management.create-competition",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.createCompetition",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition creation requires explicit same-Tenant scope and closed table-mode input.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.createCompetition",
  },
  {
    id: "sports.management.edit-competition",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.editCompetition",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition edits require exact Tenant scope, same-Tenant relation identifiers, and expected version.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.editCompetition",
  },
  {
    id: "sports.management.deactivate-competition",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.deactivateCompetition",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition deactivation requires exact Tenant scope and expected version.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.deactivateCompetition",
  },
  {
    id: "sports.management.list-competitions",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.listCompetitions",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Competition lists are capability-gated, explicitly Tenant-bound, optionally relation-filtered, and bounded.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.listCompetitions",
  },
  {
    id: "sports.management.create-team",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.createTeam",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team creation requires explicit same-Tenant scope and one Sport relation.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.createTeam",
  },
  {
    id: "sports.management.edit-team",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.editTeam",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team edits require exact Tenant scope, one same-Tenant Sport relation, and expected version.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.editTeam",
  },
  {
    id: "sports.management.deactivate-team",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.deactivateTeam",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team deactivation requires exact Tenant scope and expected version.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.deactivateTeam",
  },
  {
    id: "sports.management.list-teams",
    category: "application_service",
    implementationPath: "src/application/sports/manage-sports.ts",
    surface: "SportsManagementService.listTeams",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Team lists are capability-gated, explicitly Tenant-bound, optionally Sport-filtered, and bounded.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "SportsManagementService.listTeams",
  },
  {
    id: "sports.publisher-route",
    category: "route",
    implementationPath: "src/app/(publisher)/sports/page.tsx",
    surface: "GET /sports",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The Publisher Server Component renders only the unavailable state until a future server-produced trusted context exists; it accepts no browser authority.",
    requiredNegativeTestIds: ["sports.management"],
    operation: "default",
  },
  {
    id: "fixtures.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/sports.ts",
    surface: "fixtures",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Fixture rows are Tenant-owned and bind Competition, Campus, home Team, and away Team through same-Tenant composite foreign keys.",
    requiredNegativeTestIds: ["fixtures.persistence"],
    databaseObjectName: "fixtures",
    operation: "table:fixtures",
  },
  {
    id: "fixtures.repository",
    category: "repository",
    implementationPath: "src/server/repositories/fixture-repository.ts",
    surface: "DrizzleFixtureRepository",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Fixture direct and collection reads require an explicit Tenant; mutations lock dependencies in a deterministic order and require expected versions.",
    requiredNegativeTestIds: ["fixtures.persistence"],
  },
  {
    id: "fixtures.repository.create",
    category: "repository",
    implementationPath: "src/server/repositories/fixture-repository.ts",
    surface: "DrizzleFixtureRepository.createFixtureInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Fixture creation validates active same-Tenant Competition/Campus/Team rows and Sport consistency before insert.",
    requiredNegativeTestIds: ["fixtures.persistence"],
    operation: "DrizzleFixtureRepository.createFixtureInTransaction",
  },
  {
    id: "fixtures.repository.direct",
    category: "repository",
    implementationPath: "src/server/repositories/fixture-repository.ts",
    surface: "DrizzleFixtureRepository.findFixtureByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Fixture lookup requires both Tenant and Fixture identifiers.",
    requiredNegativeTestIds: ["fixtures.persistence"],
    operation: "DrizzleFixtureRepository.findFixtureByIdForTenant",
  },
  {
    id: "fixtures.repository.list",
    category: "repository",
    implementationPath: "src/server/repositories/fixture-repository.ts",
    surface: "DrizzleFixtureRepository.listFixturesForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Fixture lists bind the Tenant before joined relation filters and enforce bounded stable ordering.",
    requiredNegativeTestIds: ["fixtures.persistence"],
    operation: "DrizzleFixtureRepository.listFixturesForTenant",
  },
  {
    id: "fixtures.repository.update",
    category: "repository",
    implementationPath: "src/server/repositories/fixture-repository.ts",
    surface: "DrizzleFixtureRepository.updateFixtureInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Fixture edits lock the exact Tenant row and require the expected version.",
    requiredNegativeTestIds: ["fixtures.persistence"],
    operation: "DrizzleFixtureRepository.updateFixtureInTransaction",
  },
  {
    id: "fixtures.repository.postpone",
    category: "repository",
    implementationPath: "src/server/repositories/fixture-repository.ts",
    surface: "DrizzleFixtureRepository.postponeFixtureInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Postponement is a versioned state transition from scheduled to postponed.",
    requiredNegativeTestIds: ["fixtures.persistence"],
    operation: "DrizzleFixtureRepository.postponeFixtureInTransaction",
  },
  {
    id: "fixtures.repository.cancel",
    category: "repository",
    implementationPath: "src/server/repositories/fixture-repository.ts",
    surface: "DrizzleFixtureRepository.cancelFixtureInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Cancellation is a versioned terminal transition with a reason.",
    requiredNegativeTestIds: ["fixtures.persistence"],
    operation: "DrizzleFixtureRepository.cancelFixtureInTransaction",
  },
  {
    id: "fixtures.repository.complete",
    category: "repository",
    implementationPath: "src/server/repositories/fixture-repository.ts",
    surface: "DrizzleFixtureRepository.completeFixtureInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Completion is a versioned terminal transition and does not create Result data.",
    requiredNegativeTestIds: ["fixtures.persistence"],
    operation: "DrizzleFixtureRepository.completeFixtureInTransaction",
  },
  {
    id: "fixtures.repository.abandon",
    category: "repository",
    implementationPath: "src/server/repositories/fixture-repository.ts",
    surface: "DrizzleFixtureRepository.abandonFixtureInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Abandonment is a versioned terminal transition with a reason.",
    requiredNegativeTestIds: ["fixtures.persistence"],
    operation: "DrizzleFixtureRepository.abandonFixtureInTransaction",
  },
  {
    id: "fixtures.audit-append",
    category: "repository",
    implementationPath: "src/server/repositories/audit-event-repository.ts",
    surface: "DrizzleAuditEventRepository.appendFixtureMutationInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Fixture lifecycle events append to the same immutable Tenant audit transaction.",
    requiredNegativeTestIds: ["audit.persistence"],
    operation: "DrizzleAuditEventRepository.appendFixtureMutationInTransaction",
  },
  {
    id: "fixtures.authorized-management",
    category: "application_service",
    implementationPath: "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor Fixture mutations",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Fixture mutations reuse the atomic sport.manage authority, runtime database boundary, and immutable audit append.",
    requiredNegativeTestIds: ["fixtures.authorization"],
  },
  ...([
    ["createFixture", "create"],
    ["updateFixture", "update"],
    ["postponeFixture", "postpone"],
    ["cancelFixture", "cancel"],
    ["completeFixture", "complete"],
    ["abandonFixture", "abandon"],
  ] as const).map(([operation, label]) => ({
    id: `fixtures.authorized-${label}`,
    category: "application_service" as const,
    implementationPath: "src/server/authorization/postgres-authorized-sports.ts",
    surface: `PostgresAuthorizedSportsManagementExecutor.${operation}`,
    tenantScope: "TENANT_SCOPED" as const,
    isolationStrategy: "Fixture mutation is capability-gated and audit-atomic under an explicit Tenant.",
    requiredNegativeTestIds: ["fixtures.authorization"],
    operation: `PostgresAuthorizedSportsManagementExecutor.${operation}`,
  })),
  {
    id: "fixtures.management",
    category: "application_service",
    implementationPath: "src/application/sports/manage-fixtures.ts",
    surface: "FixtureManagementService",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Publisher commands require trusted context, equal Tenant scope, narrow fields, and sport.manage.",
    requiredNegativeTestIds: ["fixtures.management"],
  },
  ...([
    ["createFixture", "create"],
    ["editFixture", "edit"],
    ["postponeFixture", "postpone"],
    ["cancelFixture", "cancel"],
    ["completeFixture", "complete"],
    ["abandonFixture", "abandon"],
    ["listFixtures", "list"],
  ] as const).map(([operation, label]) => ({
    id: `fixtures.management-${label}`,
    category: "application_service" as const,
    implementationPath: "src/application/sports/manage-fixtures.ts",
    surface: `FixtureManagementService.${operation}`,
    tenantScope: "TENANT_SCOPED" as const,
    isolationStrategy: "Fixture Publisher operation is trusted-context and Tenant-bound; list is bounded.",
    requiredNegativeTestIds: ["fixtures.management"],
    operation: `FixtureManagementService.${operation}`,
  })),
  {
    id: "fixtures.student-read",
    category: "application_service",
    implementationPath: "src/application/sports/list-fixtures.ts",
    surface: "ListFixturesService",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Student fixture reads require trusted member context, full-functionality Tenant state, and explicit Tenant-local filters.",
    requiredNegativeTestIds: ["fixtures.student-read"],
  },
  {
    id: "fixtures.student-read-operation",
    category: "application_service",
    implementationPath: "src/application/sports/list-fixtures.ts",
    surface: "ListFixturesService.listFixtures",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Fixture collection read is bounded and never accepts browser identity or internal IDs from the page.",
    requiredNegativeTestIds: ["fixtures.student-read"],
    operation: "ListFixturesService.listFixtures",
  },
  {
    id: "fixtures.student-route",
    category: "route",
    implementationPath: "src/app/(student)/sports/fixtures/page.tsx",
    surface: "GET /sports/fixtures",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "The student route reads only a future server-produced trusted context and treats query filters as untrusted filters.",
    requiredNegativeTestIds: ["fixtures.student-read"],
    operation: "default",
  },
  {
    id: "fixtures.publisher-route",
    category: "route",
    implementationPath: "src/app/(publisher)/publisher/sports/fixtures/page.tsx",
    surface: "GET /publisher/sports/fixtures",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "The Publisher route exposes no controls until a server-produced trusted context exists.",
    requiredNegativeTestIds: ["fixtures.management"],
    operation: "default",
  },
  {
    id: "results.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/sports.ts",
    surface: "results",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Result aggregates are Tenant-owned, one-per-completed-Fixture, and bind their Fixture through a same-Tenant composite foreign key.",
    requiredNegativeTestIds: ["results.persistence"],
    databaseObjectName: "results",
    operation: "table:results",
  },
  {
    id: "result-revisions.persistence",
    category: "model",
    implementationPath: "src/server/db/schema/sports.ts",
    surface: "result_revisions",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Result revisions are Tenant-owned append-only rows bound to the Result and actor Membership through same-Tenant composite foreign keys.",
    requiredNegativeTestIds: ["result-revisions.persistence"],
    databaseObjectName: "result_revisions",
    operation: "table:result_revisions",
  },
  {
    id: "results.repository",
    category: "repository",
    implementationPath: "src/server/repositories/result-repository.ts",
    surface: "DrizzleResultRepository",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Result reads require explicit Tenant scope; mutations lock the Fixture/Result deterministically and use expected versions.",
    requiredNegativeTestIds: ["results.persistence"],
  },
  ...([
    ["createResultInTransaction", "create"],
    ["findResultByIdForTenant", "direct"],
    ["listPublishedResultsForTenant", "list"],
    ["listResultRevisionsForTenant", "history"],
    ["updateDraftResultInTransaction", "update"],
    ["publishResultInTransaction", "publish"],
    ["correctResultInTransaction", "correct"],
  ] as const).map(([operation, label]) => ({
    id: `results.repository-${label}`,
    category: "repository" as const,
    implementationPath: "src/server/repositories/result-repository.ts",
    surface: `DrizzleResultRepository.${operation}`,
    tenantScope: "TENANT_SCOPED" as const,
    isolationStrategy:
      "Result operation is Tenant-bound, version-checked, and preserves the published revision history contract.",
    requiredNegativeTestIds: ["results.persistence"],
    operation: `DrizzleResultRepository.${operation}`,
  })),
  {
    id: "results.audit-append",
    category: "repository",
    implementationPath: "src/server/repositories/audit-event-repository.ts",
    surface: "DrizzleAuditEventRepository.appendResultMutationInTransaction",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Result lifecycle events append to the same immutable Tenant audit chain and transaction as the Result mutation.",
    requiredNegativeTestIds: ["audit.persistence"],
    operation: "DrizzleAuditEventRepository.appendResultMutationInTransaction",
  },
  {
    id: "results.authorized-management",
    category: "application_service",
    implementationPath: "src/server/authorization/postgres-authorized-sports.ts",
    surface: "PostgresAuthorizedSportsManagementExecutor Result mutations",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Result mutations reuse sport.manage, fresh transaction authority, the runtime audit privilege boundary, and immutable audit append.",
    requiredNegativeTestIds: ["results.authorization"],
  },
  ...([
    ["createResult", "create"],
    ["updateResultDraft", "update"],
    ["publishResult", "publish"],
    ["correctResult", "correct"],
  ] as const).map(([operation, label]) => ({
    id: `results.authorized-${label}`,
    category: "application_service" as const,
    implementationPath: "src/server/authorization/postgres-authorized-sports.ts",
    surface: `PostgresAuthorizedSportsManagementExecutor.${operation}`,
    tenantScope: "TENANT_SCOPED" as const,
    isolationStrategy:
      "Result mutation is capability-gated and audit-atomic under an explicit Tenant.",
    requiredNegativeTestIds: ["results.authorization"],
    operation: `PostgresAuthorizedSportsManagementExecutor.${operation}`,
  })),
  {
    id: "results.management",
    category: "application_service",
    implementationPath: "src/application/sports/manage-results.ts",
    surface: "ResultManagementService",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Publisher Result commands require trusted context, equal Tenant scope, narrow score/reason fields, and sport.manage.",
    requiredNegativeTestIds: ["results.management"],
  },
  ...([
    ["createDraftResult", "create"],
    ["editDraftResult", "edit"],
    ["publishResult", "publish"],
    ["correctPublishedResult", "correct"],
    ["listResults", "list"],
    ["inspectResultHistory", "history"],
  ] as const).map(([operation, label]) => ({
    id: `results.management-${label}`,
    category: "application_service" as const,
    implementationPath: "src/application/sports/manage-results.ts",
    surface: `ResultManagementService.${operation}`,
    tenantScope: "TENANT_SCOPED" as const,
    isolationStrategy:
      "Result Publisher operation is trusted-context and Tenant-bound; reads are bounded and published-history scoped.",
    requiredNegativeTestIds: ["results.management"],
    operation: `ResultManagementService.${operation}`,
  })),
  {
    id: "results.student-read",
    category: "application_service",
    implementationPath: "src/application/sports/list-results.ts",
    surface: "ListResultsService",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Student Result reads require trusted member context, a functioning Tenant, and published-only bounded results/history.",
    requiredNegativeTestIds: ["results.student-read"],
  },
  ...([
    ["listResults", "list"],
    ["listCorrectionHistory", "history"],
  ] as const).map(([operation, label]) => ({
    id: `results.student-read-${label}`,
    category: "application_service" as const,
    implementationPath: "src/application/sports/list-results.ts",
    surface: `ListResultsService.${operation}`,
    tenantScope: "TENANT_SCOPED" as const,
    isolationStrategy:
      "Student Result reads expose only published scores and redacted correction history under explicit Tenant scope.",
    requiredNegativeTestIds: ["results.student-read"],
    operation: `ListResultsService.${operation}`,
  })),
  {
    id: "results.student-route",
    category: "route",
    implementationPath: "src/app/(student)/sports/results/page.tsx",
    surface: "GET /sports/results",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The student route accepts only untrusted filters and reads a future server-produced trusted context; it renders unavailable without one.",
    requiredNegativeTestIds: ["results.student-read"],
    operation: "default",
  },
  {
    id: "results.student-history-route",
    category: "route",
    implementationPath: "src/app/(student)/sports/results/[resultId]/history/page.tsx",
    surface: "GET /sports/results/:resultId/history",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "Correction history is reauthorized through the trusted student context and is only rendered for a published Result in the active Tenant.",
    requiredNegativeTestIds: ["results.student-read"],
    operation: "default",
  },
  {
    id: "results.publisher-route",
    category: "route",
    implementationPath: "src/app/(publisher)/publisher/sports/results/page.tsx",
    surface: "GET /publisher/sports/results",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy:
      "The Publisher Result surface exposes no controls until a server-produced trusted context exists.",
    requiredNegativeTestIds: ["results.management"],
    operation: "default",
  },
  {
    id: "fixtures.services.factory",
    category: "infrastructure",
    implementationPath: "src/server/sports/create-fixture-services.ts",
    surface: "Fixture service factories",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Factories construct server-side dependencies; they perform no Tenant resource query by themselves.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "This is a server wiring module; Tenant checks remain in the returned services and repositories.",
  },
  {
    id: "fixtures.services.factory-list",
    category: "infrastructure",
    implementationPath: "src/server/sports/create-fixture-services.ts",
    surface: "createListFixturesService",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Factory construction only; returned service enforces trusted Tenant scope.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "This function creates dependency wiring and does not read Tenant data.",
    operation: "createListFixturesService",
  },
  {
    id: "fixtures.services.factory-management",
    category: "infrastructure",
    implementationPath: "src/server/sports/create-fixture-services.ts",
    surface: "createFixtureManagementService",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Factory construction only; returned management service enforces trusted Tenant scope and capability.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "This function accepts already-selected dependencies and performs no resource access.",
    operation: "createFixtureManagementService",
  },
  {
    id: "global.health.route",
    category: "route",
    implementationPath: "src/app/api/health/route.ts",
    surface: "GET /api/health",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Liveness response contains no Tenant or resource data.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Global process liveness is intentionally available without a Tenant context.",
    operation: "GET",
  },
  {
    id: "global.health.service",
    category: "application_service",
    implementationPath: "src/application/system/get-health.ts",
    surface: "getHealth",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Returns only the fixed process liveness status.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Health is infrastructure liveness, not a Tenant-owned operation.",
    operation: "getHealth",
  },
  {
    id: "global.database.client",
    category: "infrastructure",
    implementationPath: "src/server/db/client.ts",
    surface: "PostgreSQL/Drizzle client",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Connection infrastructure performs no resource query by itself.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "The connection pool is shared infrastructure; every resource query remains scoped in its repository.",
  },
  {
    id: "global.schema.barrel",
    category: "infrastructure",
    implementationPath: "src/server/db/schema/index.ts",
    surface: "Drizzle schema export barrel",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "The barrel exports schema metadata and does not perform data access.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "This is a schema-module index; Tenant ownership is declared on individual table entries.",
  },
  {
    id: "global.env.reader",
    category: "infrastructure",
    implementationPath: "src/server/config/env.ts",
    surface: "getServerEnv",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Server configuration reads process configuration and exposes no Tenant resource data.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Environment configuration is process infrastructure; it is not a Tenant resource query.",
    operation: "getServerEnv",
  },
  {
    id: "global.env.schema",
    category: "infrastructure",
    implementationPath: "src/server/config/env-schema.ts",
    surface: "parseServerEnv",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Environment validation constrains process configuration without loading Tenant data.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Environment schema validation is process startup infrastructure, not a Tenant-owned operation.",
    operation: "parseServerEnv",
  },
  {
    id: "global.tenancy.registry",
    category: "infrastructure",
    implementationPath: "src/server/tenancy/tenant-surface-registry.ts",
    surface: "validateTenantSurfaceRegistry",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "The registry validator checks architecture metadata and never queries resource data.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Registry validation is a CI architecture gate and has no runtime Tenant resource access.",
    operation: "validateTenantSurfaceRegistry",
  },
  {
    id: "global.migrations",
    category: "migration",
    implementationPath: "drizzle/0014_unusual_madelyne_pryor.sql",
    surface: "Reviewed Drizzle migration history through 0014",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Migration files change schema ownership constraints and do not serve runtime resource data.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Migration history is deployment infrastructure; table ownership is checked structurally from the current schema.",
    declaredImplementationPaths: [
      "drizzle/0000_young_adam_warlock.sql",
      "drizzle/0001_luxuriant_monster_badoon.sql",
      "drizzle/0002_talented_timeslip.sql",
      "drizzle/0003_skinny_boom_boom.sql",
      "drizzle/0004_right_whizzer.sql",
      "drizzle/0005_nostalgic_prima.sql",
      "drizzle/0006_unknown_psylocke.sql",
      "drizzle/0007_optimal_mockingbird.sql",
      "drizzle/0008_loving_dagger.sql",
      "drizzle/0009_swift_salo.sql",
      "drizzle/0010_yielding_ghost_rider.sql",
      "drizzle/0011_dark_boomerang.sql",
      "drizzle/0012_tired_junta.sql",
      "drizzle/0013_regular_bug.sql",
      "drizzle/0014_unusual_madelyne_pryor.sql",
    ],
    migrationHead: "drizzle/0014_unusual_madelyne_pryor.sql",
  },
] as const satisfies readonly TenantSurfaceRegistryEntry[];

export const GOVERNED_SURFACE_ROOTS = [
  "src/server",
  "src/application",
  "src/app/api",
  "src/app/(student)",
  "src/app/(publisher)",
] as const;

export const GOVERNED_SINGLE_FILE_PREFIXES = [
  "src/middleware",
  "src/proxy",
] as const;

export const FUTURE_TENANT_SURFACE_CATEGORIES = [
  "job",
  "export",
  "search_index",
  "cache",
  "media",
  "notification",
  "analytics",
  "backup",
] as const;

export type DiscoveredTenantModel = Readonly<{
  databaseObjectName: string;
  implementationPath: string;
  tenantScope: "TENANT_ROOT" | "TENANT_SCOPED";
}>;

export type RegistryValidationInput = Readonly<{
  registry: readonly TenantSurfaceRegistryEntry[];
  discoveredTenantModels: readonly DiscoveredTenantModel[];
  governedImplementationPaths: readonly string[];
  discoveredOperations: readonly DiscoveredTenantOperation[];
  discoveredUnsupportedOperationForms: readonly DiscoveredUnsupportedOperationForm[];
  productionImportBoundaryViolations: readonly ProductionImportBoundaryViolation[];
  discoveredMigrationPaths: readonly string[];
  implementationPathExists: (implementationPath: string) => boolean;
  isolationProbeIds: ReadonlySet<string>;
}>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function includesValue<T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.includes(value);
}

function hasSpecificGlobalExemptionReason(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const reason = value.trim();
  const genericReasons = new Set([
    "global",
    "global exemption",
    "not tenant scoped",
    "not tenant-scoped",
    "infrastructure",
    "n/a",
    "none",
  ]);

  return (
    reason.length >= 24 &&
    reason.split(/\s+/).length >= 4 &&
    !genericReasons.has(reason.toLowerCase())
  );
}

function isLegalCategoryScopePair(
  category: unknown,
  tenantScope: unknown,
): boolean {
  if (
    !includesValue(TENANT_SURFACE_CATEGORIES, category) ||
    !includesValue(TENANT_SCOPE_CLASSIFICATIONS, tenantScope)
  ) {
    return false;
  }

  if (tenantScope === "FUTURE_NOT_IMPLEMENTED") {
    return true;
  }

  return (TENANT_SCOPE_MATRIX[category] as readonly string[]).includes(
    tenantScope,
  );
}

function operationKey(
  implementationPath: string,
  operation: string,
): string {
  return `${implementationPath}#${operation}`;
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

const tenantRootContracts = [
  {
    id: "tenant.persistence.root",
    category: "model",
    implementationPath: "src/server/db/schema/tenant.ts",
    operation: "table:tenants",
    databaseObjectName: "tenants",
  },
  {
    id: "tenant.repository.find-by-id",
    category: "repository",
    implementationPath: "src/server/repositories/tenant-repository.ts",
    operation: "DrizzleTenantRepository.findTenantById",
  },
  {
    id: "tenant.repository.find-by-slug",
    category: "repository",
    implementationPath: "src/server/repositories/tenant-repository.ts",
    operation: "DrizzleTenantRepository.findTenantBySlug",
  },
] as const;

function isApprovedTenantRootContract(
  entry: TenantSurfaceRegistryEntry,
): boolean {
  return tenantRootContracts.some(
    (contract) =>
      entry.id === contract.id &&
      entry.category === contract.category &&
      entry.implementationPath === contract.implementationPath &&
      entry.operation === contract.operation &&
      (!("databaseObjectName" in contract) ||
        entry.databaseObjectName === contract.databaseObjectName),
  );
}

function isApprovedGlobalNonTenantContract(
  entry: TenantSurfaceRegistryEntry,
): boolean {
  if (
    !APPROVED_GLOBAL_NON_TENANT_SURFACE_IDS.includes(
      entry.id as ApprovedGlobalNonTenantSurfaceId,
    )
  ) {
    return false;
  }

  const contract =
    APPROVED_GLOBAL_NON_TENANT_CONTRACTS[
      entry.id as ApprovedGlobalNonTenantSurfaceId
    ];
  return (
    entry.category === contract.category &&
    entry.implementationPath === contract.implementationPath &&
    entry.operation ===
      ("operation" in contract ? contract.operation : undefined)
  );
}

/**
 * Validates architecture metadata and discovery evidence. It deliberately
 * contains no authorization or database-query behavior.
 */
export function validateTenantSurfaceRegistry(
  input: RegistryValidationInput,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const operationKeys = new Set<string>();
  const entriesByPath = new Map<string, TenantSurfaceRegistryEntry[]>();

  for (const entry of input.registry) {
    if (!isNonEmptyString(entry.id)) {
      errors.push("registry entry has an empty stable ID");
    } else if (ids.has(entry.id)) {
      errors.push(`duplicate registry ID: ${entry.id}`);
    } else {
      ids.add(entry.id);
    }

    if (!includesValue(TENANT_SURFACE_CATEGORIES, entry.category)) {
      errors.push(`invalid registry category for ${entry.id}`);
    }
    if (!includesValue(TENANT_SCOPE_CLASSIFICATIONS, entry.tenantScope)) {
      errors.push(`invalid Tenant scope classification for ${entry.id}`);
    }
    if (!isLegalCategoryScopePair(entry.category, entry.tenantScope)) {
      errors.push(
        `illegal category/scope pair for ${entry.id}: ${entry.category}/${entry.tenantScope}`,
      );
    }
    if (!isNonEmptyString(entry.implementationPath)) {
      errors.push(`missing implementation path for ${entry.id}`);
    } else {
      const pathEntries = entriesByPath.get(entry.implementationPath) ?? [];
      pathEntries.push(entry);
      entriesByPath.set(entry.implementationPath, pathEntries);

      const pathExists = input.implementationPathExists(entry.implementationPath);
      if (
        entry.tenantScope === "FUTURE_NOT_IMPLEMENTED" &&
        pathExists
      ) {
        errors.push(
          `FUTURE_NOT_IMPLEMENTED entry has an existing implementation: ${entry.id}: ${entry.implementationPath}`,
        );
      }
      if (
        entry.tenantScope !== "FUTURE_NOT_IMPLEMENTED" &&
        !pathExists
      ) {
        errors.push(
          `implementation path missing for ${entry.id}: ${entry.implementationPath}`,
        );
      }
    }

    if (!isNonEmptyString(entry.surface)) {
      errors.push(`missing surface description for ${entry.id}`);
    }

    if (entry.operation !== undefined) {
      if (!isNonEmptyString(entry.operation)) {
        errors.push(`empty operation metadata for ${entry.id}`);
      } else {
        const key = operationKey(entry.implementationPath, entry.operation);
        if (operationKeys.has(key)) {
          errors.push(`duplicate operation declaration: ${key}`);
        } else {
          operationKeys.add(key);
        }
      }
    }

    if (entry.tenantScope === "TENANT_ROOT") {
      if (!isApprovedTenantRootContract(entry)) {
        errors.push(
          `TENANT_ROOT entry is not an approved Tenant-root contract: ${entry.id}`,
        );
      }
      if (entry.requiredNegativeTestIds.length === 0) {
        errors.push(`TENANT_ROOT entry lacks root negative-test obligation: ${entry.id}`);
      }
      if (entry.globalExemptionReason !== undefined) {
        errors.push(`TENANT_ROOT entry has a global exemption: ${entry.id}`);
      }
    }

    if (entry.tenantScope === "TENANT_SCOPED") {
      if (!isNonEmptyString(entry.isolationStrategy)) {
        errors.push(`TENANT_SCOPED entry lacks isolation strategy: ${entry.id}`);
      }
      if (entry.requiredNegativeTestIds.length === 0) {
        errors.push(`TENANT_SCOPED entry lacks negative-test obligation: ${entry.id}`);
      }
      if (entry.globalExemptionReason !== undefined) {
        errors.push(`TENANT_SCOPED entry has a global exemption: ${entry.id}`);
      }
      for (const probeId of entry.requiredNegativeTestIds) {
        if (!input.isolationProbeIds.has(probeId)) {
          errors.push(`missing isolation probe ${probeId} required by ${entry.id}`);
        }
      }
    }

    if (entry.tenantScope === "GLOBAL_NON_TENANT") {
      if (!hasSpecificGlobalExemptionReason(entry.globalExemptionReason)) {
        errors.push(
          `GLOBAL_NON_TENANT entry lacks a specific exemption reason: ${entry.id}`,
        );
      }
      if (
        !APPROVED_GLOBAL_NON_TENANT_SURFACE_IDS.includes(
          entry.id as ApprovedGlobalNonTenantSurfaceId,
        )
      ) {
        errors.push(
          `GLOBAL_NON_TENANT entry is not on the reviewed allowlist: ${entry.id}`,
        );
      } else if (!isApprovedGlobalNonTenantContract(entry)) {
        errors.push(
          `GLOBAL_NON_TENANT entry does not match its reviewed contract: ${entry.id}`,
        );
      }
      if (entry.requiredNegativeTestIds.length > 0) {
        errors.push(`GLOBAL_NON_TENANT entry has a negative-test obligation: ${entry.id}`);
      }
    }

    if (entry.tenantScope === "FUTURE_NOT_IMPLEMENTED") {
      if (!isNonEmptyString(entry.isolationStrategy)) {
        errors.push(`FUTURE_NOT_IMPLEMENTED entry lacks future obligation: ${entry.id}`);
      }
      if (entry.requiredNegativeTestIds.length > 0) {
        errors.push(`FUTURE_NOT_IMPLEMENTED entry has a current probe: ${entry.id}`);
      }
      if (entry.globalExemptionReason !== undefined) {
        errors.push(`FUTURE_NOT_IMPLEMENTED entry has a global exemption: ${entry.id}`);
      }
    }

    if (
      entry.category !== "migration" &&
      (entry.declaredImplementationPaths !== undefined ||
        entry.migrationHead !== undefined)
    ) {
      errors.push(`migration metadata is only valid on migration entries: ${entry.id}`);
    }
  }

  for (const implementationPath of input.governedImplementationPaths) {
    if (!entriesByPath.has(implementationPath)) {
      errors.push(`governed surface is undeclared: ${implementationPath}`);
    }
  }

  for (const unsupportedForm of input.discoveredUnsupportedOperationForms) {
    errors.push(
      `unsupported governed callable form: ${unsupportedForm.implementationPath}: ${unsupportedForm.description}`,
    );
  }

  for (const violation of input.productionImportBoundaryViolations) {
    errors.push(
      `production import crosses excluded test/spec boundary: ${violation.fromPath} -> ${violation.specifier} (${violation.resolvedPath})`,
    );
  }

  for (const discoveredOperation of input.discoveredOperations) {
    const key = operationKey(
      discoveredOperation.implementationPath,
      discoveredOperation.operation,
    );
    const candidates = input.registry.filter(
      (entry) =>
        entry.implementationPath === discoveredOperation.implementationPath &&
        entry.operation === discoveredOperation.operation,
    );
    if (candidates.length === 0) {
      errors.push(`governed operation is undeclared: ${key}`);
      continue;
    }

    if (
      discoveredOperation.kind === "route_handler" &&
      !candidates.some((entry) => entry.category === "route")
    ) {
      errors.push(`route handler lacks route registry category: ${key}`);
    }
  }

  for (const model of input.discoveredTenantModels) {
    const candidates = input.registry.filter(
      (entry) =>
        entry.category === "model" &&
        entry.databaseObjectName === model.databaseObjectName,
    );
    if (candidates.length === 0) {
      errors.push(
        `discovered Tenant-owned model is undeclared: ${model.databaseObjectName}`,
      );
      continue;
    }

    if (
      !candidates.some(
        (entry) =>
          entry.implementationPath === model.implementationPath &&
          entry.tenantScope === model.tenantScope,
      )
    ) {
      errors.push(
        `discovered Tenant-owned model declaration is invalid: ${model.databaseObjectName}`,
      );
    }
  }

  const migrationEntries = input.registry.filter(
    (entry) => entry.category === "migration",
  );
  if (input.discoveredMigrationPaths.length > 0) {
    if (migrationEntries.length !== 1) {
      errors.push(
        `migration history declaration must contain exactly one entry for discovered SQL migrations; found ${migrationEntries.length}`,
      );
    } else {
      const migrationEntry = migrationEntries[0];
      const declaredPaths = migrationEntry.declaredImplementationPaths;
      if (declaredPaths === undefined || declaredPaths.length === 0) {
        errors.push("migration history paths are not explicitly declared");
      } else {
        if (!sameStringSet(declaredPaths, input.discoveredMigrationPaths)) {
          errors.push("migration history declaration does not match discovered SQL migrations");
        }
        for (const declaredPath of declaredPaths) {
          if (!input.implementationPathExists(declaredPath)) {
            errors.push(`declared migration path missing: ${declaredPath}`);
          }
        }
      }

      const expectedHead = input.discoveredMigrationPaths.at(-1);
      if (migrationEntry.migrationHead !== expectedHead) {
        errors.push(
          `migration head is not the current discovered head: ${migrationEntry.migrationHead ?? "<missing>"}`,
        );
      }
      if (migrationEntry.implementationPath !== migrationEntry.migrationHead) {
        errors.push(
          `migration implementation path must equal declared head: ${migrationEntry.id}`,
        );
      }
    }
  }

  return errors;
}
