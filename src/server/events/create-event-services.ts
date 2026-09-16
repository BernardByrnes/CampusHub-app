import "server-only";

import { EnvironmentAuditIntegrityKeyProvider } from "@/domain/audit/audit-integrity-key-provider";
import { EventManagementService } from "@/application/events/manage-events";
import { ReadEventService } from "@/application/events/read-events";
import { PostgresCapabilityAuthorizer } from "@/server/authorization/postgres-capability-authorizer";
import { PostgresAuthorizedEventManagementExecutor } from "@/server/authorization/postgres-authorized-events";
import { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import { DrizzleEventRepository } from "@/server/repositories/event-repository";
import { DrizzleGuildTermRepository } from "@/server/repositories/guild-term-repository";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import { DrizzleRoleGrantRepository } from "@/server/repositories/role-grant-repository";
import { DrizzleTenantRepository } from "@/server/repositories/tenant-repository";
import { db } from "@/server/db/client";
import { createEventRsvpServices } from "./create-event-rsvp-services";

export function createEventServices() {
  const events = new DrizzleEventRepository();
  const memberships = new DrizzleMembershipRepository();
  const tenants = new DrizzleTenantRepository();
  const guildTerms = new DrizzleGuildTermRepository();
  const roleGrants = new DrizzleRoleGrantRepository();
  const authorizer = new PostgresCapabilityAuthorizer({
    tenants,
    memberships,
    guildTerms,
    roleGrants,
  });
  const auditEvents = new DrizzleAuditEventRepository({
    database: db,
    keyProvider: new EnvironmentAuditIntegrityKeyProvider(),
  });
  const gateway = new PostgresAuthorizedEventManagementExecutor({
    database: db,
    authorizer,
    auditEvents,
    eventRepository: events,
  });
  const rsvp = createEventRsvpServices();
  return {
    management: new EventManagementService({ capabilityAuthorizer: authorizer, gateway }),
    reads: new ReadEventService({ events, memberships }),
    participation: rsvp.participation,
    participationRepository: rsvp.rsvps,
  };
}
