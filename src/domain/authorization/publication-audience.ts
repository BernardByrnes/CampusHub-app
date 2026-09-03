import "server-only";

import {
  parsePublicationAudienceMode,
  type PublicationAudienceMode,
} from "@/domain/content/publication";
import {
  isMembershipAudienceFacts,
  type MembershipAudienceAttribute,
  type MembershipAudienceFacts,
  type MembershipResidenceAudienceFact,
  type ProfileFieldProvenance,
} from "@/domain/membership/membership-audience";
import { isUuid } from "@/domain/identifiers/uuid";

import type { PublicationAudienceDecision } from "./publication-read-contract";
import {
  PUBLICATION_AUDIENCE_DIMENSIONS,
  PUBLICATION_AUDIENCE_PROVENANCE_POLICIES,
  PUBLICATION_RESIDENCE_TARGETS,
} from "./publication-audience-vocabulary";
import type {
  PublicationAudienceDimension,
  PublicationAudienceProvenancePolicy,
} from "./publication-audience-vocabulary";

export {
  PUBLICATION_AUDIENCE_DIMENSIONS,
  PUBLICATION_AUDIENCE_PROVENANCE_POLICIES,
  PUBLICATION_RESIDENCE_TARGETS,
};
export type {
  PublicationAudienceDimension,
  PublicationAudienceProvenancePolicy,
};

export function parsePublicationAudienceProvenancePolicy(
  value: unknown,
): PublicationAudienceProvenancePolicy | null {
  return typeof value === "string" &&
    (
      PUBLICATION_AUDIENCE_PROVENANCE_POLICIES as readonly string[]
    ).includes(value)
    ? (value as PublicationAudienceProvenancePolicy)
    : null;
}

export function isPublicationAudienceProvenancePolicy(
  value: unknown,
): value is PublicationAudienceProvenancePolicy {
  return parsePublicationAudienceProvenancePolicy(value) !== null;
}

export type PublicationResidenceTarget =
  | Readonly<{ kind: "specific_residence"; residenceId: string }>
  | Readonly<{ kind: "any_resident" }>
  | Readonly<{ kind: "non_resident" }>;

export type CampusAudienceGroup = Readonly<{
  dimension: "campus";
  provenancePolicy: PublicationAudienceProvenancePolicy;
  campusIds: readonly string[];
}>;

export type AcademicDivisionAudienceGroup = Readonly<{
  dimension: "academic_division";
  provenancePolicy: PublicationAudienceProvenancePolicy;
  academicDivisionIds: readonly string[];
}>;

export type ProgrammeAudienceGroup = Readonly<{
  dimension: "programme";
  provenancePolicy: PublicationAudienceProvenancePolicy;
  programmeIds: readonly string[];
}>;

export type AcademicYearAudienceGroup = Readonly<{
  dimension: "academic_year";
  provenancePolicy: PublicationAudienceProvenancePolicy;
  academicYears: readonly number[];
}>;

export type ResidenceAudienceGroup = Readonly<{
  dimension: "residence";
  provenancePolicy: PublicationAudienceProvenancePolicy;
  residenceTargets: readonly PublicationResidenceTarget[];
}>;

export type PublicationAudienceGroup =
  | CampusAudienceGroup
  | AcademicDivisionAudienceGroup
  | ProgrammeAudienceGroup
  | AcademicYearAudienceGroup
  | ResidenceAudienceGroup;

/**
 * Canonical Pilot audience definition. Groups are the boolean structure:
 * dimensions are ANDed and values inside one group are ORed.
 */
export type PublicationAudienceDefinition = Readonly<{
  publicationId: string;
  tenantId: string;
  mode: PublicationAudienceMode;
  groups: readonly PublicationAudienceGroup[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function hasNoDuplicates(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

function isPolicy(value: unknown): value is PublicationAudienceProvenancePolicy {
  return isPublicationAudienceProvenancePolicy(value);
}

function isUuidArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    hasNoDuplicates(value) &&
    value.every((candidate) => isUuid(candidate))
  );
}

function isPositiveIntegerArray(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    hasNoDuplicates(value) &&
    value.every((candidate) => isPositiveInteger(candidate))
  );
}

function isResidenceTarget(value: unknown): value is PublicationResidenceTarget {
  if (!isRecord(value) || !hasOwn(value, "kind")) {
    return false;
  }

  if (value.kind === "specific_residence") {
    return (
      hasOnlyKeys(value, ["kind", "residenceId"]) &&
      hasOwn(value, "residenceId") &&
      isUuid(value.residenceId)
    );
  }

  return (
    (value.kind === "any_resident" || value.kind === "non_resident") &&
    hasOnlyKeys(value, ["kind"])
  );
}

function residenceTargetKey(target: PublicationResidenceTarget): string {
  return target.kind === "specific_residence"
    ? `${target.kind}:${target.residenceId}`
    : target.kind;
}

function isResidenceTargetArray(
  value: unknown,
): value is readonly PublicationResidenceTarget[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  const targets = value.filter(isResidenceTarget);
  return (
    targets.length === value.length &&
    new Set(targets.map(residenceTargetKey)).size === targets.length
  );
}

function isGroup(value: unknown): value is PublicationAudienceGroup {
  if (
    !isRecord(value) ||
    !hasOwn(value, "dimension") ||
    !hasOwn(value, "provenancePolicy") ||
    !isPolicy(value.provenancePolicy)
  ) {
    return false;
  }

  switch (value.dimension) {
    case "campus":
      return (
        hasOnlyKeys(value, ["dimension", "provenancePolicy", "campusIds"]) &&
        hasOwn(value, "campusIds") &&
        isUuidArray(value.campusIds)
      );
    case "academic_division":
      return (
        hasOnlyKeys(value, [
          "dimension",
          "provenancePolicy",
          "academicDivisionIds",
        ]) &&
        hasOwn(value, "academicDivisionIds") &&
        isUuidArray(value.academicDivisionIds)
      );
    case "programme":
      return (
        hasOnlyKeys(value, ["dimension", "provenancePolicy", "programmeIds"]) &&
        hasOwn(value, "programmeIds") &&
        isUuidArray(value.programmeIds)
      );
    case "academic_year":
      return (
        hasOnlyKeys(value, ["dimension", "provenancePolicy", "academicYears"]) &&
        hasOwn(value, "academicYears") &&
        isPositiveIntegerArray(value.academicYears)
      );
    case "residence":
      return (
        hasOnlyKeys(value, ["dimension", "provenancePolicy", "residenceTargets"]) &&
        hasOwn(value, "residenceTargets") &&
        isResidenceTargetArray(value.residenceTargets)
      );
    default:
      return false;
  }
}

/**
 * Validates the canonical group form, including one group per dimension and
 * deterministic duplicate rejection. No invalid group is ignored.
 */
export function isPublicationAudienceDefinition(
  value: unknown,
): value is PublicationAudienceDefinition {
  if (
    !isRecord(value) ||
    !hasOwn(value, "publicationId") ||
    !hasOwn(value, "tenantId") ||
    !hasOwn(value, "mode") ||
    !hasOwn(value, "groups") ||
    !isUuid(value.publicationId) ||
    !isUuid(value.tenantId) ||
    parsePublicationAudienceMode(value.mode) === null ||
    !Array.isArray(value.groups) ||
    !value.groups.every(isGroup)
  ) {
    return false;
  }

  const dimensions = value.groups.map((group) => group.dimension);
  if (new Set(dimensions).size !== dimensions.length) {
    return false;
  }

  return value.mode === "entire_tenant"
    ? value.groups.length === 0
    : value.groups.length > 0;
}

function provenancePermitted(
  provenance: ProfileFieldProvenance,
  policy: PublicationAudienceProvenancePolicy,
): boolean {
  if (provenance === "optional") {
    return false;
  }

  return policy === "allow_self_declared" || provenance !== "self_declared";
}

function matchesAttribute<T>(
  attribute: MembershipAudienceAttribute<T> | undefined,
  targetMatches: (value: T) => boolean,
  policy: PublicationAudienceProvenancePolicy,
): boolean {
  return (
    attribute !== undefined &&
    attribute.value !== null &&
    provenancePermitted(attribute.provenance, policy) &&
    targetMatches(attribute.value)
  );
}

function matchesResidence(
  residence: MembershipResidenceAudienceFact,
  target: PublicationResidenceTarget,
  policy: PublicationAudienceProvenancePolicy,
): boolean {
  if (
    !provenancePermitted(residence.provenance, policy) ||
    residence.state === "unknown"
  ) {
    return false;
  }

  if (target.kind === "any_resident") {
    return residence.state === "resident";
  }

  if (target.kind === "non_resident") {
    return residence.state === "non_resident";
  }

  return (
    residence.state === "resident" &&
    residence.residenceId === target.residenceId
  );
}

function matchesGroup(
  group: PublicationAudienceGroup,
  facts: MembershipAudienceFacts,
): boolean {
  switch (group.dimension) {
    case "campus":
      return matchesAttribute(
        facts.campus,
        (value) => group.campusIds.includes(value),
        group.provenancePolicy,
      );
    case "academic_division":
      return matchesAttribute(
        facts.academicDivision,
        (value) => group.academicDivisionIds.includes(value),
        group.provenancePolicy,
      );
    case "programme":
      return matchesAttribute(
        facts.programme,
        (value) => group.programmeIds.includes(value),
        group.provenancePolicy,
      );
    case "academic_year":
      return matchesAttribute(
        facts.academicYear,
        (value) => group.academicYears.includes(value),
        group.provenancePolicy,
      );
    case "residence":
      return group.residenceTargets.some((target) =>
        matchesResidence(facts.residence, target, group.provenancePolicy),
      );
  }
}

/**
 * Pure server-domain audience evaluation. It performs no I/O, clock lookup,
 * persistence, mutation, or browser/client decision handling.
 */
export function evaluatePublicationAudience(
  definition: unknown,
  membershipFacts: unknown,
): PublicationAudienceDecision {
  if (!isPublicationAudienceDefinition(definition)) {
    return { evaluated: true, eligible: false };
  }

  if (definition.mode === "entire_tenant") {
    if (membershipFacts === undefined || membershipFacts === null) {
      return { evaluated: true, eligible: true };
    }

    if (!isMembershipAudienceFacts(membershipFacts)) {
      return { evaluated: true, eligible: false };
    }

    return {
      evaluated: true,
      eligible: membershipFacts.tenantId === definition.tenantId,
    };
  }

  if (!isMembershipAudienceFacts(membershipFacts)) {
    return { evaluated: true, eligible: false };
  }

  if (membershipFacts.tenantId !== definition.tenantId) {
    return { evaluated: true, eligible: false };
  }

  return {
    evaluated: true,
    eligible: definition.groups.every((group) =>
      matchesGroup(group, membershipFacts),
    ),
  };
}
