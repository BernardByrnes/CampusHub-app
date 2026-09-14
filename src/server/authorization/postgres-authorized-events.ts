import "server-only";

import { sql } from "drizzle-orm";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import {
  EVENT_AUDIT_EVENT_TYPES,
  type EventAuditEventFacts,
  type EventAuditEventType,
} from "@/domain/audit/audit-event";
import type { CreateEventInput, PublishEventInput, UpdateEventInput } from "@/domain/events/events";
import type { CampusHubDatabase } from "@/server/db/client";
import {
  PostgresPrivilegedMutationAuthority,
  type PrivilegedMutationTransactionDatabase,
} from "./postgres-privileged-mutation-authority";
import {
  DrizzleEventRepository,
  type EventMutationError,
  type EventMutationResult,
  type EventRepositoryTransactionDatabase,
} from "@/server/repositories/event-repository";
import type {
  AuditEventTransactionDatabase,
  DrizzleAuditEventRepository,
} from "@/server/repositories/audit-event-repository";

type EventTransactionDatabase =
  & EventRepositoryTransactionDatabase
  & PrivilegedMutationTransactionDatabase
  & AuditEventTransactionDatabase;

export type PostgresAuthorizedEventManagementDependencies = Readonly<{
  database: CampusHubDatabase;
  authorizer: {
    authorize(request: CapabilityAuthorizationRequest): Promise<Readonly<{ allowed: boolean }>>;
  };
  auditEvents: Pick<DrizzleAuditEventRepository, "appendEventMutationInTransaction">;
  eventRepository?: DrizzleEventRepository;
  authority?: PostgresPrivilegedMutationAuthority;
  runtimeDatabaseAuthorityVerifier?: (
    database: Pick<CampusHubDatabase, "execute">,
  ) => Promise<boolean>;
  beforeMutation?: () => Promise<void>;
  afterMutation?: () => Promise<void>;
}>;

function runtimeAuthorityIsSafe(
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
      runtime_role.rolsuper = false
      and runtime_role.rolcreaterole = false
      and current_user = session_user
      and audit_table.relowner <> runtime_role.oid
      and has_table_privilege(current_user, 'public.audit_events', 'SELECT')
      and has_table_privilege(current_user, 'public.audit_events', 'INSERT')
      and not has_table_privilege(current_user, 'public.audit_events', 'UPDATE')
      and not has_table_privilege(current_user, 'public.audit_events', 'DELETE')
      and not has_table_privilege(current_user, 'public.audit_events', 'TRUNCATE')
      and not has_table_privilege(current_user, 'public.audit_events', 'TRIGGER')
      and not has_table_privilege(current_user, 'public.audit_events', 'REFERENCES')
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
  `).then((result) => (result.rows[0] as { allowed?: unknown } | undefined)?.allowed === true).catch(() => false);
}

function isAuthorizedRequest(
  request: CapabilityAuthorizationRequest,
  tenantId: string,
): boolean {
  return request.actor.tenantId === tenantId &&
    request.scope.tenantId === tenantId &&
    request.capability === CAPABILITIES.EVENT_MANAGE &&
    request.scope.module === "event" &&
    request.scope.resource === "event";
}

function eventAuditType(action: EventAuditEventFacts["action"]): EventAuditEventType {
  const candidate = `event.${action}` as EventAuditEventType;
  if (!EVENT_AUDIT_EVENT_TYPES.includes(candidate)) {
    throw new Error("Unsupported Event audit event.");
  }
  return candidate;
}

export class PostgresAuthorizedEventManagementExecutor {
  public constructor(
    private readonly dependencies: PostgresAuthorizedEventManagementDependencies,
  ) {}

  private async execute(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    prepareResource: (transaction: EventTransactionDatabase) => Promise<true | EventMutationError>,
    mutation: (transaction: EventTransactionDatabase, actorMembershipId: string, databaseTime: Date) => Promise<EventMutationResult>,
    action: EventAuditEventFacts["action"],
  ): Promise<EventMutationResult> {
    if (!isAuthorizedRequest(request, tenantId)) return { ok: false, error: "PERMISSION_DENIED" };
    const authority = this.dependencies.authority ?? new PostgresPrivilegedMutationAuthority();
    try {
      return await this.dependencies.database.transaction(async (transaction) => {
        const runtimeVerifier = this.dependencies.runtimeDatabaseAuthorityVerifier ?? runtimeAuthorityIsSafe;
        const outcome = await authority.run(transaction, {
          request,
          capability: CAPABILITIES.EVENT_MANAGE,
          moduleScope: "event",
          resource: "event",
          prepareResource: () => prepareResource(transaction),
          guardedMutation: async ({ actorMembershipId, databaseTime }) => {
            if (!(await runtimeVerifier(transaction))) return { ok: false as const, error: "PERSISTENCE_FAILED" as const };
            await this.dependencies.beforeMutation?.();
            const result = await mutation(transaction, actorMembershipId, databaseTime);
            if (!result.ok) return result;
            if (result.changed) {
              const facts: EventAuditEventFacts = {
                action,
                lifecycle: result.record.event.lifecycle,
                version: result.record.event.version,
              };
              await this.dependencies.auditEvents.appendEventMutationInTransaction(transaction, {
                tenantId: result.record.event.tenantId,
                actorMembershipId,
                resourceId: result.record.event.id,
                resourceVersion: result.record.event.version,
                occurredAt: databaseTime,
                eventType: eventAuditType(action),
                eventFacts: facts,
              });
              await this.dependencies.afterMutation?.();
            }
            return result;
          },
        });
        return outcome.ok ? outcome.value : { ok: false, error: outcome.code };
      });
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async createEvent(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateEventInput,
  ): Promise<EventMutationResult> {
    const repository = this.dependencies.eventRepository ?? new DrizzleEventRepository();
    return this.execute(
      request,
      tenantId,
      (transaction) => repository.prepareCreateEventInTransaction(transaction, tenantId, input).then((ok) => ok ? true : "NOT_READY"),
      (transaction, _actor, databaseTime) => repository.createEventInTransaction(transaction, tenantId, input, databaseTime),
      "created",
    );
  }

  public async updateEvent(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    eventId: string,
    input: UpdateEventInput,
  ): Promise<EventMutationResult> {
    const repository = this.dependencies.eventRepository ?? new DrizzleEventRepository();
    return this.execute(
      request,
      tenantId,
      (transaction) => repository.prepareEventMutationInTransaction(transaction, tenantId, eventId, input.expectedVersion, "edit"),
      (transaction, _actor, databaseTime) => repository.updateEventInTransaction(transaction, tenantId, eventId, input, databaseTime),
      "changed",
    );
  }

  public async publishEvent(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    eventId: string,
    input: PublishEventInput,
  ): Promise<EventMutationResult> {
    const repository = this.dependencies.eventRepository ?? new DrizzleEventRepository();
    return this.execute(
      request,
      tenantId,
      (transaction) => repository.prepareEventMutationInTransaction(transaction, tenantId, eventId, input.expectedVersion, "publish"),
      (transaction, _actor, databaseTime) => repository.publishEventInTransaction(transaction, tenantId, eventId, input, databaseTime),
      "published",
    );
  }
}
