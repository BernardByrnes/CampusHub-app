import "server-only";

/**
 * Canonical capability names shared by server-side authorization boundaries.
 * Listing a capability here does not authorize or implement that operation.
 */
export const CAPABILITIES = {
  PUBLICATION_CREATE: "publication.create",
  PUBLICATION_EDIT: "publication.edit",
  PUBLICATION_PUBLISH: "publication.publish",
  PUBLICATION_PRIORITY_PUBLISH: "publication.priority_publish",
  PUBLICATION_RETRACT: "publication.retract",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

const CAPABILITY_VALUES = Object.values(CAPABILITIES) as readonly Capability[];

export function parseCapability(value: unknown): Capability | null {
  return typeof value === "string" && CAPABILITY_VALUES.includes(value as Capability)
    ? (value as Capability)
    : null;
}
