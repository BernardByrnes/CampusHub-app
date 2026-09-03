import "server-only";

import { isUuid } from "@/domain/identifiers/uuid";

export const PROFILE_FIELD_PROVENANCES = [
  "institution_verified",
  "roster_derived",
  "self_declared",
  "optional",
] as const;

export type ProfileFieldProvenance =
  (typeof PROFILE_FIELD_PROVENANCES)[number];

export type EvidencedProfileFieldProvenance = Exclude<
  ProfileFieldProvenance,
  "optional"
>;

export function parseProfileFieldProvenance(
  value: unknown,
): ProfileFieldProvenance | null {
  return typeof value === "string" &&
    (PROFILE_FIELD_PROVENANCES as readonly string[]).includes(value)
    ? (value as ProfileFieldProvenance)
    : null;
}

export function isProfileFieldProvenance(
  value: unknown,
): value is ProfileFieldProvenance {
  return parseProfileFieldProvenance(value) !== null;
}

/**
 * A nullable value retains its per-field provenance. Optional attributes may
 * also be omitted from MembershipAudienceFacts; when present, a missing value
 * is represented as { value: null, provenance: "optional" } rather than by an
 * ambiguous null alone.
 */
export type MembershipAudienceAttribute<T> = Readonly<{
  value: T | null;
  provenance: ProfileFieldProvenance;
}>;

export const MEMBERSHIP_RESIDENCE_STATES = [
  "unknown",
  "non_resident",
  "resident",
] as const;

export type MembershipResidenceState =
  (typeof MEMBERSHIP_RESIDENCE_STATES)[number];

export type MembershipResidenceAudienceFact = Readonly<{
  state: MembershipResidenceState;
  residenceId: string | null;
  provenance: ProfileFieldProvenance;
}>;

/**
 * Trusted, server-resolved facts used by the Publication audience evaluator.
 * This contract deliberately does not change the persisted Membership model.
 */
export type MembershipAudienceFacts = Readonly<{
  membershipId: string;
  tenantId: string;
  campus: MembershipAudienceAttribute<string>;
  academicDivision?: MembershipAudienceAttribute<string>;
  programme?: MembershipAudienceAttribute<string>;
  academicYear?: MembershipAudienceAttribute<number>;
  residence: MembershipResidenceAudienceFact;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isEvidencedProvenance(
  value: unknown,
): value is EvidencedProfileFieldProvenance {
  return (
    value === "institution_verified" ||
    value === "roster_derived" ||
    value === "self_declared"
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isAttribute<T>(
  value: unknown,
  valueGuard: (candidate: unknown) => candidate is T,
  required: boolean,
): value is MembershipAudienceAttribute<T> {
  if (!isRecord(value) || !hasOwn(value, "value") || !hasOwn(value, "provenance")) {
    return false;
  }

  const provenance = parseProfileFieldProvenance(value.provenance);
  if (provenance === null) {
    return false;
  }

  if (value.value === null) {
    return !required && provenance === "optional";
  }

  return (
    valueGuard(value.value) &&
    isEvidencedProvenance(provenance)
  );
}

function isUuidAttribute(
  value: unknown,
  required: boolean,
): value is MembershipAudienceAttribute<string> {
  return isAttribute(value, isUuid, required);
}

function isAcademicYearAttribute(
  value: unknown,
): value is MembershipAudienceAttribute<number> {
  return isAttribute(value, isPositiveInteger, false);
}

function isResidenceFact(
  value: unknown,
): value is MembershipResidenceAudienceFact {
  if (
    !isRecord(value) ||
    !hasOwn(value, "state") ||
    !hasOwn(value, "residenceId") ||
    !hasOwn(value, "provenance") ||
    !MEMBERSHIP_RESIDENCE_STATES.includes(
      value.state as MembershipResidenceState,
    )
  ) {
    return false;
  }

  const provenance = parseProfileFieldProvenance(value.provenance);
  if (provenance === null) {
    return false;
  }

  if (value.state === "unknown") {
    return value.residenceId === null && provenance === "optional";
  }

  if (value.state === "non_resident") {
    return value.residenceId === null && isEvidencedProvenance(provenance);
  }

  return (
    value.state === "resident" &&
    isUuid(value.residenceId) &&
    isEvidencedProvenance(provenance)
  );
}

/**
 * Runtime guard for the server-owned Membership audience fact snapshot.
 * Unknown provenance, malformed IDs, invalid years, and ambiguous residence
 * states are rejected rather than interpreted.
 */
export function isMembershipAudienceFacts(
  value: unknown,
): value is MembershipAudienceFacts {
  if (
    !isRecord(value) ||
    !hasOwn(value, "membershipId") ||
    !hasOwn(value, "tenantId") ||
    !hasOwn(value, "campus") ||
    !hasOwn(value, "residence")
  ) {
    return false;
  }

  return (
    isUuid(value.membershipId) &&
    isUuid(value.tenantId) &&
    isUuidAttribute(value.campus, true) &&
    (!hasOwn(value, "academicDivision") ||
      isUuidAttribute(value.academicDivision, false)) &&
    (!hasOwn(value, "programme") || isUuidAttribute(value.programme, false)) &&
    (!hasOwn(value, "academicYear") ||
      isAcademicYearAttribute(value.academicYear)) &&
    isResidenceFact(value.residence)
  );
}
