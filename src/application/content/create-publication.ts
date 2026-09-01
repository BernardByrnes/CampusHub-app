import "server-only";

import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";
import type { Publication } from "@/domain/content/publication";
import type {
  CreatePublicationInput,
} from "@/server/repositories/publication-repository";

export type CreatePublicationCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  publication: CreatePublicationInput;
}>;

export const CREATE_PUBLICATION_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_SCOPE_NOT_FOUND",
  "PERSISTENCE_FAILED",
] as const;

export type CreatePublicationDenialCode =
  (typeof CREATE_PUBLICATION_DENIAL_CODES)[number];

export type CreatePublicationResult =
  | Readonly<{ outcome: "CREATED"; publication: Publication }>
  | Readonly<{ outcome: "DENIED"; code: CreatePublicationDenialCode }>;

export type CreatePublicationRepository = Readonly<{
  createPublication(
    tenantId: string,
    input: CreatePublicationInput,
  ): Promise<Publication | null>;
}>;

export type CreatePublicationServiceDependencies = Readonly<{
  publications: CreatePublicationRepository;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isTrustedRequestContext(value: unknown): value is TrustedRequestContext {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyString(value.identitySubjectId) &&
    isUuid(value.tenantId) &&
    isUuid(value.membershipId) &&
    parseTenantLifecycle(value.tenantStatus) !== null &&
    parseAssuranceLevel(value.assuranceLevel) !== null &&
    parseMembershipLifecycle(value.membershipStatus) !== null
  );
}

function denied(code: CreatePublicationDenialCode): CreatePublicationResult {
  return { outcome: "DENIED", code };
}

/**
 * Minimal trusted-context seam for a future create route or server action.
 * Matching scope is a necessary boundary check, not permission to create;
 * capability authorization remains a separate future policy decision.
 */
export class CreatePublicationService {
  public constructor(
    private readonly dependencies: CreatePublicationServiceDependencies,
  ) {}

  public async createPublication(
    input: CreatePublicationCommand,
  ): Promise<CreatePublicationResult> {
    if (
      !isRecord(input) ||
      !isTrustedRequestContext(input.trustedContext) ||
      !isUuid(input.requestedTenantId) ||
      !isRecord(input.publication)
    ) {
      return denied("INVALID_INPUT");
    }

    if (input.trustedContext.tenantId !== input.requestedTenantId) {
      return denied("TENANT_SCOPE_NOT_FOUND");
    }

    let publication: Publication | null;
    try {
      publication = await this.dependencies.publications.createPublication(
        input.requestedTenantId,
        input.publication,
      );
    } catch {
      return denied("PERSISTENCE_FAILED");
    }

    return publication === null
      ? denied("PERSISTENCE_FAILED")
      : { outcome: "CREATED", publication };
  }
}
