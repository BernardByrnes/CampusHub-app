import { isUuid } from "@/domain/identifiers/uuid";
import type {
  PublicationAudienceDimension,
} from "@/domain/authorization/publication-audience";
import {
  parsePublicationAudienceMode,
  type PublicationAudienceMode,
} from "@/domain/content/publication";

export const AUDIT_EVENT_TYPES = ["publication.published"] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_INTEGRITY_FORMAT_VERSION = 1 as const;
export const AUDIT_EVENT_CONTRACT_VERSION = 1 as const;
export const AUDIT_GENESIS_HASH = "0".repeat(64);

export type PublicationPublishedAuditTarget = Readonly<{
  dimension: PublicationAudienceDimension;
  targetId: string | null;
  targetValue: number | string | null;
  targetLabel: string | null;
}>;

export type PublicationPublishedAuditAudienceSnapshot = Readonly<{
  mode: PublicationAudienceMode;
  targets: readonly PublicationPublishedAuditTarget[];
}>;

export type PublicationPublishedAuditEventFacts = Readonly<{
  transition: Readonly<{ from: "draft"; to: "published" }>;
  audienceMode: PublicationAudienceMode;
  confirmedRecipientCount: number;
  audienceSnapshot: PublicationPublishedAuditAudienceSnapshot;
}>;

export type AuditEvent = Readonly<{
  id: string;
  tenantId: string;
  sequence: number;
  eventType: "publication.published";
  actorMembershipId: string;
  resourceType: "publication";
  resourceId: string;
  resourceVersion: number;
  occurredAt: Date;
  eventFacts: PublicationPublishedAuditEventFacts;
  previousHash: string;
  currentHash: string;
  keyVersion: number;
  integrityFormatVersion: 1;
  eventContractVersion: 1;
}>;

export type AuditIntegrityEnvelopeV1 = Readonly<{
  integrityFormatVersion: 1;
  eventContractVersion: 1;
  tenantId: string;
  sequence: number;
  eventId: string;
  eventType: "publication.published";
  actorMembershipId: string;
  resourceType: "publication";
  resourceId: string;
  resourceVersion: number;
  occurredAt: string;
  eventFacts: PublicationPublishedAuditEventFacts;
  previousHash: string;
  keyVersion: number;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === allowed.size && actual.every((key) => allowed.has(key));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isCanonicalOccurredAt(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function normalizeTarget(
  value: unknown,
): PublicationPublishedAuditTarget | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["dimension", "targetId", "targetValue", "targetLabel"])
  ) {
    return null;
  }

  const dimension = value.dimension;
  const targetId = value.targetId;
  const targetValue = value.targetValue;
  const targetLabel = value.targetLabel;

  if (typeof targetLabel !== "string" && targetLabel !== null) {
    return null;
  }
  if (typeof targetLabel === "string" && targetLabel.trim().length === 0) {
    return null;
  }

  if (
    dimension === "campus" ||
    dimension === "academic_division" ||
    dimension === "programme"
  ) {
    if (!isUuid(targetId) || targetValue !== null || targetLabel === null) {
      return null;
    }
    return {
      dimension,
      targetId: targetId.toLowerCase(),
      targetValue: null,
      targetLabel,
    };
  }

  if (dimension === "academic_year") {
    if (targetId !== null || !isPositiveInteger(targetValue)) {
      return null;
    }
    return {
      dimension,
      targetId: null,
      targetValue,
      targetLabel,
    };
  }

  if (dimension === "residence") {
    if (targetValue === "specific_residence") {
      if (!isUuid(targetId) || targetLabel === null) {
        return null;
      }
      return {
        dimension,
        targetId: targetId.toLowerCase(),
        targetValue,
        targetLabel,
      };
    }

    if (
      (targetValue === "any_resident" || targetValue === "non_resident") &&
      targetId === null &&
      targetLabel === null
    ) {
      return { dimension, targetId: null, targetValue, targetLabel: null };
    }
  }

  return null;
}

function targetSortKey(target: PublicationPublishedAuditTarget): string {
  return [
    target.dimension,
    target.targetId ?? "",
    typeof target.targetValue === "number"
      ? `number:${target.targetValue}`
      : `string:${target.targetValue ?? ""}`,
  ].join("\u0000");
}

export function normalizePublicationPublishedAuditEventFacts(
  value: unknown,
): PublicationPublishedAuditEventFacts | null {
  const audienceMode =
    isRecord(value) ? parsePublicationAudienceMode(value.audienceMode) : null;
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "transition",
      "audienceMode",
      "confirmedRecipientCount",
      "audienceSnapshot",
    ]) ||
    !isRecord(value.transition) ||
    !hasOnlyKeys(value.transition, ["from", "to"]) ||
    value.transition.from !== "draft" ||
    value.transition.to !== "published" ||
    audienceMode === null ||
    !isNonNegativeInteger(value.confirmedRecipientCount) ||
    !isRecord(value.audienceSnapshot) ||
    !hasOnlyKeys(value.audienceSnapshot, ["mode", "targets"]) ||
    value.audienceSnapshot.mode !== audienceMode ||
    !Array.isArray(value.audienceSnapshot.targets)
  ) {
    return null;
  }

  const targets = value.audienceSnapshot.targets.flatMap((candidate) => {
    const normalized = normalizeTarget(candidate);
    return normalized === null ? [] : [normalized];
  });
  if (targets.length !== value.audienceSnapshot.targets.length) {
    return null;
  }

  const keys = targets.map(targetSortKey);
  if (new Set(keys).size !== keys.length) {
    return null;
  }

  if (audienceMode === "entire_tenant" && targets.length !== 0) {
    return null;
  }
  if (audienceMode === "targeted" && targets.length === 0) {
    return null;
  }

  return {
    transition: { from: "draft", to: "published" },
    audienceMode,
    confirmedRecipientCount: value.confirmedRecipientCount,
    audienceSnapshot: {
      mode: audienceMode,
      targets: [...targets].sort((left, right) =>
        targetSortKey(left).localeCompare(targetSortKey(right)),
      ),
    },
  };
}

export function isPublicationPublishedAuditEventFacts(
  value: unknown,
): value is PublicationPublishedAuditEventFacts {
  return normalizePublicationPublishedAuditEventFacts(value) !== null;
}

export function normalizeAuditIntegrityEnvelope(
  value: unknown,
): AuditIntegrityEnvelopeV1 | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "integrityFormatVersion",
      "eventContractVersion",
      "tenantId",
      "sequence",
      "eventId",
      "eventType",
      "actorMembershipId",
      "resourceType",
      "resourceId",
      "resourceVersion",
      "occurredAt",
      "eventFacts",
      "previousHash",
      "keyVersion",
    ]) ||
    value.integrityFormatVersion !== AUDIT_INTEGRITY_FORMAT_VERSION ||
    value.eventContractVersion !== AUDIT_EVENT_CONTRACT_VERSION ||
    !isUuid(value.tenantId) ||
    !isPositiveInteger(value.sequence) ||
    !isUuid(value.eventId) ||
    value.eventType !== "publication.published" ||
    !isUuid(value.actorMembershipId) ||
    value.resourceType !== "publication" ||
    !isUuid(value.resourceId) ||
    !isPositiveInteger(value.resourceVersion) ||
    !isCanonicalOccurredAt(value.occurredAt) ||
    !isHash(value.previousHash) ||
    !isPositiveInteger(value.keyVersion)
  ) {
    return null;
  }

  const eventFacts = normalizePublicationPublishedAuditEventFacts(
    value.eventFacts,
  );
  if (eventFacts === null) {
    return null;
  }

  return {
    integrityFormatVersion: AUDIT_INTEGRITY_FORMAT_VERSION,
    eventContractVersion: AUDIT_EVENT_CONTRACT_VERSION,
    tenantId: value.tenantId.toLowerCase(),
    sequence: value.sequence,
    eventId: value.eventId.toLowerCase(),
    eventType: "publication.published",
    actorMembershipId: value.actorMembershipId.toLowerCase(),
    resourceType: "publication",
    resourceId: value.resourceId.toLowerCase(),
    resourceVersion: value.resourceVersion,
    occurredAt: value.occurredAt,
    eventFacts,
    previousHash: value.previousHash,
    keyVersion: value.keyVersion,
  };
}

function canonicalJsonValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Audit canonical JSON accepts safe integers only.");
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (
      Object.getPrototypeOf(record) !== Object.prototype &&
      Object.getPrototypeOf(record) !== null
    ) {
      throw new Error("Audit canonical JSON rejects non-plain objects.");
    }
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("Audit canonical JSON rejects unsupported values.");
}

export function canonicalizeAuditIntegrityEnvelope(
  value: unknown,
): string {
  const normalized = normalizeAuditIntegrityEnvelope(value);
  if (normalized === null) {
    throw new Error("Invalid AuditEvent integrity envelope.");
  }
  return canonicalJsonValue(normalized);
}
