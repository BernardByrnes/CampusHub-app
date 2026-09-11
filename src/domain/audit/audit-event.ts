import { isUuid } from "@/domain/identifiers/uuid";
import { RESULT_SCORE_MAX } from "@/domain/sports/results";
import type {
  PublicationAudienceDimension,
} from "@/domain/authorization/publication-audience";
import {
  parsePublicationAudienceMode,
  type PublicationAudienceMode,
} from "@/domain/content/publication";
import {
  parseFixtureReason,
  parseFixtureState,
  parseFixtureVenue,
  type FixtureState,
} from "@/domain/sports/fixtures";

export const AUDIT_EVENT_TYPES = [
  "publication.published",
  "sport.created",
  "sport.changed",
  "sport.deactivated",
  "competition.created",
  "competition.changed",
  "competition.deactivated",
  "team.created",
  "team.changed",
  "team.deactivated",
  "fixture.created",
  "fixture.changed",
  "fixture.postponed",
  "fixture.cancelled",
  "fixture.completed",
  "fixture.abandoned",
  "result.draft_created",
  "result.draft_changed",
  "result.published",
  "result.corrected",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_RESOURCE_TYPES = [
  "publication",
  "sport",
  "competition",
  "team",
  "fixture",
  "result",
] as const;
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export const SPORTS_AUDIT_EVENT_TYPES = [
  "sport.created",
  "sport.changed",
  "sport.deactivated",
  "competition.created",
  "competition.changed",
  "competition.deactivated",
  "team.created",
  "team.changed",
  "team.deactivated",
] as const;
export type SportsAuditEventType = (typeof SPORTS_AUDIT_EVENT_TYPES)[number];
export const FIXTURE_AUDIT_EVENT_TYPES = [
  "fixture.created",
  "fixture.changed",
  "fixture.postponed",
  "fixture.cancelled",
  "fixture.completed",
  "fixture.abandoned",
] as const;
export type FixtureAuditEventType = (typeof FIXTURE_AUDIT_EVENT_TYPES)[number];
export const RESULT_AUDIT_EVENT_TYPES = [
  "result.draft_created",
  "result.draft_changed",
  "result.published",
  "result.corrected",
] as const;
export type ResultAuditEventType = (typeof RESULT_AUDIT_EVENT_TYPES)[number];
export type SportsAuditResourceType = "sport" | "competition" | "team";

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

export type SportsAuditEventFacts = Readonly<{
  action: "created" | "changed" | "deactivated";
  name: string;
  status: "active" | "inactive";
  version: number;
  sportId: string | null;
  campusId: string | null;
  tableMode: "none" | "manual" | null;
}>;

export type FixtureAuditEventFacts = Readonly<{
  action: "created" | "changed" | "postponed" | "cancelled" | "completed" | "abandoned";
  state: FixtureState;
  version: number;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  campusId: string;
  startsAt: string;
  venue: string;
  reason: string | null;
}>;

export type ResultAuditEventFacts = Readonly<{
  action: "draft_created" | "draft_changed" | "published" | "corrected";
  lifecycle: "draft" | "published";
  version: number;
  fixtureId: string;
  revisionNumber: number | null;
  homeScore: number;
  awayScore: number;
  correctionReason: string | null;
}>;

export type AuditEvent = Readonly<{
  id: string;
  tenantId: string;
  sequence: number;
  eventType: AuditEventType;
  actorMembershipId: string;
  resourceType: AuditResourceType;
  resourceId: string;
  resourceVersion: number;
  occurredAt: Date;
  eventFacts:
    | PublicationPublishedAuditEventFacts
    | SportsAuditEventFacts
    | FixtureAuditEventFacts
    | ResultAuditEventFacts;
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
  eventType: AuditEventType;
  actorMembershipId: string;
  resourceType: AuditResourceType;
  resourceId: string;
  resourceVersion: number;
  occurredAt: string;
  eventFacts:
    | PublicationPublishedAuditEventFacts
    | SportsAuditEventFacts
    | FixtureAuditEventFacts
    | ResultAuditEventFacts;
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

function isResultScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= RESULT_SCORE_MAX
  );
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

function isSportsAuditEventType(
  value: unknown,
): value is SportsAuditEventType {
  return (
    typeof value === "string" &&
    SPORTS_AUDIT_EVENT_TYPES.includes(value as SportsAuditEventType)
  );
}

function isAuditResourceType(value: unknown): value is AuditResourceType {
  return (
    typeof value === "string" &&
    AUDIT_RESOURCE_TYPES.includes(value as AuditResourceType)
  );
}

function isAuditEventType(value: unknown): value is AuditEventType {
  return (
    typeof value === "string" &&
    AUDIT_EVENT_TYPES.includes(value as AuditEventType)
  );
}

export function normalizeSportsAuditEventFacts(
  value: unknown,
  eventType: SportsAuditEventType,
  resourceType: SportsAuditResourceType,
): SportsAuditEventFacts | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "action",
      "name",
      "status",
      "version",
      "sportId",
      "campusId",
      "tableMode",
    ]) ||
    !isSportsAuditEventType(eventType) ||
    !isAuditResourceType(resourceType)
  ) {
    return null;
  }

  const [expectedResource, expectedAction] = eventType.split(".");
  if (
    expectedResource !== resourceType ||
    value.action !== expectedAction ||
    (value.action !== "created" &&
      value.action !== "changed" &&
      value.action !== "deactivated") ||
    typeof value.name !== "string" ||
    value.name.trim().length === 0 ||
    value.name.length > 120 ||
    (value.status !== "active" && value.status !== "inactive") ||
    !isPositiveInteger(value.version) ||
    (value.action === "created" && value.status !== "active") ||
    (value.action === "deactivated" && value.status !== "inactive") ||
    (value.sportId !== null && !isUuid(value.sportId)) ||
    (value.campusId !== null && !isUuid(value.campusId)) ||
    (value.tableMode !== null &&
      value.tableMode !== "none" &&
      value.tableMode !== "manual")
  ) {
    return null;
  }

  if (resourceType === "sport") {
    if (value.sportId !== null || value.campusId !== null || value.tableMode !== null) {
      return null;
    }
  } else if (resourceType === "competition") {
    if (
      value.sportId === null ||
      value.campusId === null ||
      value.tableMode === null
    ) {
      return null;
    }
  } else if (
    value.sportId === null ||
    value.campusId !== null ||
    value.tableMode !== null
  ) {
    return null;
  }

  return {
    action: value.action,
    name: value.name.trim(),
    status: value.status,
    version: value.version,
    sportId: value.sportId === null ? null : value.sportId.toLowerCase(),
    campusId: value.campusId === null ? null : value.campusId.toLowerCase(),
    tableMode: value.tableMode,
  };
}

export function isSportsAuditEventFacts(
  value: unknown,
  eventType: SportsAuditEventType,
  resourceType: SportsAuditResourceType,
): value is SportsAuditEventFacts {
  return normalizeSportsAuditEventFacts(value, eventType, resourceType) !== null;
}

function isFixtureAuditEventType(
  value: unknown,
): value is FixtureAuditEventType {
  return typeof value === "string" &&
    FIXTURE_AUDIT_EVENT_TYPES.includes(value as FixtureAuditEventType);
}

export function normalizeFixtureAuditEventFacts(
  value: unknown,
  eventType: FixtureAuditEventType,
): FixtureAuditEventFacts | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "action",
      "state",
      "version",
      "competitionId",
      "homeTeamId",
      "awayTeamId",
      "campusId",
      "startsAt",
      "venue",
      "reason",
    ]) ||
    !isFixtureAuditEventType(eventType) ||
    !isUuid(value.competitionId) ||
    !isUuid(value.homeTeamId) ||
    !isUuid(value.awayTeamId) ||
    value.homeTeamId === value.awayTeamId ||
    !isUuid(value.campusId) ||
    parseFixtureState(value.state) === null ||
    !isPositiveInteger(value.version) ||
    !isCanonicalOccurredAt(value.startsAt) ||
    parseFixtureVenue(value.venue) === null ||
    (value.reason !== null && parseFixtureReason(value.reason) === null)
  ) {
    return null;
  }

  const [resource, expectedAction] = eventType.split(".");
  if (resource !== "fixture" || value.action !== expectedAction) {
    return null;
  }
  const state = value.state as FixtureState;
  const action = value.action;
  if (
    (action === "created" && state !== "scheduled") ||
    (action === "changed" && state !== "scheduled" && state !== "postponed") ||
    (action === "postponed" && (state !== "postponed" || value.reason === null)) ||
    (action === "cancelled" && (state !== "cancelled" || value.reason === null)) ||
    (action === "completed" && state !== "completed") ||
    (action === "abandoned" && (state !== "abandoned" || value.reason === null))
  ) {
    return null;
  }

  return {
    action: action as FixtureAuditEventFacts["action"],
    state,
    version: value.version,
    competitionId: value.competitionId.toLowerCase(),
    homeTeamId: value.homeTeamId.toLowerCase(),
    awayTeamId: value.awayTeamId.toLowerCase(),
    campusId: value.campusId.toLowerCase(),
    startsAt: value.startsAt,
    venue: parseFixtureVenue(value.venue) as string,
    reason: value.reason === null ? null : parseFixtureReason(value.reason),
  };
}

export function isFixtureAuditEventFacts(
  value: unknown,
  eventType: FixtureAuditEventType,
): value is FixtureAuditEventFacts {
  return normalizeFixtureAuditEventFacts(value, eventType) !== null;
}

function isResultAuditEventType(
  value: unknown,
): value is ResultAuditEventType {
  return typeof value === "string" &&
    RESULT_AUDIT_EVENT_TYPES.includes(value as ResultAuditEventType);
}

export function normalizeResultAuditEventFacts(
  value: unknown,
  eventType: ResultAuditEventType,
): ResultAuditEventFacts | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "action",
      "lifecycle",
      "version",
      "fixtureId",
      "revisionNumber",
      "homeScore",
      "awayScore",
      "correctionReason",
    ]) ||
    !isResultAuditEventType(eventType) ||
    !isUuid(value.fixtureId) ||
    !isPositiveInteger(value.version) ||
    (value.lifecycle !== "draft" && value.lifecycle !== "published") ||
    !isResultScore(value.homeScore) ||
    !isResultScore(value.awayScore) ||
    (value.revisionNumber !== null &&
      !isPositiveInteger(value.revisionNumber)) ||
    (value.correctionReason !== null &&
      (typeof value.correctionReason !== "string" ||
        value.correctionReason.trim().length === 0 ||
        value.correctionReason.length > 500))
  ) {
    return null;
  }

  const [resource, expectedAction] = eventType.split(".");
  if (resource !== "result" || value.action !== expectedAction) {
    return null;
  }

  const action = value.action as ResultAuditEventFacts["action"];
  if (
    (action === "draft_created" || action === "draft_changed") &&
    (value.lifecycle !== "draft" || value.revisionNumber !== null || value.correctionReason !== null)
  ) {
    return null;
  }
  if (
    action === "published" &&
    (value.lifecycle !== "published" || value.revisionNumber !== 1 || value.correctionReason !== null)
  ) {
    return null;
  }
  if (
    action === "corrected" &&
    (value.lifecycle !== "published" ||
      value.revisionNumber === null ||
      value.revisionNumber < 2 ||
      typeof value.correctionReason !== "string")
  ) {
    return null;
  }

  return {
    action,
    lifecycle: value.lifecycle,
    version: value.version,
    fixtureId: value.fixtureId.toLowerCase(),
    revisionNumber: value.revisionNumber,
    homeScore: value.homeScore,
    awayScore: value.awayScore,
    correctionReason:
      value.correctionReason === null ? null : value.correctionReason.trim(),
  };
}

export function isResultAuditEventFacts(
  value: unknown,
  eventType: ResultAuditEventType,
): value is ResultAuditEventFacts {
  return normalizeResultAuditEventFacts(value, eventType) !== null;
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
    !isAuditEventType(value.eventType) ||
    !isUuid(value.actorMembershipId) ||
    !isAuditResourceType(value.resourceType) ||
    !isUuid(value.resourceId) ||
    !isPositiveInteger(value.resourceVersion) ||
    !isCanonicalOccurredAt(value.occurredAt) ||
    !isHash(value.previousHash) ||
    !isPositiveInteger(value.keyVersion)
  ) {
    return null;
  }

  const eventFacts =
    value.eventType === "publication.published" &&
    value.resourceType === "publication"
      ? normalizePublicationPublishedAuditEventFacts(value.eventFacts)
      : isSportsAuditEventType(value.eventType) &&
          (value.resourceType === "sport" ||
            value.resourceType === "competition" ||
            value.resourceType === "team")
        ? normalizeSportsAuditEventFacts(
            value.eventFacts,
            value.eventType,
          value.resourceType,
          )
        : isFixtureAuditEventType(value.eventType) &&
            value.resourceType === "fixture"
        ? normalizeFixtureAuditEventFacts(value.eventFacts, value.eventType)
          : isResultAuditEventType(value.eventType) &&
              value.resourceType === "result"
            ? normalizeResultAuditEventFacts(value.eventFacts, value.eventType)
        : null;
  if (eventFacts === null) {
    return null;
  }

  return {
    integrityFormatVersion: AUDIT_INTEGRITY_FORMAT_VERSION,
    eventContractVersion: AUDIT_EVENT_CONTRACT_VERSION,
    tenantId: value.tenantId.toLowerCase(),
    sequence: value.sequence,
    eventId: value.eventId.toLowerCase(),
    eventType: value.eventType,
    actorMembershipId: value.actorMembershipId.toLowerCase(),
    resourceType: value.resourceType,
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
