export const RESOURCE_VISIBILITIES = [
  "PUBLIC",
  "MEMBERS",
  "VERIFIED_MEMBERS",
] as const;

export type ResourceVisibility = (typeof RESOURCE_VISIBILITIES)[number];

export function parseResourceVisibility(
  value: unknown,
): ResourceVisibility | null {
  return typeof value === "string" &&
    (RESOURCE_VISIBILITIES as readonly string[]).includes(value)
    ? (value as ResourceVisibility)
    : null;
}
