import "server-only";

import { isResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle, tenantHasFullFunctionality } from "@/domain/tenancy/tenant";
import { parseResultHistoryLimit, type ResultRevision } from "@/domain/sports/results";
import type { ResultListItem, DrizzleResultRepository } from "@/server/repositories/result-repository";

export const RESULT_READ_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_UNAVAILABLE",
  "MEMBERSHIP_NOT_ELIGIBLE",
  "NOT_FOUND",
  "PERSISTENCE_FAILED",
] as const;
export type ResultReadDenialCode = (typeof RESULT_READ_DENIAL_CODES)[number];

export type StudentResultItem = Readonly<{
  resultId: string;
  fixtureId: string;
  sportName: string;
  competitionName: string;
  homeTeamName: string;
  awayTeamName: string;
  campusLabel: string;
  startsAt: Date;
  venue: string;
  homeScore: number;
  awayScore: number;
  revisionNumber: number;
  corrected: boolean;
}>;

export type StudentResultHistoryItem = Readonly<{
  revisionNumber: number;
  homeScore: number;
  awayScore: number;
  correctionReason: string | null;
  createdAt: Date;
}>;

export type ResultReadResult =
  | Readonly<{ outcome: "READY"; items: readonly StudentResultItem[] }>
  | Readonly<{ outcome: "HISTORY"; items: readonly StudentResultHistoryItem[] }>
  | Readonly<{ outcome: "DENIED"; code: ResultReadDenialCode }>;

export type ListResultsInput = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  filters?: unknown;
}>;
export type ListResultHistoryInput = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  resultId: string;
  limit?: unknown;
}>;

export type ResultReadServiceDependencies = Readonly<{
  results: Pick<DrizzleResultRepository, "listPublishedResultsForTenant" | "listResultRevisionsForTenant">;
}>;

const MEMBER_READ_LIFECYCLES: readonly string[] = [
  "unverified",
  "pending_review",
  "verified",
  "stale",
  "on_leave",
  "participation_suspended",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseName(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized.length <= 120 ? normalized : null;
}

function parseFilters(value: unknown): { fixtureId?: string; sportName?: string; competitionName?: string; teamName?: string; limit?: number } | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const allowed = ["sportName", "competitionName", "teamName", "fixtureId", "limit"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
  const sportName = parseName(value.sportName);
  const competitionName = parseName(value.competitionName);
  const teamName = parseName(value.teamName);
  const fixtureId = value.fixtureId === undefined ? undefined : isUuid(value.fixtureId) ? value.fixtureId : null;
  const limit = parseResultHistoryLimit(value.limit);
  if (sportName === null || competitionName === null || teamName === null || fixtureId === null || limit === null) return null;
  return { sportName, competitionName, teamName, fixtureId, limit };
}

function isTrustedContext(value: unknown): value is TrustedRequestContext {
  return isRecord(value) &&
    isResourceReadViewer({ kind: "membership", context: value }) &&
    isUuid(value.tenantId) &&
    isUuid(value.membershipId) &&
    parseTenantLifecycle(value.tenantStatus) !== null &&
    parseMembershipLifecycle(value.membershipStatus) !== null;
}

function denied(code: ResultReadDenialCode): ResultReadResult {
  return { outcome: "DENIED", code };
}

function toStudentItem(item: ResultListItem): StudentResultItem {
  return {
    resultId: item.result.id,
    fixtureId: item.result.fixtureId,
    sportName: item.sportName,
    competitionName: item.competitionName,
    homeTeamName: item.homeTeamName,
    awayTeamName: item.awayTeamName,
    campusLabel: item.campusLabel,
    startsAt: item.startsAt,
    venue: item.venue,
    homeScore: item.revision.homeScore,
    awayScore: item.revision.awayScore,
    revisionNumber: item.revision.revisionNumber,
    corrected: item.revision.revisionNumber > 1,
  };
}

function toHistoryItem(revision: ResultRevision): StudentResultHistoryItem {
  return {
    revisionNumber: revision.revisionNumber,
    homeScore: revision.homeScore,
    awayScore: revision.awayScore,
    correctionReason: revision.correctionReason,
    createdAt: revision.createdAt,
  };
}

export class ListResultsService {
  public constructor(private readonly dependencies: ResultReadServiceDependencies) {}

  private validateContext(input: { trustedContext: unknown; requestedTenantId: unknown }): ResultReadDenialCode | null {
    if (!isTrustedContext(input.trustedContext) || !isUuid(input.requestedTenantId) || input.trustedContext.tenantId !== input.requestedTenantId) return "INVALID_INPUT";
    if (!tenantHasFullFunctionality(input.trustedContext.tenantStatus)) return "TENANT_UNAVAILABLE";
    if (!MEMBER_READ_LIFECYCLES.includes(input.trustedContext.membershipStatus)) return "MEMBERSHIP_NOT_ELIGIBLE";
    return null;
  }

  public async listResults(input: ListResultsInput): Promise<ResultReadResult> {
    const error = this.validateContext(input);
    if (error !== null) return denied(error);
    const filters = parseFilters(input.filters);
    if (filters === null) return denied("INVALID_INPUT");
    try {
      const items = await this.dependencies.results.listPublishedResultsForTenant(input.requestedTenantId, filters);
      return { outcome: "READY", items: items.map(toStudentItem) };
    } catch { return denied("PERSISTENCE_FAILED"); }
  }

  public async listCorrectionHistory(input: ListResultHistoryInput): Promise<ResultReadResult> {
    const error = this.validateContext(input);
    if (error !== null) return denied(error);
    if (!isUuid(input.resultId)) return denied("INVALID_INPUT");
    const limit = parseResultHistoryLimit(input.limit);
    if (limit === null) return denied("INVALID_INPUT");
    try {
      const items = await this.dependencies.results.listResultRevisionsForTenant(input.requestedTenantId, input.resultId, limit);
      return { outcome: "HISTORY", items: items.map(toHistoryItem) };
    } catch { return denied("PERSISTENCE_FAILED"); }
  }
}
