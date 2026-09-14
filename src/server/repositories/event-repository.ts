import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  isEvent,
  isMaterialEventChange,
  parseEventDescription,
  parseEventTitle,
  parseEventVenue,
  type CreateEventInput,
  type Event,
  type PublishEventInput,
  type UpdateEventInput,
} from "@/domain/events/events";
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
  type EventAudienceCriteriaRow,
  type EventRow,
} from "@/server/db/schema";

export type EventRecord = Readonly<{
  event: Event;
  audience: EventAudienceDefinition;
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
}>;

export type PreparedEventMutation = Readonly<{
  event: Event;
  currentAudience: EventAudienceDefinition;
  audience: EventAudienceDefinition;
}>;

export type EventListOptions = Readonly<{
  now: Date;
  campusId?: string;
  visibility?: "PUBLIC" | "MEMBERS" | "VERIFIED_MEMBERS";
  includePast?: boolean;
  limit?: number;
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
    visibility: row.visibility,
    audienceMode: row.audienceMode,
    rsvpEnabled: row.rsvpEnabled,
    lifecycle: row.lifecycle,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isEvent(candidate) ? candidate : null;
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
    isUuid(input.campusId);
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
    const { audience } = prepared;
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
      return { ok: true, record: { event, audience }, changed: true };
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
    return { eventId, audience };
  }

  public async prepareEventMutationInTransaction(
    transaction: EventRepositoryTransactionDatabase,
    tenantId: string,
    eventId: string,
    expectedVersion: number,
    operation: "edit" | "publish",
    input?: UpdateEventInput,
  ): Promise<PreparedEventMutation | EventMutationError> {
    if (!isUuid(tenantId) || !isUuid(eventId)) return "PERMISSION_DENIED";
    const rows = await transaction.select().from(events).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId))).for("update").limit(1);
    const event = rows[0] ? toEvent(rows[0]) : null;
    if (event === null) return "NOT_FOUND";
    if (event.version !== expectedVersion) return "VERSION_CONFLICT";
    if (event.lifecycle !== "draft") return "INVALID_STATE";
    const campusId = operation === "edit" ? input?.campusId : event.campusId;
    const audience = operation === "edit"
      ? input === undefined || !validEventInput(input)
        ? null
        : bindServerOwnedAudience(input.audience, event.id, tenantId)
      : await loadAudience(transaction, tenantId, event);
    if (campusId === undefined || audience === null) return "NOT_READY";
    if (operation === "edit" && (input === undefined || input.audienceMode !== audience.mode)) return "NOT_READY";
    if (operation === "publish" && audience.mode !== event.audienceMode) return "NOT_READY";
    if (!(await lockActiveCampus(transaction, tenantId, campusId))) return "NOT_READY";
    if (!(await lockAndValidateAudienceTargets(transaction, audience))) return "NOT_READY";
    const currentAudience = operation === "edit"
      ? await loadAudience(transaction, tenantId, event)
      : audience;
    if (currentAudience === null) return "NOT_READY";
    return { event, currentAudience, audience };
  }

  public async findEventByIdForTenant(tenantId: string, eventId: string): Promise<EventRecord | null> {
    if (!isUuid(tenantId) || !isUuid(eventId)) return null;
    const rows = await this.database.select().from(events).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId))).limit(1);
    const event = rows[0] ? toEvent(rows[0]) : null;
    if (event === null) return null;
    const audience = await loadAudience(this.database, tenantId, event);
    return audience === null ? null : { event, audience };
  }

  public async listEventsForTenant(tenantId: string, options: EventListOptions): Promise<readonly EventRecord[]> {
    if (!isUuid(tenantId) || !isValidDate(options.now)) return [];
    const clauses = [eq(events.tenantId, tenantId), eq(events.lifecycle, "published" as const)];
    if (options.campusId !== undefined) clauses.push(eq(events.campusId, options.campusId));
    if (options.visibility !== undefined) clauses.push(eq(events.visibility, options.visibility));
    if (!options.includePast) {
      clauses.push(sql`coalesce(${events.endsAt}, ${events.startsAt}) > ${options.now}`);
    }
    const limit = Number.isSafeInteger(options.limit) && (options.limit ?? 0) >= 1 && (options.limit ?? 0) <= 100 ? options.limit! : 50;
    const rows = await this.database.select().from(events).where(and(...clauses)).orderBy(asc(events.startsAt), asc(events.id)).limit(limit);
    const records: EventRecord[] = [];
    for (const row of rows) {
      const event = toEvent(row);
      if (event === null) continue;
      const past = options.now.getTime() >= (event.endsAt ?? event.startsAt).getTime();
      if (!options.includePast && past) continue;
      const audience = await loadAudience(this.database, tenantId, event);
      if (audience !== null) records.push({ event, audience });
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
    const { event: existing, currentAudience, audience } = prepared;
    if (existing.id !== eventId || existing.tenantId !== tenantId || existing.version !== input.expectedVersion) {
      return { ok: false, error: "VERSION_CONFLICT" };
    }
    try {
      if (existing.lifecycle !== "draft") return { ok: false, error: "INVALID_STATE" };
      const material = isMaterialEventChange(existing, input);
      if (!material && sameAudience(currentAudience, audience)) return { ok: true, record: { event: existing, audience: currentAudience }, changed: false };
      const updatedRows = await transaction.update(events).set({
        title: parseEventTitle(input.title)!,
        description: parseEventDescription(input.description)!,
        venue: parseEventVenue(input.venue)!,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        campusId: input.campusId,
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
      return { ok: true, record: { event: updated, audience }, changed: true };
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
    const { event: existing, audience } = prepared;
    if (existing.id !== eventId || existing.tenantId !== tenantId || existing.version !== input.expectedVersion) {
      return { ok: false, error: "VERSION_CONFLICT" };
    }
    try {
      if (existing.lifecycle !== "draft") return { ok: false, error: "INVALID_STATE" };
      const updatedRows = await transaction.update(events).set({ lifecycle: "published", version: sql`${events.version} + 1`, updatedAt: occurredAt }).where(and(eq(events.tenantId, tenantId), eq(events.id, eventId), eq(events.version, input.expectedVersion), eq(events.lifecycle, "draft"))).returning();
      const updated = updatedRows[0] ? toEvent(updatedRows[0]) : null;
      return updated === null ? { ok: false, error: "PERSISTENCE_FAILED" } : { ok: true, record: { event: updated, audience }, changed: true };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }
}
