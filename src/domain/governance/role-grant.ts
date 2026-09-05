import {
  parseCapability,
  parseCapabilityModuleScope,
  type Capability,
  type CapabilityModuleScope,
} from "@/domain/authorization/capability-vocabulary";

export const ROLE_GRANT_ROLES = ["publisher", "guild_administrator"] as const;

export type RoleGrantRole = (typeof ROLE_GRANT_ROLES)[number];

export type RoleGrant = Readonly<{
  id: string;
  tenantId: string;
  guildTermId: string;
  membershipId: string;
  role: RoleGrantRole;
  capability: Capability;
  moduleScope: CapabilityModuleScope;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function parseRoleGrantRole(value: unknown): RoleGrantRole | null {
  return typeof value === "string" &&
    ROLE_GRANT_ROLES.includes(value as RoleGrantRole)
    ? (value as RoleGrantRole)
    : null;
}

export function isRoleGrant(value: unknown): value is RoleGrant {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const createdAt = candidate.createdAt;
  const expiresAt = candidate.expiresAt;
  const revokedAt = candidate.revokedAt;

  return (
    typeof candidate.id === "string" && candidate.id.trim().length > 0 &&
    typeof candidate.tenantId === "string" &&
    candidate.tenantId.trim().length > 0 &&
    typeof candidate.guildTermId === "string" &&
    candidate.guildTermId.trim().length > 0 &&
    typeof candidate.membershipId === "string" &&
    candidate.membershipId.trim().length > 0 &&
    parseRoleGrantRole(candidate.role) !== null &&
    parseCapability(candidate.capability) !== null &&
    parseCapabilityModuleScope(candidate.moduleScope) !== null &&
    isValidDate(createdAt) &&
    isValidDate(expiresAt) &&
    expiresAt.getTime() > createdAt.getTime() &&
    (revokedAt === null ||
      (isValidDate(revokedAt) && revokedAt.getTime() >= createdAt.getTime())) &&
    isValidDate(candidate.updatedAt)
  );
}
