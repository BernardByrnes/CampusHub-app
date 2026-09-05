export const GUILD_TERM_STATUSES = ["upcoming", "active", "closed"] as const;

export type GuildTermStatus = (typeof GUILD_TERM_STATUSES)[number];

export type GuildTerm = Readonly<{
  id: string;
  tenantId: string;
  label: string;
  startsAt: Date;
  endsAt: Date;
  status: GuildTermStatus;
  createdAt: Date;
  updatedAt: Date;
}>;

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function parseGuildTermStatus(value: unknown): GuildTermStatus | null {
  return typeof value === "string" &&
    GUILD_TERM_STATUSES.includes(value as GuildTermStatus)
    ? (value as GuildTermStatus)
    : null;
}

export function isGuildTerm(value: unknown): value is GuildTerm {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" && candidate.id.trim().length > 0 &&
    typeof candidate.tenantId === "string" &&
    candidate.tenantId.trim().length > 0 &&
    typeof candidate.label === "string" && candidate.label.trim().length > 0 &&
    isValidDate(candidate.startsAt) &&
    isValidDate(candidate.endsAt) &&
    candidate.startsAt.getTime() < candidate.endsAt.getTime() &&
    parseGuildTermStatus(candidate.status) !== null &&
    isValidDate(candidate.createdAt) &&
    isValidDate(candidate.updatedAt)
  );
}
