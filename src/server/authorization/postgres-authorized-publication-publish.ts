import "server-only";

import { sql } from "drizzle-orm";

import type {
  AtomicPublicationPublishResult,
  AuthorizedPublicationPublishGateway,
} from "@/application/content/publish-publication";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import type { PublishPublicationInput } from "@/domain/content/publication-publish";
import { isUuid } from "@/domain/identifiers/uuid";
import type { CampusHubDatabase } from "@/server/db/client";
import {
  DrizzlePublicationRepository,
  type PublicationPublishAuditWriter,
} from "@/server/repositories/publication-repository";
import { PostgresCapabilityAuthorizer } from "./postgres-capability-authorizer";

export type PostgresAuthorizedPublicationPublishDependencies = Readonly<{
  database: CampusHubDatabase;
  authorizer: PostgresCapabilityAuthorizer;
  auditEvents: PublicationPublishAuditWriter;
  /** The production default verifies the actual PostgreSQL session principal. */
  runtimeDatabaseAuthorityVerifier?: (
    database: Pick<CampusHubDatabase, "execute">,
  ) => Promise<boolean>;
  /** Test-only gate after the Publication lock and before fresh authority time. */
  beforePublish?: () => Promise<void>;
  /** Test-only failure point after the lifecycle mutation, before commit. */
  afterPublishMutation?: () => Promise<void>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function verifyAuditRuntimeDatabaseAuthority(
  database: Pick<CampusHubDatabase, "execute">,
): Promise<boolean> {
  try {
    const result = await database.execute(sql`
      with reachable_roles(oid) as (
        select role.oid
        from pg_roles as role
        where role.rolname = current_user
           or pg_has_role(session_user::name, role.oid, 'USAGE')
           or pg_has_role(session_user::name, role.oid, 'SET')
      ),
      settable_roles(oid) as (
        select role.oid
        from pg_roles as role
        where role.rolname = current_user
           or pg_has_role(session_user::name, role.oid, 'SET')
      )
      select (
        runtime_role.rolsuper = false
        and runtime_role.rolcreaterole = false
        and current_user = session_user
        and audit_table.relowner <> runtime_role.oid
        and not exists (
          select 1
          from settable_roles as owner_role
          where owner_role.oid = audit_table.relowner
        )
        and has_table_privilege(current_user, 'public.audit_events', 'SELECT')
        and has_table_privilege(current_user, 'public.audit_events', 'INSERT')
        and not has_table_privilege(current_user, 'public.audit_events', 'UPDATE')
        and not has_table_privilege(current_user, 'public.audit_events', 'DELETE')
        and not has_table_privilege(current_user, 'public.audit_events', 'TRUNCATE')
        and not has_table_privilege(current_user, 'public.audit_events', 'REFERENCES')
        and not has_table_privilege(current_user, 'public.audit_events', 'TRIGGER')
        and not exists (
          select 1
          from settable_roles as audit_owner_role
          join pg_roles as named_role
            on named_role.oid = audit_owner_role.oid
          where named_role.rolname = 'campushub_audit_owner'
        )
        and not exists (
          select 1
          from settable_roles as dangerous_role
          join pg_roles as exercisable_role
            on exercisable_role.oid = dangerous_role.oid
          where exercisable_role.rolsuper
             or has_table_privilege(exercisable_role.rolname, 'public.audit_events', 'UPDATE')
             or has_table_privilege(exercisable_role.rolname, 'public.audit_events', 'DELETE')
             or has_table_privilege(exercisable_role.rolname, 'public.audit_events', 'TRUNCATE')
             or has_table_privilege(exercisable_role.rolname, 'public.audit_events', 'TRIGGER')
             or has_table_privilege(exercisable_role.rolname, 'public.audit_events', 'REFERENCES')
             or has_schema_privilege(exercisable_role.rolname, 'public', 'CREATE')
        )
        and not exists (
          select 1
          from pg_auth_members as membership
          join reachable_roles as member_role
            on member_role.oid = membership.member
          join pg_roles as grantable_role
            on grantable_role.oid = membership.roleid
          where membership.admin_option
            and (
              grantable_role.rolsuper
              or grantable_role.rolcreaterole
              or grantable_role.rolname = 'campushub_audit_owner'
              or grantable_role.oid = audit_table.relowner
              or has_table_privilege(
                grantable_role.rolname,
                'public.audit_events',
                'UPDATE'
              )
              or has_table_privilege(
                grantable_role.rolname,
                'public.audit_events',
                'DELETE'
              )
              or has_table_privilege(
                grantable_role.rolname,
                'public.audit_events',
                'TRUNCATE'
              )
              or has_table_privilege(
                grantable_role.rolname,
                'public.audit_events',
                'TRIGGER'
              )
              or has_table_privilege(
                grantable_role.rolname,
                'public.audit_events',
                'REFERENCES'
              )
              or has_schema_privilege(
                grantable_role.rolname,
                'public',
                'CREATE'
              )
            )
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

/**
 * Commit-time Publication publish gateway. Authority, the exact resource
 * lock, the audience confirmation, and the lifecycle update all use one
 * PostgreSQL transaction.
 */
export class PostgresAuthorizedPublicationPublishExecutor
  implements AuthorizedPublicationPublishGateway
{
  public constructor(
    private readonly dependencies: PostgresAuthorizedPublicationPublishDependencies,
  ) {}

  public async publishAuthorizedPublication(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    publicationId: string,
    input: PublishPublicationInput,
  ): Promise<AtomicPublicationPublishResult> {
    try {
      if (
        !isUuid(tenantId) ||
        !isUuid(publicationId) ||
        !isRecord(request) ||
        !isRecord(request.actor) ||
        !isRecord(request.scope) ||
        request.scope.tenantId !== tenantId ||
        !isUuid(request.actor.membershipId)
      ) {
        return { outcome: "DENIED", code: "PERMISSION_DENIED" };
      }

      return await this.dependencies.database.transaction(async (transaction) => {
        const actorMembershipId = request.actor.membershipId;
        if (!isUuid(actorMembershipId)) {
          return { outcome: "DENIED", code: "PERMISSION_DENIED" } as const;
        }
        const authorizationTimestamp: { value?: Date } = {};
        const decision =
          await this.dependencies.authorizer.authorizePublicationPublishInTransaction(
            transaction,
            request,
            publicationId,
            input.expectedVersion,
            this.dependencies.beforePublish,
            (checkedAt) => {
              authorizationTimestamp.value = checkedAt;
            },
          );
        if (!decision.allowed) {
          return { outcome: "DENIED", code: decision.code } as const;
        }

        const occurredAt = authorizationTimestamp.value;
        if (
          !(occurredAt instanceof Date) ||
          Number.isNaN(occurredAt.getTime())
        ) {
          return { outcome: "DENIED", code: "PERSISTENCE_FAILED" } as const;
        }

        const runtimeAuthorityIsSafe = await (
          this.dependencies.runtimeDatabaseAuthorityVerifier ??
          verifyAuditRuntimeDatabaseAuthority
        )(transaction);
        if (!runtimeAuthorityIsSafe) {
          return { outcome: "DENIED", code: "PERSISTENCE_FAILED" } as const;
        }

        const mutation =
          await new DrizzlePublicationRepository(
            this.dependencies.database,
          ).publishPublicationInTransaction(
            transaction,
            tenantId,
            publicationId,
            input,
            occurredAt,
            actorMembershipId,
            this.dependencies.auditEvents,
          );
        if (mutation.ok) {
          await this.dependencies.afterPublishMutation?.();
        }
        return mutation.ok
          ? ({ outcome: "PUBLISHED", publication: mutation.publication } as const)
          : ({ outcome: "DENIED", code: mutation.error } as const);
      });
    } catch {
      return { outcome: "DENIED", code: "PERSISTENCE_FAILED" };
    }
  }
}
