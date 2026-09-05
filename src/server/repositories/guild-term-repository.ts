import "server-only";

import { and, eq, gt, lte } from "drizzle-orm";

import {
  isGuildTerm,
  parseGuildTermStatus,
  type GuildTerm,
} from "@/domain/governance/guild-term";
import { isUuid } from "@/domain/identifiers/uuid";
import { db, type CampusHubDatabase } from "@/server/db/client";
import { guildTerms, type GuildTermRow } from "@/server/db/schema";

function toGuildTerm(row: GuildTermRow): GuildTerm | null {
  const status = parseGuildTermStatus(row.status);
  if (status === null) {
    return null;
  }

  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    label: row.label,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  return isGuildTerm(candidate) ? candidate : null;
}

export type GuildTermAuthorizationReader = Readonly<{
  findActiveGuildTermForTenant(
    tenantId: string,
    now: Date,
  ): Promise<GuildTerm | null>;
}>;

export class DrizzleGuildTermRepository
  implements GuildTermAuthorizationReader
{
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async findActiveGuildTermForTenant(
    tenantId: string,
    now: Date,
  ): Promise<GuildTerm | null> {
    if (
      !isUuid(tenantId) ||
      !(now instanceof Date) ||
      Number.isNaN(now.getTime())
    ) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(guildTerms)
      .where(
        and(
          eq(guildTerms.tenantId, tenantId),
          eq(guildTerms.status, "active"),
          lte(guildTerms.startsAt, now),
          gt(guildTerms.endsAt, now),
        ),
      )
      .limit(1);

    return rows[0] ? toGuildTerm(rows[0]) : null;
  }
}
