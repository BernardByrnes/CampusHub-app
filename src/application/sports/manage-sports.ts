import "server-only";

import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";
import { CAPABILITIES } from "@/domain/authorization/capability";
import {
  isCapabilityAuthorizationDecision,
  type CapabilityAuthorizationRequest,
  type CapabilityAuthorizer,
} from "@/domain/authorization/capability-authorization";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import {
  parseAffiliationLabel,
  parseCompetitionTableMode,
  parseExpectedVersion,
  parseSeasonLabel,
  parseSportLifecycle,
  parseSportName,
  parseSportsListLimit,
  type Competition,
  type CreateCompetitionInput,
  type CreateSportInput,
  type CreateTeamInput,
  type DeactivateCompetitionInput,
  type DeactivateSportInput,
  type DeactivateTeamInput,
  type Sport,
  type Team,
  type UpdateCompetitionInput,
  type UpdateSportInput,
  type UpdateTeamInput,
} from "@/domain/sports/sports";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";
import type {
  CompetitionMutationResult,
  DrizzleCompetitionRepository,
} from "@/server/repositories/competition-repository";
import type {
  DrizzleSportRepository,
  SportMutationResult,
} from "@/server/repositories/sport-repository";
import type {
  DrizzleTeamRepository,
  TeamMutationResult,
} from "@/server/repositories/team-repository";

export const SPORTS_MANAGEMENT_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_SCOPE_NOT_FOUND",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_STATE",
  "NOT_READY",
  "PERSISTENCE_FAILED",
] as const;
export type SportsManagementDenialCode =
  (typeof SPORTS_MANAGEMENT_DENIAL_CODES)[number];

export type SportsManagementDenied = Readonly<{
  outcome: "DENIED";
  code: SportsManagementDenialCode;
}>;

export type SportsManagementResult =
  | Readonly<{ outcome: "CREATED"; sport: Sport }>
  | Readonly<{ outcome: "UPDATED"; sport: Sport }>
  | Readonly<{ outcome: "DEACTIVATED"; sport: Sport }>
  | Readonly<{ outcome: "CREATED"; competition: Competition }>
  | Readonly<{ outcome: "UPDATED"; competition: Competition }>
  | Readonly<{ outcome: "DEACTIVATED"; competition: Competition }>
  | Readonly<{ outcome: "CREATED"; team: Team }>
  | Readonly<{ outcome: "UPDATED"; team: Team }>
  | Readonly<{ outcome: "DEACTIVATED"; team: Team }>
  | Readonly<{ outcome: "LISTED"; resource: "sports"; items: readonly Sport[] }>
  | Readonly<{
      outcome: "LISTED";
      resource: "competitions";
      items: readonly Competition[];
    }>
  | Readonly<{ outcome: "LISTED"; resource: "teams"; items: readonly Team[] }>
  | SportsManagementDenied;

export type CreateSportCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  sport: unknown;
}>;
export type EditSportCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  sportId: string;
  edit: unknown;
}>;
export type DeactivateSportCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  sportId: string;
  expectedVersion: unknown;
}>;

export type CreateCompetitionCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  competition: unknown;
}>;
export type EditCompetitionCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  competitionId: string;
  edit: unknown;
}>;
export type DeactivateCompetitionCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  competitionId: string;
  expectedVersion: unknown;
}>;

export type CreateTeamCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  team: unknown;
}>;
export type EditTeamCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  teamId: string;
  edit: unknown;
}>;
export type DeactivateTeamCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  teamId: string;
  expectedVersion: unknown;
}>;

export type ListSportsCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  status?: unknown;
  limit?: unknown;
}>;
export type ListCompetitionsCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  status?: unknown;
  sportId?: unknown;
  campusId?: unknown;
  limit?: unknown;
}>;
export type ListTeamsCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  status?: unknown;
  sportId?: unknown;
  limit?: unknown;
}>;

export type AuthorizedSportsManagementGateway = Readonly<{
  createSport(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateSportInput,
  ): Promise<SportMutationResult>;
  updateSport(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    sportId: string,
    input: UpdateSportInput,
  ): Promise<SportMutationResult>;
  deactivateSport(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    sportId: string,
    input: DeactivateSportInput,
  ): Promise<SportMutationResult>;
  createCompetition(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateCompetitionInput,
  ): Promise<CompetitionMutationResult>;
  updateCompetition(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    competitionId: string,
    input: UpdateCompetitionInput,
  ): Promise<CompetitionMutationResult>;
  deactivateCompetition(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    competitionId: string,
    input: DeactivateCompetitionInput,
  ): Promise<CompetitionMutationResult>;
  createTeam(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateTeamInput,
  ): Promise<TeamMutationResult>;
  updateTeam(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    teamId: string,
    input: UpdateTeamInput,
  ): Promise<TeamMutationResult>;
  deactivateTeam(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    teamId: string,
    input: DeactivateTeamInput,
  ): Promise<TeamMutationResult>;
}>;

export type SportsManagementServiceDependencies = Readonly<{
  capabilityAuthorizer: CapabilityAuthorizer;
  gateway: AuthorizedSportsManagementGateway;
  sports: Pick<DrizzleSportRepository, "listSportsForTenant">;
  competitions: Pick<DrizzleCompetitionRepository, "listCompetitionsForTenant">;
  teams: Pick<DrizzleTeamRepository, "listTeamsForTenant">;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === allowed.size && actual.every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTrustedRequestContext(value: unknown): value is TrustedRequestContext {
  return (
    isRecord(value) &&
    isNonEmptyString(value.identitySubjectId) &&
    isUuid(value.tenantId) &&
    isUuid(value.membershipId) &&
    parseTenantLifecycle(value.tenantStatus) !== null &&
    parseAssuranceLevel(value.assuranceLevel) !== null &&
    parseMembershipLifecycle(value.membershipStatus) !== null
  );
}

function isScopedCommand(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is Record<string, unknown> {
  const allowedKeys = [...requiredKeys, ...optionalKeys];
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => allowedKeys.includes(key)) &&
    requiredKeys.every((key) => key in value) &&
    isTrustedRequestContext(value.trustedContext) &&
    isUuid(value.requestedTenantId) &&
    value.trustedContext.tenantId === value.requestedTenantId
  );
}

function parseCreateSport(value: unknown): CreateSportInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["name"])) {
    return null;
  }
  const name = parseSportName(value.name);
  return name === null ? null : { name };
}

function parseUpdateSport(value: unknown): UpdateSportInput | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ["expectedVersion", "name"])) {
    return null;
  }
  const expectedVersion = parseExpectedVersion(value.expectedVersion);
  const name = parseSportName(value.name);
  return expectedVersion === null || name === null
    ? null
    : { expectedVersion, name };
}

function parseCreateCompetition(value: unknown): CreateCompetitionInput | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "sportId",
      "name",
      "seasonLabel",
      "campusId",
      "tableMode",
    ])
  ) {
    return null;
  }
  const name = parseSportName(value.name);
  const seasonLabel = parseSeasonLabel(value.seasonLabel);
  const tableMode = parseCompetitionTableMode(value.tableMode);
  return !isUuid(value.sportId) ||
    !isUuid(value.campusId) ||
    name === null ||
    seasonLabel === null ||
    tableMode === null
    ? null
    : {
        sportId: value.sportId,
        name,
        seasonLabel,
        campusId: value.campusId,
        tableMode,
      };
}

function parseUpdateCompetition(value: unknown): UpdateCompetitionInput | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "expectedVersion",
      "sportId",
      "name",
      "seasonLabel",
      "campusId",
      "tableMode",
    ])
  ) {
    return null;
  }
  const expectedVersion = parseExpectedVersion(value.expectedVersion);
  const sportId = value.sportId;
  const name = parseSportName(value.name);
  const seasonLabel = parseSeasonLabel(value.seasonLabel);
  const campusId = value.campusId;
  const tableMode = parseCompetitionTableMode(value.tableMode);
  return expectedVersion === null ||
    !isUuid(sportId) ||
    name === null ||
    seasonLabel === null ||
    !isUuid(campusId) ||
    tableMode === null
    ? null
    : { expectedVersion, sportId, name, seasonLabel, campusId, tableMode };
}

function parseCreateTeam(value: unknown): CreateTeamInput | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["sportId", "name", "affiliationLabel"])
  ) {
    return null;
  }
  const name = parseSportName(value.name);
  const affiliationLabel = parseAffiliationLabel(value.affiliationLabel);
  return name === null ||
    affiliationLabel === undefined ||
    !isUuid(value.sportId)
    ? null
    : { sportId: value.sportId, name, affiliationLabel };
}

function parseUpdateTeam(value: unknown): UpdateTeamInput | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "expectedVersion",
      "sportId",
      "name",
      "affiliationLabel",
    ])
  ) {
    return null;
  }
  const expectedVersion = parseExpectedVersion(value.expectedVersion);
  const sportId = value.sportId;
  const name = parseSportName(value.name);
  const affiliationLabel = parseAffiliationLabel(value.affiliationLabel);
  return expectedVersion === null ||
    !isUuid(sportId) ||
    name === null ||
    affiliationLabel === undefined
    ? null
    : { expectedVersion, sportId, name, affiliationLabel };
}

function parseListStatus(
  value: unknown,
): "active" | "inactive" | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return parseSportLifecycle(value);
}

function parseOptionalUuid(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return isUuid(value) ? value : null;
}

function parseListLimit(value: unknown): number | null {
  return parseSportsListLimit(value);
}

function makeAuthorizationRequest(
  trustedContext: TrustedRequestContext,
  tenantId: string,
  resource: "sport" | "competition" | "team",
): CapabilityAuthorizationRequest {
  return {
    actor: {
      identitySubjectId: trustedContext.identitySubjectId,
      tenantId: trustedContext.tenantId,
      membershipId: trustedContext.membershipId,
    },
    context: {
      tenantStatus: trustedContext.tenantStatus,
      membershipStatus: trustedContext.membershipStatus,
      assuranceLevel: trustedContext.assuranceLevel,
    },
    capability: CAPABILITIES.SPORT_MANAGE,
    scope: {
      tenantId,
      module: "sports",
      resource,
    },
  };
}

function denied(code: SportsManagementDenialCode): SportsManagementDenied {
  return { outcome: "DENIED", code };
}

function mapMutationResult<T extends "CREATED" | "UPDATED" | "DEACTIVATED">(
  result: SportMutationResult,
  outcome: T,
): Readonly<{ outcome: T; sport: Sport }> | SportsManagementDenied {
  if (!result.ok) {
    return denied(result.error);
  }
  return { outcome, sport: result.sport };
}

function mapCompetitionMutationResult<
  T extends "CREATED" | "UPDATED" | "DEACTIVATED",
>(
  result: CompetitionMutationResult,
  outcome: T,
): Readonly<{ outcome: T; competition: Competition }> | SportsManagementDenied {
  if (!result.ok) {
    return denied(result.error);
  }
  return { outcome, competition: result.competition };
}

function mapTeamMutationResult<T extends "CREATED" | "UPDATED" | "DEACTIVATED">(
  result: TeamMutationResult,
  outcome: T,
): Readonly<{ outcome: T; team: Team }> | SportsManagementDenied {
  if (!result.ok) {
    return denied(result.error);
  }
  return { outcome, team: result.team };
}

export class SportsManagementService {
  public constructor(
    private readonly dependencies: SportsManagementServiceDependencies,
  ) {}

  private async authorize(
    trustedContext: TrustedRequestContext,
    tenantId: string,
    resource: "sport" | "competition" | "team",
  ): Promise<boolean> {
    try {
      const decision = await this.dependencies.capabilityAuthorizer.authorize(
        makeAuthorizationRequest(trustedContext, tenantId, resource),
      );
      return isCapabilityAuthorizationDecision(decision) && decision.allowed;
    } catch {
      return false;
    }
  }

  public async createSport(
    command: CreateSportCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(command, [
        "trustedContext",
        "requestedTenantId",
        "sport",
      ])
    ) {
      return denied("INVALID_INPUT");
    }
    const input = parseCreateSport(command.sport);
    if (input === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "sport",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapMutationResult(
        await this.dependencies.gateway.createSport(
          makeAuthorizationRequest(
            command.trustedContext,
            command.requestedTenantId,
            "sport",
          ),
          command.requestedTenantId,
          input,
        ),
        "CREATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async editSport(
    command: EditSportCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(command, [
        "trustedContext",
        "requestedTenantId",
        "sportId",
        "edit",
      ])
    ) {
      return denied("INVALID_INPUT");
    }
    if (!isUuid(command.sportId)) {
      return denied("INVALID_INPUT");
    }
    const input = parseUpdateSport(command.edit);
    if (input === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "sport",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapMutationResult(
        await this.dependencies.gateway.updateSport(
          makeAuthorizationRequest(
            command.trustedContext,
            command.requestedTenantId,
            "sport",
          ),
          command.requestedTenantId,
          command.sportId,
          input,
        ),
        "UPDATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async deactivateSport(
    command: DeactivateSportCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(command, [
        "trustedContext",
        "requestedTenantId",
        "sportId",
        "expectedVersion",
      ])
    ) {
      return denied("INVALID_INPUT");
    }
    if (!isUuid(command.sportId)) {
      return denied("INVALID_INPUT");
    }
    const expectedVersion = parseExpectedVersion(command.expectedVersion);
    if (expectedVersion === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "sport",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapMutationResult(
        await this.dependencies.gateway.deactivateSport(
          makeAuthorizationRequest(
            command.trustedContext,
            command.requestedTenantId,
            "sport",
          ),
          command.requestedTenantId,
          command.sportId,
          { expectedVersion },
        ),
        "DEACTIVATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async listSports(
    command: ListSportsCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(
        command,
        ["trustedContext", "requestedTenantId"],
        ["status", "limit"],
      )
    ) {
      return denied("INVALID_INPUT");
    }
    const status = parseListStatus(command.status);
    const limit = parseListLimit(command.limit);
    if (status === null || limit === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "sport",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      const items = await this.dependencies.sports.listSportsForTenant(
        command.requestedTenantId,
        { status, limit },
      );
      return { outcome: "LISTED", resource: "sports", items };
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async createCompetition(
    command: CreateCompetitionCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(command, [
        "trustedContext",
        "requestedTenantId",
        "competition",
      ])
    ) {
      return denied("INVALID_INPUT");
    }
    const input = parseCreateCompetition(command.competition);
    if (input === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "competition",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapCompetitionMutationResult(
        await this.dependencies.gateway.createCompetition(
          makeAuthorizationRequest(
            command.trustedContext,
            command.requestedTenantId,
            "competition",
          ),
          command.requestedTenantId,
          input,
        ),
        "CREATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async editCompetition(
    command: EditCompetitionCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(command, [
        "trustedContext",
        "requestedTenantId",
        "competitionId",
        "edit",
      ])
    ) {
      return denied("INVALID_INPUT");
    }
    if (!isUuid(command.competitionId)) {
      return denied("INVALID_INPUT");
    }
    const input = parseUpdateCompetition(command.edit);
    if (input === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "competition",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapCompetitionMutationResult(
        await this.dependencies.gateway.updateCompetition(
          makeAuthorizationRequest(
            command.trustedContext,
            command.requestedTenantId,
            "competition",
          ),
          command.requestedTenantId,
          command.competitionId,
          input,
        ),
        "UPDATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async deactivateCompetition(
    command: DeactivateCompetitionCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(command, [
        "trustedContext",
        "requestedTenantId",
        "competitionId",
        "expectedVersion",
      ])
    ) {
      return denied("INVALID_INPUT");
    }
    if (!isUuid(command.competitionId)) {
      return denied("INVALID_INPUT");
    }
    const expectedVersion = parseExpectedVersion(command.expectedVersion);
    if (expectedVersion === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "competition",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapCompetitionMutationResult(
        await this.dependencies.gateway.deactivateCompetition(
          makeAuthorizationRequest(
            command.trustedContext,
            command.requestedTenantId,
            "competition",
          ),
          command.requestedTenantId,
          command.competitionId,
          { expectedVersion },
        ),
        "DEACTIVATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async listCompetitions(
    command: ListCompetitionsCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(
        command,
        ["trustedContext", "requestedTenantId"],
        ["status", "sportId", "campusId", "limit"],
      )
    ) {
      return denied("INVALID_INPUT");
    }
    const status = parseListStatus(command.status);
    const sportId = parseOptionalUuid(command.sportId);
    const campusId = parseOptionalUuid(command.campusId);
    const limit = parseListLimit(command.limit);
    if (
      status === null ||
      sportId === null ||
      campusId === null ||
      limit === null
    ) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "competition",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      const items = await this.dependencies.competitions.listCompetitionsForTenant(
        command.requestedTenantId,
        { status, sportId, campusId, limit },
      );
      return { outcome: "LISTED", resource: "competitions", items };
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async createTeam(
    command: CreateTeamCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(command, [
        "trustedContext",
        "requestedTenantId",
        "team",
      ])
    ) {
      return denied("INVALID_INPUT");
    }
    const input = parseCreateTeam(command.team);
    if (input === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "team",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapTeamMutationResult(
        await this.dependencies.gateway.createTeam(
          makeAuthorizationRequest(
            command.trustedContext,
            command.requestedTenantId,
            "team",
          ),
          command.requestedTenantId,
          input,
        ),
        "CREATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async editTeam(
    command: EditTeamCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(command, [
        "trustedContext",
        "requestedTenantId",
        "teamId",
        "edit",
      ])
    ) {
      return denied("INVALID_INPUT");
    }
    if (!isUuid(command.teamId)) {
      return denied("INVALID_INPUT");
    }
    const input = parseUpdateTeam(command.edit);
    if (input === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "team",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapTeamMutationResult(
        await this.dependencies.gateway.updateTeam(
          makeAuthorizationRequest(
            command.trustedContext,
            command.requestedTenantId,
            "team",
          ),
          command.requestedTenantId,
          command.teamId,
          input,
        ),
        "UPDATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async deactivateTeam(
    command: DeactivateTeamCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(command, [
        "trustedContext",
        "requestedTenantId",
        "teamId",
        "expectedVersion",
      ])
    ) {
      return denied("INVALID_INPUT");
    }
    if (!isUuid(command.teamId)) {
      return denied("INVALID_INPUT");
    }
    const expectedVersion = parseExpectedVersion(command.expectedVersion);
    if (expectedVersion === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "team",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapTeamMutationResult(
        await this.dependencies.gateway.deactivateTeam(
          makeAuthorizationRequest(
            command.trustedContext,
            command.requestedTenantId,
            "team",
          ),
          command.requestedTenantId,
          command.teamId,
          { expectedVersion },
        ),
        "DEACTIVATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async listTeams(
    command: ListTeamsCommand,
  ): Promise<SportsManagementResult> {
    if (
      !isScopedCommand(
        command,
        ["trustedContext", "requestedTenantId"],
        ["status", "sportId", "limit"],
      )
    ) {
      return denied("INVALID_INPUT");
    }
    const status = parseListStatus(command.status);
    const sportId = parseOptionalUuid(command.sportId);
    const limit = parseListLimit(command.limit);
    if (status === null || sportId === null || limit === null) {
      return denied("INVALID_INPUT");
    }
    if (
      !(await this.authorize(
        command.trustedContext,
        command.requestedTenantId,
        "team",
      ))
    ) {
      return denied("PERMISSION_DENIED");
    }
    try {
      const items = await this.dependencies.teams.listTeamsForTenant(
        command.requestedTenantId,
        { status, sportId, limit },
      );
      return { outcome: "LISTED", resource: "teams", items };
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }
}
