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
  "global.membership-repository.constructor",
  "global.publication-repository.constructor",
  "global.tenant-repository.constructor",
  "global.schema.barrel",
  "global.env.reader",
  "global.env.schema",
  "global.tenancy.registry",
  "global.migrations",
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
  "global.membership-repository.constructor": {
    category: "infrastructure",
    implementationPath: "src/server/repositories/membership-repository.ts",
    operation: "DrizzleMembershipRepository.constructor",
  },
  "global.publication-repository.constructor": {
    category: "infrastructure",
    implementationPath: "src/server/repositories/publication-repository.ts",
    operation: "DrizzlePublicationRepository.constructor",
  },
  "global.tenant-repository.constructor": {
    category: "infrastructure",
    implementationPath: "src/server/repositories/tenant-repository.ts",
    operation: "DrizzleTenantRepository.constructor",
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
    implementationPath: "drizzle/0004_right_whizzer.sql",
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
    exportName: "memberships",
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
    exportName: "publications",
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
    moduleSpecifier: "./publication",
    exportForm: "ExportAllDeclaration",
  },
  {
    implementationPath: "src/server/db/schema/index.ts",
    moduleSpecifier: "./tenant",
    exportForm: "ExportAllDeclaration",
  },
] as const;

/**
 * Existing exported service/repository constructors are dependency-injection
 * construction details rather than independently governed operations. These
 * exact path/class contracts preserve that reviewed surface only when the
 * constructor body is empty; a newly executable constructor is discovered as
 * a callable operation.
 */
export const REVIEWED_NON_OPERATIONAL_CONSTRUCTOR_CONTRACTS = [
  {
    implementationPath: "src/application/context/resolve-request-context.ts",
    classIdentity: "RequestContextService",
  },
  {
    implementationPath: "src/application/content/create-publication.ts",
    classIdentity: "CreatePublicationService",
  },
  {
    implementationPath: "src/application/content/list-publications.ts",
    classIdentity: "ListPublicationsService",
  },
  {
    implementationPath: "src/application/content/read-publication.ts",
    classIdentity: "ReadPublicationService",
  },
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
    isolationStrategy: "Required tenant_id ownership with a foreign key to tenants.id.",
    requiredNegativeTestIds: ["membership.persistence"],
    databaseObjectName: "memberships",
    operation: "table:memberships",
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
    id: "publication.authorization.resolvers",
    category: "application_service",
    implementationPath: "src/application/content/publication-read-resolvers.ts",
    surface: "PublicationExposureResolver/PublicationAudienceResolver",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Authorization-critical exposure and audience facts are server-owned dependencies.",
    requiredNegativeTestIds: ["publication.direct"],
  },
  {
    id: "publication.repository.create",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface: "DrizzlePublicationRepository.createPublication",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Publication writes accept only a canonical Tenant UUID and persist that ownership field.",
    requiredNegativeTestIds: ["publication.create"],
    operation: "DrizzlePublicationRepository.createPublication",
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
    id: "publication.create",
    category: "application_service",
    implementationPath: "src/application/content/create-publication.ts",
    surface: "CreatePublicationService.createPublication",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Trusted context and requested Tenant must match before the repository write; scope validation is not capability authorization.",
    requiredNegativeTestIds: ["publication.create"],
    operation: "CreatePublicationService.createPublication",
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
    id: "global.membership-repository.constructor",
    category: "infrastructure",
    implementationPath: "src/server/repositories/membership-repository.ts",
    surface: "DrizzleMembershipRepository constructor dependency wiring",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Constructor selects an injected or default database dependency without performing a Tenant query.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Repository construction wires shared infrastructure; Tenant scoping begins at each repository operation.",
    operation: "DrizzleMembershipRepository.constructor",
  },
  {
    id: "global.publication-repository.constructor",
    category: "infrastructure",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface: "DrizzlePublicationRepository constructor dependency wiring",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Constructor selects an injected or default database dependency without performing a Tenant query.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Repository construction wires shared infrastructure; Tenant scoping begins at each repository operation.",
    operation: "DrizzlePublicationRepository.constructor",
  },
  {
    id: "global.tenant-repository.constructor",
    category: "infrastructure",
    implementationPath: "src/server/repositories/tenant-repository.ts",
    surface: "DrizzleTenantRepository constructor dependency wiring",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Constructor selects an injected or default database dependency without performing a Tenant query.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Repository construction wires shared infrastructure; Tenant scoping begins at each repository operation.",
    operation: "DrizzleTenantRepository.constructor",
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
    implementationPath: "drizzle/0004_right_whizzer.sql",
    surface: "Reviewed Drizzle migration history through 0004",
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
    ],
    migrationHead: "drizzle/0004_right_whizzer.sql",
  },
] as const satisfies readonly TenantSurfaceRegistryEntry[];

export const GOVERNED_SURFACE_ROOTS = [
  "src/server",
  "src/application",
  "src/app/api",
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
