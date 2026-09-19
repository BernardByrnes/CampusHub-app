import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";

import {
  decideEventRsvpXpAward,
  EVENT_RSVP_RULE_ID,
  EVENT_RSVP_RULE_VERSION,
  EVENT_RSVP_SOURCE_KIND,
  EVENT_RSVP_SOURCE_OCCURRENCE,
  EVENT_RSVP_XP_DEFAULT,
  type XpAwardDecision,
} from "@/domain/xp/xp-ledger";
import type { CampusHubDatabase } from "@/server/db/client";
import {
  xpEventRsvpSourceClaims,
  xpLedgerEntries,
  xpSourceClaims,
  type XpLedgerEntryRow,
  type XpSourceClaimRow,
} from "@/server/db/schema";

export type XpLedgerTransactionDatabase = Pick<
  CampusHubDatabase,
  "select" | "insert" | "execute"
>;

export type EventRsvpXpAwardAppendInput = Readonly<{
  tenantId: string;
  membershipId: string;
  eventId: string;
  tenantTimezone: string;
  occurredAt: Date;
  requestIdempotencyKey: string;
  afterAdvisoryLockAcquired?: () => Promise<void>;
}>;

export type EventRsvpXpAwardAppendResult = Readonly<{
  entryType: "award" | "capped_award";
  amount: number;
  sourceClaimId: string;
  ledgerEntryId: string;
  tenantDay: string;
}>;

function requestKeyDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseTenantDay(value: unknown): string {
  const day = typeof value === "string" ? value : String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("Authoritative Tenant-local XP day was unavailable.");
  }
  return day;
}

function parseAwardedToday(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Invalid normal-positive XP total.");
  }
  return amount;
}

function canonicalResult(
  claim: XpSourceClaimRow,
  ledger: XpLedgerEntryRow,
): EventRsvpXpAwardAppendResult {
  if (
    claim.expectedEntryType !== "award" &&
    claim.expectedEntryType !== "capped_award"
  ) throw new Error("Invalid Event RSVP XP source-claim outcome.");
  if (
    ledger.tenantId !== claim.tenantId ||
    ledger.membershipId !== claim.membershipId ||
    ledger.sourceClaimId !== claim.id ||
    ledger.id !== claim.canonicalLedgerEntryId ||
    ledger.ruleId !== claim.ruleId ||
    ledger.ruleVersion !== claim.ruleVersion ||
    ledger.sourceKind !== claim.sourceKind ||
    ledger.sourceReferenceId !== claim.sourceReferenceId ||
    ledger.sourceOccurrence !== claim.sourceOccurrence ||
    ledger.entryType !== claim.expectedEntryType ||
    (ledger.entryType === "award" && ledger.amount <= 0) ||
    (ledger.entryType === "capped_award" && ledger.amount !== 0)
  ) throw new Error("XP source claim and ledger fact do not match.");
  return {
    entryType: ledger.entryType,
    amount: ledger.amount,
    sourceClaimId: claim.id,
    ledgerEntryId: ledger.id,
    tenantDay: ledger.tenantDay,
  };
}

async function findCanonicalClaim(
  transaction: XpLedgerTransactionDatabase,
  input: Pick<EventRsvpXpAwardAppendInput, "tenantId" | "membershipId" | "eventId">,
): Promise<EventRsvpXpAwardAppendResult | null> {
  const claims = await transaction
    .select()
    .from(xpSourceClaims)
    .where(and(
      eq(xpSourceClaims.tenantId, input.tenantId),
      eq(xpSourceClaims.membershipId, input.membershipId),
      eq(xpSourceClaims.ruleId, EVENT_RSVP_RULE_ID),
      eq(xpSourceClaims.sourceKind, EVENT_RSVP_SOURCE_KIND),
      eq(xpSourceClaims.sourceReferenceId, input.eventId),
      eq(xpSourceClaims.sourceOccurrence, EVENT_RSVP_SOURCE_OCCURRENCE),
    ))
    .limit(1);
  const claim = claims[0];
  if (claim === undefined) return null;

  const ledgers = await transaction
    .select()
    .from(xpLedgerEntries)
    .where(and(
      eq(xpLedgerEntries.tenantId, input.tenantId),
      eq(xpLedgerEntries.id, claim.canonicalLedgerEntryId),
    ))
    .limit(1);
  const ledger = ledgers[0];
  if (ledger === undefined) throw new Error("XP source claim has no canonical ledger fact.");
  return canonicalResult(claim, ledger);
}

async function authoritativeTenantDay(
  transaction: XpLedgerTransactionDatabase,
  occurredAt: Date,
  timezone: string,
): Promise<string> {
  const rows = await transaction.execute(sql`
    select (
      (${occurredAt}::timestamptz at time zone ${timezone})::date::text
    ) as tenant_day
  `);
  return parseTenantDay((rows.rows[0] as { tenant_day?: unknown } | undefined)?.tenant_day);
}

async function lockTenantMembershipDay(
  transaction: XpLedgerTransactionDatabase,
  tenantId: string,
  membershipId: string,
  tenantDay: string,
): Promise<void> {
  const lockKey = `${tenantId}:${membershipId}:${tenantDay}`;
  await transaction.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
  `);
}

function decisionResult(
  decision: XpAwardDecision,
  sourceClaimId: string,
  ledgerEntryId: string,
): EventRsvpXpAwardAppendResult {
  return {
    entryType: decision.entryType,
    amount: decision.amount,
    sourceClaimId,
    ledgerEntryId,
    tenantDay: decision.tenantDay,
  };
}

/**
 * Appends the one-time Event RSVP XP claim and its immutable ledger fact in
 * the caller's RSVP transaction. The advisory transaction lock serializes the
 * approved Tenant/Membership/local-day cap key; the conceptual source unique
 * constraint remains the duplicate-award boundary across request keys.
 */
export async function appendEventRsvpAwardInTransaction(
  transaction: XpLedgerTransactionDatabase,
  input: EventRsvpXpAwardAppendInput,
): Promise<EventRsvpXpAwardAppendResult> {
  if (
    input.tenantId.trim().length === 0 ||
    input.membershipId.trim().length === 0 ||
    input.eventId.trim().length === 0 ||
    input.tenantTimezone.trim().length === 0 ||
    !(input.occurredAt instanceof Date) ||
    Number.isNaN(input.occurredAt.getTime()) ||
    input.requestIdempotencyKey.trim().length === 0
  ) throw new Error("Invalid Event RSVP XP award input.");

  const tenantDay = await authoritativeTenantDay(
    transaction,
    input.occurredAt,
    input.tenantTimezone,
  );
  await lockTenantMembershipDay(
    transaction,
    input.tenantId,
    input.membershipId,
    tenantDay,
  );
  await input.afterAdvisoryLockAcquired?.();

  const existing = await findCanonicalClaim(transaction, input);
  if (existing !== null) return existing;

  const totals = await transaction
    .select({
      awardedToday: sql<number>`coalesce(sum(${xpLedgerEntries.amount}), 0)::integer`,
    })
    .from(xpLedgerEntries)
    .where(and(
      eq(xpLedgerEntries.tenantId, input.tenantId),
      eq(xpLedgerEntries.membershipId, input.membershipId),
      eq(xpLedgerEntries.tenantDay, tenantDay),
      eq(xpLedgerEntries.entryType, "award"),
    ));
  const decision = decideEventRsvpXpAward({
    proposedAmount: EVENT_RSVP_XP_DEFAULT,
    awardedToday: parseAwardedToday(totals[0]?.awardedToday),
    tenantDay,
  });
  if (decision === null) throw new Error("Event RSVP XP policy rejected the award.");

  const sourceClaimId = randomUUID();
  const ledgerEntryId = randomUUID();
  const claimRows = await transaction
    .insert(xpSourceClaims)
    .values({
      id: sourceClaimId,
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      ruleId: EVENT_RSVP_RULE_ID,
      ruleVersion: EVENT_RSVP_RULE_VERSION,
      sourceKind: EVENT_RSVP_SOURCE_KIND,
      sourceReferenceId: input.eventId,
      sourceOccurrence: EVENT_RSVP_SOURCE_OCCURRENCE,
      expectedEntryType: decision.entryType,
      canonicalLedgerEntryId: ledgerEntryId,
    })
    .onConflictDoNothing({
      target: [
        xpSourceClaims.tenantId,
        xpSourceClaims.membershipId,
        xpSourceClaims.ruleId,
        xpSourceClaims.sourceKind,
        xpSourceClaims.sourceReferenceId,
        xpSourceClaims.sourceOccurrence,
      ],
    })
    .returning();
  if (claimRows.length === 0) {
    const retry = await findCanonicalClaim(transaction, input);
    if (retry === null) throw new Error("XP source claim conflict had no canonical row.");
    return retry;
  }

  await transaction.insert(xpEventRsvpSourceClaims).values({
    tenantId: input.tenantId,
    sourceClaimId,
    eventId: input.eventId,
    createdAt: input.occurredAt,
  });
  await transaction.insert(xpLedgerEntries).values({
    id: ledgerEntryId,
    tenantId: input.tenantId,
    membershipId: input.membershipId,
    entryType: decision.entryType,
    amount: decision.amount,
    ruleId: EVENT_RSVP_RULE_ID,
    ruleVersion: EVENT_RSVP_RULE_VERSION,
    sourceKind: EVENT_RSVP_SOURCE_KIND,
    sourceReferenceId: input.eventId,
    sourceOccurrence: EVENT_RSVP_SOURCE_OCCURRENCE,
    sourceClaimId,
    requestIdempotencyKeyDigest: requestKeyDigest(input.requestIdempotencyKey),
    tenantDay,
    occurredAt: input.occurredAt,
    createdAt: input.occurredAt,
  });

  return decisionResult(decision, sourceClaimId, ledgerEntryId);
}
