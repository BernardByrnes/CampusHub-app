import "server-only";

import { parseAssuranceLevel } from "@/domain/authorization/assurance-level";
import { CAPABILITIES } from "@/domain/authorization/capability";
import {
  isCapabilityAuthorizationDecision,
  type CapabilityAuthorizationRequest,
  type CapabilityAuthorizer,
} from "@/domain/authorization/capability-authorization";
import type { TrustedRequestContext } from "@/domain/authorization/trusted-request-context";
import {
  parseCreatePublicationDraftInput,
  type CanonicalPublicationDraftInput,
} from "@/domain/content/publication-draft";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";
import { isPublication, type Publication } from "@/domain/content/publication";

export type CreatePublicationCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  publication: unknown;
}>;

export const CREATE_PUBLICATION_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_SCOPE_NOT_FOUND",
  "PERMISSION_DENIED",
  "PERSISTENCE_FAILED",
] as const;

export type CreatePublicationDenialCode =
  (typeof CREATE_PUBLICATION_DENIAL_CODES)[number];

export type CreatePublicationResult =
  | Readonly<{ outcome: "CREATED"; publication: Publication }>
  | Readonly<{ outcome: "DENIED"; code: CreatePublicationDenialCode }>;

export type AtomicPublicationCreateResult =
  | Readonly<{ outcome: "CREATED"; publication: Publication }>
  | Readonly<{
      outcome: "DENIED";
      code: "PERMISSION_DENIED" | "PERSISTENCE_FAILED";
    }>;

/**
 * The commit-time authority boundary for privileged Publication creation.
 * A successful preflight decision is never sufficient to call this gateway;
 * the implementation must re-evaluate authority inside the write transaction.
 */
export type AuthorizedPublicationCreateGateway = Readonly<{
  createAuthorizedPublication(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    input: CanonicalPublicationDraftInput,
  ): Promise<AtomicPublicationCreateResult>;
}>;

export type CreatePublicationServiceDependencies = Readonly<{
  capabilityAuthorizer: CapabilityAuthorizer;
  authorizedPublicationCreate: AuthorizedPublicationCreateGateway;
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

function isAtomicPublicationCreateResult(
  value: unknown,
): value is AtomicPublicationCreateResult {
  if (!isRecord(value) || (value.outcome !== "CREATED" && value.outcome !== "DENIED")) {
    return false;
  }

  if (value.outcome === "CREATED") {
    return (
      isPublication(value.publication) &&
      value.publication.version === 1 &&
      value.publication.lifecycle === "draft" &&
      value.publication.publishAt === null
    );
  }

  return (
    value.code === "PERMISSION_DENIED" || value.code === "PERSISTENCE_FAILED"
  );
}

/**
 * Minimal trusted-context seam for a future create route or server action.
 * Matching scope is a necessary boundary check, not permission to create.
 * The preflight capability check is useful for early rejection, but only the
 * transaction-bound gateway may commit the privileged mutation.
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
      !isUuid(input.requestedTenantId)
    ) {
      return denied("INVALID_INPUT");
    }

    const draft = parseCreatePublicationDraftInput(input.publication);
    if (draft === null) {
      return denied("INVALID_INPUT");
    }

    if (input.trustedContext.tenantId !== input.requestedTenantId) {
      return denied("TENANT_SCOPE_NOT_FOUND");
    }

    const authorizationRequest: CapabilityAuthorizationRequest = {
      actor: {
        identitySubjectId: input.trustedContext.identitySubjectId,
        tenantId: input.trustedContext.tenantId,
        membershipId: input.trustedContext.membershipId,
      },
      context: {
        tenantStatus: input.trustedContext.tenantStatus,
        membershipStatus: input.trustedContext.membershipStatus,
        assuranceLevel: input.trustedContext.assuranceLevel,
      },
      capability: CAPABILITIES.PUBLICATION_CREATE,
      scope: {
        tenantId: input.requestedTenantId,
        module: "publication",
        resource: "publication",
      },
    };

    let authorizationDecision: unknown;
    try {
      authorizationDecision =
        await this.dependencies.capabilityAuthorizer.authorize(
          authorizationRequest,
        );
    } catch {
      return denied("PERMISSION_DENIED");
    }

    if (
      !isCapabilityAuthorizationDecision(authorizationDecision) ||
      !authorizationDecision.allowed
    ) {
      return denied("PERMISSION_DENIED");
    }

    try {
      const result =
        await this.dependencies.authorizedPublicationCreate.createAuthorizedPublication(
          authorizationRequest,
          input.requestedTenantId,
          draft,
        );
      if (!isAtomicPublicationCreateResult(result)) {
        return denied("PERSISTENCE_FAILED");
      }

      return result;
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }
}
