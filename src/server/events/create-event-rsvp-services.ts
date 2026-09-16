import "server-only";

import { EventRsvpService } from "@/application/events/manage-event-rsvp";
import { PostgresCapabilityAuthorizer } from "@/server/authorization/postgres-capability-authorizer";
import { DrizzleEventRsvpRepository } from "@/server/repositories/event-rsvp-repository";
import { DrizzleGuildTermRepository } from "@/server/repositories/guild-term-repository";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import { DrizzleRoleGrantRepository } from "@/server/repositories/role-grant-repository";
import { DrizzleTenantRepository } from "@/server/repositories/tenant-repository";
import { db } from "@/server/db/client";

export function createEventRsvpServices() {
  const memberships = new DrizzleMembershipRepository();
  const tenants = new DrizzleTenantRepository();
  const guildTerms = new DrizzleGuildTermRepository();
  const roleGrants = new DrizzleRoleGrantRepository();
  const capabilityAuthorizer = new PostgresCapabilityAuthorizer({
    tenants,
    memberships,
    guildTerms,
    roleGrants,
  });
  const rsvps = new DrizzleEventRsvpRepository(db);
  const participation = new EventRsvpService({
    rsvps,
    capabilityAuthorizer,
  });
  return {
    participation,
    rsvps,
  };
}
