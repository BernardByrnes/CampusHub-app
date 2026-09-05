import "server-only";

import type {
  AtomicPublicationCreateResult,
  AuthorizedPublicationCreateGateway,
} from "@/application/content/create-publication";
import type { CapabilityAuthorizationRequest } from "@/domain/authorization/capability-authorization";
import { isUuid } from "@/domain/identifiers/uuid";
import type { CreatePublicationInput } from "@/server/repositories/publication-repository";
import { DrizzlePublicationRepository } from "@/server/repositories/publication-repository";
import type { CampusHubDatabase } from "@/server/db/client";
import { PostgresCapabilityAuthorizer } from "./postgres-capability-authorizer";

export type PostgresAuthorizedPublicationCreateDependencies = Readonly<{
  database: CampusHubDatabase;
  authorizer: PostgresCapabilityAuthorizer;
  /** Test-only gate used after locking and before the final freshness check. */
  beforeInsert?: () => Promise<void>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Commit-time Publication mutation gateway. The authorizer and repository
 * receive the same transaction handle, so a successful preflight result is
 * never reused as a write permit.
 */
export class PostgresAuthorizedPublicationCreateExecutor
  implements AuthorizedPublicationCreateGateway
{
  public constructor(
    private readonly dependencies: PostgresAuthorizedPublicationCreateDependencies,
  ) {}

  public async createAuthorizedPublication(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CreatePublicationInput,
  ): Promise<AtomicPublicationCreateResult> {
    try {
      if (
        !isUuid(tenantId) ||
        !isRecord(request) ||
        !isRecord(request.scope) ||
        request.scope.tenantId !== tenantId
      ) {
        return { outcome: "DENIED", code: "PERMISSION_DENIED" };
      }

      return await this.dependencies.database.transaction(async (transaction) => {
        const decision =
          await this.dependencies.authorizer.authorizePublicationCreateInTransaction(
            transaction,
            request,
            this.dependencies.beforeInsert,
          );
        if (!decision.allowed) {
          return { outcome: "DENIED", code: "PERMISSION_DENIED" } as const;
        }

        const publication = await new DrizzlePublicationRepository().createPublicationInTransaction(
          transaction,
          tenantId,
          input,
        );
        return publication === null
          ? ({ outcome: "DENIED", code: "PERSISTENCE_FAILED" } as const)
          : ({ outcome: "CREATED", publication } as const);
      });
    } catch {
      return { outcome: "DENIED", code: "PERSISTENCE_FAILED" };
    }
  }
}
