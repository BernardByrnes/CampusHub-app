import "server-only";

import {
  authorizeResourceRead,
  authorizeResourceReadBeforeAudience,
  isResourceReadViewer,
  type ResourceReadViewer,
} from "@/domain/authorization/resource-read-policy";
import type { ResolvedTenantReadFacts } from "@/domain/authorization/publication-read-contract";
import { isUuid } from "@/domain/identifiers/uuid";
import { evaluateEventAudience } from "@/domain/events/event-audience";
import { isEventPast, type Event } from "@/domain/events/events";
import type { EventRecord, DrizzleEventRepository, EventListOptions } from "@/server/repositories/event-repository";
import type { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";

export type EventReadProjection = Readonly<{
  id: string;
  tenantId: string;
  version: number;
  title: string;
  description: string;
  venue: string;
  startsAt: Date;
  endsAt: Date | null;
  campusId: string;
  visibility: Event["visibility"];
  rsvpEnabled: boolean;
  lifecycle: "published";
  past: boolean;
}>;

export type EventReadInput = Readonly<{
  tenantId: string;
  eventId: string;
  viewer: ResourceReadViewer;
  tenantFacts: ResolvedTenantReadFacts;
  now: Date;
  includePast?: boolean;
}>;

export type EventReadResult =
  | Readonly<{ outcome: "FOUND"; event: EventReadProjection }>
  | Readonly<{ outcome: "NOT_FOUND" }>;

export type EventCollectionInput = Readonly<{
  tenantId: string;
  viewer: ResourceReadViewer;
  tenantFacts: ResolvedTenantReadFacts;
  now: Date;
  campusId?: string;
  visibility?: Event["visibility"];
  limit?: number;
  includePast?: boolean;
}>;

export type EventCollectionResult =
  | Readonly<{ outcome: "OK"; items: readonly EventReadProjection[] }>
  | Readonly<{ outcome: "DENIED"; code: "INVALID_INPUT" | "NOT_FOUND" }>;

export type EventReadServiceDependencies = Readonly<{
  events: Pick<DrizzleEventRepository, "findEventByIdForTenant" | "listEventsForTenant">;
  memberships: Pick<DrizzleMembershipRepository, "findMembershipAudienceFactsByIdForTenant">;
}>;

function project(record: EventRecord, now: Date): EventReadProjection | null {
  if (record.event.lifecycle !== "published") return null;
  return {
    id: record.event.id,
    tenantId: record.event.tenantId,
    version: record.event.version,
    title: record.event.title,
    description: record.event.description,
    venue: record.event.venue,
    startsAt: record.event.startsAt,
    endsAt: record.event.endsAt,
    campusId: record.event.campusId,
    visibility: record.event.visibility,
    rsvpEnabled: record.event.rsvpEnabled,
    lifecycle: "published",
    past: isEventPast(record.event, now),
  };
}

function viewerTenant(viewer: ResourceReadViewer): string {
  return viewer.kind === "anonymous" ? viewer.tenantId : viewer.context.tenantId;
}

function factsForViewer(
  viewer: ResourceReadViewer,
  tenantId: string,
  memberships: EventReadServiceDependencies["memberships"],
) {
  return viewer.kind === "membership"
    ? memberships.findMembershipAudienceFactsByIdForTenant(tenantId, viewer.context.membershipId)
    : Promise.resolve(null);
}

async function allowed(
  record: EventRecord,
  input: EventReadInput | EventCollectionInput,
  dependencies: EventReadServiceDependencies,
): Promise<boolean> {
  if (!isResourceReadViewer(input.viewer) || viewerTenant(input.viewer) !== input.tenantId || input.tenantFacts.tenantId !== input.tenantId || record.event.tenantId !== input.tenantId || record.event.lifecycle !== "published") return false;
  const past = isEventPast(record.event, input.now);
  if (past && !input.includePast) return false;
  const base = {
    resourceId: record.event.id,
    tenantId: record.event.tenantId,
    tenantStatus: input.tenantFacts.tenantStatus,
    visibility: record.event.visibility,
    readable: true,
    publicSurfacePermitted: input.tenantFacts.publicSurfacePermitted,
    onLeaveReadEnabled: input.tenantFacts.onLeaveReadEnabled,
    alumniPublicReadEnabled: input.tenantFacts.alumniPublicReadEnabled,
  } as const;
  if (!authorizeResourceReadBeforeAudience({ resource: base, viewer: input.viewer }).allowed) return false;
  const audienceFacts = await factsForViewer(input.viewer, input.tenantId, dependencies.memberships);
  const audience = record.event.audienceMode === "entire_tenant"
    ? { restricted: false as const }
    : { restricted: true as const, eligible: evaluateEventAudience(record.audience, audienceFacts).eligible };
  return authorizeResourceRead({ resource: { ...base, audience }, viewer: input.viewer }).allowed;
}

export class ReadEventService {
  public constructor(private readonly dependencies: EventReadServiceDependencies) {}

  public async getEventForRead(input: EventReadInput): Promise<EventReadResult> {
    if (!isUuid(input.tenantId) || !isUuid(input.eventId)) return { outcome: "NOT_FOUND" };
    const record = await this.dependencies.events.findEventByIdForTenant(input.tenantId, input.eventId);
    if (record === null || !(await allowed(record, { ...input, includePast: true }, this.dependencies))) return { outcome: "NOT_FOUND" };
    const event = project(record, input.now);
    return event === null ? { outcome: "NOT_FOUND" } : { outcome: "FOUND", event };
  }

  public async listEvents(input: EventCollectionInput): Promise<EventCollectionResult> {
    if (!isUuid(input.tenantId) || !isResourceReadViewer(input.viewer) || viewerTenant(input.viewer) !== input.tenantId || input.tenantFacts.tenantId !== input.tenantId) return { outcome: "DENIED", code: "INVALID_INPUT" };
    const options: EventListOptions = { now: input.now, campusId: input.campusId, visibility: input.visibility, limit: input.limit, includePast: input.includePast };
    const records = await this.dependencies.events.listEventsForTenant(input.tenantId, options);
    const items: EventReadProjection[] = [];
    for (const record of records) {
      if (!(await allowed(record, input, this.dependencies))) continue;
      const item = project(record, input.now);
      if (item !== null) items.push(item);
    }
    return { outcome: "OK", items };
  }
}
