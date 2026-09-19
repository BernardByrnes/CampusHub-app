import { isUuid } from "@/domain/identifiers/uuid";

export const XP_PILOT_DAILY_CAP = 50 as const;
export const EVENT_RSVP_XP_DEFAULT = 5 as const;
export const EVENT_RSVP_XP_MIN = 1 as const;
export const EVENT_RSVP_XP_MAX = 10 as const;
export const EVENT_RSVP_RULE_ID = "event.rsvp" as const;
export const EVENT_RSVP_RULE_VERSION = 1 as const;
export const EVENT_RSVP_SOURCE_KIND = "event_rsvp" as const;
export const EVENT_RSVP_SOURCE_OCCURRENCE = "initial_eligible_rsvp" as const;

export const XP_LEDGER_ENTRY_TYPES = [
  "award",
  "capped_award",
  "correction",
  "reversal",
] as const;
export type XpLedgerEntryType = (typeof XP_LEDGER_ENTRY_TYPES)[number];

export type XpAwardDecision = Readonly<{
  entryType: "award" | "capped_award";
  amount: number;
  awardedToday: number;
  tenantDay: string;
}>;

export type EventRsvpXpSource = Readonly<{
  tenantId: string;
  membershipId: string;
  eventId: string;
}>;

export function isEventRsvpXpAmount(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= EVENT_RSVP_XP_MIN &&
    value <= EVENT_RSVP_XP_MAX;
}

export function decideEventRsvpXpAward(input: Readonly<{
  proposedAmount: number;
  awardedToday: number;
  tenantDay: string;
}>): XpAwardDecision | null {
  if (
    !isEventRsvpXpAmount(input.proposedAmount) ||
    !Number.isSafeInteger(input.awardedToday) ||
    input.awardedToday < 0 ||
    input.awardedToday > XP_PILOT_DAILY_CAP ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.tenantDay)
  ) return null;

  const fits = input.awardedToday + input.proposedAmount <= XP_PILOT_DAILY_CAP;
  return {
    entryType: fits ? "award" : "capped_award",
    amount: fits ? input.proposedAmount : 0,
    awardedToday: input.awardedToday,
    tenantDay: input.tenantDay,
  };
}

export function isEventRsvpXpSource(value: unknown): value is EventRsvpXpSource {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isUuid(candidate.tenantId) &&
    isUuid(candidate.membershipId) &&
    isUuid(candidate.eventId);
}
