import "server-only";

import { sql } from "drizzle-orm";

import type {
  AuthorizedSportsManagementGateway,
} from "@/application/sports/manage-sports";
import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import type {
  DeactivateCompetitionInput,
  DeactivateSportInput,
  DeactivateTeamInput,
} from "@/domain/sports/sports";
import type {
  CreateFixtureInput,
  PostponeFixtureInput,
  TransitionFixtureInput,
  UpdateFixtureInput,
} from "@/domain/sports/fixtures";
import type {
  CorrectResultInput,
  CreateResultInput,
  PublishResultInput,
  UpdateResultDraftInput,
} from "@/domain/sports/results";
import {
  FIXTURE_AUDIT_EVENT_TYPES,
  type FixtureAuditEventFacts,
  type FixtureAuditEventType,
  SPORTS_AUDIT_EVENT_TYPES,
  type SportsAuditEventFacts,
  type SportsAuditEventType,
  RESULT_AUDIT_EVENT_TYPES,
  type ResultAuditEventFacts,
  type ResultAuditEventType,
} from "@/domain/audit/audit-event";
import { isUuid } from "@/domain/identifiers/uuid";
import type { CampusHubDatabase } from "@/server/db/client";
import type {
  AuditEventTransactionDatabase,
  DrizzleAuditEventRepository,
} from "@/server/repositories/audit-event-repository";
import {
  DrizzleFixtureRepository,
  type FixtureMutationResult,
  type FixtureRepositoryTransactionDatabase,
} from "@/server/repositories/fixture-repository";
import {
  DrizzleCompetitionRepository,
  type CompetitionRepositoryTransactionDatabase,
  type CompetitionMutationResult,
} from "@/server/repositories/competition-repository";
import {
  DrizzleSportRepository,
  type SportMutationResult,
  type SportRepositoryTransactionDatabase,
} from "@/server/repositories/sport-repository";
import {
  DrizzleTeamRepository,
  type TeamMutationResult,
  type TeamRepositoryTransactionDatabase,
} from "@/server/repositories/team-repository";
import {
  DrizzleResultRepository,
  type ResultMutationResult,
  type ResultRepositoryTransactionDatabase,
} from "@/server/repositories/result-repository";
import { PostgresCapabilityAuthorizer } from "./postgres-capability-authorizer";

type SportsTransactionDatabase =
  & SportRepositoryTransactionDatabase
  & CompetitionRepositoryTransactionDatabase
  & TeamRepositoryTransactionDatabase
  & FixtureRepositoryTransactionDatabase
  & ResultRepositoryTransactionDatabase
  & AuditEventTransactionDatabase;

type SportsGatewayResult =
  | SportMutationResult
  | CompetitionMutationResult
  | TeamMutationResult
  | FixtureMutationResult
  | ResultMutationResult;

export type PostgresAuthorizedSportsManagementDependencies = Readonly<{
  database: CampusHubDatabase;
  authorizer: PostgresCapabilityAuthorizer;
  auditEvents: Pick<
    DrizzleAuditEventRepository,
    "appendSportsMutationInTransaction"
  > &
    Partial<
      Pick<DrizzleAuditEventRepository, "appendFixtureMutationInTransaction">
    > &
    Partial<
      Pick<DrizzleAuditEventRepository, "appendResultMutationInTransaction">
    >;
  /** The production default verifies the actual PostgreSQL session principal. */
  runtimeDatabaseAuthorityVerifier?: (
    database: Pick<CampusHubDatabase, "execute">,
  ) => Promise<boolean>;
  /** Test-only pause after authority locks and before the final fresh check. */
  beforeMutation?: () => Promise<void>;
  /** Test-only failure point after the mutation and audit append, before commit. */
  afterMutation?: () => Promise<void>;
  sportsRepository?: DrizzleSportRepository;
  competitionRepository?: DrizzleCompetitionRepository;
  teamRepository?: DrizzleTeamRepository;
  fixtureRepository?: DrizzleFixtureRepository;
  resultRepository?: DrizzleResultRepository;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function verifySportsAuditRuntimeDatabaseAuthority(
  database: Pick<CampusHubDatabase, "execute">,
): Promise<boolean> {
  try {
    const result = await database.execute(sql`
      with recursive effective_authority_closure(oid) as (
        select role.oid
        from pg_roles as role
        where role.rolname = current_user
           or pg_has_role(session_user::name, role.oid, 'USAGE')
           or pg_has_role(session_user::name, role.oid, 'SET')
        union
        select membership.roleid
        from pg_auth_members as membership
        join effective_authority_closure as controlled
          on controlled.oid = membership.member
        where membership.admin_option
           or membership.set_option
           or membership.inherit_option
      )
      select (
        runtime_role.rolsuper = false
        and runtime_role.rolcreaterole = false
        and current_user = session_user
        and audit_table.relowner <> runtime_role.oid
        and has_table_privilege(current_user, 'public.audit_events', 'SELECT')
        and has_table_privilege(current_user, 'public.audit_events', 'INSERT')
        and not has_table_privilege(current_user, 'public.audit_events', 'UPDATE')
        and not has_table_privilege(current_user, 'public.audit_events', 'DELETE')
        and not has_table_privilege(current_user, 'public.audit_events', 'TRUNCATE')
        and not has_table_privilege(current_user, 'public.audit_events', 'REFERENCES')
        and not has_table_privilege(current_user, 'public.audit_events', 'TRIGGER')
        and not exists (
          select 1
          from effective_authority_closure as authority
          join pg_roles as authority_role
            on authority_role.oid = authority.oid
          where authority_role.rolsuper
             or authority_role.rolcreaterole
             or authority_role.rolname = 'campushub_audit_owner'
             or authority_role.oid = audit_table.relowner
             or has_table_privilege(authority_role.rolname, 'public.audit_events', 'UPDATE')
             or has_table_privilege(authority_role.rolname, 'public.audit_events', 'DELETE')
             or has_table_privilege(authority_role.rolname, 'public.audit_events', 'TRUNCATE')
             or has_table_privilege(authority_role.rolname, 'public.audit_events', 'TRIGGER')
             or has_table_privilege(authority_role.rolname, 'public.audit_events', 'REFERENCES')
             or has_schema_privilege(authority_role.rolname, 'public', 'CREATE')
        )
        and not has_schema_privilege(current_user, 'public', 'CREATE')
      ) as allowed
      from pg_roles as runtime_role
      join pg_namespace as audit_namespace
        on audit_namespace.nspname = 'public'
      join pg_class as audit_table
        on audit_table.relnamespace = audit_namespace.oid
       and audit_table.relname = 'audit_events'
       and audit_table.relkind = 'r'
      where runtime_role.rolname = current_user
    `);
    const row = result.rows[0] as { allowed?: unknown } | undefined;
    return row?.allowed === true;
  } catch {
    return false;
  }
}

function isAuthorizedGatewayRequest(
  request: CapabilityAuthorizationRequest,
  tenantId: string,
  resource: "sport" | "competition" | "team" | "fixture" | "result",
): boolean {
  return (
    isRecord(request) &&
    isRecord(request.actor) &&
    isRecord(request.scope) &&
    request.actor.membershipId !== undefined &&
    isUuid(request.actor.membershipId) &&
    request.actor.tenantId === tenantId &&
    request.scope.tenantId === tenantId &&
    request.capability === CAPABILITIES.SPORT_MANAGE &&
    request.scope.module === "sports" &&
    request.scope.resource === resource
  );
}

function denied(): Readonly<{ ok: false; error: "PERMISSION_DENIED" }> {
  return { ok: false, error: "PERMISSION_DENIED" };
}

function persistenceFailure(): Readonly<{
  ok: false;
  error: "PERSISTENCE_FAILED";
}> {
  return { ok: false, error: "PERSISTENCE_FAILED" };
}

function sportsAuditEventType(
  resource: "sport" | "competition" | "team",
  action: "created" | "changed" | "deactivated",
): SportsAuditEventType {
  const eventType = resource + "." + action;
  return SPORTS_AUDIT_EVENT_TYPES.includes(eventType as SportsAuditEventType)
    ? (eventType as SportsAuditEventType)
    : (() => {
        throw new Error("Unsupported Sports audit event.");
      })();
}

function sportAuditFacts(
  action: "created" | "changed" | "deactivated",
  sport: SportMutationResult & { ok: true },
): SportsAuditEventFacts {
  return {
    action,
    name: sport.sport.name,
    status: sport.sport.status,
    version: sport.sport.version,
    sportId: null,
    campusId: null,
    tableMode: null,
  };
}

function competitionAuditFacts(
  action: "created" | "changed" | "deactivated",
  competition: CompetitionMutationResult & { ok: true },
): SportsAuditEventFacts {
  return {
    action,
    name: competition.competition.name,
    status: competition.competition.status,
    version: competition.competition.version,
    sportId: competition.competition.sportId,
    campusId: competition.competition.campusId,
    tableMode: competition.competition.tableMode,
  };
}

function teamAuditFacts(
  action: "created" | "changed" | "deactivated",
  team: TeamMutationResult & { ok: true },
): SportsAuditEventFacts {
  return {
    action,
    name: team.team.name,
    status: team.team.status,
    version: team.team.version,
    sportId: team.team.sportId,
    campusId: null,
    tableMode: null,
  };
}

function fixtureAuditEventType(
  action: FixtureAuditEventFacts["action"],
): FixtureAuditEventType {
  const eventType = "fixture." + action;
  return FIXTURE_AUDIT_EVENT_TYPES.includes(eventType as FixtureAuditEventType)
    ? (eventType as FixtureAuditEventType)
    : (() => {
        throw new Error("Unsupported Fixture audit event.");
      })();
}

function fixtureAuditFacts(
  result: FixtureMutationResult & { ok: true },
  action: FixtureAuditEventFacts["action"],
): FixtureAuditEventFacts {
  const fixture = result.fixture;
  return {
    action,
    state: fixture.state,
    version: fixture.version,
    competitionId: fixture.competitionId,
    homeTeamId: fixture.homeTeamId,
    awayTeamId: fixture.awayTeamId,
    campusId: fixture.campusId,
    startsAt: fixture.startsAt.toISOString(),
    venue: fixture.venue,
    reason: fixture.reason,
  };
}

function resultAuditEventType(
  action: ResultAuditEventFacts["action"],
): ResultAuditEventType {
  const eventType = "result." + action;
  return RESULT_AUDIT_EVENT_TYPES.includes(eventType as ResultAuditEventType)
    ? (eventType as ResultAuditEventType)
    : (() => {
        throw new Error("Unsupported Result audit event.");
      })();
}

function resultAuditFacts(
  result: ResultMutationResult & { ok: true },
  action: ResultAuditEventFacts["action"],
): ResultAuditEventFacts {
  const aggregate = result.result;
  const revision = result.revision;
  const homeScore = revision?.homeScore ?? aggregate.draftHomeScore;
  const awayScore = revision?.awayScore ?? aggregate.draftAwayScore;
  if (homeScore === null || awayScore === null) {
    throw new Error("Result audit facts require scores.");
  }
  return {
    action,
    lifecycle: aggregate.lifecycle,
    version: aggregate.version,
    fixtureId: aggregate.fixtureId,
    revisionNumber: revision?.revisionNumber ?? null,
    homeScore,
    awayScore,
    correctionReason: revision?.correctionReason ?? null,
  };
}

export class PostgresAuthorizedSportsManagementExecutor
  implements AuthorizedSportsManagementGateway
{
  public constructor(
    private readonly dependencies: PostgresAuthorizedSportsManagementDependencies,
  ) {}

  private async execute<T extends SportsGatewayResult>(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    resource: "sport" | "competition" | "team" | "fixture" | "result",
    mutation: (
      transaction: SportsTransactionDatabase,
      actorMembershipId: string,
      occurredAt: Date,
    ) => Promise<T>,
  ): Promise<T> {
    if (
      !isUuid(tenantId) ||
      !isAuthorizedGatewayRequest(request, tenantId, resource)
    ) {
      return denied() as T;
    }

    try {
      return await this.dependencies.database.transaction(async (transaction) => {
        const authorizationTimestamp: { value?: Date } = {};
        const decision =
          await this.dependencies.authorizer.authorizeSportManageInTransaction(
            transaction,
            request,
            this.dependencies.beforeMutation,
            (checkedAt) => {
              authorizationTimestamp.value = checkedAt;
            },
          );
        if (!decision.allowed) {
          return denied() as T;
        }

        const occurredAt = authorizationTimestamp.value;
        const actorMembershipId = request.actor.membershipId;
        if (
          !isUuid(actorMembershipId) ||
          !(occurredAt instanceof Date) ||
          Number.isNaN(occurredAt.getTime())
        ) {
          return persistenceFailure() as T;
        }

        const runtimeAuthorityIsSafe =
          this.dependencies.runtimeDatabaseAuthorityVerifier !== undefined
            ? await this.dependencies.runtimeDatabaseAuthorityVerifier(transaction)
            : await verifySportsAuditRuntimeDatabaseAuthority(transaction);
        if (!runtimeAuthorityIsSafe) {
          return persistenceFailure() as T;
        }

        const result = await mutation(transaction, actorMembershipId, occurredAt);
        if (result.ok) {
          await this.dependencies.afterMutation?.();
        }
        return result;
      });
    } catch {
      return persistenceFailure() as T;
    }
  }

  private async appendSportAudit(
    transaction: SportsTransactionDatabase,
    actorMembershipId: string,
    occurredAt: Date,
    result: SportMutationResult & { ok: true },
    action: "created" | "changed" | "deactivated",
  ): Promise<void> {
    await this.dependencies.auditEvents.appendSportsMutationInTransaction(
      transaction,
      {
        tenantId: result.sport.tenantId,
        actorMembershipId,
        resourceType: "sport",
        resourceId: result.sport.id,
        resourceVersion: result.sport.version,
        occurredAt,
        eventType: sportsAuditEventType("sport", action),
        eventFacts: sportAuditFacts(action, result),
      },
    );
  }

  private async appendCompetitionAudit(
    transaction: SportsTransactionDatabase,
    actorMembershipId: string,
    occurredAt: Date,
    result: CompetitionMutationResult & { ok: true },
    action: "created" | "changed" | "deactivated",
  ): Promise<void> {
    await this.dependencies.auditEvents.appendSportsMutationInTransaction(
      transaction,
      {
        tenantId: result.competition.tenantId,
        actorMembershipId,
        resourceType: "competition",
        resourceId: result.competition.id,
        resourceVersion: result.competition.version,
        occurredAt,
        eventType: sportsAuditEventType("competition", action),
        eventFacts: competitionAuditFacts(action, result),
      },
    );
  }

  private async appendTeamAudit(
    transaction: SportsTransactionDatabase,
    actorMembershipId: string,
    occurredAt: Date,
    result: TeamMutationResult & { ok: true },
    action: "created" | "changed" | "deactivated",
  ): Promise<void> {
    await this.dependencies.auditEvents.appendSportsMutationInTransaction(
      transaction,
      {
        tenantId: result.team.tenantId,
        actorMembershipId,
        resourceType: "team",
        resourceId: result.team.id,
        resourceVersion: result.team.version,
        occurredAt,
        eventType: sportsAuditEventType("team", action),
        eventFacts: teamAuditFacts(action, result),
      },
    );
  }

  private async appendFixtureAudit(
    transaction: SportsTransactionDatabase,
    actorMembershipId: string,
    occurredAt: Date,
    result: FixtureMutationResult & { ok: true },
    action: FixtureAuditEventFacts["action"],
  ): Promise<void> {
    const auditEvents = this.dependencies.auditEvents;
    const append = auditEvents.appendFixtureMutationInTransaction;
    if (append === undefined) {
      throw new Error("Fixture audit append is not configured.");
    }
    await append.call(auditEvents, transaction, {
      tenantId: result.fixture.tenantId,
      actorMembershipId,
      resourceType: "fixture",
      resourceId: result.fixture.id,
      resourceVersion: result.fixture.version,
      occurredAt,
      eventType: fixtureAuditEventType(action),
      eventFacts: fixtureAuditFacts(result, action),
    });
  }

  private async appendResultAudit(
    transaction: SportsTransactionDatabase,
    actorMembershipId: string,
    occurredAt: Date,
    result: ResultMutationResult & { ok: true },
    action: ResultAuditEventFacts["action"],
  ): Promise<void> {
    const auditEvents = this.dependencies.auditEvents;
    const append = auditEvents.appendResultMutationInTransaction;
    if (append === undefined) {
      throw new Error("Result audit append is not configured.");
    }
    await append.call(auditEvents, transaction, {
      tenantId: result.result.tenantId,
      actorMembershipId,
      resourceId: result.result.id,
      resourceVersion: result.result.version,
      occurredAt,
      eventType: resultAuditEventType(action),
      eventFacts: resultAuditFacts(result, action),
    });
  }

  public async createSport(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: Parameters<DrizzleSportRepository["createSportInTransaction"]>[2],
  ): Promise<SportMutationResult> {
    return this.execute(request, tenantId, "sport", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.sportsRepository ?? new DrizzleSportRepository()
      ).createSportInTransaction(transaction, tenantId, input);
      if (result.ok) {
        await this.appendSportAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "created",
        );
      }
      return result;
    });
  }

  public async updateSport(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    sportId: string,
    input: Parameters<DrizzleSportRepository["updateSportInTransaction"]>[3],
  ): Promise<SportMutationResult> {
    return this.execute(request, tenantId, "sport", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.sportsRepository ?? new DrizzleSportRepository()
      ).updateSportInTransaction(transaction, tenantId, sportId, input);
      if (result.ok) {
        await this.appendSportAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "changed",
        );
      }
      return result;
    });
  }

  public async deactivateSport(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    sportId: string,
    input: DeactivateSportInput,
  ): Promise<SportMutationResult> {
    return this.execute(request, tenantId, "sport", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.sportsRepository ?? new DrizzleSportRepository()
      ).deactivateSportInTransaction(
        transaction,
        tenantId,
        sportId,
        input.expectedVersion,
      );
      if (result.ok) {
        await this.appendSportAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "deactivated",
        );
      }
      return result;
    });
  }

  public async createCompetition(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: Parameters<
      DrizzleCompetitionRepository["createCompetitionInTransaction"]
    >[2],
  ): Promise<CompetitionMutationResult> {
    return this.execute(request, tenantId, "competition", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.competitionRepository ??
        new DrizzleCompetitionRepository()
      ).createCompetitionInTransaction(transaction, tenantId, input);
      if (result.ok) {
        await this.appendCompetitionAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "created",
        );
      }
      return result;
    });
  }

  public async updateCompetition(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    competitionId: string,
    input: Parameters<
      DrizzleCompetitionRepository["updateCompetitionInTransaction"]
    >[3],
  ): Promise<CompetitionMutationResult> {
    return this.execute(request, tenantId, "competition", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.competitionRepository ??
        new DrizzleCompetitionRepository()
      ).updateCompetitionInTransaction(
        transaction,
        tenantId,
        competitionId,
        input,
      );
      if (result.ok) {
        await this.appendCompetitionAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "changed",
        );
      }
      return result;
    });
  }

  public async deactivateCompetition(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    competitionId: string,
    input: DeactivateCompetitionInput,
  ): Promise<CompetitionMutationResult> {
    return this.execute(request, tenantId, "competition", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.competitionRepository ??
        new DrizzleCompetitionRepository()
      ).deactivateCompetitionInTransaction(
        transaction,
        tenantId,
        competitionId,
        input.expectedVersion,
      );
      if (result.ok) {
        await this.appendCompetitionAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "deactivated",
        );
      }
      return result;
    });
  }

  public async createTeam(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: Parameters<DrizzleTeamRepository["createTeamInTransaction"]>[2],
  ): Promise<TeamMutationResult> {
    return this.execute(request, tenantId, "team", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.teamRepository ?? new DrizzleTeamRepository()
      ).createTeamInTransaction(transaction, tenantId, input);
      if (result.ok) {
        await this.appendTeamAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "created",
        );
      }
      return result;
    });
  }

  public async updateTeam(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    teamId: string,
    input: Parameters<DrizzleTeamRepository["updateTeamInTransaction"]>[3],
  ): Promise<TeamMutationResult> {
    return this.execute(request, tenantId, "team", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.teamRepository ?? new DrizzleTeamRepository()
      ).updateTeamInTransaction(transaction, tenantId, teamId, input);
      if (result.ok) {
        await this.appendTeamAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "changed",
        );
      }
      return result;
    });
  }

  public async deactivateTeam(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    teamId: string,
    input: DeactivateTeamInput,
  ): Promise<TeamMutationResult> {
    return this.execute(request, tenantId, "team", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.teamRepository ?? new DrizzleTeamRepository()
      ).deactivateTeamInTransaction(
        transaction,
        tenantId,
        teamId,
        input.expectedVersion,
      );
      if (result.ok) {
        await this.appendTeamAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "deactivated",
        );
      }
      return result;
    });
  }

  public async createFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateFixtureInput,
  ): Promise<FixtureMutationResult> {
    return this.execute(request, tenantId, "fixture", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.fixtureRepository ?? new DrizzleFixtureRepository()
      ).createFixtureInTransaction(transaction, tenantId, input);
      if (result.ok) {
        await this.appendFixtureAudit(transaction, actorMembershipId, occurredAt, result, "created");
      }
      return result;
    });
  }

  public async updateFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: UpdateFixtureInput,
  ): Promise<FixtureMutationResult> {
    return this.execute(request, tenantId, "fixture", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.fixtureRepository ?? new DrizzleFixtureRepository()
      ).updateFixtureInTransaction(transaction, tenantId, fixtureId, input);
      if (result.ok) {
        await this.appendFixtureAudit(transaction, actorMembershipId, occurredAt, result, "changed");
      }
      return result;
    });
  }

  public async postponeFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: PostponeFixtureInput,
  ): Promise<FixtureMutationResult> {
    return this.execute(request, tenantId, "fixture", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.fixtureRepository ?? new DrizzleFixtureRepository()
      ).postponeFixtureInTransaction(transaction, tenantId, fixtureId, input);
      if (result.ok) {
        await this.appendFixtureAudit(transaction, actorMembershipId, occurredAt, result, "postponed");
      }
      return result;
    });
  }

  public async cancelFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: TransitionFixtureInput,
  ): Promise<FixtureMutationResult> {
    return this.execute(request, tenantId, "fixture", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.fixtureRepository ?? new DrizzleFixtureRepository()
      ).cancelFixtureInTransaction(transaction, tenantId, fixtureId, input);
      if (result.ok) {
        await this.appendFixtureAudit(transaction, actorMembershipId, occurredAt, result, "cancelled");
      }
      return result;
    });
  }

  public async completeFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: TransitionFixtureInput,
  ): Promise<FixtureMutationResult> {
    return this.execute(request, tenantId, "fixture", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.fixtureRepository ?? new DrizzleFixtureRepository()
      ).completeFixtureInTransaction(transaction, tenantId, fixtureId, input);
      if (result.ok) {
        await this.appendFixtureAudit(transaction, actorMembershipId, occurredAt, result, "completed");
      }
      return result;
    });
  }

  public async abandonFixture(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    fixtureId: string,
    input: TransitionFixtureInput,
  ): Promise<FixtureMutationResult> {
    return this.execute(request, tenantId, "fixture", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.fixtureRepository ?? new DrizzleFixtureRepository()
      ).abandonFixtureInTransaction(transaction, tenantId, fixtureId, input);
      if (result.ok) {
        await this.appendFixtureAudit(transaction, actorMembershipId, occurredAt, result, "abandoned");
      }
      return result;
    });
  }

  public async createResult(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateResultInput,
  ): Promise<ResultMutationResult> {
    return this.execute(request, tenantId, "result", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.resultRepository ?? new DrizzleResultRepository()
      ).createResultInTransaction(transaction, tenantId, input);
      if (result.ok) {
        await this.appendResultAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "draft_created",
        );
      }
      return result;
    });
  }

  public async updateResultDraft(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    resultId: string,
    input: UpdateResultDraftInput,
  ): Promise<ResultMutationResult> {
    return this.execute(request, tenantId, "result", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.resultRepository ?? new DrizzleResultRepository()
      ).updateDraftResultInTransaction(transaction, tenantId, resultId, input);
      if (result.ok) {
        await this.appendResultAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "draft_changed",
        );
      }
      return result;
    });
  }

  public async publishResult(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    resultId: string,
    input: PublishResultInput,
  ): Promise<ResultMutationResult> {
    return this.execute(request, tenantId, "result", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.resultRepository ?? new DrizzleResultRepository()
      ).publishResultInTransaction(
        transaction,
        tenantId,
        resultId,
        input,
        actorMembershipId,
        occurredAt,
      );
      if (result.ok) {
        await this.appendResultAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "published",
        );
      }
      return result;
    });
  }

  public async correctResult(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    resultId: string,
    input: CorrectResultInput,
  ): Promise<ResultMutationResult> {
    return this.execute(request, tenantId, "result", async (
      transaction,
      actorMembershipId,
      occurredAt,
    ) => {
      const result = await (
        this.dependencies.resultRepository ?? new DrizzleResultRepository()
      ).correctResultInTransaction(
        transaction,
        tenantId,
        resultId,
        input,
        actorMembershipId,
        occurredAt,
      );
      if (result.ok) {
        await this.appendResultAudit(
          transaction,
          actorMembershipId,
          occurredAt,
          result,
          "corrected",
        );
      }
      return result;
    });
  }
}
