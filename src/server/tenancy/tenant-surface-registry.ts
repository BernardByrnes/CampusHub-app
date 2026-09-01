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
  },
  {
    id: "tenant.repository.lookup",
    category: "repository",
    implementationPath: "src/server/repositories/tenant-repository.ts",
    surface: "DrizzleTenantRepository.findTenantById/findTenantBySlug",
    tenantScope: "TENANT_ROOT",
    isolationStrategy: "Tenant root lookup validates the canonical identifier or slug before SQL.",
    requiredNegativeTestIds: ["tenant.root.contract"],
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
  },
  {
    id: "membership.repository.identity-tenant",
    category: "repository",
    implementationPath: "src/server/repositories/membership-repository.ts",
    surface: "findMembershipForIdentityAndTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "SQL requires both identitySubjectId and tenant_id; invalid Tenant UUIDs stop before SQL.",
    requiredNegativeTestIds: ["membership.identity-tenant"],
  },
  {
    id: "membership.repository.tenant-id",
    category: "repository",
    implementationPath: "src/server/repositories/membership-repository.ts",
    surface: "findMembershipByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "SQL requires tenant_id and Membership id; foreign or malformed IDs return null.",
    requiredNegativeTestIds: ["membership.id-tenant"],
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
    id: "publication.repository.direct",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface: "findPublicationByIdForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "SQL requires tenant_id and Publication id before hydration.",
    requiredNegativeTestIds: ["publication.direct"],
  },
  {
    id: "publication.repository.collection",
    category: "repository",
    implementationPath: "src/server/repositories/publication-repository.ts",
    surface: "listPublicationCandidatesForTenant",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "SQL requires tenant_id, surface lifecycle predicates, and keyset ordering without OFFSET.",
    requiredNegativeTestIds: ["publication.collection"],
  },
  {
    id: "publication.direct-read",
    category: "application_service",
    implementationPath: "src/application/content/read-publication.ts",
    surface: "ReadPublicationService.getPublicationForRead",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Viewer and trusted Tenant facts bind before lookup; hydrated denials normalize to NOT_FOUND.",
    requiredNegativeTestIds: ["publication.direct"],
  },
  {
    id: "publication.collection.active",
    category: "application_service",
    implementationPath: "src/application/content/list-publications.ts",
    surface: "ListPublicationsService ACTIVE",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Collection input binds viewer and Tenant before bounded tenant-scoped keyset reads.",
    requiredNegativeTestIds: ["publication.collection"],
  },
  {
    id: "publication.collection.archive",
    category: "application_service",
    implementationPath: "src/application/content/list-publications.ts",
    surface: "ListPublicationsService ARCHIVE",
    tenantScope: "TENANT_SCOPED",
    isolationStrategy: "Archive collection preserves the same Tenant binding, policy, and bounded keyset contract.",
    requiredNegativeTestIds: ["publication.collection"],
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
    id: "global.migrations",
    category: "migration",
    implementationPath: "drizzle/0004_right_whizzer.sql",
    surface: "Reviewed Drizzle migration history through 0004",
    tenantScope: "GLOBAL_NON_TENANT",
    isolationStrategy: "Migration files change schema ownership constraints and do not serve runtime resource data.",
    requiredNegativeTestIds: [],
    globalExemptionReason: "Migration history is deployment infrastructure; table ownership is checked structurally from the current schema.",
  },
] as const satisfies readonly TenantSurfaceRegistryEntry[];

export const GOVERNED_SURFACE_ROOTS = [
  "src/app/api",
  "src/application",
  "src/server/context",
  "src/server/repositories",
  "src/server/db/schema",
  "src/server/jobs",
  "src/server/exports",
  "src/server/search",
  "src/server/cache",
  "src/server/media",
  "src/server/notifications",
  "src/server/analytics",
] as const;

export const FUTURE_TENANT_SURFACE_CATEGORIES = [
  "job",
  "export",
  "search_index",
  "cache",
  "media",
  "notification",
  "analytics",
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

/**
 * Validates architecture metadata and discovery evidence. It deliberately
 * contains no authorization or database-query behavior.
 */
export function validateTenantSurfaceRegistry(
  input: RegistryValidationInput,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
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
    if (!isNonEmptyString(entry.implementationPath)) {
      errors.push(`missing implementation path for ${entry.id}`);
    } else {
      const pathEntries = entriesByPath.get(entry.implementationPath) ?? [];
      pathEntries.push(entry);
      entriesByPath.set(entry.implementationPath, pathEntries);
      if (!input.implementationPathExists(entry.implementationPath)) {
        errors.push(
          `implementation path missing for ${entry.id}: ${entry.implementationPath}`,
        );
      }
    }

    if (!isNonEmptyString(entry.surface)) {
      errors.push(`missing surface description for ${entry.id}`);
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
      if (!isNonEmptyString(entry.globalExemptionReason)) {
        errors.push(`GLOBAL_NON_TENANT entry lacks exemption reason: ${entry.id}`);
      }
      if (entry.requiredNegativeTestIds.length > 0) {
        errors.push(`GLOBAL_NON_TENANT entry has a negative-test obligation: ${entry.id}`);
      }
    }
  }

  for (const implementationPath of input.governedImplementationPaths) {
    if (!entriesByPath.has(implementationPath)) {
      errors.push(`governed surface is undeclared: ${implementationPath}`);
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

  return errors;
}
