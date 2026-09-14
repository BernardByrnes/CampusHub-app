import {
  isPublicationAudienceDefinition,
  evaluatePublicationAudience,
  type PublicationAudienceDefinition,
  type PublicationAudienceGroup,
  type PublicationResidenceTarget,
} from "@/domain/authorization/publication-audience";
import type { PublicationAudienceMode } from "@/domain/content/publication";
import { isUuid } from "@/domain/identifiers/uuid";

export type EventAudienceDefinition = Readonly<{
  eventId: string;
  tenantId: string;
  mode: PublicationAudienceMode;
  groups: readonly PublicationAudienceGroup[];
}>;

export type {
  PublicationAudienceGroup,
  PublicationResidenceTarget,
};

export function isEventAudienceDefinition(
  value: unknown,
): value is EventAudienceDefinition {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (!isUuid(candidate.eventId) || !isUuid(candidate.tenantId)) {
    return false;
  }
  return isPublicationAudienceDefinition({
    publicationId: candidate.eventId,
    tenantId: candidate.tenantId,
    mode: candidate.mode,
    groups: candidate.groups,
  });
}

export function eventAudienceToPublicationDefinition(
  definition: EventAudienceDefinition,
): PublicationAudienceDefinition {
  return {
    publicationId: definition.eventId,
    tenantId: definition.tenantId,
    mode: definition.mode,
    groups: definition.groups,
  };
}

export function evaluateEventAudience(
  definition: unknown,
  membershipFacts: unknown,
): { evaluated: true; eligible: boolean } {
  if (!isEventAudienceDefinition(definition)) {
    return { evaluated: true, eligible: false };
  }
  return evaluatePublicationAudience(
    eventAudienceToPublicationDefinition(definition),
    membershipFacts,
  );
}
