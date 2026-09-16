import "server-only";

import {
  authorizeResourceRead,
  authorizeResourceReadBeforeAudience,
  isResourceReadViewer,
  type ResourceReadViewer,
} from "@/domain/authorization/resource-read-policy";
import type { ResolvedTenantReadFacts } from "@/domain/authorization/publication-read-contract";
import { evaluateEventAudience, type EventAudienceDefinition } from "@/domain/events/event-audience";
import { isEventPast, type Event } from "@/domain/events/events";
import { isOrganiser, type Organiser } from "@/domain/organisers/organisers";
import type { MembershipAudienceFacts } from "@/domain/membership/membership-audience";

export type EventDetailReadRecord = Readonly<{
  event: Event;
  audience: EventAudienceDefinition;
  organiser: Organiser | null;
}>;

export type EventDetailReadAuthorizationInput = Readonly<{
  record: EventDetailReadRecord;
  viewer: ResourceReadViewer;
  tenantFacts: ResolvedTenantReadFacts;
  membershipFacts: MembershipAudienceFacts | null;
  now: Date;
  includePast?: boolean;
}>;

/**
 * The canonical Event-detail authorization seam. RSVP reads call this same
 * policy instead of maintaining a weaker Event-specific visibility check.
 */
export function authorizeEventDetailRead(
  input: EventDetailReadAuthorizationInput,
): boolean {
  const { record, viewer, tenantFacts, membershipFacts, now } = input;
  if (
    !isResourceReadViewer(viewer) ||
    tenantFacts.tenantId !== record.event.tenantId ||
    record.event.lifecycle === "draft" ||
    (record.event.lifecycle === "cancelled" && record.event.cancellationRetentionUntil === null)
  ) return false;

  if (record.event.organiserId === null) {
    if (record.organiser !== null) return false;
  } else if (
    record.organiser === null ||
    !isOrganiser(record.organiser) ||
    record.organiser.id !== record.event.organiserId ||
    record.organiser.tenantId !== record.event.tenantId
  ) return false;

  if (isEventPast(record.event, now) && input.includePast !== true) return false;

  const resource = {
    resourceId: record.event.id,
    tenantId: record.event.tenantId,
    tenantStatus: tenantFacts.tenantStatus,
    visibility: record.event.visibility,
    readable: true,
    publicSurfacePermitted: tenantFacts.publicSurfacePermitted,
    onLeaveReadEnabled: tenantFacts.onLeaveReadEnabled,
    alumniPublicReadEnabled: tenantFacts.alumniPublicReadEnabled,
    archiveNoticeState: tenantFacts.archiveNoticeState,
  } as const;

  if (!authorizeResourceReadBeforeAudience({ resource, viewer }).allowed) return false;

  const audience = record.event.audienceMode === "entire_tenant"
    ? { restricted: false as const }
    : { restricted: true as const, eligible: evaluateEventAudience(record.audience, membershipFacts).eligible };
  return authorizeResourceRead({ resource: { ...resource, audience }, viewer }).allowed;
}
