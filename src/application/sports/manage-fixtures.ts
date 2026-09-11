import "server-only";

import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";
import { CAPABILITIES } from "@/domain/authorization/capability";
import {
  isCapabilityAuthorizationDecision,
  type CapabilityAuthorizationRequest,
  type CapabilityAuthorizer,
} from "@/domain/authorization/capability-authorization";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import {
  parseFixtureExpectedVersion,
  parseFixtureListLimit,
  parseFixtureReason,
  parseFixtureState,
  parseFixtureTimestamp,
  parseFixtureVenue,
  type CreateFixtureInput,
  type Fixture,
  type PostponeFixtureInput,
  type TransitionFixtureInput,
  type UpdateFixtureInput,
} from "@/domain/sports/fixtures";
import type {
  DrizzleFixtureRepository,
  FixtureListOptions,
  FixtureListItem,
  FixtureMutationResult,
} from "@/server/repositories/fixture-repository";

export const FIXTURE_MANAGEMENT_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_SCOPE_NOT_FOUND",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_STATE",
  "NOT_READY",
  "PERSISTENCE_FAILED",
] as const;
export type FixtureManagementDenialCode =
  (typeof FIXTURE_MANAGEMENT_DENIAL_CODES)[number];

export type FixtureManagementDenied = Readonly<{
  outcome: "DENIED";
  code: FixtureManagementDenialCode;
}>;

export type FixtureManagementResult =
  | Readonly<{ outcome: "CREATED"; fixture: Fixture }>
  | Readonly<{ outcome: "UPDATED"; fixture: Fixture }>
  | Readonly<{ outcome: "POSTPONED"; fixture: Fixture }>
  | Readonly<{ outcome: "CANCELLED"; fixture: Fixture }>
  | Readonly<{ outcome: "COMPLETED"; fixture: Fixture }>
  | Readonly<{ outcome: "ABANDONED"; fixture: Fixture }>
  | Readonly<{
      outcome: "LISTED";
      items: readonly FixtureListItem[];
    }>
  | FixtureManagementDenied;

export type CreateFixtureCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  fixture: unknown;
}>;
export type EditFixtureCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  fixtureId: string;
  edit: unknown;
}>;
export type PostponeFixtureCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  fixtureId: string;
  edit: unknown;
}>;
export type TransitionFixtureCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  fixtureId: string;
  transition: unknown;
}>;
export type ListFixturesCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  state?: unknown;
  sportId?: unknown;
  competitionId?: unknown;
  teamId?: unknown;
  sportName?: unknown;
  competitionName?: unknown;
  teamName?: unknown;
  limit?: unknown;
  order?: unknown;
}>;

export type AuthorizedFixtureManagementGateway = Readonly<{
  createFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateFixtureInput,
  ): Promise<FixtureMutationResult>;
  updateFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: UpdateFixtureInput,
  ): Promise<FixtureMutationResult>;
  postponeFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: PostponeFixtureInput,
  ): Promise<FixtureMutationResult>;
  cancelFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: TransitionFixtureInput,
  ): Promise<FixtureMutationResult>;
  completeFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: TransitionFixtureInput,
  ): Promise<FixtureMutationResult>;
  abandonFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: TransitionFixtureInput,
  ): Promise<FixtureMutationResult>;
}>;

export type FixtureManagementServiceDependencies = Readonly<{
  capabilityAuthorizer: CapabilityAuthorizer;
  gateway: AuthorizedFixtureManagementGateway;
  fixtures: Pick<DrizzleFixtureRepository, "listFixturesForTenant">;
}>;

type FixtureEditableInput = UpdateFixtureInput | PostponeFixtureInput | TransitionFixtureInput;

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

function parseCreateFixture(value: unknown): CreateFixtureInput | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "competitionId",
      "homeTeamId",
      "awayTeamId",
      "campusId",
      "startsAt",
      "venue",
    ]) ||
    !isUuid(value.competitionId) ||
    !isUuid(value.homeTeamId) ||
    !isUuid(value.awayTeamId) ||
    value.homeTeamId === value.awayTeamId ||
    !isUuid(value.campusId)
  ) {
    return null;
  }
  const startsAt = parseFixtureTimestamp(value.startsAt);
  const venue = parseFixtureVenue(value.venue);
  return startsAt === null || venue === null
    ? null
    : {
        competitionId: value.competitionId,
        homeTeamId: value.homeTeamId,
        awayTeamId: value.awayTeamId,
        campusId: value.campusId,
        startsAt,
        venue,
      };
}

function parseUpdateFixture(value: unknown): UpdateFixtureInput | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["expectedVersion", "startsAt", "venue"])
  ) {
    return null;
  }
  const expectedVersion = parseFixtureExpectedVersion(value.expectedVersion);
  const startsAt = parseFixtureTimestamp(value.startsAt);
  const venue = parseFixtureVenue(value.venue);
  return expectedVersion === null || startsAt === null || venue === null
    ? null
    : { expectedVersion, startsAt, venue };
}

function parsePostponeFixture(value: unknown): PostponeFixtureInput | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["expectedVersion", "startsAt", "reason"])
  ) {
    return null;
  }
  const expectedVersion = parseFixtureExpectedVersion(value.expectedVersion);
  const startsAt = parseFixtureTimestamp(value.startsAt);
  const reason = parseFixtureReason(value.reason);
  return expectedVersion === null || startsAt === null || reason === null
    ? null
    : { expectedVersion, startsAt, reason };
}

function parseTransitionFixture(value: unknown): TransitionFixtureInput | null {
  if (!isRecord(value)) {
    return null;
  }
  const expectedVersion = parseFixtureExpectedVersion(value.expectedVersion);
  if (expectedVersion === null) {
    return null;
  }
  if (Object.keys(value).length === 1) {
    return { expectedVersion };
  }
  if (!hasOnlyKeys(value, ["expectedVersion", "reason"])) {
    return null;
  }
  const reason = parseFixtureReason(value.reason);
  return reason === null ? null : { expectedVersion, reason };
}

function parseOptionalUuid(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return isUuid(value) ? value : null;
}

function parseOptionalName(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" && value.trim().length > 0 && value.length <= 120
    ? value.trim()
    : null;
}

function parseOrder(value: unknown): "upcoming" | "recent" | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  return value === "upcoming" || value === "recent" ? value : null;
}

function makeAuthorizationRequest(
  trustedContext: TrustedRequestContext,
  tenantId: string,
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
    scope: { tenantId, module: "sports", resource: "fixture" },
  };
}

function denied(code: FixtureManagementDenialCode): FixtureManagementDenied {
  return { outcome: "DENIED", code };
}

function mapMutationResult(
  result: FixtureMutationResult,
  outcome: "CREATED" | "UPDATED" | "POSTPONED" | "CANCELLED" | "COMPLETED" | "ABANDONED",
): FixtureManagementResult {
  if (!result.ok) {
    return denied(result.error);
  }
  return { outcome, fixture: result.fixture };
}

export class FixtureManagementService {
  public constructor(
    private readonly dependencies: FixtureManagementServiceDependencies,
  ) {}

  private async authorize(
    trustedContext: TrustedRequestContext,
    tenantId: string,
  ): Promise<boolean> {
    try {
      const decision = await this.dependencies.capabilityAuthorizer.authorize(
        makeAuthorizationRequest(trustedContext, tenantId),
      );
      return isCapabilityAuthorizationDecision(decision) && decision.allowed;
    } catch {
      return false;
    }
  }

  private async mutate<T extends FixtureEditableInput>(
    command: Record<string, unknown>,
    input: unknown,
    payloadKey: "edit" | "transition",
    operation: (
      request: CapabilityAuthorizationRequest,
      tenantId: string,
      fixtureId: string,
      parsed: T,
    ) => Promise<FixtureMutationResult>,
    outcome: "CREATED" | "UPDATED" | "POSTPONED" | "CANCELLED" | "COMPLETED" | "ABANDONED",
    parser: (value: unknown) => T | null,
    needsId = true,
  ): Promise<FixtureManagementResult> {
    const required = ["trustedContext", "requestedTenantId", payloadKey];
    if (!isScopedCommand(command, required, needsId ? ["fixtureId"] : [])) {
      return denied("INVALID_INPUT");
    }
    const fixtureId = needsId ? command.fixtureId : undefined;
    if (needsId && !isUuid(fixtureId)) {
      return denied("INVALID_INPUT");
    }
    const parsed = parser(input);
    if (parsed === null) {
      return denied("INVALID_INPUT");
    }
    const context = command.trustedContext as TrustedRequestContext;
    const tenantId = command.requestedTenantId as string;
    if (!(await this.authorize(context, tenantId))) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapMutationResult(
        await operation(
          makeAuthorizationRequest(context, tenantId),
          tenantId,
          fixtureId as string,
          parsed,
        ),
        outcome,
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async createFixture(
    command: CreateFixtureCommand,
  ): Promise<FixtureManagementResult> {
    if (!isScopedCommand(command, ["trustedContext", "requestedTenantId", "fixture"])) {
      return denied("INVALID_INPUT");
    }
    const input = parseCreateFixture(command.fixture);
    if (input === null) {
      return denied("INVALID_INPUT");
    }
    const context = command.trustedContext;
    if (!(await this.authorize(context, command.requestedTenantId))) {
      return denied("PERMISSION_DENIED");
    }
    try {
      return mapMutationResult(
        await this.dependencies.gateway.createFixture(
          makeAuthorizationRequest(context, command.requestedTenantId),
          command.requestedTenantId,
          input,
        ),
        "CREATED",
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }

  public async editFixture(command: EditFixtureCommand): Promise<FixtureManagementResult> {
    return this.mutate<UpdateFixtureInput>(command, command.edit, "edit", (request, tenantId, fixtureId, input) =>
      this.dependencies.gateway.updateFixture(request, tenantId, fixtureId, input), "UPDATED", parseUpdateFixture);
  }

  public async postponeFixture(command: PostponeFixtureCommand): Promise<FixtureManagementResult> {
    return this.mutate<PostponeFixtureInput>(command, command.edit, "edit", (request, tenantId, fixtureId, input) =>
      this.dependencies.gateway.postponeFixture(request, tenantId, fixtureId, input), "POSTPONED", parsePostponeFixture);
  }

  public async cancelFixture(command: TransitionFixtureCommand): Promise<FixtureManagementResult> {
    return this.mutate<TransitionFixtureInput>(command, command.transition, "transition", (request, tenantId, fixtureId, input) =>
      this.dependencies.gateway.cancelFixture(request, tenantId, fixtureId, input), "CANCELLED", parseTransitionFixture);
  }

  public async completeFixture(command: TransitionFixtureCommand): Promise<FixtureManagementResult> {
    return this.mutate<TransitionFixtureInput>(command, command.transition, "transition", (request, tenantId, fixtureId, input) =>
      this.dependencies.gateway.completeFixture(request, tenantId, fixtureId, input), "COMPLETED", parseTransitionFixture);
  }

  public async abandonFixture(command: TransitionFixtureCommand): Promise<FixtureManagementResult> {
    return this.mutate<TransitionFixtureInput>(command, command.transition, "transition", (request, tenantId, fixtureId, input) =>
      this.dependencies.gateway.abandonFixture(request, tenantId, fixtureId, input), "ABANDONED", parseTransitionFixture);
  }

  public async listFixtures(command: ListFixturesCommand): Promise<FixtureManagementResult> {
    if (
      !isScopedCommand(
        command,
        ["trustedContext", "requestedTenantId"],
        ["state", "sportId", "competitionId", "teamId", "sportName", "competitionName", "teamName", "limit", "order"],
      )
    ) {
      return denied("INVALID_INPUT");
    }
    const state = command.state === undefined ? undefined : parseFixtureState(command.state);
    const sportId = parseOptionalUuid(command.sportId);
    const competitionId = parseOptionalUuid(command.competitionId);
    const teamId = parseOptionalUuid(command.teamId);
    const sportName = parseOptionalName(command.sportName);
    const competitionName = parseOptionalName(command.competitionName);
    const teamName = parseOptionalName(command.teamName);
    const limit = parseFixtureListLimit(command.limit);
    const order = parseOrder(command.order);
    if (state === null || sportId === null || competitionId === null || teamId === null || sportName === null || competitionName === null || teamName === null || limit === null || order === null) {
      return denied("INVALID_INPUT");
    }
    const context = command.trustedContext;
    if (!(await this.authorize(context, command.requestedTenantId))) {
      return denied("PERMISSION_DENIED");
    }
    const options: FixtureListOptions = { state, sportId, competitionId, teamId, sportName, competitionName, teamName, limit, order };
    try {
      return { outcome: "LISTED", items: await this.dependencies.fixtures.listFixturesForTenant(command.requestedTenantId, options) };
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }
}
