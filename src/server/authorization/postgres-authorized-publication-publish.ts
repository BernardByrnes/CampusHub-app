import "server-only";

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
  /** Test-only gate after the Publication lock and before fresh authority time. */
  beforePublish?: () => Promise<void>;
  /** Test-only failure point after the lifecycle mutation, before commit. */
  afterPublishMutation?: () => Promise<void>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
