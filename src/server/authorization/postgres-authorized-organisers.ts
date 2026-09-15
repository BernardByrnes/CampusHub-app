import "server-only";

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { CAPABILITIES } from "@/domain/authorization/capability";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import {
  ORGANISER_AUDIT_EVENT_TYPES,
  type OrganiserAuditEventFacts,
  type OrganiserAuditEventType,
} from "@/domain/audit/audit-event";
import type {
  CreateOrganiserInput,
  UpdateOrganiserInput,
} from "@/domain/organisers/organisers";
import type { CampusHubDatabase } from "@/server/db/client";
import {
  DrizzleOrganiserRepository,
  type OrganiserMutationError,
  type OrganiserMutationResult,
  type OrganiserRepositoryTransactionDatabase,
  type PreparedOrganiserMutation,
} from "@/server/repositories/organiser-repository";
import type {
  AuditEventTransactionDatabase,
  DrizzleAuditEventRepository,
} from "@/server/repositories/audit-event-repository";
import {
  PostgresPrivilegedMutationAuthority,
  type PrivilegedMutationTransactionDatabase,
} from "./postgres-privileged-mutation-authority";

type OrganiserTransactionDatabase =
  & OrganiserRepositoryTransactionDatabase
  & PrivilegedMutationTransactionDatabase
  & AuditEventTransactionDatabase;

export type PostgresAuthorizedOrganiserManagementDependencies = Readonly<{
  database: CampusHubDatabase;
  auditEvents: Pick<DrizzleAuditEventRepository, "appendOrganiserMutationInTransaction">;
  organiserRepository?: DrizzleOrganiserRepository;
  authority?: PostgresPrivilegedMutationAuthority;
  runtimeDatabaseAuthorityVerifier?: (
    database: Pick<CampusHubDatabase, "execute">,
  ) => Promise<boolean>;
  onTransactionStarted?: (backendPid: number) => void | Promise<void>;
  beforeFinalAuthorityCheck?: () => Promise<void>;
  beforeFinalClockCheck?: () => Promise<void>;
  applicationName?: string;
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
    request.capability === CAPABILITIES.ORGANISER_MANAGE &&
    request.scope.module === "tenant" &&
    request.scope.resource === "organiser";
}

function organiserAuditType(action: OrganiserAuditEventFacts["action"]): OrganiserAuditEventType {
  const candidate = `organiser.${action}` as OrganiserAuditEventType;
  if (!ORGANISER_AUDIT_EVENT_TYPES.includes(candidate)) {
    throw new Error("Unsupported Organiser audit event.");
  }
  return candidate;
}

export class PostgresAuthorizedOrganiserManagementExecutor {
  public constructor(
    private readonly dependencies: PostgresAuthorizedOrganiserManagementDependencies,
  ) {}

  private async execute(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    applicationName: string,
    prepareResource: (transaction: OrganiserTransactionDatabase) => Promise<true | OrganiserMutationError>,
    mutation: (transaction: OrganiserTransactionDatabase, actorMembershipId: string, databaseTime: Date) => Promise<OrganiserMutationResult>,
    action: OrganiserAuditEventFacts["action"],
  ): Promise<OrganiserMutationResult> {
    if (!isAuthorizedRequest(request, tenantId)) return { ok: false, error: "PERMISSION_DENIED" };
    const authority = this.dependencies.authority ?? new PostgresPrivilegedMutationAuthority();
    try {
      return await this.dependencies.database.transaction(async (transaction) => {
        await transaction.execute(sql`select set_config('application_name', ${applicationName}, true)`);
        if (this.dependencies.onTransactionStarted !== undefined) {
          const backendResult = await transaction.execute(sql`select pg_backend_pid() as backend_pid`);
          const rawBackendPid = (backendResult.rows[0] as { backend_pid?: unknown } | undefined)?.backend_pid;
          const backendPid = typeof rawBackendPid === "number" ? rawBackendPid : Number(rawBackendPid);
          if (!Number.isInteger(backendPid) || backendPid <= 0) throw new Error("Organiser transaction backend identity was unavailable.");
          await this.dependencies.onTransactionStarted(backendPid);
        }
        const runtimeVerifier = this.dependencies.runtimeDatabaseAuthorityVerifier ?? runtimeAuthorityIsSafe;
        const outcome = await authority.run(transaction, {
          request,
          capability: CAPABILITIES.ORGANISER_MANAGE,
          moduleScope: "tenant",
          resource: "organiser",
          prepareResource: async () => {
            const prepared = await prepareResource(transaction);
            if (prepared !== true) return prepared;
            if (!(await runtimeVerifier(transaction))) return "PERSISTENCE_FAILED";
            await this.dependencies.beforeFinalAuthorityCheck?.();
            return true;
          },
          beforeFinalClockCheck: this.dependencies.beforeFinalClockCheck,
          guardedMutation: async ({ actorMembershipId, databaseTime }) => {
            const result = await mutation(transaction, actorMembershipId, databaseTime);
            if (!result.ok) return result;
            if (result.changed) {
              await this.dependencies.auditEvents.appendOrganiserMutationInTransaction(transaction, {
                tenantId: result.organiser.tenantId,
                actorMembershipId,
                resourceId: result.organiser.id,
                resourceVersion: result.organiser.version,
                occurredAt: databaseTime,
                eventType: organiserAuditType(action),
                eventFacts: { action, version: result.organiser.version },
              });
            }
            return result;
          },
        });
        if (outcome.ok) {
          if (!outcome.value.ok && outcome.value.error === "PERSISTENCE_FAILED") throw new Error("Organiser persistence failed; rolling back transaction.");
          return outcome.value;
        }
        if (outcome.code === "PERSISTENCE_FAILED") throw new Error("Organiser persistence failed; rolling back transaction.");
        return { ok: false, error: outcome.code };
      });
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async createOrganiser(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreateOrganiserInput,
  ): Promise<OrganiserMutationResult> {
    const repository = this.dependencies.organiserRepository ?? new DrizzleOrganiserRepository();
    const organiserId = randomUUID();
    let prepared = false;
    return this.execute(
      request,
      tenantId,
      this.dependencies.applicationName ?? `campushub-organiser-${organiserId}`,
      async (transaction) => {
        prepared = await repository.prepareCreateOrganiserInTransaction(transaction, tenantId, organiserId, input);
        return prepared ? true : "NOT_READY";
      },
      (transaction, _actor, databaseTime) => prepared
        ? repository.createOrganiserInTransaction(transaction, tenantId, organiserId, input, databaseTime)
        : Promise.resolve({ ok: false as const, error: "PERSISTENCE_FAILED" as const }),
      "created",
    );
  }

  public async updateOrganiser(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    organiserId: string,
    input: UpdateOrganiserInput,
  ): Promise<OrganiserMutationResult> {
    const repository = this.dependencies.organiserRepository ?? new DrizzleOrganiserRepository();
    let prepared: PreparedOrganiserMutation | undefined;
    return this.execute(
      request,
      tenantId,
      this.dependencies.applicationName ?? `campushub-organiser-${organiserId}`,
      async (transaction) => {
        const result = await repository.prepareOrganiserMutationInTransaction(transaction, tenantId, organiserId, input.expectedVersion);
        if (typeof result === "string") return result;
        prepared = result;
        return true;
      },
      (transaction, _actor, databaseTime) => prepared === undefined
        ? Promise.resolve({ ok: false as const, error: "PERSISTENCE_FAILED" as const })
        : repository.updateOrganiserInTransaction(transaction, tenantId, organiserId, input, prepared, databaseTime),
      "changed",
    );
  }
}
