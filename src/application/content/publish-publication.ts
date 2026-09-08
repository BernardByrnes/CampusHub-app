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
  parsePublishPublicationInput,
  type PublishPublicationInput,
} from "@/domain/content/publication-publish";
import { isPublication, type Publication } from "@/domain/content/publication";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";

export type PublishPublicationCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  publicationId: string;
  publish: unknown;
}>;

export const PUBLISH_PUBLICATION_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_SCOPE_NOT_FOUND",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "RECONFIRM_REQUIRED",
  "NOT_READY",
  "INVALID_STATE",
  "PERSISTENCE_FAILED",
] as const;

export type PublishPublicationDenialCode =
  (typeof PUBLISH_PUBLICATION_DENIAL_CODES)[number];

export type PublishPublicationResult =
  | Readonly<{ outcome: "PUBLISHED"; publication: Publication }>
  | Readonly<{
      outcome: "DENIED";
      code: PublishPublicationDenialCode;
    }>;

export type AtomicPublicationPublishResult =
  | Readonly<{ outcome: "PUBLISHED"; publication: Publication }>
  | Readonly<{
      outcome: "DENIED";
      code:
        | "PERMISSION_DENIED"
        | "NOT_FOUND"
        | "VERSION_CONFLICT"
        | "RECONFIRM_REQUIRED"
        | "NOT_READY"
        | "INVALID_STATE"
        | "PERSISTENCE_FAILED";
    }>;

export type AuthorizedPublicationPublishGateway = Readonly<{
  publishAuthorizedPublication(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    publicationId: string,
    input: PublishPublicationInput,
  ): Promise<AtomicPublicationPublishResult>;
}>;

export type PublishPublicationServiceDependencies = Readonly<{
  capabilityAuthorizer: CapabilityAuthorizer;
  authorizedPublicationPublish: AuthorizedPublicationPublishGateway;
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

function denied(
  code: PublishPublicationDenialCode,
): PublishPublicationResult {
  return { outcome: "DENIED", code };
}

function isAtomicPublicationPublishResult(
  value: unknown,
  tenantId: string,
  publicationId: string,
  expectedVersion: number,
): value is AtomicPublicationPublishResult {
  if (
    !isRecord(value) ||
    (value.outcome !== "PUBLISHED" && value.outcome !== "DENIED")
  ) {
    return false;
  }

  if (value.outcome === "PUBLISHED") {
    return (
      isPublication(value.publication) &&
      value.publication.id === publicationId &&
      value.publication.tenantId === tenantId &&
      value.publication.version === expectedVersion + 1 &&
      value.publication.lifecycle === "published" &&
      value.publication.publishAt !== null
    );
  }

  return (
    value.code === "PERMISSION_DENIED" ||
    value.code === "NOT_FOUND" ||
    value.code === "VERSION_CONFLICT" ||
    value.code === "RECONFIRM_REQUIRED" ||
    value.code === "NOT_READY" ||
    value.code === "INVALID_STATE" ||
    value.code === "PERSISTENCE_FAILED"
  );
}

/**
 * Trusted-context seam for manual publication. Preflight is advisory; only
 * the transaction-bound gateway may return a published Publication.
 */
export class PublishPublicationService {
  public constructor(
    private readonly dependencies: PublishPublicationServiceDependencies,
  ) {}

  public async publishPublication(
    input: PublishPublicationCommand,
  ): Promise<PublishPublicationResult> {
    if (
      !isRecord(input) ||
      !isTrustedRequestContext(input.trustedContext) ||
      !isUuid(input.requestedTenantId) ||
      !isUuid(input.publicationId)
    ) {
      return denied("INVALID_INPUT");
    }

    const publish = parsePublishPublicationInput(input.publish);
    if (publish === null) {
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
      capability: CAPABILITIES.PUBLICATION_PUBLISH,
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
        await this.dependencies.authorizedPublicationPublish.publishAuthorizedPublication(
          authorizationRequest,
          input.requestedTenantId,
          input.publicationId,
          publish,
        );
      if (
        !isAtomicPublicationPublishResult(
          result,
          input.requestedTenantId,
          input.publicationId,
          publish.expectedVersion,
        )
      ) {
        return denied("PERSISTENCE_FAILED");
      }

      return result;
    } catch {
      return denied("PERSISTENCE_FAILED");
    }
  }
}
