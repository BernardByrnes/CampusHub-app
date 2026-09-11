import "server-only";

import { isCapabilityAuthorizationDecision, type CapabilityAuthorizationRequest, type CapabilityAuthorizer } from "@/domain/authorization/capability-authorization";
import { CAPABILITIES } from "@/domain/authorization/capability";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";
import {
  parseResultExpectedVersion,
  parseResultHistoryLimit,
  parseResultReason,
  parseResultScore,
  type CorrectResultInput,
  type CreateResultInput,
  type PublishResultInput,
  type Result,
  type ResultRevision,
  type UpdateResultDraftInput,
} from "@/domain/sports/results";
import type { ManagedResultListItem, ResultMutationResult, DrizzleResultRepository } from "@/server/repositories/result-repository";

export const RESULT_MANAGEMENT_DENIAL_CODES = [
  "INVALID_INPUT",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_STATE",
  "NOT_READY",
  "PERSISTENCE_FAILED",
] as const;
export type ResultManagementDenialCode = (typeof RESULT_MANAGEMENT_DENIAL_CODES)[number];

export type ResultManagementDenied = Readonly<{
  outcome: "DENIED";
  code: ResultManagementDenialCode;
}>;

export type ResultManagementResult =
  | Readonly<{ outcome: "CREATED"; result: Result }>
  | Readonly<{ outcome: "UPDATED"; result: Result }>
  | Readonly<{ outcome: "PUBLISHED"; result: Result; revision: ResultRevision }>
  | Readonly<{ outcome: "CORRECTED"; result: Result; revision: ResultRevision }>
  | Readonly<{ outcome: "LISTED"; items: readonly ManagedResultListItem[] }>
  | Readonly<{ outcome: "HISTORY"; items: readonly ResultRevision[] }>
  | ResultManagementDenied;

export type CreateResultCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  result: unknown;
}>;
export type EditResultDraftCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  resultId: string;
  edit: unknown;
}>;
export type PublishResultCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  resultId: string;
  expectedVersion: unknown;
}>;
export type CorrectResultCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  resultId: string;
  correction: unknown;
}>;
export type ListManagedResultsCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  filters?: unknown;
}>;
export type ReadResultHistoryCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  resultId: string;
  limit?: unknown;
}>;

export type AuthorizedResultManagementGateway = Readonly<{
  createResult(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateResultInput,
  ): Promise<ResultMutationResult>;
  updateResultDraft(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    resultId: string,
    input: UpdateResultDraftInput,
  ): Promise<ResultMutationResult>;
  publishResult(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    resultId: string,
    input: PublishResultInput,
  ): Promise<ResultMutationResult>;
  correctResult(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    resultId: string,
    input: CorrectResultInput,
  ): Promise<ResultMutationResult>;
}>;

export type ResultManagementServiceDependencies = Readonly<{
  capabilityAuthorizer: CapabilityAuthorizer;
  gateway: AuthorizedResultManagementGateway;
  results: Pick<
    DrizzleResultRepository,
    "listManagedResultsForTenant" | "listResultRevisionsForTenant"
  >;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).length === allowed.size && Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseFilterName(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length === 0 || normalized.length > 120
    ? normalized.length === 0
      ? undefined
      : null
    : normalized;
}

function parseFilters(value: unknown): {
  fixtureId?: string;
  sportName?: string;
  competitionName?: string;
  teamName?: string;
  limit?: number;
} | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const allowed = [
    "fixtureId",
    "sportName",
    "competitionName",
    "teamName",
    "limit",
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return null;
  const fixtureId =
    value.fixtureId === undefined
      ? undefined
      : isUuid(value.fixtureId)
        ? value.fixtureId
        : null;
  const sportName = parseFilterName(value.sportName);
  const competitionName = parseFilterName(value.competitionName);
  const teamName = parseFilterName(value.teamName);
  const limit = parseResultHistoryLimit(value.limit);
  return fixtureId === null ||
    sportName === null ||
    competitionName === null ||
    teamName === null ||
    limit === null
    ? null
    : { fixtureId, sportName, competitionName, teamName, limit };
}

function isTrustedContext(value: unknown): value is TrustedRequestContext {
  return isRecord(value) &&
    isNonEmptyString(value.identitySubjectId) &&
    isUuid(value.tenantId) &&
    isUuid(value.membershipId) &&
    parseTenantLifecycle(value.tenantStatus) !== null &&
    parseMembershipLifecycle(value.membershipStatus) !== null;
}

function isScopedCommand(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const allowed = [...requiredKeys, ...optionalKeys];
  return Object.keys(value).every((key) => allowed.includes(key)) &&
    requiredKeys.every((key) => key in value) &&
    isTrustedContext(value.trustedContext) &&
    isUuid(value.requestedTenantId) &&
    value.trustedContext.tenantId === value.requestedTenantId;
}

function parseScores(value: Record<string, unknown>): { homeScore: number; awayScore: number } | null {
  const homeScore = parseResultScore(value.homeScore);
  const awayScore = parseResultScore(value.awayScore);
  return homeScore === null || awayScore === null ? null : { homeScore, awayScore };
}

function parseCreate(value: unknown): CreateResultInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["fixtureId", "homeScore", "awayScore"]) || !isUuid(value.fixtureId)) return null;
  const scores = parseScores(value);
  return scores === null ? null : { fixtureId: value.fixtureId, ...scores };
}

function parseEdit(value: unknown): UpdateResultDraftInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["expectedVersion", "homeScore", "awayScore"])) return null;
  const expectedVersion = parseResultExpectedVersion(value.expectedVersion);
  const scores = parseScores(value);
  return expectedVersion === null || scores === null ? null : { expectedVersion, ...scores };
}

function parsePublish(value: unknown): PublishResultInput | null {
  const expectedVersion = isRecord(value) && hasOnlyKeys(value, ["expectedVersion"])
    ? parseResultExpectedVersion(value.expectedVersion)
    : parseResultExpectedVersion(value);
  return expectedVersion === null ? null : { expectedVersion };
}

function parseCorrection(value: unknown): CorrectResultInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["expectedVersion", "homeScore", "awayScore", "reason"])) return null;
  const expectedVersion = parseResultExpectedVersion(value.expectedVersion);
  const reason = parseResultReason(value.reason);
  const scores = parseScores(value);
  return expectedVersion === null || reason === null || scores === null
    ? null
    : { expectedVersion, reason, ...scores };
}

function makeRequest(context: TrustedRequestContext, tenantId: string): CapabilityAuthorizationRequest {
  return {
    actor: { identitySubjectId: context.identitySubjectId, tenantId: context.tenantId, membershipId: context.membershipId },
    context: { tenantStatus: context.tenantStatus, membershipStatus: context.membershipStatus, assuranceLevel: context.assuranceLevel },
    capability: CAPABILITIES.SPORT_MANAGE,
    scope: { tenantId, module: "sports", resource: "result" },
  };
}

function denied(code: ResultManagementDenialCode): ResultManagementDenied {
  return { outcome: "DENIED", code };
}

function mapResult(result: ResultMutationResult, outcome: "CREATED" | "UPDATED" | "PUBLISHED" | "CORRECTED"): ResultManagementResult {
  if (!result.ok) return denied(result.error);
  if (outcome === "PUBLISHED" || outcome === "CORRECTED") {
    return result.revision === undefined ? denied("PERSISTENCE_FAILED") : { outcome, result: result.result, revision: result.revision };
  }
  return { outcome, result: result.result };
}

export class ResultManagementService {
  public constructor(private readonly dependencies: ResultManagementServiceDependencies) {}

  private async authorize(context: TrustedRequestContext, tenantId: string): Promise<boolean> {
    try {
      const decision = await this.dependencies.capabilityAuthorizer.authorize(makeRequest(context, tenantId));
      return isCapabilityAuthorizationDecision(decision) && decision.allowed;
    } catch {
      return false;
    }
  }

  public async createDraftResult(command: CreateResultCommand): Promise<ResultManagementResult> {
    if (!isScopedCommand(command, ["trustedContext", "requestedTenantId", "result"])) return denied("INVALID_INPUT");
    const input = parseCreate(command.result);
    if (input === null) return denied("INVALID_INPUT");
    const context = command.trustedContext as TrustedRequestContext;
    if (!(await this.authorize(context, command.requestedTenantId as string))) return denied("PERMISSION_DENIED");
    try {
      return mapResult(await this.dependencies.gateway.createResult(makeRequest(context, command.requestedTenantId as string), command.requestedTenantId as string, input), "CREATED");
    } catch { return denied("PERSISTENCE_FAILED"); }
  }

  public async editDraftResult(command: EditResultDraftCommand): Promise<ResultManagementResult> {
    if (!isScopedCommand(command, ["trustedContext", "requestedTenantId", "resultId", "edit"]) || !isUuid(command.resultId)) return denied("INVALID_INPUT");
    const input = parseEdit(command.edit);
    if (input === null) return denied("INVALID_INPUT");
    const context = command.trustedContext as TrustedRequestContext;
    if (!(await this.authorize(context, command.requestedTenantId as string))) return denied("PERMISSION_DENIED");
    try {
      return mapResult(await this.dependencies.gateway.updateResultDraft(makeRequest(context, command.requestedTenantId as string), command.requestedTenantId as string, command.resultId as string, input), "UPDATED");
    } catch { return denied("PERSISTENCE_FAILED"); }
  }

  public async publishResult(command: PublishResultCommand): Promise<ResultManagementResult> {
    if (!isScopedCommand(command, ["trustedContext", "requestedTenantId", "resultId", "expectedVersion"]) || !isUuid(command.resultId)) return denied("INVALID_INPUT");
    const input = parsePublish(command.expectedVersion);
    if (input === null) return denied("INVALID_INPUT");
    const context = command.trustedContext as TrustedRequestContext;
    if (!(await this.authorize(context, command.requestedTenantId as string))) return denied("PERMISSION_DENIED");
    try {
      return mapResult(await this.dependencies.gateway.publishResult(makeRequest(context, command.requestedTenantId as string), command.requestedTenantId as string, command.resultId as string, input), "PUBLISHED");
    } catch { return denied("PERSISTENCE_FAILED"); }
  }

  public async correctPublishedResult(command: CorrectResultCommand): Promise<ResultManagementResult> {
    if (!isScopedCommand(command, ["trustedContext", "requestedTenantId", "resultId", "correction"]) || !isUuid(command.resultId)) return denied("INVALID_INPUT");
    const input = parseCorrection(command.correction);
    if (input === null) return denied("INVALID_INPUT");
    const context = command.trustedContext as TrustedRequestContext;
    if (!(await this.authorize(context, command.requestedTenantId as string))) return denied("PERMISSION_DENIED");
    try {
      return mapResult(await this.dependencies.gateway.correctResult(makeRequest(context, command.requestedTenantId as string), command.requestedTenantId as string, command.resultId as string, input), "CORRECTED");
    } catch { return denied("PERSISTENCE_FAILED"); }
  }

  public async listResults(command: ListManagedResultsCommand): Promise<ResultManagementResult> {
    if (!isScopedCommand(command, ["trustedContext", "requestedTenantId"], ["filters"])) return denied("INVALID_INPUT");
    if (!(await this.authorize(command.trustedContext as TrustedRequestContext, command.requestedTenantId as string))) return denied("PERMISSION_DENIED");
    const filters = parseFilters(command.filters);
    if (filters === null) return denied("INVALID_INPUT");
    try {
      return { outcome: "LISTED", items: await this.dependencies.results.listManagedResultsForTenant(command.requestedTenantId as string, filters) };
    } catch { return denied("PERSISTENCE_FAILED"); }
  }

  public async inspectResultHistory(command: ReadResultHistoryCommand): Promise<ResultManagementResult> {
    if (!isScopedCommand(command, ["trustedContext", "requestedTenantId", "resultId"], ["limit"]) || !isUuid(command.resultId)) return denied("INVALID_INPUT");
    const limit = parseResultHistoryLimit(command.limit);
    if (limit === null) return denied("INVALID_INPUT");
    if (!(await this.authorize(command.trustedContext as TrustedRequestContext, command.requestedTenantId as string))) return denied("PERMISSION_DENIED");
    try {
      const history = await this.dependencies.results.listResultRevisionsForTenant(command.requestedTenantId as string, command.resultId as string, limit);
      return history.ok
        ? { outcome: "HISTORY", items: history.items }
        : denied(history.error);
    } catch { return denied("PERSISTENCE_FAILED"); }
  }
}
