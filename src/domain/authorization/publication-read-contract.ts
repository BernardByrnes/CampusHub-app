import {
  parseTenantLifecycle,
  type TenantLifecycle,
} from "@/domain/tenancy/tenant";

import {
  parseArchiveNoticeState,
  type ArchiveNoticeState,
} from "./resource-read-facts";

/**
 * A server-side content exposure fact. It is deliberately not a browser or
 * transport input: callers must resolve it from an authoritative seam.
 */
export const PUBLICATION_CONTENT_EXPOSURES = [
  "READABLE",
  "SUPPRESSED",
] as const;

export type PublicationContentExposure =
  (typeof PUBLICATION_CONTENT_EXPOSURES)[number];

export function parsePublicationContentExposure(
  value: unknown,
): PublicationContentExposure | null {
  return typeof value === "string" &&
    (PUBLICATION_CONTENT_EXPOSURES as readonly string[]).includes(value)
    ? (value as PublicationContentExposure)
    : null;
}

/**
 * This discriminated result must be produced by a trusted audience seam.
 * There is no unevaluated or ambiguous boolean state.
 */
export type PublicationAudienceDecision = Readonly<{
  evaluated: true;
  eligible: boolean;
}>;

export function isPublicationAudienceDecision(
  value: unknown,
): value is PublicationAudienceDecision {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).evaluated === true &&
    Object.prototype.hasOwnProperty.call(value, "eligible") &&
    typeof (value as Record<string, unknown>).eligible === "boolean"
  );
}

/**
 * Server-resolved Tenant facts consumed by the pure Publication mapper.
 * No browser-provided defaults or operation decisions belong here.
 */
export type ResolvedTenantReadFacts = Readonly<{
  tenantStatus: TenantLifecycle;
  publicSurfacePermitted: boolean;
  onLeaveReadEnabled: boolean;
  alumniPublicReadEnabled: boolean;
  archiveNoticeState?: ArchiveNoticeState;
}>;

export function isResolvedTenantReadFacts(
  value: unknown,
): value is ResolvedTenantReadFacts {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const tenantStatus = parseTenantLifecycle(candidate.tenantStatus);
  const archiveNoticeState = candidate.archiveNoticeState;

  if (
    tenantStatus === null ||
    typeof candidate.publicSurfacePermitted !== "boolean" ||
    typeof candidate.onLeaveReadEnabled !== "boolean" ||
    typeof candidate.alumniPublicReadEnabled !== "boolean"
  ) {
    return false;
  }

  if (
    archiveNoticeState !== undefined &&
    parseArchiveNoticeState(archiveNoticeState) === null
  ) {
    return false;
  }

  return (
    tenantStatus !== "archived" ||
    parseArchiveNoticeState(archiveNoticeState) !== null
  );
}
