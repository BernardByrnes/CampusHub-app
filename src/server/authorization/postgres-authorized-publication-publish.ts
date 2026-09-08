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
  type PublicationPublishActor,
} from "@/server/repositories/publication-repository";
import {
  PostgresCapabilityAuthorizer,
  type CapabilityClock,
} from "./postgres-capability-authorizer";

export type PostgresAuthorizedPublicationPublishDependencies = Readonly<{
  database: CampusHubDatabase;
  authorizer: PostgresCapabilityAuthorizer;
  clock?: CapabilityClock;
  /** Test-only gate after the Publication lock and before fresh authority time. */
  beforePublish?: () => Promise<void>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Commit-time Publication publish gateway. Authority, the exact resource
 * lock, the audience confirmation, the lifecycle update, and the audit event
 * all use one PostgreSQL transaction.
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

      const actorMembershipId = request.actor.membershipId;

      return await this.dependencies.database.transaction(async (transaction) => {
        const decision =
          await this.dependencies.authorizer.authorizePublicationPublishInTransaction(
            transaction,
            request,
            publicationId,
            input.expectedVersion,
            this.dependencies.beforePublish,
          );
        if (!decision.allowed) {
          return { outcome: "DENIED", code: decision.code } as const;
        }

        const occurredAt = this.dependencies.clock?.now() ?? new Date();
        if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.getTime())) {
          return { outcome: "DENIED", code: "PERSISTENCE_FAILED" } as const;
        }

        const actor: PublicationPublishActor = {
          identitySubjectId: request.actor.identitySubjectId,
          membershipId: actorMembershipId,
        };
        const mutation =
          await new DrizzlePublicationRepository().publishPublicationInTransaction(
            transaction,
            tenantId,
            publicationId,
            input,
            actor,
            occurredAt,
          );
        return mutation.ok
          ? ({ outcome: "PUBLISHED", publication: mutation.publication } as const)
          : ({ outcome: "DENIED", code: mutation.error } as const);
      });
    } catch {
      return { outcome: "DENIED", code: "PERSISTENCE_FAILED" };
    }
  }
}
