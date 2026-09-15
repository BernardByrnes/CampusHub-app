import "server-only";

import { OrganiserManagementService } from "@/application/organisers/manage-organisers";
import { EnvironmentAuditIntegrityKeyProvider } from "@/domain/audit/audit-integrity-key-provider";
import { PostgresCapabilityAuthorizer } from "@/server/authorization/postgres-capability-authorizer";
import { PostgresAuthorizedOrganiserManagementExecutor } from "@/server/authorization/postgres-authorized-organisers";
import { db } from "@/server/db/client";
import { DrizzleAuditEventRepository } from "@/server/repositories/audit-event-repository";
import { DrizzleGuildTermRepository } from "@/server/repositories/guild-term-repository";
import { DrizzleMembershipRepository } from "@/server/repositories/membership-repository";
import { DrizzleOrganiserRepository } from "@/server/repositories/organiser-repository";
import { DrizzleRoleGrantRepository } from "@/server/repositories/role-grant-repository";
import { DrizzleTenantRepository } from "@/server/repositories/tenant-repository";

export function createOrganiserServices() {
  const organisers = new DrizzleOrganiserRepository();
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
  const gateway = new PostgresAuthorizedOrganiserManagementExecutor({
    database: db,
    auditEvents,
    organiserRepository: organisers,
  });
  return {
    management: new OrganiserManagementService({
      capabilityAuthorizer: authorizer,
      gateway,
      organisers,
    }),
  };
}
