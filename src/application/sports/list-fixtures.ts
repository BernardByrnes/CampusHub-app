import "server-only";

import { isResourceReadViewer } from "@/domain/authorization/resource-read-policy";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import {
  parseFixtureListLimit,
  parseFixtureState,
} from "@/domain/sports/fixtures";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import {
  tenantHasFullFunctionality,
  parseTenantLifecycle,
} from "@/domain/tenancy/tenant";
import { isUuid } from "@/domain/identifiers/uuid";
import type {
  DrizzleFixtureRepository,
  FixtureListOptions,
  FixtureListItem,
} from "@/server/repositories/fixture-repository";

export const FIXTURE_READ_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_SCOPE_NOT_FOUND",
  "TENANT_UNAVAILABLE",
  "MEMBERSHIP_NOT_ELIGIBLE",
  "PERSISTENCE_FAILED",
] as const;
export type FixtureReadDenialCode = (typeof FIXTURE_READ_DENIAL_CODES)[number];

export type FixtureReadResult =
  | Readonly<{ outcome: "READY"; items: readonly FixtureListItem[] }>
  | Readonly<{ outcome: "DENIED"; code: FixtureReadDenialCode }>;

export type ListFixturesInput = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  filters?: unknown;
}>;

export type FixtureReadServiceDependencies = Readonly<{
  fixtures: Pick<DrizzleFixtureRepository, "listFixturesForTenant">;
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

function isValidName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 120;
}

function parseFilters(value: unknown): FixtureListOptions | null {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    return null;
  }
  const allowed = [
    "state",
    "sportName",
    "competitionName",
    "teamName",
    "limit",
    "order",
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    return null;
  }
  const state = value.state === undefined ? undefined : parseFixtureState(value.state);
  const sportName = value.sportName === undefined ? undefined : isValidName(value.sportName) ? value.sportName.trim() : null;
  const competitionName = value.competitionName === undefined ? undefined : isValidName(value.competitionName) ? value.competitionName.trim() : null;
  const teamName = value.teamName === undefined ? undefined : isValidName(value.teamName) ? value.teamName.trim() : null;
  const limit = parseFixtureListLimit(value.limit);
  const order = value.order === undefined ? undefined : value.order === "upcoming" || value.order === "recent" ? value.order : null;
  if (state === null || sportName === null || competitionName === null || teamName === null || limit === null || order === null) {
    return null;
  }
  return { state, sportName, competitionName, teamName, limit, order };
}

function isTrustedContext(value: unknown): value is TrustedRequestContext {
  if (!isRecord(value)) {
    return false;
  }
  return isResourceReadViewer({ kind: "membership", context: value }) &&
    isUuid(value.tenantId) &&
    isUuid(value.membershipId) &&
    parseTenantLifecycle(value.tenantStatus) !== null &&
    parseMembershipLifecycle(value.membershipStatus) !== null;
}

export class ListFixturesService {
  public constructor(
    private readonly dependencies: FixtureReadServiceDependencies,
  ) {}

  public async listFixtures(input: ListFixturesInput): Promise<FixtureReadResult> {
    if (
      !isRecord(input) ||
      !isTrustedContext(input.trustedContext) ||
      !isUuid(input.requestedTenantId) ||
      input.trustedContext.tenantId !== input.requestedTenantId
    ) {
      return { outcome: "DENIED", code: "INVALID_INPUT" };
    }
    const context = input.trustedContext;
    if (!tenantHasFullFunctionality(context.tenantStatus)) {
      return { outcome: "DENIED", code: "TENANT_UNAVAILABLE" };
    }
    if (!MEMBER_READ_LIFECYCLES.includes(context.membershipStatus)) {
      return { outcome: "DENIED", code: "MEMBERSHIP_NOT_ELIGIBLE" };
    }
    const filters = parseFilters(input.filters);
    if (filters === null) {
      return { outcome: "DENIED", code: "INVALID_INPUT" };
    }
    try {
      return {
        outcome: "READY",
        items: await this.dependencies.fixtures.listFixturesForTenant(
          context.tenantId,
          filters,
        ),
      };
    } catch {
      return { outcome: "DENIED", code: "PERSISTENCE_FAILED" };
    }
  }
}
