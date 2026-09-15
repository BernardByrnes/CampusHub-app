import { isUuid } from "@/domain/identifiers/uuid";

export const ORGANISER_NAME_MAX_LENGTH = 120;
export const ORGANISERS_LIST_MAX_LIMIT = 100;

export type Organiser = Readonly<{
  id: string;
  tenantId: string;
  version: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateOrganiserInput = Readonly<{ name: string }>;
export type UpdateOrganiserInput = Readonly<{
  expectedVersion: number;
  name: string;
}>;

export function parseOrganiserName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= ORGANISER_NAME_MAX_LENGTH
    ? normalized
    : null;
}

export function parseOrganiserExpectedVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

export function parseOrganiserListLimit(value: unknown): number | null {
  if (value === undefined || value === null) return 50;
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= ORGANISERS_LIST_MAX_LIMIT
    ? value
    : null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isOrganiser(value: unknown): value is Organiser {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const canonicalName = parseOrganiserName(candidate.name);
  return isUuid(candidate.id) &&
    isUuid(candidate.tenantId) &&
    parseOrganiserExpectedVersion(candidate.version) !== null &&
    canonicalName !== null &&
    candidate.name === canonicalName &&
    isValidDate(candidate.createdAt) &&
    isValidDate(candidate.updatedAt);
}
