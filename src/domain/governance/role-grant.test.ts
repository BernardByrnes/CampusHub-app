import { describe, expect, it } from "vitest";

import { CAPABILITIES, parseCapabilityModuleScope } from "@/domain/authorization/capability";

import {
  isRoleGrant,
  parseRoleGrantRole,
  ROLE_GRANT_ROLES,
} from "./role-grant";

const createdAt = new Date("2026-01-01T00:00:00.000Z");
const expiresAt = new Date("2026-12-31T23:59:59.000Z");

const validGrant = {
  id: "00000000-0000-4000-8000-000000000001",
  tenantId: "00000000-0000-4000-8000-000000000002",
  guildTermId: "00000000-0000-4000-8000-000000000003",
  membershipId: "00000000-0000-4000-8000-000000000004",
  role: "publisher" as const,
  capability: CAPABILITIES.PUBLICATION_CREATE,
  moduleScope: "publication" as const,
  expiresAt,
  revokedAt: null,
  createdAt,
  updatedAt: createdAt,
};

describe("RoleGrant domain contract", () => {
  it("keeps role and module scopes closed", () => {
    expect(ROLE_GRANT_ROLES).toEqual(["publisher", "guild_administrator"]);
    expect(parseRoleGrantRole("publisher")).toBe("publisher");
    expect(parseRoleGrantRole("owner")).toBeNull();
    expect(parseCapabilityModuleScope("publication")).toBe("publication");
    expect(parseCapabilityModuleScope("arbitrary")).toBeNull();
  });

  it("accepts a valid Membership-backed capability grant and rejects drift", () => {
    expect(isRoleGrant(validGrant)).toBe(true);
    expect(isRoleGrant({ ...validGrant, expiresAt: createdAt })).toBe(false);
    expect(isRoleGrant({ ...validGrant, revokedAt: new Date("2025-12-31T00:00:00.000Z") })).toBe(false);
    expect(isRoleGrant({ ...validGrant, moduleScope: "event" })).toBe(true);
    expect(isRoleGrant({ ...validGrant, capability: "unknown" })).toBe(false);
  });
});
