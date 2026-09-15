import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import {
  isOrganiser,
  parseOrganiserName,
  type CreateOrganiserInput,
  type Organiser,
  type UpdateOrganiserInput,
  ORGANISERS_LIST_MAX_LIMIT,
} from "@/domain/organisers/organisers";
import { isUuid } from "@/domain/identifiers/uuid";
import { db, type CampusHubDatabase } from "@/server/db/client";
import { organisers } from "@/server/db/schema";

export type OrganiserMutationError =
  | "PERMISSION_DENIED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "INVALID_STATE"
  | "NOT_READY"
  | "PERSISTENCE_FAILED";

export type OrganiserMutationResult =
  | Readonly<{ ok: true; organiser: Organiser; changed: boolean }>
  | Readonly<{ ok: false; error: OrganiserMutationError }>;

export type OrganiserRepositoryTransactionDatabase = Pick<
  CampusHubDatabase,
  "select" | "insert" | "update"
>;

export type PreparedOrganiserMutation = Readonly<{
  organiser: Organiser;
}>;

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function toOrganiser(row: typeof organisers.$inferSelect): Organiser | null {
  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    version: row.version,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return isOrganiser(candidate) ? candidate : null;
}

function validCreate(
  tenantId: string,
  organiserId: string,
  input: CreateOrganiserInput,
  occurredAt: Date,
): boolean {
  return isUuid(tenantId) &&
    isUuid(organiserId) &&
    parseOrganiserName(input.name) !== null &&
    isValidDate(occurredAt);
}

export class DrizzleOrganiserRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async prepareCreateOrganiserInTransaction(
    _transaction: OrganiserRepositoryTransactionDatabase,
    tenantId: string,
    organiserId: string,
    input: CreateOrganiserInput,
  ): Promise<boolean> {
    return isUuid(tenantId) &&
      isUuid(organiserId) &&
      parseOrganiserName(input.name) !== null;
  }

  public async createOrganiserInTransaction(
    transaction: OrganiserRepositoryTransactionDatabase,
    tenantId: string,
    organiserId: string,
    input: CreateOrganiserInput,
    occurredAt = new Date(),
  ): Promise<OrganiserMutationResult> {
    if (!validCreate(tenantId, organiserId, input, occurredAt)) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
    try {
      const name = parseOrganiserName(input.name);
      if (name === null) return { ok: false, error: "PERSISTENCE_FAILED" };
      const rows = await transaction.insert(organisers).values({
        id: organiserId,
        tenantId,
        version: 1,
        name,
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }).returning();
      const organiser = rows[0] === undefined ? null : toOrganiser(rows[0]);
      return organiser === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, organiser, changed: true };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async prepareOrganiserMutationInTransaction(
    transaction: OrganiserRepositoryTransactionDatabase,
    tenantId: string,
    organiserId: string,
    expectedVersion: number,
  ): Promise<PreparedOrganiserMutation | OrganiserMutationError> {
    if (!isUuid(tenantId) || !isUuid(organiserId)) return "PERMISSION_DENIED";
    const rows = await transaction
      .select()
      .from(organisers)
      .where(and(eq(organisers.tenantId, tenantId), eq(organisers.id, organiserId)))
      .orderBy(asc(organisers.id))
      .for("update")
      .limit(1);
    const organiser = rows[0] === undefined ? null : toOrganiser(rows[0]);
    if (organiser === null) return "NOT_FOUND";
    if (organiser.version !== expectedVersion) return "VERSION_CONFLICT";
    return { organiser };
  }

  public async updateOrganiserInTransaction(
    transaction: OrganiserRepositoryTransactionDatabase,
    tenantId: string,
    organiserId: string,
    input: UpdateOrganiserInput,
    prepared: PreparedOrganiserMutation,
    occurredAt = new Date(),
  ): Promise<OrganiserMutationResult> {
    if (!isUuid(tenantId) || !isUuid(organiserId) || !isValidDate(occurredAt)) {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
    const existing = prepared.organiser;
    if (existing.id !== organiserId || existing.tenantId !== tenantId || existing.version !== input.expectedVersion) {
      return { ok: false, error: "VERSION_CONFLICT" };
    }
    const name = parseOrganiserName(input.name);
    if (name === null) return { ok: false, error: "NOT_READY" };
    if (existing.name === name) return { ok: true, organiser: existing, changed: false };
    try {
      const rows = await transaction.update(organisers).set({
        name,
        version: sql`${organisers.version} + 1`,
        updatedAt: occurredAt,
      }).where(and(
        eq(organisers.tenantId, tenantId),
        eq(organisers.id, organiserId),
        eq(organisers.version, input.expectedVersion),
      )).returning();
      const organiser = rows[0] === undefined ? null : toOrganiser(rows[0]);
      return organiser === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, organiser, changed: true };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
  }

  public async findOrganiserByIdForTenant(
    tenantId: string,
    organiserId: string,
  ): Promise<Organiser | null> {
    if (!isUuid(tenantId) || !isUuid(organiserId)) return null;
    const rows = await this.database
      .select()
      .from(organisers)
      .where(and(eq(organisers.tenantId, tenantId), eq(organisers.id, organiserId)))
      .limit(1);
    return rows[0] === undefined ? null : toOrganiser(rows[0]);
  }

  public async listOrganisersForTenant(
    tenantId: string,
    limit = 50,
  ): Promise<readonly Organiser[]> {
    if (!isUuid(tenantId) || !Number.isSafeInteger(limit) || limit < 1 || limit > ORGANISERS_LIST_MAX_LIMIT) {
      return [];
    }
    const rows = await this.database
      .select()
      .from(organisers)
      .where(eq(organisers.tenantId, tenantId))
      .orderBy(asc(organisers.name), asc(organisers.id))
      .limit(limit);
    return rows.flatMap((row) => {
      const organiser = toOrganiser(row);
      return organiser === null ? [] : [organiser];
    });
  }
}
