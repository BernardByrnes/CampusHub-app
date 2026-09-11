import { isUuid } from "@/domain/identifiers/uuid";

export const FIXTURE_STATES = [
  "scheduled",
  "postponed",
  "cancelled",
  "completed",
  "abandoned",
] as const;
export type FixtureState = (typeof FIXTURE_STATES)[number];

export const FIXTURE_VENUE_MAX_LENGTH = 200;
export const FIXTURE_REASON_MAX_LENGTH = 500;
export const FIXTURE_LIST_MAX_LIMIT = 100;

export type Fixture = Readonly<{
  id: string;
  tenantId: string;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  campusId: string;
  startsAt: Date;
  venue: string;
  state: FixtureState;
  reason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type CreateFixtureInput = Readonly<{
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  campusId: string;
  startsAt: Date;
  venue: string;
}>;

export type UpdateFixtureInput = Readonly<{
  expectedVersion: number;
  startsAt: Date;
  venue: string;
}>;

export type PostponeFixtureInput = Readonly<{
  expectedVersion: number;
  startsAt: Date;
  reason: string;
}>;

export type TransitionFixtureInput = Readonly<{
  expectedVersion: number;
  reason?: string;
}>;

export function parseFixtureState(value: unknown): FixtureState | null {
  return typeof value === "string" &&
    FIXTURE_STATES.includes(value as FixtureState)
    ? (value as FixtureState)
    : null;
}

export function parseFixtureVenue(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= FIXTURE_VENUE_MAX_LENGTH
    ? value.trim()
    : null;
}

export function parseFixtureReason(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= FIXTURE_REASON_MAX_LENGTH
    ? value.trim()
    : null;
}

export function parseFixtureTimestamp(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
    ? parsed
    : null;
}

export function parseFixtureExpectedVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

export function parseFixtureListLimit(value: unknown): number | null {
  if (value === undefined || value === null) {
    return 50;
  }
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= FIXTURE_LIST_MAX_LIMIT
    ? value
    : null;
}

export function canTransitionFixture(
  from: FixtureState,
  to: FixtureState,
): boolean {
  if (from === "scheduled" || from === "postponed") {
    return (
      to === "postponed" ||
      to === "cancelled" ||
      to === "completed" ||
      to === "abandoned"
    );
  }
  return false;
}

function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function isFixture(value: unknown): value is Fixture {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isUuid(candidate.id) &&
    isUuid(candidate.tenantId) &&
    isUuid(candidate.competitionId) &&
    isUuid(candidate.homeTeamId) &&
    isUuid(candidate.awayTeamId) &&
    isUuid(candidate.campusId) &&
    candidate.homeTeamId !== candidate.awayTeamId &&
    isDate(candidate.startsAt) &&
    parseFixtureVenue(candidate.venue) !== null &&
    parseFixtureState(candidate.state) !== null &&
    (candidate.reason === null || parseFixtureReason(candidate.reason) !== null) &&
    typeof candidate.version === "number" &&
    Number.isSafeInteger(candidate.version) &&
    candidate.version >= 1 &&
    isDate(candidate.createdAt) &&
    isDate(candidate.updatedAt)
  );
}
