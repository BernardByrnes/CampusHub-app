export const TENANT_LIFECYCLE_STATUSES = [
  "pilot",
  "active",
  "grace",
  "suspended",
  "archived",
] as const;

export type TenantLifecycle = (typeof TENANT_LIFECYCLE_STATUSES)[number];
export type TenantStatus = TenantLifecycle;
export const TENANT_STATUSES = TENANT_LIFECYCLE_STATUSES;

/** The frozen authority permits full student operations in these states. */
export const TENANT_PROTECTED_OPERATION_STATUSES = [
  "pilot",
  "active",
  "grace",
] as const satisfies readonly TenantLifecycle[];

export type Tenant = Readonly<{
  id: string;
  slug: string;
  displayName: string;
  status: TenantLifecycle;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseTenantLifecycle(value: unknown): TenantLifecycle | null {
  return typeof value === "string" &&
    (TENANT_LIFECYCLE_STATUSES as readonly string[]).includes(value)
    ? (value as TenantLifecycle)
    : null;
}

export function isValidTenantSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 80 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

export function isValidIanaTimezone(value: unknown): value is string {
  if (!isNonEmptyString(value) || value !== value.trim()) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function isTenantLifecycleOperationalForProtectedActions(
  value: unknown,
): value is (typeof TENANT_PROTECTED_OPERATION_STATUSES)[number] {
  return (
    typeof value === "string" &&
    (TENANT_PROTECTED_OPERATION_STATUSES as readonly string[]).includes(value)
  );
}

export function isTenant(value: unknown): value is Tenant {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    isNonEmptyString(candidate.id) &&
    isValidTenantSlug(candidate.slug) &&
    isNonEmptyString(candidate.displayName) &&
    parseTenantLifecycle(candidate.status) !== null &&
    isValidIanaTimezone(candidate.timezone) &&
    candidate.createdAt instanceof Date &&
    !Number.isNaN(candidate.createdAt.getTime()) &&
    candidate.updatedAt instanceof Date &&
    !Number.isNaN(candidate.updatedAt.getTime())
  );
}
