/**
 * Pure persisted capability vocabulary shared by Drizzle schema metadata and
 * server-only authorization code. This module performs no authorization.
 */
export const CAPABILITIES = {
  PUBLICATION_CREATE: "publication.create",
  PUBLICATION_EDIT: "publication.edit",
  PUBLICATION_PUBLISH: "publication.publish",
  PUBLICATION_PRIORITY_PUBLISH: "publication.priority_publish",
  PUBLICATION_RETRACT: "publication.retract",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const CAPABILITY_VALUES = [
  CAPABILITIES.PUBLICATION_CREATE,
  CAPABILITIES.PUBLICATION_EDIT,
  CAPABILITIES.PUBLICATION_PUBLISH,
  CAPABILITIES.PUBLICATION_PRIORITY_PUBLISH,
  CAPABILITIES.PUBLICATION_RETRACT,
] as const satisfies readonly Capability[];

/**
 * Closed module scopes used by persisted capability grants. This vocabulary
 * mirrors the product's named production modules; it is not an arbitrary
 * string escape hatch for authorization data.
 */
export const CAPABILITY_MODULE_SCOPES = [
  "publication",
  "event",
  "opportunity",
  "sports",
  "poll",
  "voice",
  "quiz",
  "sponsorship",
  "tenant",
  "verification",
  "analytics",
  "notification",
  "export",
  "search",
] as const;

export type CapabilityModuleScope = (typeof CAPABILITY_MODULE_SCOPES)[number];

export function parseCapability(value: unknown): Capability | null {
  return typeof value === "string" && CAPABILITY_VALUES.includes(value as Capability)
    ? (value as Capability)
    : null;
}

export function parseCapabilityModuleScope(
  value: unknown,
): CapabilityModuleScope | null {
  return typeof value === "string" &&
    CAPABILITY_MODULE_SCOPES.includes(value as CapabilityModuleScope)
    ? (value as CapabilityModuleScope)
    : null;
}
