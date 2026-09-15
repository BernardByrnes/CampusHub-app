import {
  parseResourceVisibility,
  type ResourceVisibility,
} from "@/domain/authorization/resource-visibility";
import {
  parsePublicationAudienceMode,
  type PublicationAudienceMode,
} from "@/domain/content/publication";
import { isUuid } from "@/domain/identifiers/uuid";

export const EVENT_LIFECYCLES = [
  "draft",
  "published",
  "postponed",
  "cancelled",
] as const;
export type EventLifecycle = (typeof EVENT_LIFECYCLES)[number];

export const EVENT_REASON_MAX_LENGTH = 500;

export type Event = Readonly<{
  id: string;
  tenantId: string;
  version: number;
  title: string;
  description: string;
  venue: string;
  startsAt: Date;
  endsAt: Date | null;
  campusId: string;
  organiserId: string | null;
  visibility: ResourceVisibility;
  audienceMode: PublicationAudienceMode;
  rsvpEnabled: boolean;
  lifecycle: EventLifecycle;
  cancellationRetentionUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type EventLifecycleHistory = Readonly<{
  id: string;
  tenantId: string;
  eventId: string;
  sequence: number;
  eventVersion: number;
  fromLifecycle: EventLifecycle;
  toLifecycle: EventLifecycle;
  startsAt: Date;
  endsAt: Date | null;
  postponedFromStartsAt: Date | null;
  reason: string | null;
  cancellationRetentionUntil: Date | null;
  occurredAt: Date;
}>;

export type CreateEventInput = Readonly<{
  title: string;
  description: string;
  venue: string;
  startsAt: Date;
  endsAt: Date | null;
  campusId: string;
  organiserId?: string | null;
  visibility: ResourceVisibility;
  audienceMode: PublicationAudienceMode;
  rsvpEnabled: boolean;
  audience: unknown;
}>;

export type UpdateEventInput = CreateEventInput & Readonly<{
  expectedVersion: number;
}>;

export type PublishEventInput = Readonly<{
  expectedVersion: number;
}>;

export type PostponeEventInput = Readonly<{
  expectedVersion: number;
  startsAt: Date;
  endsAt: Date | null;
  reason: string;
}>;

export type RepublishEventInput = Readonly<{
  expectedVersion: number;
}>;

export type CancelEventInput = Readonly<{
  expectedVersion: number;
  reason: string;
}>;

export function parseEventLifecycle(value: unknown): EventLifecycle | null {
  return typeof value === "string" &&
    (EVENT_LIFECYCLES as readonly string[]).includes(value)
    ? (value as EventLifecycle)
    : null;
}

export function parseEventTitle(value: unknown): string | null {
  return parseBoundedText(value, 160);
}

export function parseEventDescription(value: unknown): string | null {
  return parseBoundedText(value, 5000);
}

export function parseEventVenue(value: unknown): string | null {
  return parseBoundedText(value, 200);
}

export function parseEventReason(value: unknown): string | null {
  return parseBoundedText(value, EVENT_REASON_MAX_LENGTH);
}

function parseBoundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : null;
}

export function parseEventTimestamp(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(value.getTime());
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseEventExpectedVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : null;
}

export function isEvent(value: unknown): value is Event {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const startsAt = parseEventTimestamp(candidate.startsAt);
  const endsAt = candidate.endsAt === null
    ? null
    : parseEventTimestamp(candidate.endsAt);
  const createdAt = parseEventTimestamp(candidate.createdAt);
  const updatedAt = parseEventTimestamp(candidate.updatedAt);
  const cancellationRetentionUntil = candidate.cancellationRetentionUntil === null
    ? null
    : parseEventTimestamp(candidate.cancellationRetentionUntil);
  return (
    isUuid(candidate.id) &&
    isUuid(candidate.tenantId) &&
    parseEventExpectedVersion(candidate.version) !== null &&
    parseEventTitle(candidate.title) !== null &&
    parseEventDescription(candidate.description) !== null &&
    parseEventVenue(candidate.venue) !== null &&
    startsAt !== null &&
    Object.prototype.hasOwnProperty.call(candidate, "endsAt") &&
    (candidate.endsAt === null || endsAt instanceof Date) &&
    (endsAt === null || endsAt.getTime() > startsAt.getTime()) &&
    isUuid(candidate.campusId) &&
    (candidate.organiserId === undefined || candidate.organiserId === null || isUuid(candidate.organiserId)) &&
    parseResourceVisibility(candidate.visibility) !== null &&
    parsePublicationAudienceMode(candidate.audienceMode) !== null &&
    typeof candidate.rsvpEnabled === "boolean" &&
    parseEventLifecycle(candidate.lifecycle) !== null &&
    Object.prototype.hasOwnProperty.call(candidate, "cancellationRetentionUntil") &&
    (candidate.cancellationRetentionUntil === null || cancellationRetentionUntil instanceof Date) &&
    (candidate.lifecycle === "cancelled"
      ? cancellationRetentionUntil instanceof Date
      : candidate.cancellationRetentionUntil === null) &&
    createdAt !== null &&
    updatedAt !== null
  );
}

export function isEventPast(
  event: Pick<Event, "startsAt" | "endsAt" | "lifecycle" | "cancellationRetentionUntil">,
  now: Date,
): boolean {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return true;
  }
  if (event.lifecycle === "cancelled") {
    return !(event.cancellationRetentionUntil instanceof Date) ||
      Number.isNaN(event.cancellationRetentionUntil.getTime()) ||
      now.getTime() >= event.cancellationRetentionUntil.getTime();
  }
  return now.getTime() >= (event.endsAt ?? event.startsAt).getTime();
}

export function isMaterialEventChange(
  event: Pick<Event, "title" | "description" | "venue" | "startsAt" | "endsAt" | "campusId" | "organiserId" | "visibility" | "audienceMode" | "rsvpEnabled">,
  input: Omit<UpdateEventInput, "expectedVersion" | "audience"> & Readonly<{ audienceMode: PublicationAudienceMode; audience?: unknown }>,
): boolean {
  return event.title !== input.title ||
    event.description !== input.description ||
    event.venue !== input.venue ||
    event.startsAt.getTime() !== input.startsAt.getTime() ||
    (event.endsAt?.getTime() ?? null) !== (input.endsAt?.getTime() ?? null) ||
    event.campusId !== input.campusId ||
    (event.organiserId ?? null) !== (input.organiserId ?? null) ||
    event.visibility !== input.visibility ||
    event.audienceMode !== input.audienceMode ||
    event.rsvpEnabled !== input.rsvpEnabled;
}
