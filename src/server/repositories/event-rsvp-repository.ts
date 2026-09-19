import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  evaluateEventParticipation,
  resolveEventRsvpTransition,
  type EventParticipationEvaluationInput,
  type EventRsvpCommand,
  type EventRsvpDenialCode,
  type EventRsvpResult,
  type EventRsvpState,
  type EventRsvpSuccess,
} from "@/domain/events/event-rsvp";
import { isEventAudienceDefinition, type EventAudienceDefinition } from "@/domain/events/event-audience";
import { isEvent } from "@/domain/events/events";
import { authorizeEventDetailRead } from "@/domain/events/event-detail-read-policy";
import { isOrganiser, type Organiser } from "@/domain/organisers/organisers";
import { parsePublicationAudienceProvenancePolicy } from "@/domain/authorization/publication-audience";
import { isMembershipAudienceFacts, parseMembershipResidenceState, parseProfileFieldProvenance, type MembershipAudienceFacts } from "@/domain/membership/membership-audience";
import type { Event } from "@/domain/events/events";
import { isUuid } from "@/domain/identifiers/uuid";
import { appendEventRsvpAwardInTransaction } from "@/server/repositories/xp-ledger-repository";
import { db, type CampusHubDatabase } from "@/server/db/client";
import {
  eventAudienceCriteria,
  eventRsvpIdempotency,
  eventRsvps,
  events,
  memberships,
  organisers,
  tenantModuleStates,
  tenants,
  type EventAudienceCriteriaRow,
  type EventRsvpIdempotencyRow,
  type MembershipRow,
  type TenantRow,
} from "@/server/db/schema";

export type EventRsvpRepositoryTransactionDatabase = Pick<
  CampusHubDatabase,
  "select" | "insert" | "update" | "execute"
>;

export type EventRsvpRepositoryOptions = Readonly<{
  runtimeDatabaseAuthorityVerifier?: (
    database: Pick<CampusHubDatabase, "execute">,
  ) => Promise<boolean>;
  onTransactionStarted?: (backendPid: number) => void | Promise<void>;
  beforeFinalClockCheck?: () => Promise<void>;
  afterXpAwardLockAcquired?: () => Promise<void>;
}>;

const DEFAULT_EVENT_RSVP_REPOSITORY_OPTIONS: EventRsvpRepositoryOptions = {};

export type EventRsvpReadResult =
  | Readonly<{ ok: true; state: EventRsvpState | null; participationVersion: number }>
  | Readonly<{ ok: false; error: "NOT_FOUND" | "TENANT_SCOPE_NOT_FOUND" | "PERSISTENCE_FAILED" }>;

export type EventRsvpAggregateResult =
  | Readonly<{ ok: true; goingCount: number; interestedCount: number }>
  | Readonly<{ ok: false; error: "NOT_FOUND" | "TENANT_SCOPE_NOT_FOUND" | "PERSISTENCE_FAILED" }>;

type RsvpContext = Readonly<{
  tenant: TenantRow | null;
  tenantStatus: unknown;
  moduleEnabled: boolean | null;
  moduleVersion: number | null;
  membership: MembershipRow | null;
  membershipBindingValid: boolean;
  event: Event | null;
  audience: EventAudienceDefinition | null;
  membershipFacts: MembershipAudienceFacts | null;
}>;

type RsvpTransactionAbort = Readonly<{
  readonly __campushubRsvpTransactionAbort: true;
  readonly result: EventRsvpResult;
}>;

function abortRsvpTransaction(result: EventRsvpResult): never {
  throw { __campushubRsvpTransactionAbort: true as const, result } satisfies RsvpTransactionAbort;
}

function isRsvpTransactionAbort(value: unknown): value is RsvpTransactionAbort {
  return typeof value === "object" &&
    value !== null &&
    (value as { __campushubRsvpTransactionAbort?: unknown }).__campushubRsvpTransactionAbort === true &&
    "result" in value;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function toEvent(row: typeof events.$inferSelect): Event | null {
  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    version: row.version,
    title: row.title,
    description: row.description,
    venue: row.venue,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    campusId: row.campusId,
    organiserId: row.organiserId,
    visibility: row.visibility,
    audienceMode: row.audienceMode,
    rsvpEnabled: row.rsvpEnabled,
    lifecycle: row.lifecycle,
    cancellationRetentionUntil: row.cancellationRetentionUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isEvent(candidate) ? candidate : null;
}

function toOrganiserForRead(row: typeof organisers.$inferSelect): Organiser | null {
  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    version: row.version,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isOrganiser(candidate) ? candidate : null;
}

function criteriaEmpty(row: EventAudienceCriteriaRow): boolean {
  return row.campusId === null &&
    row.academicDivisionId === null &&
    row.programmeId === null &&
    row.academicYear === null &&
    row.residenceTarget === null &&
    row.residenceId === null;
}

function rowsToAudience(
  tenantId: string,
  event: Event,
  rows: readonly EventAudienceCriteriaRow[],
): EventAudienceDefinition | null {
  if (event.tenantId !== tenantId) return null;
  if (event.audienceMode === "entire_tenant") {
    return rows.length === 0
      ? { eventId: event.id, tenantId, mode: "entire_tenant", groups: [] }
      : null;
  }
  if (rows.length === 0) return null;

  const groups = new Map<string, { policy: "authoritative_only" | "allow_self_declared"; values: unknown[] }>();
  for (const row of rows) {
    if (
      row.tenantId !== tenantId ||
      row.eventId !== event.id ||
      parsePublicationAudienceProvenancePolicy(row.provenancePolicy) === null
    ) return null;
    const existing = groups.get(row.dimension);
    if (existing !== undefined && existing.policy !== row.provenancePolicy) return null;
    const group = existing ?? { policy: row.provenancePolicy, values: [] };
    if (row.dimension === "campus") {
      if (!isUuid(row.campusId) || !criteriaEmpty({ ...row, campusId: null })) return null;
      group.values.push(row.campusId);
    } else if (row.dimension === "academic_division") {
      if (!isUuid(row.academicDivisionId) || !criteriaEmpty({ ...row, academicDivisionId: null })) return null;
      group.values.push(row.academicDivisionId);
    } else if (row.dimension === "programme") {
      if (!isUuid(row.programmeId) || !criteriaEmpty({ ...row, programmeId: null })) return null;
      group.values.push(row.programmeId);
    } else if (row.dimension === "academic_year") {
      if (row.academicYear === null || !Number.isInteger(row.academicYear) || row.academicYear < 1 || !criteriaEmpty({ ...row, academicYear: null })) return null;
      group.values.push(row.academicYear);
    } else if (row.dimension === "residence") {
      if (row.residenceTarget === null || row.campusId !== null || row.academicDivisionId !== null || row.programmeId !== null || row.academicYear !== null) return null;
      if (row.residenceTarget === "specific_residence") {
        if (!isUuid(row.residenceId)) return null;
        group.values.push({ kind: "specific_residence", residenceId: row.residenceId });
      } else if (row.residenceId === null && (row.residenceTarget === "any_resident" || row.residenceTarget === "non_resident")) {
        group.values.push({ kind: row.residenceTarget });
      } else return null;
    } else return null;
    groups.set(row.dimension, group);
  }

  const mapped = [...groups.entries()].map(([dimension, group]) => {
    switch (dimension) {
      case "campus": return { dimension, provenancePolicy: group.policy, campusIds: group.values as string[] };
      case "academic_division": return { dimension, provenancePolicy: group.policy, academicDivisionIds: group.values as string[] };
      case "programme": return { dimension, provenancePolicy: group.policy, programmeIds: group.values as string[] };
      case "academic_year": return { dimension, provenancePolicy: group.policy, academicYears: group.values as number[] };
      default: return { dimension: "residence" as const, provenancePolicy: group.policy, residenceTargets: group.values as Array<{ kind: "specific_residence"; residenceId: string } | { kind: "any_resident" } | { kind: "non_resident" }> };
    }
  });
  const candidate = { eventId: event.id, tenantId, mode: event.audienceMode, groups: mapped };
  return isEventAudienceDefinition(candidate) ? candidate : null;
}

function toMembershipFacts(row: MembershipRow | null): MembershipAudienceFacts | null {
  if (row === null) return null;
  const campusProvenance = parseProfileFieldProvenance(row.campusProvenance);
  const academicDivisionProvenance = parseProfileFieldProvenance(row.academicDivisionProvenance);
  const programmeProvenance = parseProfileFieldProvenance(row.programmeProvenance);
  const academicYearProvenance = parseProfileFieldProvenance(row.academicYearProvenance);
  const residenceProvenance = parseProfileFieldProvenance(row.residenceProvenance);
  const residenceState = parseMembershipResidenceState(row.residenceState);
  if (
    campusProvenance === null ||
    academicDivisionProvenance === null ||
    programmeProvenance === null ||
    academicYearProvenance === null ||
    residenceProvenance === null ||
    residenceState === null
  ) return null;

  const candidate = {
    membershipId: row.id,
    tenantId: row.tenantId,
    campus: { value: row.campusId, provenance: campusProvenance },
    academicDivision: { value: row.academicDivisionId, provenance: academicDivisionProvenance },
    programme: { value: row.programmeId, provenance: programmeProvenance },
    academicYear: { value: row.academicYear, provenance: academicYearProvenance },
    residence: { state: residenceState, residenceId: row.residenceId, provenance: residenceProvenance },
  };
  return isMembershipAudienceFacts(candidate) ? candidate : null;
}

async function databaseClock(database: Pick<CampusHubDatabase, "execute">): Promise<Date> {
  const result = await database.execute(sql`select clock_timestamp() as now`);
  const value = (result.rows[0] as { now?: unknown } | undefined)?.now;
  const date = toDate(value);
  if (date === null) throw new Error("Database clock unavailable.");
  return date;
}

function parseBackendPid(value: unknown): number {
  const pid = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Backend identity unavailable.");
  return pid;
}

function runtimeRsvpAuthorityIsSafe(
  database: Pick<CampusHubDatabase, "execute">,
): Promise<boolean> {
  return database.execute(sql`
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
      current_user = session_user
      and runtime_role.rolsuper = false
      and runtime_role.rolcreaterole = false
      and not has_schema_privilege(current_user, 'public', 'CREATE')
      and not exists (
        select 1
        from effective_authority_closure as authority
        join pg_roles as authority_role on authority_role.oid = authority.oid
        where authority_role.rolsuper
           or authority_role.rolcreaterole
           or authority_role.rolname = 'campushub_data_owner'
           or authority.oid in (module_table.relowner, rsvp_table.relowner, idempotency_table.relowner, xp_ledger_table.relowner, xp_claim_table.relowner, xp_event_source_table.relowner)
           or has_table_privilege(authority_role.rolname, 'public.tenant_module_states', 'INSERT')
           or has_column_privilege(authority_role.rolname, 'public.tenant_module_states', 'tenant_id', 'UPDATE')
           or has_column_privilege(authority_role.rolname, 'public.tenant_module_states', 'module', 'UPDATE')
           or has_column_privilege(authority_role.rolname, 'public.tenant_module_states', 'enabled', 'UPDATE')
           or has_column_privilege(authority_role.rolname, 'public.tenant_module_states', 'version', 'UPDATE')
           or has_table_privilege(authority_role.rolname, 'public.tenant_module_states', 'DELETE')
           or has_table_privilege(authority_role.rolname, 'public.tenant_module_states', 'TRUNCATE')
           or has_table_privilege(authority_role.rolname, 'public.event_rsvps', 'DELETE')
           or has_table_privilege(authority_role.rolname, 'public.event_rsvps', 'TRUNCATE')
           or has_table_privilege(authority_role.rolname, 'public.event_rsvp_idempotency', 'DELETE')
           or has_table_privilege(authority_role.rolname, 'public.event_rsvp_idempotency', 'TRUNCATE')
           or has_table_privilege(authority_role.rolname, 'public.xp_ledger_entries', 'UPDATE')
           or has_table_privilege(authority_role.rolname, 'public.xp_ledger_entries', 'DELETE')
           or has_table_privilege(authority_role.rolname, 'public.xp_ledger_entries', 'TRUNCATE')
           or has_table_privilege(authority_role.rolname, 'public.xp_source_claims', 'UPDATE')
           or has_table_privilege(authority_role.rolname, 'public.xp_source_claims', 'DELETE')
           or has_table_privilege(authority_role.rolname, 'public.xp_source_claims', 'TRUNCATE')
           or has_table_privilege(authority_role.rolname, 'public.xp_event_rsvp_source_claims', 'UPDATE')
           or has_table_privilege(authority_role.rolname, 'public.xp_event_rsvp_source_claims', 'DELETE')
           or has_table_privilege(authority_role.rolname, 'public.xp_event_rsvp_source_claims', 'TRUNCATE')
      )
      and has_table_privilege(current_user, 'public.tenant_module_states', 'SELECT')
      and not has_table_privilege(current_user, 'public.tenant_module_states', 'INSERT')
      and not has_column_privilege(current_user, 'public.tenant_module_states', 'tenant_id', 'UPDATE')
      and not has_column_privilege(current_user, 'public.tenant_module_states', 'module', 'UPDATE')
      and not has_column_privilege(current_user, 'public.tenant_module_states', 'enabled', 'UPDATE')
      and not has_column_privilege(current_user, 'public.tenant_module_states', 'version', 'UPDATE')
      and not has_table_privilege(current_user, 'public.tenant_module_states', 'DELETE')
      and not has_table_privilege(current_user, 'public.tenant_module_states', 'TRUNCATE')
      and has_table_privilege(current_user, 'public.event_rsvps', 'SELECT')
      and has_table_privilege(current_user, 'public.event_rsvps', 'INSERT')
      and has_table_privilege(current_user, 'public.event_rsvps', 'UPDATE')
      and not has_table_privilege(current_user, 'public.event_rsvps', 'DELETE')
      and not has_table_privilege(current_user, 'public.event_rsvps', 'TRUNCATE')
      and has_table_privilege(current_user, 'public.event_rsvp_idempotency', 'SELECT')
      and has_table_privilege(current_user, 'public.event_rsvp_idempotency', 'INSERT')
      and has_table_privilege(current_user, 'public.event_rsvp_idempotency', 'UPDATE')
      and not has_table_privilege(current_user, 'public.event_rsvp_idempotency', 'DELETE')
      and not has_table_privilege(current_user, 'public.event_rsvp_idempotency', 'TRUNCATE')
      and has_table_privilege(current_user, 'public.xp_ledger_entries', 'SELECT')
      and has_table_privilege(current_user, 'public.xp_ledger_entries', 'INSERT')
      and not has_table_privilege(current_user, 'public.xp_ledger_entries', 'UPDATE')
      and not has_table_privilege(current_user, 'public.xp_ledger_entries', 'DELETE')
      and not has_table_privilege(current_user, 'public.xp_ledger_entries', 'TRUNCATE')
      and has_table_privilege(current_user, 'public.xp_source_claims', 'SELECT')
      and has_table_privilege(current_user, 'public.xp_source_claims', 'INSERT')
      and not has_table_privilege(current_user, 'public.xp_source_claims', 'UPDATE')
      and not has_table_privilege(current_user, 'public.xp_source_claims', 'DELETE')
      and not has_table_privilege(current_user, 'public.xp_source_claims', 'TRUNCATE')
      and has_table_privilege(current_user, 'public.xp_event_rsvp_source_claims', 'SELECT')
      and has_table_privilege(current_user, 'public.xp_event_rsvp_source_claims', 'INSERT')
      and not has_table_privilege(current_user, 'public.xp_event_rsvp_source_claims', 'UPDATE')
      and not has_table_privilege(current_user, 'public.xp_event_rsvp_source_claims', 'DELETE')
      and not has_table_privilege(current_user, 'public.xp_event_rsvp_source_claims', 'TRUNCATE')
    ) as allowed
    from pg_roles as runtime_role
    cross join pg_class as module_table
    cross join pg_class as rsvp_table
    cross join pg_class as idempotency_table
    cross join pg_class as xp_ledger_table
    cross join pg_class as xp_claim_table
    cross join pg_class as xp_event_source_table
    join pg_namespace as namespace on namespace.nspname = 'public'
    where runtime_role.rolname = current_user
      and module_table.relnamespace = namespace.oid
      and module_table.relname = 'tenant_module_states'
      and module_table.relkind = 'r'
      and rsvp_table.relnamespace = namespace.oid
      and rsvp_table.relname = 'event_rsvps'
      and rsvp_table.relkind = 'r'
      and idempotency_table.relnamespace = namespace.oid
      and idempotency_table.relname = 'event_rsvp_idempotency'
      and idempotency_table.relkind = 'r'
      and xp_ledger_table.relnamespace = namespace.oid
      and xp_ledger_table.relname = 'xp_ledger_entries'
      and xp_ledger_table.relkind = 'r'
      and xp_claim_table.relnamespace = namespace.oid
      and xp_claim_table.relname = 'xp_source_claims'
      and xp_claim_table.relkind = 'r'
      and xp_event_source_table.relnamespace = namespace.oid
      and xp_event_source_table.relname = 'xp_event_rsvp_source_claims'
      and xp_event_source_table.relkind = 'r'
  `).then((result) => (result.rows[0] as { allowed?: unknown } | undefined)?.allowed === true).catch(() => false);
}

function toSuccess(row: Readonly<{ state: EventRsvpState; version: number }>, changed: boolean): EventRsvpSuccess {
  return {
    outcome: changed ? "CHANGED" : "NOOP",
    state: row.state,
    participationVersion: row.version,
    changed,
  };
}

function persistedSuccess(row: EventRsvpIdempotencyRow): EventRsvpSuccess | null {
  if (
    row.completedOutcome === null ||
    row.completedState === null ||
    row.completedParticipationVersion === null ||
    row.completedChanged === null ||
    row.completedAt === null
  ) return null;
  return {
    outcome: row.completedOutcome,
    state: row.completedState,
    participationVersion: row.completedParticipationVersion,
    changed: row.completedChanged,
  };
}

function failed(error: EventRsvpDenialCode): EventRsvpResult {
  return { ok: false, error };
}

export class DrizzleEventRsvpRepository {
  public constructor(
    private readonly database: CampusHubDatabase = db,
    private readonly options: EventRsvpRepositoryOptions = DEFAULT_EVENT_RSVP_REPOSITORY_OPTIONS,
  ) {}

  private async loadContext(
    transaction: EventRsvpRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    membershipId: string,
    identitySubjectId: string,
  ): Promise<RsvpContext> {
    const tenantRows = await transaction
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .for("share")
      .limit(1);
    const tenant = tenantRows[0] ?? null;

    const moduleRows = await transaction
      .select({ enabled: tenantModuleStates.enabled, version: tenantModuleStates.version, updatedAt: tenantModuleStates.updatedAt })
      .from(tenantModuleStates)
      .where(and(eq(tenantModuleStates.tenantId, tenantId), eq(tenantModuleStates.module, "event")))
      .for("share")
      .limit(1);
    const moduleEnabled = moduleRows[0]?.enabled ?? null;
    const moduleVersion = moduleRows[0]?.version ?? null;

    const membershipRows = await transaction
      .select()
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, membershipId)))
      .for("share")
      .limit(1);
    const membership = membershipRows[0] ?? null;
    const membershipBindingValid = membership !== null && membership.identitySubjectId === identitySubjectId;

    const eventRows = await transaction
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenantId), eq(events.id, eventId)))
      .for("share")
      .limit(1);
    const event = eventRows[0] ? toEvent(eventRows[0]) : null;
    const audienceRows = eventRows[0]
      ? await transaction.select().from(eventAudienceCriteria).where(and(eq(eventAudienceCriteria.tenantId, tenantId), eq(eventAudienceCriteria.eventId, eventId))).orderBy(asc(eventAudienceCriteria.dimension), asc(eventAudienceCriteria.id))
      : [];
    const audience = event === null ? null : rowsToAudience(tenantId, event, audienceRows);
    return {
      tenant,
      tenantStatus: tenant?.status,
      moduleEnabled,
      moduleVersion,
      membership,
      membershipBindingValid,
      event,
      audience,
      membershipFacts: membershipBindingValid ? toMembershipFacts(membership) : null,
    };
  }

  private evaluate(context: RsvpContext, now: Date): ReturnType<typeof evaluateEventParticipation> {
    const input: EventParticipationEvaluationInput = {
      tenantStatus: context.tenantStatus,
      moduleEnabled: context.moduleEnabled,
      moduleVersion: context.moduleVersion,
      event: context.event,
      membershipLifecycle: context.membership?.lifecycle,
      membershipBindingValid: context.membershipBindingValid,
      assuranceLevel: context.membership?.assuranceLevel,
      audience: context.audience,
      membershipFacts: context.membershipFacts,
      now,
    };
    return evaluateEventParticipation(input);
  }

  private async claimIdempotency(
    transaction: EventRsvpRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    membershipId: string,
    command: EventRsvpCommand,
  ): Promise<{ row: EventRsvpIdempotencyRow; inserted: boolean } | EventRsvpResult> {
    const insertedRows = await transaction
      .insert(eventRsvpIdempotency)
      .values({
        tenantId,
        eventId,
        membershipId,
        operationFamily: "participation",
        idempotencyKey: command.idempotencyKey,
        requestedState: command.requestedState,
        expectedParticipationVersion: command.expectedParticipationVersion,
      })
      .onConflictDoNothing({
        target: [
          eventRsvpIdempotency.tenantId,
          eventRsvpIdempotency.eventId,
          eventRsvpIdempotency.membershipId,
          eventRsvpIdempotency.operationFamily,
          eventRsvpIdempotency.idempotencyKey,
        ],
      })
      .returning();

    const row = insertedRows[0] ?? (await transaction
      .select()
      .from(eventRsvpIdempotency)
      .where(and(
        eq(eventRsvpIdempotency.tenantId, tenantId),
        eq(eventRsvpIdempotency.eventId, eventId),
        eq(eventRsvpIdempotency.membershipId, membershipId),
        eq(eventRsvpIdempotency.operationFamily, "participation"),
        eq(eventRsvpIdempotency.idempotencyKey, command.idempotencyKey),
      ))
      .for("update")
      .limit(1))[0];
    if (row === undefined) return failed("PERSISTENCE_FAILED");
    if (row.requestedState !== command.requestedState || row.expectedParticipationVersion !== command.expectedParticipationVersion) {
      return failed("IDEMPOTENCY_CONFLICT");
    }
    return { row, inserted: insertedRows.length > 0 };
  }

  public async changeParticipation(
    tenantId: string,
    membershipId: string,
    identitySubjectId: string,
    input: EventRsvpCommand,
  ): Promise<EventRsvpResult> {
    if (!isUuid(tenantId) || !isUuid(membershipId) || !isUuid(input.eventId) || identitySubjectId.trim().length === 0) return failed("INVALID_INPUT");
    try {
      return await this.database.transaction(async (transaction) => {
        const context = await this.loadContext(transaction, tenantId, input.eventId, membershipId, identitySubjectId);
        if (context.tenant === null) return failed("TENANT_SCOPE_NOT_FOUND");
        const authorityVerifier = this.options.runtimeDatabaseAuthorityVerifier ?? runtimeRsvpAuthorityIsSafe;
        if (!(await authorityVerifier(transaction))) return failed("PERSISTENCE_FAILED");
        if (this.options.onTransactionStarted !== undefined) {
          const result = await transaction.execute(sql`select pg_backend_pid() as backend_pid`);
          await this.options.onTransactionStarted(parseBackendPid((result.rows[0] as { backend_pid?: unknown } | undefined)?.backend_pid));
        }

        const initialDecision = this.evaluate(context, await databaseClock(transaction));
        if (!initialDecision.allowed) return failed(initialDecision.code);

        const claim = await this.claimIdempotency(transaction, tenantId, input.eventId, membershipId, input);
        if (!("row" in claim)) return claim;

        const currentRows = await transaction
          .select()
          .from(eventRsvps)
          .where(and(eq(eventRsvps.tenantId, tenantId), eq(eventRsvps.eventId, input.eventId), eq(eventRsvps.membershipId, membershipId)))
          .for("update")
          .limit(1);
        let current = currentRows[0];
        const currentState = current === undefined ? null : { state: current.state, version: current.version };
        await this.options.beforeFinalClockCheck?.();
        const finalClock = await databaseClock(transaction);
        const finalDecision = this.evaluate(context, finalClock);
        if (!finalDecision.allowed) {
          if (claim.inserted) abortRsvpTransaction(failed(finalDecision.code));
          return failed(finalDecision.code);
        }

        const completed = persistedSuccess(claim.row);
        if (completed !== null) {
          return {
            ok: true,
            value: completed,
          };
        }

        let transition = resolveEventRsvpTransition(currentState, input);
        if (transition.kind === "INVALID_STATE") {
          if (claim.inserted) abortRsvpTransaction(failed("INVALID_STATE"));
          return failed("INVALID_STATE");
        }
        if (transition.kind === "VERSION_CONFLICT") {
          if (claim.inserted) abortRsvpTransaction(failed("VERSION_CONFLICT"));
          return failed("VERSION_CONFLICT");
        }

        let finalState: EventRsvpState;
        let finalVersion: number;
        let changed = false;
        if (transition.kind === "CREATE") {
          const rows = await transaction.insert(eventRsvps).values({
            tenantId,
            eventId: input.eventId,
            membershipId,
            state: input.requestedState,
            version: transition.nextVersion!,
            createdAt: finalClock,
            updatedAt: finalClock,
          }).onConflictDoNothing({
            target: [eventRsvps.tenantId, eventRsvps.eventId, eventRsvps.membershipId],
          }).returning();
          const inserted = rows[0];
          if (inserted !== undefined) {
            await appendEventRsvpAwardInTransaction(transaction, {
              tenantId,
              membershipId,
              eventId: input.eventId,
              tenantTimezone: context.tenant!.timezone,
              occurredAt: finalClock,
              requestIdempotencyKey: input.idempotencyKey,
              afterAdvisoryLockAcquired: this.options.afterXpAwardLockAcquired,
            });
            finalState = inserted.state;
            finalVersion = inserted.version;
            changed = true;
          } else {
            // Two different idempotency keys can legitimately arrive with the
            // same expected version. The unique participation row is the
            // serialization point for the absent-row case; re-read it after
            // the conflict has waited for the winner to commit.
            const winnerRows = await transaction
              .select()
              .from(eventRsvps)
              .where(and(
                eq(eventRsvps.tenantId, tenantId),
                eq(eventRsvps.eventId, input.eventId),
                eq(eventRsvps.membershipId, membershipId),
              ))
              .for("update")
              .limit(1);
            current = winnerRows[0];
            if (current === undefined) throw new Error("RSVP conflict row was not visible after serialization.");
            transition = resolveEventRsvpTransition(
              { state: current.state, version: current.version },
              input,
            );
            if (transition.kind === "VERSION_CONFLICT") abortRsvpTransaction(failed("VERSION_CONFLICT"));
            if (transition.kind === "INVALID_STATE") abortRsvpTransaction(failed("INVALID_STATE"));
            if (transition.kind !== "NOOP") throw new Error("Unexpected RSVP conflict transition.");
            finalState = current.state;
            finalVersion = current.version;
          }
        } else if (transition.kind === "UPDATE") {
          if (current === undefined) throw new Error("RSVP update lost its current row.");
          const rows = await transaction.update(eventRsvps).set({
            state: input.requestedState,
            version: transition.nextVersion!,
            updatedAt: finalClock,
          }).where(and(
            eq(eventRsvps.tenantId, tenantId),
            eq(eventRsvps.id, current.id),
            eq(eventRsvps.version, current.version),
          )).returning();
          const updated = rows[0];
          if (updated === undefined) throw new Error("RSVP update lost its version guard.");
          finalState = updated.state;
          finalVersion = updated.version;
          changed = true;
        } else {
          if (current === undefined) throw new Error("RSVP no-op has no current row.");
          finalState = current.state;
          finalVersion = current.version;
        }

        await transaction.update(eventRsvpIdempotency).set({
          completedOutcome: changed ? "CHANGED" : "NOOP",
          completedState: finalState!,
          completedParticipationVersion: finalVersion!,
          completedChanged: changed,
          completedAt: finalClock,
          updatedAt: finalClock,
        }).where(eq(eventRsvpIdempotency.id, claim.row.id));
        return { ok: true, value: toSuccess({ state: finalState!, version: finalVersion! }, changed) };
      });
    } catch (error) {
      if (isRsvpTransactionAbort(error)) return error.result;
      return failed("PERSISTENCE_FAILED");
    }
  }

  public async findOwnParticipation(
    tenantId: string,
    eventId: string,
    membershipId: string,
    identitySubjectId: string,
  ): Promise<EventRsvpReadResult> {
    if (!isUuid(tenantId) || !isUuid(eventId) || !isUuid(membershipId) || identitySubjectId.trim().length === 0) return { ok: false, error: "PERSISTENCE_FAILED" };
    try {
      const tenant = (await this.database.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0];
      if (tenant === undefined) return { ok: false, error: "TENANT_SCOPE_NOT_FOUND" };
      const membership = (await this.database.select().from(memberships).where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, membershipId))).limit(1))[0];
      if (membership === undefined || membership.identitySubjectId !== identitySubjectId) return { ok: false, error: "TENANT_SCOPE_NOT_FOUND" };
      const eventRow = (await this.database.select().from(events).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId))).limit(1))[0];
      const event = eventRow === undefined ? null : toEvent(eventRow);
      if (event === null) return { ok: false, error: "NOT_FOUND" };
      const audienceRows = await this.database
        .select()
        .from(eventAudienceCriteria)
        .where(and(eq(eventAudienceCriteria.tenantId, tenantId), eq(eventAudienceCriteria.eventId, eventId)))
        .orderBy(asc(eventAudienceCriteria.dimension), asc(eventAudienceCriteria.id));
      const audience = rowsToAudience(tenantId, event, audienceRows);
      if (audience === null) return { ok: false, error: "NOT_FOUND" };
      const organiserRow = event.organiserId === null
        ? undefined
        : (await this.database.select().from(organisers).where(and(eq(organisers.tenantId, tenantId), eq(organisers.id, event.organiserId))).limit(1))[0];
      const readable = authorizeEventDetailRead({
        record: {
          event,
          audience,
          organiser: organiserRow === undefined ? null : toOrganiserForRead(organiserRow),
        },
        viewer: {
          kind: "membership",
          context: {
            identitySubjectId,
            tenantId,
            tenantStatus: tenant.status,
            membershipId,
            assuranceLevel: membership.assuranceLevel,
            membershipStatus: membership.lifecycle,
          },
        },
        tenantFacts: {
          tenantId,
          tenantStatus: tenant.status,
          publicSurfacePermitted: tenant.status !== "archived",
          onLeaveReadEnabled: true,
          alumniPublicReadEnabled: true,
          ...(tenant.status === "archived" ? { archiveNoticeState: "ENDED" as const } : {}),
        },
        membershipFacts: toMembershipFacts(membership),
        now: await databaseClock(this.database),
        includePast: true,
      });
      if (!readable) return { ok: false, error: "NOT_FOUND" };
      const rows = await this.database.select({ state: eventRsvps.state, version: eventRsvps.version }).from(eventRsvps).where(and(eq(eventRsvps.tenantId, tenantId), eq(eventRsvps.eventId, eventId), eq(eventRsvps.membershipId, membershipId))).limit(1);
      return rows[0] === undefined
        ? { ok: true, state: null, participationVersion: 0 }
        : { ok: true, state: rows[0].state, participationVersion: rows[0].version };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async getAggregateCounts(
    tenantId: string,
    eventId: string,
  ): Promise<EventRsvpAggregateResult> {
    if (!isUuid(tenantId) || !isUuid(eventId)) return { ok: false, error: "PERSISTENCE_FAILED" };
    try {
      const event = await this.database.select({ id: events.id }).from(events).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId))).limit(1);
      if (event.length === 0) return { ok: false, error: "NOT_FOUND" };
      const rows = await this.database.select({ state: eventRsvps.state, count: sql<number>`count(*)::int` }).from(eventRsvps).where(and(eq(eventRsvps.tenantId, tenantId), eq(eventRsvps.eventId, eventId))).groupBy(eventRsvps.state);
      return {
        ok: true,
        goingCount: Number(rows.find((row) => row.state === "going")?.count ?? 0),
        interestedCount: Number(rows.find((row) => row.state === "interested")?.count ?? 0),
      };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }
}
