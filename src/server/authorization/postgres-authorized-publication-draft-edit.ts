import "server-only";

import type {
  AtomicPublicationDraftEditResult,
  AuthorizedPublicationDraftEditGateway,
} from "@/application/content/edit-publication-draft";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import type { UpdatePublicationDraftInput } from "@/domain/content/publication-draft-edit";
import { isUuid } from "@/domain/identifiers/uuid";
import { DrizzlePublicationRepository } from "@/server/repositories/publication-repository";
import type { CampusHubDatabase } from "@/server/db/client";
import { PostgresCapabilityAuthorizer } from "./postgres-capability-authorizer";

export type PostgresAuthorizedPublicationDraftEditDependencies = Readonly<{
  database: CampusHubDatabase;
  authorizer: PostgresCapabilityAuthorizer;
  /** Test-only gate after the Publication lock and before fresh authority time. */
  beforeUpdate?: () => Promise<void>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Commit-time Publication draft-edit gateway. Authority, the exact resource
 * lock, and the version-guarded update all use one PostgreSQL transaction.
 */
export class PostgresAuthorizedPublicationDraftEditExecutor
  implements AuthorizedPublicationDraftEditGateway
{
  public constructor(
    private readonly dependencies: PostgresAuthorizedPublicationDraftEditDependencies,
  ) {}

  public async editAuthorizedPublication(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    publicationId: string,
    input: UpdatePublicationDraftInput,
  ): Promise<AtomicPublicationDraftEditResult> {
    try {
      if (
        !isUuid(tenantId) ||
        !isUuid(publicationId) ||
        !isRecord(request) ||
        !isRecord(request.scope) ||
        request.scope.tenantId !== tenantId
      ) {
        return { outcome: "DENIED", code: "PERMISSION_DENIED" };
      }

      return await this.dependencies.database.transaction(async (transaction) => {
        const decision =
          await this.dependencies.authorizer.authorizePublicationEditInTransaction(
            transaction,
            request,
            publicationId,
            input.expectedVersion,
            this.dependencies.beforeUpdate,
          );
        if (!decision.allowed) {
          return { outcome: "DENIED", code: decision.code } as const;
        }

        const mutation =
          await new DrizzlePublicationRepository().updatePublicationDraftInTransaction(
            transaction,
            tenantId,
            publicationId,
            input,
          );
        return mutation.ok
          ? ({ outcome: "UPDATED", publication: mutation.publication } as const)
          : ({ outcome: "DENIED", code: mutation.error } as const);
      });
    } catch {
      return { outcome: "DENIED", code: "PERSISTENCE_FAILED" };
    }
  }
}
