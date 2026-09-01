import type { Membership } from "@/domain/membership/membership";
import type { Tenant } from "@/domain/tenancy/tenant";

export interface TenantContextReader {
  findTenantById(id: string): Promise<Tenant | null>;
  findTenantBySlug(slug: string): Promise<Tenant | null>;
}

export interface MembershipContextReader {
  findMembershipByIdForTenant(
    tenantId: string,
    membershipId: string,
  ): Promise<Membership | null>;
  findMembershipForIdentityAndTenant(
    identitySubjectId: string,
    tenantId: string,
  ): Promise<Membership | null>;
}
