import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  isEvent,
  isEventPast,
  isMaterialEventChange,
  parseEventDescription,
  parseEventTitle,
  parseEventVenue,
  parseEventReason,
  type CreateEventInput,
  type Event,
  type EventLifecycleHistory,
  type PostponeEventInput,
  type RepublishEventInput,
  type CancelEventInput,
  type PublishEventInput,
  type UpdateEventInput,
} from "@/domain/events/events";
import { isOrganiser, type Organiser } from "@/domain/organisers/organisers";
import {
  isEventAudienceDefinition,
  type EventAudienceDefinition,
  type PublicationAudienceGroup,
  type PublicationResidenceTarget,
} from "@/domain/events/event-audience";
import { isUuid } from "@/domain/identifiers/uuid";
import { parsePublicationAudienceProvenancePolicy } from "@/domain/authorization/publication-audience";
import { db, type CampusHubDatabase } from "@/server/db/client";
import {
  academicDivisions,
  campuses,
  eventAudienceCriteria,
  events,
  programmes,
  residences,
  organisers,
  eventLifecycleHistory,
  tenantAcademicYearConfig,
  type EventAudienceCriteriaRow,
  type EventRow,
  type EventLifecycleHistoryRow,
} from "@/server/db/schema";

export type EventRecord = Readonly<{
  event: Event;
  audience: EventAudienceDefinition;
  organiser: Organiser | null;
  history: readonly EventLifecycleHistory[];
}>;

export type EventMutationError =
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_STATE"
  | "NOT_READY"
  | "PERSISTENCE_FAILED";

export type EventMutationResult =
  | Readonly<{ ok: true; record: EventRecord; changed: boolean }>
  | Readonly<{ ok: false; error: EventMutationError }>;

export type EventRepositoryTransactionDatabase = Pick<
  CampusHubDatabase,
  "select" | "insert" | "update" | "delete"
>;

export type PreparedCreateEvent = Readonly<{
  eventId: string;
  audience: EventAudienceDefinition;
  organiser: Organiser | null;
}>;

export type PreparedEventMutation = Readonly<{
  event: Event;
  currentAudience: EventAudienceDefinition;
  audience: EventAudienceDefinition;
  organiser: Organiser | null;
  history: readonly EventLifecycleHistory[];
  hasCommittedPostponement: boolean;
  latestPostponedFromStartsAt: Date | null;
}>;

export type EventListOptions = Readonly<{
  now: Date;
  surface?: "home" | "discover";
  campusId?: string;
  visibility?: "PUBLIC" | "MEMBERS" | "VERIFIED_MEMBERS";
  includePast?: boolean;
  limit?: number;
}>;

export type EventLifecycleHistoryAppendInput = Readonly<{
  tenantId: string;
  eventId: string;
  sequence: number;
  eventVersion: number;
  fromLifecycle: EventLifecycleHistory["fromLifecycle"];
  toLifecycle: EventLifecycleHistory["toLifecycle"];
  startsAt: Date;
  endsAt: Date | null;
  postponedFromStartsAt: Date | null;
  reason: string | null;
  cancellationRetentionUntil: Date | null;
  occurredAt: Date;
}>;

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function toEvent(row: EventRow): Event | null {
  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    version: row.version,
    title: row.title,
    description: row.description,
    venue: row.venue,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    campusId: row.campusId,
    organiserId: row.organiserId ?? null,
    visibility: row.visibility,
    audienceMode: row.audienceMode,
    rsvpEnabled: row.rsvpEnabled,
    lifecycle: row.lifecycle,
    cancellationRetentionUntil: row.cancellationRetentionUntil,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isEvent(candidate) ? candidate : null;
}

function toLifecycleHistory(row: EventLifecycleHistoryRow): EventLifecycleHistory | null {
  if (
    !isUuid(row.id) ||
    !isUuid(row.tenantId) ||
    !isUuid(row.eventId) ||
    !Number.isSafeInteger(row.sequence) ||
    row.sequence < 1 ||
    !Number.isSafeInteger(row.eventVersion) ||
    row.eventVersion < 1 ||
    !isValidDate(row.startsAt) ||
    (row.endsAt !== null && !isValidDate(row.endsAt)) ||
    (row.postponedFromStartsAt !== null && !isValidDate(row.postponedFromStartsAt)) ||
    (row.cancellationRetentionUntil !== null && !isValidDate(row.cancellationRetentionUntil)) ||
    !isValidDate(row.occurredAt)
  ) {
    return null;
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    eventId: row.eventId,
    sequence: row.sequence,
    eventVersion: row.eventVersion,
    fromLifecycle: row.fromLifecycle,
    toLifecycle: row.toLifecycle,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    postponedFromStartsAt: row.postponedFromStartsAt,
    reason: row.reason,
    cancellationRetentionUntil: row.cancellationRetentionUntil,
    occurredAt: row.occurredAt,
  };
}

function toOrganiser(row: typeof organisers.$inferSelect): Organiser | null {
  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    version: row.version,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isOrganiser(candidate) ? candidate : null;
}

function criteriaEmpty(row: EventAudienceCriteriaRow): boolean {
  return row.campusId === null &&
    row.academicDivisionId === null &&
    row.programmeId === null &&
    row.academicYear === null &&
    row.residenceTarget === null &&
    row.residenceId === null;
}

function rowsToAudience(
  tenantId: string,
  event: Event,
  rows: readonly EventAudienceCriteriaRow[],
): EventAudienceDefinition | null {
  if (event.tenantId !== tenantId) {
    return null;
  }
  if (event.audienceMode === "entire_tenant") {
    return rows.length === 0
      ? { eventId: event.id, tenantId, mode: "entire_tenant", groups: [] }
      : null;
  }
  if (rows.length === 0) {
    return null;
  }

  const groups = new Map<string, { policy: "authoritative_only" | "allow_self_declared"; values: unknown[] }>();
  for (const row of rows) {
    if (
      row.tenantId !== tenantId ||
      row.eventId !== event.id ||
      parsePublicationAudienceProvenancePolicy(row.provenancePolicy) === null
    ) {
      return null;
    }
    const existing = groups.get(row.dimension);
    if (existing !== undefined && existing.policy !== row.provenancePolicy) {
      return null;
    }
    const group = existing ?? { policy: row.provenancePolicy, values: [] };
    if (row.dimension === "campus") {
      if (!isUuid(row.campusId) || !criteriaEmpty({ ...row, campusId: null })) return null;
      group.values.push(row.campusId);
    } else if (row.dimension === "academic_division") {
      if (!isUuid(row.academicDivisionId) || !criteriaEmpty({ ...row, academicDivisionId: null })) return null;
      group.values.push(row.academicDivisionId);
    } else if (row.dimension === "programme") {
      if (!isUuid(row.programmeId) || !criteriaEmpty({ ...row, programmeId: null })) return null;
      group.values.push(row.programmeId);
    } else if (row.dimension === "academic_year") {
      if (row.academicYear === null || !Number.isInteger(row.academicYear) || row.academicYear < 1 || !criteriaEmpty({ ...row, academicYear: null })) return null;
      group.values.push(row.academicYear);
    } else if (row.dimension === "residence") {
      if (row.residenceTarget === null || row.campusId !== null || row.academicDivisionId !== null || row.programmeId !== null || row.academicYear !== null) return null;
      if (row.residenceTarget === "specific_residence") {
        if (!isUuid(row.residenceId)) return null;
        group.values.push({ kind: "specific_residence", residenceId: row.residenceId });
      } else if (row.residenceId === null && (row.residenceTarget === "any_resident" || row.residenceTarget === "non_resident")) {
        group.values.push({ kind: row.residenceTarget });
      } else return null;
    } else {
      return null;
    }
    groups.set(row.dimension, group);
  }

  const mapped: PublicationAudienceGroup[] = [...groups.entries()].map(([dimension, group]) => {
    switch (dimension) {
      case "campus": return { dimension, provenancePolicy: group.policy, campusIds: group.values as string[] };
      case "academic_division": return { dimension, provenancePolicy: group.policy, academicDivisionIds: group.values as string[] };
      case "programme": return { dimension, provenancePolicy: group.policy, programmeIds: group.values as string[] };
      case "academic_year": return { dimension, provenancePolicy: group.policy, academicYears: group.values as number[] };
      default: return { dimension: "residence" as const, provenancePolicy: group.policy, residenceTargets: group.values as PublicationResidenceTarget[] };
    }
  });
  const candidate = { eventId: event.id, tenantId, mode: event.audienceMode, groups: mapped };
  return isEventAudienceDefinition(candidate) ? candidate : null;
}

type CriteriaPayload = Readonly<{
  campusId?: string | null;
  academicDivisionId?: string | null;
  programmeId?: string | null;
  academicYear?: number | null;
  residenceTarget?: "specific_residence" | "any_resident" | "non_resident" | null;
  residenceId?: string | null;
}>;

function criteriaRow(
  tenantId: string,
  eventId: string,
  dimension: EventAudienceCriteriaRow["dimension"],
  provenancePolicy: EventAudienceCriteriaRow["provenancePolicy"],
  payload: CriteriaPayload,
) {
  return {
    tenantId,
    eventId,
    dimension,
    provenancePolicy,
    campusId: payload.campusId ?? null,
    academicDivisionId: payload.academicDivisionId ?? null,
    programmeId: payload.programmeId ?? null,
    academicYear: payload.academicYear ?? null,
    residenceTarget: payload.residenceTarget ?? null,
    residenceId: payload.residenceId ?? null,
  };
}

function audienceToRows(
  definition: EventAudienceDefinition,
): Array<ReturnType<typeof criteriaRow>> {
  return definition.groups.flatMap((group) => {
    switch (group.dimension) {
      case "campus": return group.campusIds.map((id) => criteriaRow(definition.tenantId, definition.eventId, group.dimension, group.provenancePolicy, { campusId: id }));
      case "academic_division": return group.academicDivisionIds.map((id) => criteriaRow(definition.tenantId, definition.eventId, group.dimension, group.provenancePolicy, { academicDivisionId: id }));
      case "programme": return group.programmeIds.map((id) => criteriaRow(definition.tenantId, definition.eventId, group.dimension, group.provenancePolicy, { programmeId: id }));
      case "academic_year": return group.academicYears.map((year) => criteriaRow(definition.tenantId, definition.eventId, group.dimension, group.provenancePolicy, { academicYear: year }));
      case "residence": return group.residenceTargets.map((target) => target.kind === "specific_residence"
        ? criteriaRow(definition.tenantId, definition.eventId, group.dimension, group.provenancePolicy, { residenceTarget: target.kind, residenceId: target.residenceId })
        : criteriaRow(definition.tenantId, definition.eventId, group.dimension, group.provenancePolicy, { residenceTarget: target.kind }));
    }
  });
}

function bindServerOwnedAudience(
  value: unknown,
  eventId: string,
  tenantId: string,
): EventAudienceDefinition | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if ("eventId" in candidate || "tenantId" in candidate) return null;
  if (Object.keys(candidate).length !== 2 || !Object.keys(candidate).every((key) => key === "mode" || key === "groups")) return null;
  const bound = { ...candidate, eventId, tenantId };
  return isEventAudienceDefinition(bound) ? bound : null;
}

async function lockAndValidateAudienceTargets(
  database: Pick<CampusHubDatabase, "select">,
  definition: EventAudienceDefinition,
): Promise<boolean> {
  const groups = [...definition.groups].sort((left, right) =>
    left.dimension.localeCompare(right.dimension),
  );
  for (const group of groups) {
    if (group.dimension === "campus") {
      const ids = [...group.campusIds].sort();
      const rows = await database
        .select({ id: campuses.id })
        .from(campuses)
        .where(
          and(
            eq(campuses.tenantId, definition.tenantId),
            inArray(campuses.id, ids),
            eq(campuses.status, "active"),
          ),
        )
        .orderBy(asc(campuses.id))
        .for("update");
      if (rows.length !== ids.length || rows.some((row, index) => row.id !== ids[index])) return false;
    } else if (group.dimension === "academic_division") {
      const ids = [...group.academicDivisionIds].sort();
      const rows = await database
        .select({ id: academicDivisions.id })
        .from(academicDivisions)
        .where(
          and(
            eq(academicDivisions.tenantId, definition.tenantId),
            inArray(academicDivisions.id, ids),
            eq(academicDivisions.status, "active"),
          ),
        )
        .orderBy(asc(academicDivisions.id))
        .for("update");
      if (rows.length !== ids.length || rows.some((row, index) => row.id !== ids[index])) return false;
    } else if (group.dimension === "programme") {
      const ids = [...group.programmeIds].sort();
      const rows = await database
        .select({ id: programmes.id })
        .from(programmes)
        .where(
          and(
            eq(programmes.tenantId, definition.tenantId),
            inArray(programmes.id, ids),
            eq(programmes.status, "active"),
          ),
        )
        .orderBy(asc(programmes.id))
        .for("update");
      if (rows.length !== ids.length || rows.some((row, index) => row.id !== ids[index])) return false;
    } else if (group.dimension === "academic_year") {
      const rows = await database
        .select({
          minimumYear: tenantAcademicYearConfig.minimumYear,
          maximumYear: tenantAcademicYearConfig.maximumYear,
        })
        .from(tenantAcademicYearConfig)
        .where(eq(tenantAcademicYearConfig.tenantId, definition.tenantId))
        .orderBy(asc(tenantAcademicYearConfig.tenantId))
        .for("update");
      const config = rows.length === 1 ? rows[0] : undefined;
      if (
        config === undefined ||
        group.academicYears.some(
          (year) =>
            !Number.isInteger(year) ||
            year < config.minimumYear ||
            year > config.maximumYear,
        )
      ) {
        return false;
      }
    } else if (group.dimension === "residence") {
      const ids = group.residenceTargets
        .flatMap((target) => target.kind === "specific_residence" ? [target.residenceId] : [])
        .sort();
      if (ids.length === 0) continue;
      const rows = await database
        .select({ id: residences.id })
        .from(residences)
        .where(
          and(
            eq(residences.tenantId, definition.tenantId),
            inArray(residences.id, ids),
            eq(residences.status, "active"),
          ),
        )
        .orderBy(asc(residences.id))
        .for("update");
      if (rows.length !== ids.length || rows.some((row, index) => row.id !== ids[index])) return false;
    }
  }
  return true;
}

async function lockActiveCampus(
  database: Pick<CampusHubDatabase, "select">,
  tenantId: string,
  campusId: string,
): Promise<boolean> {
  const rows = await database
    .select({ id: campuses.id })
    .from(campuses)
    .where(
      and(
        eq(campuses.tenantId, tenantId),
        eq(campuses.id, campusId),
        eq(campuses.status, "active"),
      ),
    )
    .orderBy(asc(campuses.id))
    .for("update")
    .limit(1);
  return rows.length === 1;
}

function validEventInput(input: CreateEventInput): boolean {
  const title = parseEventTitle(input.title);
  const description = parseEventDescription(input.description);
  const venue = parseEventVenue(input.venue);
  return title !== null &&
    description !== null &&
    venue !== null &&
    isValidDate(input.startsAt) &&
    (input.endsAt === null || (isValidDate(input.endsAt) && input.endsAt > input.startsAt)) &&
    isUuid(input.campusId) &&
    (input.organiserId === undefined || input.organiserId === null || isUuid(input.organiserId));
}

async function lockOrganiser(
  database: Pick<CampusHubDatabase, "select">,
  tenantId: string,
  organiserId: string,
): Promise<Organiser | null> {
  if (!isUuid(tenantId) || !isUuid(organiserId)) return null;
  const rows = await database
    .select()
    .from(organisers)
    .where(and(eq(organisers.tenantId, tenantId), eq(organisers.id, organiserId)))
    .orderBy(asc(organisers.id))
    .for("update")
    .limit(1);
  return rows[0] === undefined ? null : toOrganiser(rows[0]);
}

async function loadOrganiser(
  database: Pick<CampusHubDatabase, "select">,
  tenantId: string,
  organiserId: string | null,
): Promise<Organiser | null> {
  if (organiserId === null) return null;
  if (!isUuid(tenantId) || !isUuid(organiserId)) return null;
  const rows = await database
    .select()
    .from(organisers)
    .where(and(eq(organisers.tenantId, tenantId), eq(organisers.id, organiserId)))
    .limit(1);
  return rows[0] === undefined ? null : toOrganiser(rows[0]);
}

async function loadAudience(
  database: Pick<CampusHubDatabase, "select">,
  tenantId: string,
  event: Event,
): Promise<EventAudienceDefinition | null> {
  const rows = await database.select().from(eventAudienceCriteria).where(and(eq(eventAudienceCriteria.tenantId, tenantId), eq(eventAudienceCriteria.eventId, event.id))).orderBy(asc(eventAudienceCriteria.dimension), asc(eventAudienceCriteria.id));
  return rowsToAudience(tenantId, event, rows);
}

function sameAudience(left: EventAudienceDefinition, right: EventAudienceDefinition): boolean {
  const canonical = (definition: EventAudienceDefinition) => ({
    mode: definition.mode,
    groups: [...definition.groups]
      .sort((a, b) => a.dimension.localeCompare(b.dimension))
      .map((group) => {
        switch (group.dimension) {
          case "campus":
            return { ...group, campusIds: [...group.campusIds].sort() };
          case "academic_division":
            return { ...group, academicDivisionIds: [...group.academicDivisionIds].sort() };
          case "programme":
            return { ...group, programmeIds: [...group.programmeIds].sort() };
          case "academic_year":
            return { ...group, academicYears: [...group.academicYears].sort((a, b) => a - b) };
          case "residence":
            return {
              ...group,
              residenceTargets: [...group.residenceTargets].sort((a, b) => {
                const leftKey = a.kind === "specific_residence" ? `${a.kind}:${a.residenceId}` : a.kind;
                const rightKey = b.kind === "specific_residence" ? `${b.kind}:${b.residenceId}` : b.kind;
                return leftKey.localeCompare(rightKey);
              }),
            };
        }
      }),
  });
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

async function loadLifecycleHistory(
  database: Pick<CampusHubDatabase, "select">,
  tenantId: string,
  eventId: string,
): Promise<readonly EventLifecycleHistory[] | null> {
  const rows = await database
    .select()
    .from(eventLifecycleHistory)
    .where(
      and(
        eq(eventLifecycleHistory.tenantId, tenantId),
        eq(eventLifecycleHistory.eventId, eventId),
      ),
    )
    .orderBy(asc(eventLifecycleHistory.sequence))
    .for("update");
  const mapped = rows.map(toLifecycleHistory);
  return mapped.every((row): row is EventLifecycleHistory => row !== null)
    ? mapped
    : null;
}

function datesEqual(left: Date | null, right: Date | null): boolean {
  return (left === null && right === null) ||
    (left !== null && right !== null && left.getTime() === right.getTime());
}

function historyIsConsistent(
  event: Event,
  history: readonly EventLifecycleHistory[],
): boolean {
  if (event.lifecycle === "draft") return history.length === 0 && event.cancellationRetentionUntil === null;
  if (history.length === 0) return false;

  for (let index = 0; index < history.length; index += 1) {
    const row = history[index]!;
    const previous = index > 0 ? history[index - 1]! : null;
    if (
      row.tenantId !== event.tenantId ||
      row.eventId !== event.id ||
      row.sequence !== index + 1 ||
      (previous !== null && row.eventVersion !== previous.eventVersion + 1) ||
      row.endsAt !== null && row.endsAt.getTime() <= row.startsAt.getTime() ||
      (row.reason !== null && parseEventReason(row.reason) !== row.reason)
    ) return false;

    if (index === 0) {
      if (
        row.fromLifecycle !== "draft" ||
        row.toLifecycle !== "published" ||
        row.postponedFromStartsAt !== null ||
        row.reason !== null ||
        row.cancellationRetentionUntil !== null
      ) return false;
    } else if (row.fromLifecycle !== previous!.toLifecycle) {
      return false;
    }

    if (row.fromLifecycle === "published" && row.toLifecycle === "postponed") {
      if (
        previous === null ||
        row.postponedFromStartsAt === null ||
        !datesEqual(row.postponedFromStartsAt, previous.startsAt) ||
        row.startsAt.getTime() <= previous.startsAt.getTime() ||
        parseEventReason(row.reason) === null ||
        row.cancellationRetentionUntil !== null
      ) return false;
    } else if (row.fromLifecycle === "postponed" && row.toLifecycle === "published") {
      if (
        previous === null ||
        !datesEqual(row.startsAt, previous.startsAt) ||
        !datesEqual(row.endsAt, previous.endsAt) ||
        row.postponedFromStartsAt !== null ||
        row.reason !== null ||
        row.cancellationRetentionUntil !== null
      ) return false;
    } else if ((row.fromLifecycle === "published" || row.fromLifecycle === "postponed") && row.toLifecycle === "cancelled") {
      if (
        previous === null ||
        !datesEqual(row.startsAt, previous.startsAt) ||
        !datesEqual(row.endsAt, previous.endsAt) ||
        row.postponedFromStartsAt !== null ||
        parseEventReason(row.reason) === null ||
        row.cancellationRetentionUntil === null
      ) return false;
      const hadPostponement = history
        .slice(0, index)
        .some((item) => item.fromLifecycle === "published" && item.toLifecycle === "postponed");
      const expectedRetention = hadPostponement
        ? row.fromLifecycle === "published"
          ? row.startsAt
          : latestPostponedFromStartsAt(history.slice(0, index))
        : previous.endsAt ?? previous.startsAt;
      if (expectedRetention === null || !datesEqual(row.cancellationRetentionUntil, expectedRetention)) return false;
    } else if (!(row.fromLifecycle === "draft" && row.toLifecycle === "published")) {
      return false;
    }
  }

  const last = history[history.length - 1]!;
  if (last.eventVersion !== event.version || last.toLifecycle !== event.lifecycle) return false;
  if (event.cancellationRetentionUntil !== null && event.lifecycle !== "cancelled") return false;
  if (event.lifecycle === "cancelled") {
    return last.cancellationRetentionUntil !== null &&
      datesEqual(event.cancellationRetentionUntil, last.cancellationRetentionUntil) &&
      datesEqual(event.startsAt, last.startsAt) &&
      datesEqual(event.endsAt, last.endsAt);
  }
  return event.cancellationRetentionUntil === null &&
    datesEqual(event.startsAt, last.startsAt) &&
    datesEqual(event.endsAt, last.endsAt);
}

function hasCommittedPostponement(history: readonly EventLifecycleHistory[]): boolean {
  return history.some((row) => row.fromLifecycle === "published" && row.toLifecycle === "postponed");
}

function latestPostponedFromStartsAt(history: readonly EventLifecycleHistory[]): Date | null {
  const rows = history.filter((row) => row.fromLifecycle === "published" && row.toLifecycle === "postponed");
  return rows.length === 0 ? null : rows[rows.length - 1]!.postponedFromStartsAt;
}

function nextHistorySequence(history: readonly EventLifecycleHistory[]): number {
  return history.length === 0 ? 1 : history[history.length - 1]!.sequence + 1;
}

function isPostponeInput(value: unknown): value is PostponeEventInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Number.isSafeInteger(candidate.expectedVersion) &&
    (candidate.expectedVersion as number) >= 1 &&
    isValidDate(candidate.startsAt) &&
    (candidate.endsAt === null || isValidDate(candidate.endsAt)) &&
    parseEventReason(candidate.reason) === candidate.reason;
}

function isRepublishInput(value: unknown): value is RepublishEventInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 1 &&
    Number.isSafeInteger(candidate.expectedVersion) &&
    (candidate.expectedVersion as number) >= 1;
}

function isCancelInput(value: unknown): value is CancelEventInput {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Number.isSafeInteger(candidate.expectedVersion) &&
    (candidate.expectedVersion as number) >= 1 &&
    parseEventReason(candidate.reason) === candidate.reason;
}

export class DrizzleEventRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async createEventInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    input: CreateEventInput,
    prepared: PreparedCreateEvent,
    occurredAt = new Date(),
  ): Promise<EventMutationResult> {
    if (!isUuid(tenantId) || !isUuid(eventId) || prepared.eventId !== eventId || !isValidDate(occurredAt)) return { ok: false, error: "PERSISTENCE_FAILED" };
    const { audience, organiser } = prepared;
    try {
      const rows = await transaction.insert(events).values({
        id: eventId,
        tenantId,
        version: 1,
        title: parseEventTitle(input.title)!,
        description: parseEventDescription(input.description)!,
        venue: parseEventVenue(input.venue)!,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        campusId: input.campusId,
        organiserId: input.organiserId ?? null,
        visibility: input.visibility,
        audienceMode: input.audienceMode,
        rsvpEnabled: input.rsvpEnabled,
        lifecycle: "draft",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }).returning();
      const event = rows[0] ? toEvent(rows[0]) : null;
      if (event === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const criteria = audienceToRows(audience);
      if (criteria.length > 0) await transaction.insert(eventAudienceCriteria).values(criteria);
      return { ok: true, record: { event, audience, organiser, history: [] }, changed: true };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async prepareCreateEventInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    input: CreateEventInput,
  ): Promise<PreparedCreateEvent | null> {
    if (!isUuid(tenantId) || !isUuid(eventId) || !validEventInput(input)) return null;
    const audience = bindServerOwnedAudience(input.audience, eventId, tenantId);
    if (audience === null || audience.mode !== input.audienceMode) return null;
    if (!(await lockActiveCampus(transaction, tenantId, input.campusId))) return null;
    if (!(await lockAndValidateAudienceTargets(transaction, audience))) return null;
    const organiser = input.organiserId === undefined || input.organiserId === null
      ? null
      : await lockOrganiser(transaction, tenantId, input.organiserId);
    if (input.organiserId !== undefined && input.organiserId !== null && organiser === null) return null;
    return { eventId, audience, organiser };
  }

  public async prepareEventMutationInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    expectedVersion: number,
    operation: "edit" | "publish" | "postpone" | "republish" | "cancel",
    input?: UpdateEventInput | PostponeEventInput | RepublishEventInput | CancelEventInput,
  ): Promise<PreparedEventMutation | EventMutationError> {
    if (!isUuid(tenantId) || !isUuid(eventId)) return "PERMISSION_DENIED";
    const rows = await transaction.select().from(events).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId))).for("update").limit(1);
    const event = rows[0] ? toEvent(rows[0]) : null;
    if (event === null) return "NOT_FOUND";
    if (event.version !== expectedVersion) return "VERSION_CONFLICT";
    const history = await loadLifecycleHistory(transaction, tenantId, eventId);
    if (history === null || !historyIsConsistent(event, history)) return "NOT_READY";

    if (operation === "postpone") {
      if (event.lifecycle !== "published" || !isPostponeInput(input)) return "INVALID_STATE";
      if (input.startsAt.getTime() <= event.startsAt.getTime() || (input.endsAt !== null && input.endsAt.getTime() <= input.startsAt.getTime())) return "NOT_READY";
      const audience = await loadAudience(transaction, tenantId, event);
      const organiser = await loadOrganiser(transaction, tenantId, event.organiserId);
      if (audience === null || (event.organiserId !== null && organiser === null)) return "NOT_READY";
      return {
        event,
        currentAudience: audience,
        audience,
        organiser,
        history,
        hasCommittedPostponement: hasCommittedPostponement(history),
        latestPostponedFromStartsAt: latestPostponedFromStartsAt(history),
      };
    }

    if (operation === "cancel") {
      if ((event.lifecycle !== "published" && event.lifecycle !== "postponed") || !isCancelInput(input)) return "INVALID_STATE";
      const audience = await loadAudience(transaction, tenantId, event);
      const organiser = await loadOrganiser(transaction, tenantId, event.organiserId);
      if (audience === null || (event.organiserId !== null && organiser === null)) return "NOT_READY";
      return {
        event,
        currentAudience: audience,
        audience,
        organiser,
        history,
        hasCommittedPostponement: hasCommittedPostponement(history),
        latestPostponedFromStartsAt: latestPostponedFromStartsAt(history),
      };
    }

    if (operation === "republish" && event.lifecycle !== "postponed") return "INVALID_STATE";
    if (operation !== "edit" && operation !== "publish" && operation !== "republish") return "INVALID_STATE";
    if (operation === "edit" && event.lifecycle !== "draft") return "INVALID_STATE";
    if (operation === "publish" && event.lifecycle !== "draft") return "INVALID_STATE";
    const campusId = operation === "edit" ? (input as UpdateEventInput | undefined)?.campusId : event.campusId;
    const audience = operation === "edit"
      ? input === undefined || !validEventInput(input as UpdateEventInput)
        ? null
        : bindServerOwnedAudience((input as UpdateEventInput).audience, event.id, tenantId)
      : await loadAudience(transaction, tenantId, event);
    if (campusId === undefined || audience === null) return "NOT_READY";
    if (operation === "edit" && ((input as UpdateEventInput).audienceMode !== audience.mode)) return "NOT_READY";
    if ((operation === "publish" || operation === "republish") && audience.mode !== event.audienceMode) return "NOT_READY";
    if (!(await lockActiveCampus(transaction, tenantId, campusId))) return "NOT_READY";
    if (!(await lockAndValidateAudienceTargets(transaction, audience))) return "NOT_READY";
    const organiserId = operation === "edit"
      ? (input as UpdateEventInput).organiserId ?? null
      : event.organiserId;
    const organiser = organiserId === null
      ? null
      : await lockOrganiser(transaction, tenantId, organiserId);
    if (organiserId !== null && organiser === null) return "NOT_READY";
    const currentAudience = operation === "edit"
      ? await loadAudience(transaction, tenantId, event)
      : audience;
    if (currentAudience === null) return "NOT_READY";
    return {
      event,
      currentAudience,
      audience,
      organiser,
      history,
      hasCommittedPostponement: hasCommittedPostponement(history),
      latestPostponedFromStartsAt: latestPostponedFromStartsAt(history),
    };
  }

  public async findEventByIdForTenant(tenantId: string, eventId: string): Promise<EventRecord | null> {
    if (!isUuid(tenantId) || !isUuid(eventId)) return null;
    const rows = await this.database.select().from(events).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId))).limit(1);
    const event = rows[0] ? toEvent(rows[0]) : null;
    if (event === null) return null;
    const audience = await loadAudience(this.database, tenantId, event);
    const organiser = await loadOrganiser(this.database, tenantId, event.organiserId);
    const history = await loadLifecycleHistory(this.database, tenantId, eventId);
    return event.organiserId !== null && organiser === null
      ? null
      : audience === null || history === null || !historyIsConsistent(event, history)
        ? null
        : { event, audience, organiser, history };
  }

  public async listLifecycleHistoryForTenant(
    tenantId: string,
    eventId: string,
  ): Promise<readonly EventLifecycleHistory[]> {
    if (!isUuid(tenantId) || !isUuid(eventId)) return [];
    const eventRows = await this.database
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.tenantId, tenantId), eq(events.id, eventId)))
      .limit(1);
    if (eventRows.length !== 1) return [];
    const rows = await this.database
      .select()
      .from(eventLifecycleHistory)
      .where(and(eq(eventLifecycleHistory.tenantId, tenantId), eq(eventLifecycleHistory.eventId, eventId)))
      .orderBy(asc(eventLifecycleHistory.sequence));
    return rows.map(toLifecycleHistory).filter((row): row is EventLifecycleHistory => row !== null);
  }

  public async listEventsForTenant(tenantId: string, options: EventListOptions): Promise<readonly EventRecord[]> {
    if (!isUuid(tenantId) || !isValidDate(options.now)) return [];
    if (options.surface !== undefined && options.surface !== "home" && options.surface !== "discover") return [];
    const surface = options.surface ?? "home";
    const lifecycles = surface === "discover"
      ? ["published", "postponed"] as const
      : ["published", "postponed", "cancelled"] as const;
    const clauses = [eq(events.tenantId, tenantId), inArray(events.lifecycle, lifecycles)];
    if (options.campusId !== undefined) clauses.push(eq(events.campusId, options.campusId));
    if (options.visibility !== undefined) clauses.push(eq(events.visibility, options.visibility));
    if (!options.includePast) {
      clauses.push(surface === "discover"
        ? sql`coalesce(${events.endsAt}, ${events.startsAt}) > ${options.now}`
        : sql`case when ${events.lifecycle} = 'cancelled' then ${events.cancellationRetentionUntil} > ${options.now} else coalesce(${events.endsAt}, ${events.startsAt}) > ${options.now} end`);
    }
    const limit = Number.isSafeInteger(options.limit) && (options.limit ?? 0) >= 1 && (options.limit ?? 0) <= 100 ? options.limit! : 50;
    const rows = await this.database.select().from(events).where(and(...clauses)).orderBy(asc(events.startsAt), asc(events.id)).limit(limit);
    const records: EventRecord[] = [];
    for (const row of rows) {
      const event = toEvent(row);
      if (event === null) continue;
      const history = await loadLifecycleHistory(this.database, tenantId, event.id);
      if (history === null || !historyIsConsistent(event, history)) continue;
      const past = isEventPast(event, options.now);
      if (!options.includePast && past) continue;
      const audience = await loadAudience(this.database, tenantId, event);
      const organiser = await loadOrganiser(this.database, tenantId, event.organiserId);
      if (audience !== null && (event.organiserId === null || organiser !== null)) {
        records.push({ event, audience, organiser, history });
      }
    }
    return records;
  }

  public async updateEventInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    input: UpdateEventInput,
    prepared: PreparedEventMutation,
    occurredAt = new Date(),
  ): Promise<EventMutationResult> {
    if (!isUuid(tenantId) || !isUuid(eventId) || !isValidDate(occurredAt)) return { ok: false, error: "PERSISTENCE_FAILED" };
    const { event: existing, currentAudience, audience, organiser, history } = prepared;
    if (existing.id !== eventId || existing.tenantId !== tenantId || existing.version !== input.expectedVersion) {
      return { ok: false, error: "VERSION_CONFLICT" };
    }
    try {
      if (existing.lifecycle !== "draft") return { ok: false, error: "INVALID_STATE" };
      const material = isMaterialEventChange(existing, input);
      if (!material && sameAudience(currentAudience, audience)) return { ok: true, record: { event: existing, audience: currentAudience, organiser, history }, changed: false };
      const updatedRows = await transaction.update(events).set({
        title: parseEventTitle(input.title)!,
        description: parseEventDescription(input.description)!,
        venue: parseEventVenue(input.venue)!,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        campusId: input.campusId,
        organiserId: input.organiserId ?? null,
        visibility: input.visibility,
        audienceMode: input.audienceMode,
        rsvpEnabled: input.rsvpEnabled,
        version: sql`${events.version} + 1`,
        updatedAt: occurredAt,
      }).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId), eq(events.version, input.expectedVersion))).returning();
      const updated = updatedRows[0] ? toEvent(updatedRows[0]) : null;
      if (updated === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      await transaction.delete(eventAudienceCriteria).where(and(eq(eventAudienceCriteria.tenantId, tenantId), eq(eventAudienceCriteria.eventId, eventId)));
      const criteria = audienceToRows(audience);
      if (criteria.length > 0) await transaction.insert(eventAudienceCriteria).values(criteria);
      return { ok: true, record: { event: updated, audience, organiser, history }, changed: true };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async appendLifecycleHistoryInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    input: EventLifecycleHistoryAppendInput,
  ): Promise<EventLifecycleHistory | null> {
    if (
      !isUuid(input.tenantId) ||
      !isUuid(input.eventId) ||
      !Number.isSafeInteger(input.sequence) ||
      input.sequence < 1 ||
      !Number.isSafeInteger(input.eventVersion) ||
      input.eventVersion < 1 ||
      !isValidDate(input.startsAt) ||
      (input.endsAt !== null && !isValidDate(input.endsAt)) ||
      (input.postponedFromStartsAt !== null && !isValidDate(input.postponedFromStartsAt)) ||
      (input.cancellationRetentionUntil !== null && !isValidDate(input.cancellationRetentionUntil)) ||
      !isValidDate(input.occurredAt)
    ) return null;
    try {
      const rows = await transaction.insert(eventLifecycleHistory).values({
        tenantId: input.tenantId,
        eventId: input.eventId,
        sequence: input.sequence,
        eventVersion: input.eventVersion,
        fromLifecycle: input.fromLifecycle,
        toLifecycle: input.toLifecycle,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        postponedFromStartsAt: input.postponedFromStartsAt,
        reason: input.reason,
        cancellationRetentionUntil: input.cancellationRetentionUntil,
        occurredAt: input.occurredAt,
      }).returning();
      const row = rows[0] ? toLifecycleHistory(rows[0]) : null;
      return row !== null && row.tenantId === input.tenantId && row.eventId === input.eventId
        ? row
        : null;
    } catch {
      return null;
    }
  }

  public async postponeEventInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    input: PostponeEventInput,
    prepared: PreparedEventMutation,
    occurredAt = new Date(),
  ): Promise<EventMutationResult> {
    if (!isUuid(tenantId) || !isUuid(eventId) || !isValidDate(occurredAt) || !isPostponeInput(input)) return { ok: false, error: "PERSISTENCE_FAILED" };
    const { event: existing, audience, organiser, history } = prepared;
    if (existing.id !== eventId || existing.tenantId !== tenantId || existing.version !== input.expectedVersion) return { ok: false, error: "VERSION_CONFLICT" };
    if (existing.lifecycle !== "published" || input.startsAt.getTime() <= existing.startsAt.getTime() || (input.endsAt !== null && input.endsAt.getTime() <= input.startsAt.getTime())) return { ok: false, error: "NOT_READY" };
    try {
      const updatedRows = await transaction.update(events).set({
        lifecycle: "postponed",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        cancellationRetentionUntil: null,
        version: sql`${events.version} + 1`,
        updatedAt: occurredAt,
      }).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId), eq(events.version, input.expectedVersion), eq(events.lifecycle, "published"))).returning();
      const updated = updatedRows[0] ? toEvent(updatedRows[0]) : null;
      if (updated === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const appended = await this.appendLifecycleHistoryInTransaction(transaction, {
        tenantId,
        eventId,
        sequence: nextHistorySequence(history),
        eventVersion: updated.version,
        fromLifecycle: "published",
        toLifecycle: "postponed",
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        postponedFromStartsAt: existing.startsAt,
        reason: input.reason,
        cancellationRetentionUntil: null,
        occurredAt,
      });
      if (appended === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const nextHistory = [...history, appended];
      if (!historyIsConsistent(updated, nextHistory)) return { ok: false, error: "PERSISTENCE_FAILED" };
      return { ok: true, record: { event: updated, audience, organiser, history: nextHistory }, changed: true };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async republishEventInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    input: RepublishEventInput,
    prepared: PreparedEventMutation,
    occurredAt = new Date(),
  ): Promise<EventMutationResult> {
    if (!isUuid(tenantId) || !isUuid(eventId) || !isValidDate(occurredAt) || !isRepublishInput(input)) return { ok: false, error: "PERSISTENCE_FAILED" };
    const { event: existing, audience, organiser, history } = prepared;
    if (existing.id !== eventId || existing.tenantId !== tenantId || existing.version !== input.expectedVersion) return { ok: false, error: "VERSION_CONFLICT" };
    if (existing.lifecycle !== "postponed") return { ok: false, error: "INVALID_STATE" };
    try {
      const updatedRows = await transaction.update(events).set({
        lifecycle: "published",
        cancellationRetentionUntil: null,
        version: sql`${events.version} + 1`,
        updatedAt: occurredAt,
      }).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId), eq(events.version, input.expectedVersion), eq(events.lifecycle, "postponed"))).returning();
      const updated = updatedRows[0] ? toEvent(updatedRows[0]) : null;
      if (updated === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const appended = await this.appendLifecycleHistoryInTransaction(transaction, {
        tenantId,
        eventId,
        sequence: nextHistorySequence(history),
        eventVersion: updated.version,
        fromLifecycle: "postponed",
        toLifecycle: "published",
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        postponedFromStartsAt: null,
        reason: null,
        cancellationRetentionUntil: null,
        occurredAt,
      });
      if (appended === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const nextHistory = [...history, appended];
      if (!historyIsConsistent(updated, nextHistory)) return { ok: false, error: "PERSISTENCE_FAILED" };
      return { ok: true, record: { event: updated, audience, organiser, history: nextHistory }, changed: true };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async cancelEventInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    input: CancelEventInput,
    prepared: PreparedEventMutation,
    occurredAt = new Date(),
  ): Promise<EventMutationResult> {
    if (!isUuid(tenantId) || !isUuid(eventId) || !isValidDate(occurredAt) || !isCancelInput(input)) return { ok: false, error: "PERSISTENCE_FAILED" };
    const { event: existing, audience, organiser, history, hasCommittedPostponement, latestPostponedFromStartsAt } = prepared;
    if (existing.id !== eventId || existing.tenantId !== tenantId || existing.version !== input.expectedVersion) return { ok: false, error: "VERSION_CONFLICT" };
    if (existing.lifecycle !== "published" && existing.lifecycle !== "postponed") return { ok: false, error: "INVALID_STATE" };
    const retention = hasCommittedPostponement
      ? existing.lifecycle === "published" ? existing.startsAt : latestPostponedFromStartsAt
      : existing.endsAt ?? existing.startsAt;
    if (retention === null) return { ok: false, error: "NOT_READY" };
    try {
      const updatedRows = await transaction.update(events).set({
        lifecycle: "cancelled",
        cancellationRetentionUntil: retention,
        version: sql`${events.version} + 1`,
        updatedAt: occurredAt,
      }).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId), eq(events.version, input.expectedVersion), inArray(events.lifecycle, ["published", "postponed"]))).returning();
      const updated = updatedRows[0] ? toEvent(updatedRows[0]) : null;
      if (updated === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const appended = await this.appendLifecycleHistoryInTransaction(transaction, {
        tenantId,
        eventId,
        sequence: nextHistorySequence(history),
        eventVersion: updated.version,
        fromLifecycle: existing.lifecycle,
        toLifecycle: "cancelled",
        startsAt: existing.startsAt,
        endsAt: existing.endsAt,
        postponedFromStartsAt: null,
        reason: input.reason,
        cancellationRetentionUntil: retention,
        occurredAt,
      });
      if (appended === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const nextHistory = [...history, appended];
      if (!historyIsConsistent(updated, nextHistory)) return { ok: false, error: "PERSISTENCE_FAILED" };
      return { ok: true, record: { event: updated, audience, organiser, history: nextHistory }, changed: true };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async publishEventInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    input: PublishEventInput,
    prepared: PreparedEventMutation,
    occurredAt = new Date(),
  ): Promise<EventMutationResult> {
    if (!isUuid(tenantId) || !isUuid(eventId) || !isValidDate(occurredAt)) return { ok: false, error: "PERSISTENCE_FAILED" };
    const { event: existing, audience, organiser, history } = prepared;
    if (existing.id !== eventId || existing.tenantId !== tenantId || existing.version !== input.expectedVersion) {
      return { ok: false, error: "VERSION_CONFLICT" };
    }
    try {
      if (existing.lifecycle !== "draft") return { ok: false, error: "INVALID_STATE" };
      const updatedRows = await transaction.update(events).set({ lifecycle: "published", version: sql`${events.version} + 1`, updatedAt: occurredAt }).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId), eq(events.version, input.expectedVersion), eq(events.lifecycle, "draft"))).returning();
      const updated = updatedRows[0] ? toEvent(updatedRows[0]) : null;
      if (updated === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const appended = await this.appendLifecycleHistoryInTransaction(transaction, {
        tenantId,
        eventId,
        sequence: nextHistorySequence(history),
        eventVersion: updated.version,
        fromLifecycle: "draft",
        toLifecycle: "published",
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        postponedFromStartsAt: null,
        reason: null,
        cancellationRetentionUntil: null,
        occurredAt,
      });
      if (appended === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const nextHistory = [...history, appended];
      if (!historyIsConsistent(updated, nextHistory)) return { ok: false, error: "PERSISTENCE_FAILED" };
      return { ok: true, record: { event: updated, audience, organiser, history: nextHistory }, changed: true };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }
}
