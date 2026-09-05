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
  parseUpdatePublicationDraftInput,
  type UpdatePublicationDraftInput,
} from "@/domain/content/publication-draft-edit";
import { isPublication, type Publication } from "@/domain/content/publication";
import { isUuid } from "@/domain/identifiers/uuid";
import { parseMembershipLifecycle } from "@/domain/membership/membership";
import { parseTenantLifecycle } from "@/domain/tenancy/tenant";

export type EditPublicationDraftCommand = Readonly<{
  trustedContext: TrustedRequestContext;
  requestedTenantId: string;
  publicationId: string;
  edit: unknown;
}>;

export const EDIT_PUBLICATION_DRAFT_DENIAL_CODES = [
  "INVALID_INPUT",
  "TENANT_SCOPE_NOT_FOUND",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_STATE",
  "PERSISTENCE_FAILED",
] as const;

export type EditPublicationDraftDenialCode =
  (typeof EDIT_PUBLICATION_DRAFT_DENIAL_CODES)[number];

export type EditPublicationDraftResult =
  | Readonly<{ outcome: "UPDATED"; publication: Publication }>
  | Readonly<{
      outcome: "DENIED";
      code: EditPublicationDraftDenialCode;
    }>;

export type AtomicPublicationDraftEditResult =
  | Readonly<{ outcome: "UPDATED"; publication: Publication }>
  | Readonly<{
      outcome: "DENIED";
      code:
        | "PERMISSION_DENIED"
        | "NOT_FOUND"
        | "VERSION_CONFLICT"
        | "INVALID_STATE"
        | "PERSISTENCE_FAILED";
    }>;

export type AuthorizedPublicationDraftEditGateway = Readonly<{
  editAuthorizedPublication(
    request: CapabilityAuthorizationRequest,
    tenantId: string,
    publicationId: string,
    input: UpdatePublicationDraftInput,
  ): Promise<AtomicPublicationDraftEditResult>;
}>;

export type EditPublicationDraftServiceDependencies = Readonly<{
  capabilityAuthorizer: CapabilityAuthorizer;
  authorizedPublicationDraftEdit: AuthorizedPublicationDraftEditGateway;
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
  code: EditPublicationDraftDenialCode,
): EditPublicationDraftResult {
  return { outcome: "DENIED", code };
}

function isAtomicPublicationDraftEditResult(
  value: unknown,
  tenantId: string,
  publicationId: string,
  expectedVersion: number,
): value is AtomicPublicationDraftEditResult {
  if (!isRecord(value) || (value.outcome !== "UPDATED" && value.outcome !== "DENIED")) {
    return false;
  }

  if (value.outcome === "UPDATED") {
    return (
      isPublication(value.publication) &&
      value.publication.id === publicationId &&
      value.publication.tenantId === tenantId &&
      value.publication.version === expectedVersion + 1 &&
      value.publication.lifecycle === "draft" &&
      value.publication.publishAt === null
    );
  }

  return (
    value.code === "PERMISSION_DENIED" ||
    value.code === "NOT_FOUND" ||
    value.code === "VERSION_CONFLICT" ||
    value.code === "INVALID_STATE" ||
    value.code === "PERSISTENCE_FAILED"
  );
}

/**
 * Trusted-context seam for draft editing. Preflight is advisory; only the
 * transaction-bound edit gateway can return an updated Publication.
 */
export class EditPublicationDraftService {
  public constructor(
    private readonly dependencies: EditPublicationDraftServiceDependencies,
  ) {}

  public async editPublicationDraft(
    input: EditPublicationDraftCommand,
  ): Promise<EditPublicationDraftResult> {
    if (
      !isRecord(input) ||
      !isTrustedRequestContext(input.trustedContext) ||
      !isUuid(input.requestedTenantId) ||
      !isUuid(input.publicationId)
    ) {
      return denied("INVALID_INPUT");
    }

    const edit = parseUpdatePublicationDraftInput(input.edit);
    if (edit === null) {
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
      capability: CAPABILITIES.PUBLICATION_EDIT,
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
        await this.dependencies.authorizedPublicationDraftEdit.editAuthorizedPublication(
          authorizationRequest,
          input.requestedTenantId,
          input.publicationId,
          edit,
        );
      if (
        !isAtomicPublicationDraftEditResult(
          result,
          input.requestedTenantId,
          input.publicationId,
          edit.expectedVersion,
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
