const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value
    : null;
}

export function isUuid(value: unknown): value is string {
  return parseUuid(value) !== null;
}
