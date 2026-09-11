import { isUuid } from "@/domain/identifiers/uuid";

export const RESULT_LIFECYCLES = ["draft", "published"] as const;
export type ResultLifecycle = (typeof RESULT_LIFECYCLES)[number];

export const RESULT_SCORE_MAX = 1000;
export const RESULT_CORRECTION_REASON_MAX_LENGTH = 500;
export const RESULT_HISTORY_MAX_LIMIT = 100;

export type Result = Readonly<{
  id: string;
  tenantId: string;
  fixtureId: string;
  lifecycle: ResultLifecycle;
  draftHomeScore: number | null;
  draftAwayScore: number | null;
  currentRevisionNumber: number | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ResultRevision = Readonly<{
  id: string;
  tenantId: string;
  resultId: string;
  revisionNumber: number;
  homeScore: number;
  awayScore: number;
  actorMembershipId: string;
  correctionReason: string | null;
  createdAt: Date;
}>;

export type CreateResultInput = Readonly<{
  fixtureId: string;
  homeScore: number;
  awayScore: number;
}>;

export type UpdateResultDraftInput = Readonly<{
  expectedVersion: number;
  homeScore: number;
  awayScore: number;
}>;

export type PublishResultInput = Readonly<{
  expectedVersion: number;
}>;

export type CorrectResultInput = Readonly<{
  expectedVersion: number;
  homeScore: number;
  awayScore: number;
  reason: string;
}>;

export function parseResultLifecycle(value: unknown): ResultLifecycle | null {
  return typeof value === "string" &&
    RESULT_LIFECYCLES.includes(value as ResultLifecycle)
    ? (value as ResultLifecycle)
    : null;
}

export function parseResultScore(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= RESULT_SCORE_MAX
    ? value
    : null;
}

export function parseResultReason(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= RESULT_CORRECTION_REASON_MAX_LENGTH
    ? value.trim()
    : null;
}

export function parseResultExpectedVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

export function parseResultHistoryLimit(value: unknown): number | null {
  if (value === undefined || value === null) {
    return 50;
  }
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= RESULT_HISTORY_MAX_LIMIT
    ? value
    : null;
}

function isDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isPositiveVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

export function isResult(value: unknown): value is Result {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const lifecycle = parseResultLifecycle(candidate.lifecycle);
  const draftHomeScore = candidate.draftHomeScore;
  const draftAwayScore = candidate.draftAwayScore;
  const currentRevisionNumber = candidate.currentRevisionNumber;
  return (
    isUuid(candidate.id) &&
    isUuid(candidate.tenantId) &&
    isUuid(candidate.fixtureId) &&
    lifecycle !== null &&
    (draftHomeScore === null || parseResultScore(draftHomeScore) !== null) &&
    (draftAwayScore === null || parseResultScore(draftAwayScore) !== null) &&
    ((lifecycle === "draft" &&
      draftHomeScore !== null &&
      draftAwayScore !== null &&
      currentRevisionNumber === null) ||
      (lifecycle === "published" &&
        draftHomeScore === null &&
        draftAwayScore === null &&
        typeof currentRevisionNumber === "number" &&
        isPositiveVersion(currentRevisionNumber))) &&
    isPositiveVersion(candidate.version) &&
    isDate(candidate.createdAt) &&
    isDate(candidate.updatedAt)
  );
}

export function isResultRevision(value: unknown): value is ResultRevision {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    isUuid(candidate.id) &&
    isUuid(candidate.tenantId) &&
    isUuid(candidate.resultId) &&
    isPositiveVersion(candidate.revisionNumber) &&
    parseResultScore(candidate.homeScore) !== null &&
    parseResultScore(candidate.awayScore) !== null &&
    isUuid(candidate.actorMembershipId) &&
    (candidate.correctionReason === null ||
      parseResultReason(candidate.correctionReason) !== null) &&
    (candidate.revisionNumber === 1
      ? candidate.correctionReason === null
      : parseResultReason(candidate.correctionReason) !== null) &&
    isDate(candidate.createdAt)
  );
}
