import "server-only";

import { eq } from "drizzle-orm";

import {
  isTenant,
  isValidIanaTimezone,
  isValidTenantSlug,
  parseTenantLifecycle,
  type Tenant,
} from "@/domain/tenancy/tenant";
import { isUuid } from "@/domain/identifiers/uuid";
import { db, type CampusHubDatabase } from "@/server/db/client";
import { tenants, type TenantRow } from "@/server/db/schema";

import type { TenantContextReader } from "@/application/context/context-readers";

function toTenant(row: TenantRow): Tenant | null {
  const status = parseTenantLifecycle(row.status);
  if (status === null || !isValidIanaTimezone(row.timezone)) {
    return null;
  }

  const candidate = {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    status,
    timezone: row.timezone,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  return isTenant(candidate) ? candidate : null;
}

export class DrizzleTenantRepository implements TenantContextReader {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async findTenantById(id: string): Promise<Tenant | null> {
    if (!isUuid(id)) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    return rows[0] ? toTenant(rows[0]) : null;
  }

  public async findTenantBySlug(slug: string): Promise<Tenant | null> {
    if (!isValidTenantSlug(slug)) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    return rows[0] ? toTenant(rows[0]) : null;
  }
}
