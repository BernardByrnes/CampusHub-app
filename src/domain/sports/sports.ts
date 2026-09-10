import { isUuid } from "@/domain/identifiers/uuid";

export const SPORT_LIFECYCLE_STATUSES = ["active", "inactive"] as const;
export type SportLifecycle = (typeof SPORT_LIFECYCLE_STATUSES)[number];

export const COMPETITION_TABLE_MODES = ["none", "manual"] as const;
export type CompetitionTableMode = (typeof COMPETITION_TABLE_MODES)[number];

export const SPORTS_NAME_MAX_LENGTH = 120;
export const SPORTS_SEASON_LABEL_MAX_LENGTH = 80;
export const SPORTS_AFFILIATION_MAX_LENGTH = 160;
export const SPORTS_LIST_MAX_LIMIT = 100;

export type Sport = Readonly<{
  id: string;
  tenantId: string;
  name: string;
  status: SportLifecycle;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type Competition = Readonly<{
  id: string;
  tenantId: string;
  sportId: string;
  name: string;
  seasonLabel: string;
  campusId: string;
  tableMode: CompetitionTableMode;
  status: SportLifecycle;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type Team = Readonly<{
  id: string;
  tenantId: string;
  sportId: string;
  name: string;
  affiliationLabel: string | null;
  status: SportLifecycle;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateSportInput = Readonly<{ name: string }>;
export type UpdateSportInput = Readonly<{
  expectedVersion: number;
  name: string;
}>;
export type DeactivateSportInput = Readonly<{ expectedVersion: number }>;

export type CreateCompetitionInput = Readonly<{
  sportId: string;
  name: string;
  seasonLabel: string;
  campusId: string;
  tableMode: CompetitionTableMode;
}>;
export type UpdateCompetitionInput = Readonly<
  CreateCompetitionInput & { expectedVersion: number }
>;
export type DeactivateCompetitionInput = Readonly<{ expectedVersion: number }>;

export type CreateTeamInput = Readonly<{
  sportId: string;
  name: string;
  affiliationLabel: string | null;
}>;
export type UpdateTeamInput = Readonly<
  CreateTeamInput & { expectedVersion: number }
>;
export type DeactivateTeamInput = Readonly<{ expectedVersion: number }>;

export function parseSportLifecycle(value: unknown): SportLifecycle | null {
  return typeof value === "string" &&
    SPORT_LIFECYCLE_STATUSES.includes(value as SportLifecycle)
    ? (value as SportLifecycle)
    : null;
}

export function parseCompetitionTableMode(
  value: unknown,
): CompetitionTableMode | null {
  return typeof value === "string" &&
    COMPETITION_TABLE_MODES.includes(value as CompetitionTableMode)
    ? (value as CompetitionTableMode)
    : null;
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function isValidAffiliation(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.trim().length > 0 &&
      value.length <= SPORTS_AFFILIATION_MAX_LENGTH)
  );
}

export function parseSportName(value: unknown): string | null {
  return isBoundedText(value, SPORTS_NAME_MAX_LENGTH) ? value.trim() : null;
}

export function parseSeasonLabel(value: unknown): string | null {
  return isBoundedText(value, SPORTS_SEASON_LABEL_MAX_LENGTH)
    ? value.trim()
    : null;
}

export function parseAffiliationLabel(
  value: unknown,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value === undefined ? undefined : null;
  }
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= SPORTS_AFFILIATION_MAX_LENGTH
    ? value.trim()
    : undefined;
}

export function parseExpectedVersion(value: unknown): number | null {
  return isPositiveVersion(value) ? value : null;
}

export function parseSportsListLimit(value: unknown): number | null {
  if (value === undefined || value === null) {
    return 50;
  }
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= SPORTS_LIST_MAX_LIMIT
    ? value
    : null;
}

export function isSport(value: unknown): value is Sport {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isUuid(candidate.id) &&
    isUuid(candidate.tenantId) &&
    isBoundedText(candidate.name, SPORTS_NAME_MAX_LENGTH) &&
    parseSportLifecycle(candidate.status) !== null &&
    isPositiveVersion(candidate.version) &&
    isValidDate(candidate.createdAt) &&
    isValidDate(candidate.updatedAt)
  );
}

export function isCompetition(value: unknown): value is Competition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isUuid(candidate.id) &&
    isUuid(candidate.tenantId) &&
    isUuid(candidate.sportId) &&
    isBoundedText(candidate.name, SPORTS_NAME_MAX_LENGTH) &&
    isBoundedText(candidate.seasonLabel, SPORTS_SEASON_LABEL_MAX_LENGTH) &&
    isUuid(candidate.campusId) &&
    parseCompetitionTableMode(candidate.tableMode) !== null &&
    parseSportLifecycle(candidate.status) !== null &&
    isPositiveVersion(candidate.version) &&
    isValidDate(candidate.createdAt) &&
    isValidDate(candidate.updatedAt)
  );
}

export function isTeam(value: unknown): value is Team {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isUuid(candidate.id) &&
    isUuid(candidate.tenantId) &&
    isUuid(candidate.sportId) &&
    isBoundedText(candidate.name, SPORTS_NAME_MAX_LENGTH) &&
    isValidAffiliation(candidate.affiliationLabel) &&
    parseSportLifecycle(candidate.status) !== null &&
    isPositiveVersion(candidate.version) &&
    isValidDate(candidate.createdAt) &&
    isValidDate(candidate.updatedAt)
  );
}
