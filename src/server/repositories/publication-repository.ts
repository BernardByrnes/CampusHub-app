import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";

import {
  isPublicationAudienceDefinition,
  type PublicationAudienceDefinition,
  type PublicationAudienceGroup,
  type PublicationResidenceTarget,
  parsePublicationAudienceProvenancePolicy,
} from "@/domain/authorization/publication-audience";
import {
  isPublication,
  parsePublicationAudienceMode,
  parsePublicationLifecycle,
  parsePublicationPriority,
  parsePublicationType,
  type Publication,
  type PublicationAudienceMode,
  type PublicationLifecycle,
  type PublicationPriority,
  type PublicationType,
} from "@/domain/content/publication";
import {
  parseResourceVisibility,
  type ResourceVisibility,
} from "@/domain/authorization/resource-visibility";
import { isUuid } from "@/domain/identifiers/uuid";
import {
  isPublicationCollectionCursor,
  MAX_PUBLICATION_CANDIDATES_SCANNED,
  parsePublicationCollectionSurface,
  type PublicationCollectionCandidatePage,
  type PublicationCollectionQuery,
} from "@/domain/content/publication-collection";
import { db, type CampusHubDatabase } from "@/server/db/client";
import {
  publicationAudienceCriteria,
  publications,
  type NewPublicationAudienceCriteriaRow,
  type PublicationRow,
  type PublicationAudienceCriteriaRow,
} from "@/server/db/schema/publication";
import {
  academicDivisions,
  campuses,
  programmes,
  residences,
  tenantAcademicYearConfig,
} from "@/server/db/schema/organization";

export type CreatePublicationInput = Readonly<{
  type: PublicationType;
  title: string;
  body: string;
  priority?: PublicationPriority;
  visibility?: ResourceVisibility;
  lifecycle?: PublicationLifecycle;
  audienceMode: PublicationAudienceMode;
  authorOfficeLabel: string;
  publishAt?: Date | null;
  expiresAt?: Date | null;
}>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableDate(value: unknown): value is Date | null {
  return (
    value === null ||
    (value instanceof Date && !Number.isNaN(value.getTime()))
  );
}

function toPublication(row: PublicationRow): Publication | null {
  const type = parsePublicationType(row.type);
  const priority = parsePublicationPriority(row.priority);
  const lifecycle = parsePublicationLifecycle(row.lifecycle);
  const audienceMode = parsePublicationAudienceMode(row.audienceMode);
  const visibility = parseResourceVisibility(row.visibility);

  if (
    type === null ||
    priority === null ||
    lifecycle === null ||
    audienceMode === null ||
    visibility === null
  ) {
    return null;
  }

  const candidate = {
    id: row.id,
    tenantId: row.tenantId,
    type,
    title: row.title,
    body: row.body,
    priority,
    visibility,
    lifecycle,
    audienceMode,
    authorOfficeLabel: row.authorOfficeLabel,
    publishAt: row.publishAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  return isPublication(candidate) ? candidate : null;
}

type AudienceCriteriaPayload = Readonly<{
  campusId?: string | null;
  academicDivisionId?: string | null;
  programmeId?: string | null;
  academicYear?: number | null;
  residenceTarget?:
    | "specific_residence"
    | "any_resident"
    | "non_resident"
    | null;
  residenceId?: string | null;
}>;

function toAudienceCriteriaRow(
  tenantId: string,
  publicationId: string,
  dimension: NewPublicationAudienceCriteriaRow["dimension"],
  provenancePolicy: NewPublicationAudienceCriteriaRow["provenancePolicy"],
  payload: AudienceCriteriaPayload,
): NewPublicationAudienceCriteriaRow {
  return {
    tenantId,
    publicationId,
    dimension,
    provenancePolicy,
    campusId: payload.campusId ?? null,
    academicDivisionId: payload.academicDivisionId ?? null,
    programmeId: payload.programmeId ?? null,
    academicYear: payload.academicYear ?? null,
    residenceTarget: payload.residenceTarget ?? null,
    residenceId: payload.residenceId ?? null,
  };
}

function audienceDefinitionToCriteriaRows(
  definition: PublicationAudienceDefinition,
): NewPublicationAudienceCriteriaRow[] {
  const rows: NewPublicationAudienceCriteriaRow[] = [];

  for (const group of definition.groups) {
    switch (group.dimension) {
      case "campus":
        for (const campusId of group.campusIds) {
          rows.push(
            toAudienceCriteriaRow(
              definition.tenantId,
              definition.publicationId,
              "campus",
              group.provenancePolicy,
              { campusId },
            ),
          );
        }
        break;
      case "academic_division":
        for (const academicDivisionId of group.academicDivisionIds) {
          rows.push(
            toAudienceCriteriaRow(
              definition.tenantId,
              definition.publicationId,
              "academic_division",
              group.provenancePolicy,
              { academicDivisionId },
            ),
          );
        }
        break;
      case "programme":
        for (const programmeId of group.programmeIds) {
          rows.push(
            toAudienceCriteriaRow(
              definition.tenantId,
              definition.publicationId,
              "programme",
              group.provenancePolicy,
              { programmeId },
            ),
          );
        }
        break;
      case "academic_year":
        for (const academicYear of group.academicYears) {
          rows.push(
            toAudienceCriteriaRow(
              definition.tenantId,
              definition.publicationId,
              "academic_year",
              group.provenancePolicy,
              { academicYear },
            ),
          );
        }
        break;
      case "residence":
        for (const target of group.residenceTargets) {
          rows.push(
            toAudienceCriteriaRow(
              definition.tenantId,
              definition.publicationId,
              "residence",
              group.provenancePolicy,
              residenceTargetPayload(target),
            ),
          );
        }
        break;
    }
  }

  return rows;
}

function residenceTargetPayload(
  target: PublicationResidenceTarget,
): AudienceCriteriaPayload {
  switch (target.kind) {
    case "specific_residence":
      return {
        residenceTarget: target.kind,
        residenceId: target.residenceId,
      };
    case "any_resident":
    case "non_resident":
      return { residenceTarget: target.kind };
  }
}

function residenceTargetSortKey(target: PublicationResidenceTarget): string {
  switch (target.kind) {
    case "specific_residence":
      return `0:${target.residenceId}`;
    case "any_resident":
      return "1";
    case "non_resident":
      return "2";
  }
}

function isAudienceCriteriaPayloadEmpty(row: PublicationAudienceCriteriaRow): boolean {
  return (
    row.campusId === null &&
    row.academicDivisionId === null &&
    row.programmeId === null &&
    row.academicYear === null &&
    row.residenceTarget === null &&
    row.residenceId === null
  );
}

function mapAudienceCriteria(
  tenantId: string,
  publicationId: string,
  publication: Publication,
  rows: readonly PublicationAudienceCriteriaRow[],
): PublicationAudienceDefinition | null {
  if (publication.tenantId !== tenantId || publication.id !== publicationId) {
    return null;
  }

  if (publication.audienceMode === "entire_tenant") {
    return rows.length === 0
      ? {
          tenantId,
          publicationId,
          mode: "entire_tenant",
          groups: [],
        }
      : null;
  }

  if (rows.length === 0) {
    return null;
  }

  const policies = new Map<
    PublicationAudienceGroup["dimension"],
    NewPublicationAudienceCriteriaRow["provenancePolicy"]
  >();
  const campusIds: string[] = [];
  const academicDivisionIds: string[] = [];
  const programmeIds: string[] = [];
  const academicYears: number[] = [];
  const residenceTargets: PublicationResidenceTarget[] = [];

  for (const row of rows) {
    if (
      row.tenantId !== tenantId ||
      row.publicationId !== publicationId ||
      !parsePublicationAudienceProvenancePolicy(row.provenancePolicy) ||
      !["campus", "academic_division", "programme", "academic_year", "residence"].includes(
        row.dimension,
      )
    ) {
      return null;
    }

    const existingPolicy = policies.get(row.dimension);
    if (existingPolicy !== undefined && existingPolicy !== row.provenancePolicy) {
      return null;
    }
    policies.set(row.dimension, row.provenancePolicy);

    switch (row.dimension) {
      case "campus":
        if (
          !isUuid(row.campusId) ||
          !isAudienceCriteriaPayloadEmpty({ ...row, campusId: null })
        ) {
          return null;
        }
        campusIds.push(row.campusId);
        break;
      case "academic_division":
        if (
          !isUuid(row.academicDivisionId) ||
          !isAudienceCriteriaPayloadEmpty({
            ...row,
            academicDivisionId: null,
          })
        ) {
          return null;
        }
        academicDivisionIds.push(row.academicDivisionId);
        break;
      case "programme":
        if (
          !isUuid(row.programmeId) ||
          !isAudienceCriteriaPayloadEmpty({ ...row, programmeId: null })
        ) {
          return null;
        }
        programmeIds.push(row.programmeId);
        break;
      case "academic_year":
        if (
          row.academicYear === null ||
          !Number.isInteger(row.academicYear) ||
          row.academicYear < 1 ||
          !isAudienceCriteriaPayloadEmpty({ ...row, academicYear: null })
        ) {
          return null;
        }
        academicYears.push(row.academicYear);
        break;
      case "residence":
        if (
          row.campusId !== null ||
          row.academicDivisionId !== null ||
          row.programmeId !== null ||
          row.academicYear !== null ||
          row.residenceTarget === null
        ) {
          return null;
        }
        if (row.residenceTarget === "specific_residence") {
          if (!isUuid(row.residenceId)) {
            return null;
          }
          residenceTargets.push({
            kind: "specific_residence",
            residenceId: row.residenceId,
          });
        } else if (
          row.residenceTarget === "any_resident" ||
          row.residenceTarget === "non_resident"
        ) {
          if (row.residenceId !== null) {
            return null;
          }
          residenceTargets.push({ kind: row.residenceTarget });
        } else {
          return null;
        }
        break;
    }
  }

  const groups: PublicationAudienceGroup[] = [];
  const policyFor = (dimension: PublicationAudienceGroup["dimension"]) =>
    policies.get(dimension);
  const campusPolicy = policyFor("campus");
  if (campusIds.length > 0 && campusPolicy !== undefined) {
    groups.push({
      dimension: "campus",
      provenancePolicy: campusPolicy,
      campusIds: [...new Set(campusIds)].sort((a, b) => a.localeCompare(b)),
    });
  }
  const divisionPolicy = policyFor("academic_division");
  if (academicDivisionIds.length > 0 && divisionPolicy !== undefined) {
    groups.push({
      dimension: "academic_division",
      provenancePolicy: divisionPolicy,
      academicDivisionIds: [...new Set(academicDivisionIds)].sort((a, b) =>
        a.localeCompare(b),
      ),
    });
  }
  const programmePolicy = policyFor("programme");
  if (programmeIds.length > 0 && programmePolicy !== undefined) {
    groups.push({
      dimension: "programme",
      provenancePolicy: programmePolicy,
      programmeIds: [...new Set(programmeIds)].sort((a, b) =>
        a.localeCompare(b),
      ),
    });
  }
  const academicYearPolicy = policyFor("academic_year");
  if (academicYears.length > 0 && academicYearPolicy !== undefined) {
    groups.push({
      dimension: "academic_year",
      provenancePolicy: academicYearPolicy,
      academicYears: [...new Set(academicYears)].sort((a, b) => a - b),
    });
  }
  const residencePolicy = policyFor("residence");
  if (residenceTargets.length > 0 && residencePolicy !== undefined) {
    if (
      new Set(residenceTargets.map(residenceTargetSortKey)).size !==
      residenceTargets.length
    ) {
      return null;
    }
    const uniqueResidenceTargets = [
      ...residenceTargets,
    ].sort((left, right) =>
      residenceTargetSortKey(left).localeCompare(residenceTargetSortKey(right)),
    );
    groups.push({
      dimension: "residence",
      provenancePolicy: residencePolicy,
      residenceTargets: uniqueResidenceTargets,
    });
  }

  if (
    new Set(campusIds).size !== campusIds.length ||
    new Set(academicDivisionIds).size !== academicDivisionIds.length ||
    new Set(programmeIds).size !== programmeIds.length ||
    new Set(academicYears).size !== academicYears.length
  ) {
    return null;
  }

  const definition = {
    tenantId,
    publicationId,
    mode: "targeted" as const,
    groups,
  };

  return isPublicationAudienceDefinition(definition) ? definition : null;
}

type SelectOnlyDatabase = Pick<CampusHubDatabase, "select">;

async function hasActiveCampuses(
  database: SelectOnlyDatabase,
  tenantId: string,
  ids: readonly string[],
): Promise<boolean> {
  const rows = await database
    .select({ id: campuses.id, status: campuses.status })
    .from(campuses)
    .where(and(eq(campuses.tenantId, tenantId), inArray(campuses.id, ids)));
  return rows.length === ids.length && rows.every((row) => row.status === "active");
}

async function hasActiveAcademicDivisions(
  database: SelectOnlyDatabase,
  tenantId: string,
  ids: readonly string[],
): Promise<boolean> {
  const rows = await database
    .select({ id: academicDivisions.id, status: academicDivisions.status })
    .from(academicDivisions)
    .where(
      and(
        eq(academicDivisions.tenantId, tenantId),
        inArray(academicDivisions.id, ids),
      ),
    );
  return rows.length === ids.length && rows.every((row) => row.status === "active");
}

async function hasActiveProgrammes(
  database: SelectOnlyDatabase,
  tenantId: string,
  ids: readonly string[],
): Promise<boolean> {
  const rows = await database
    .select({ id: programmes.id, status: programmes.status })
    .from(programmes)
    .where(and(eq(programmes.tenantId, tenantId), inArray(programmes.id, ids)));
  return rows.length === ids.length && rows.every((row) => row.status === "active");
}

async function hasActiveResidences(
  database: SelectOnlyDatabase,
  tenantId: string,
  ids: readonly string[],
): Promise<boolean> {
  const rows = await database
    .select({ id: residences.id, status: residences.status })
    .from(residences)
    .where(and(eq(residences.tenantId, tenantId), inArray(residences.id, ids)));
  return rows.length === ids.length && rows.every((row) => row.status === "active");
}

async function hasConfiguredAcademicYears(
  database: SelectOnlyDatabase,
  tenantId: string,
  years: readonly number[],
): Promise<boolean> {
  const rows = await database
    .select({
      minimumYear: tenantAcademicYearConfig.minimumYear,
      maximumYear: tenantAcademicYearConfig.maximumYear,
    })
    .from(tenantAcademicYearConfig)
    .where(eq(tenantAcademicYearConfig.tenantId, tenantId))
    .limit(1);
  const config = rows[0];
  return (
    config !== undefined &&
    years.every(
      (year) => year >= config.minimumYear && year <= config.maximumYear,
    )
  );
}

async function validateAudienceTargets(
  database: SelectOnlyDatabase,
  definition: PublicationAudienceDefinition,
): Promise<boolean> {
  for (const group of definition.groups) {
    switch (group.dimension) {
      case "campus":
        if (!(await hasActiveCampuses(database, definition.tenantId, group.campusIds))) {
          return false;
        }
        break;
      case "academic_division":
        if (
          !(await hasActiveAcademicDivisions(
            database,
            definition.tenantId,
            group.academicDivisionIds,
          ))
        ) {
          return false;
        }
        break;
      case "programme":
        if (
          !(await hasActiveProgrammes(
            database,
            definition.tenantId,
            group.programmeIds,
          ))
        ) {
          return false;
        }
        break;
      case "academic_year":
        if (
          !(await hasConfiguredAcademicYears(
            database,
            definition.tenantId,
            group.academicYears,
          ))
        ) {
          return false;
        }
        break;
      case "residence": {
        const residenceIds = group.residenceTargets
          .filter(
            (target): target is Extract<
              PublicationResidenceTarget,
              { kind: "specific_residence" }
            > => target.kind === "specific_residence",
          )
          .map((target) => target.residenceId);
        if (
          residenceIds.length > 0 &&
          !(await hasActiveResidences(
            database,
            definition.tenantId,
            residenceIds,
          ))
        ) {
          return false;
        }
        break;
      }
    }
  }

  return true;
}

export class DrizzlePublicationRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async createPublication(
    tenantId: string,
    input: CreatePublicationInput,
  ): Promise<Publication | null> {
    if (
      !isUuid(tenantId) ||
      typeof input !== "object" ||
      input === null
    ) {
      return null;
    }

    const candidate = input as Record<string, unknown>;
    const type = parsePublicationType(candidate.type);
    const priority =
      candidate.priority === undefined
        ? "standard"
        : parsePublicationPriority(candidate.priority);
    const lifecycle =
      candidate.lifecycle === undefined
        ? "draft"
        : parsePublicationLifecycle(candidate.lifecycle);
    const audienceMode = parsePublicationAudienceMode(candidate.audienceMode);
    const visibility =
      candidate.visibility === undefined
        ? "MEMBERS"
        : parseResourceVisibility(candidate.visibility);
    const publishAt =
      candidate.publishAt === undefined ? null : candidate.publishAt;
    const expiresAt =
      candidate.expiresAt === undefined ? null : candidate.expiresAt;

    if (
      type === null ||
      priority === null ||
      lifecycle === null ||
      audienceMode === null ||
      visibility === null ||
      !isNonEmptyString(candidate.title) ||
      !isNonEmptyString(candidate.body) ||
      !isNonEmptyString(candidate.authorOfficeLabel) ||
      !isNullableDate(publishAt) ||
      !isNullableDate(expiresAt)
    ) {
      return null;
    }

    const rows = await this.database
      .insert(publications)
      .values({
        tenantId,
        type,
        title: candidate.title,
        body: candidate.body,
        priority,
        visibility,
        lifecycle,
        audienceMode,
        authorOfficeLabel: candidate.authorOfficeLabel,
        publishAt,
        expiresAt,
      })
      .returning();

    return rows[0] ? toPublication(rows[0]) : null;
  }

  public async findPublicationByIdForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<Publication | null> {
    if (!isUuid(tenantId) || !isUuid(publicationId)) {
      return null;
    }

    const rows = await this.database
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.tenantId, tenantId),
          eq(publications.id, publicationId),
        ),
      )
      .limit(1);

    return rows[0] ? toPublication(rows[0]) : null;
  }

  public async findPublicationAudienceDefinitionForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<PublicationAudienceDefinition | null> {
    if (!isUuid(tenantId) || !isUuid(publicationId)) {
      return null;
    }

    const publicationRows = await this.database
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.tenantId, tenantId),
          eq(publications.id, publicationId),
        ),
      )
      .limit(1);
    const publication = publicationRows[0]
      ? toPublication(publicationRows[0])
      : null;
    if (publication === null) {
      return null;
    }

    const criteriaRows = await this.database
      .select()
      .from(publicationAudienceCriteria)
      .where(
        and(
          eq(publicationAudienceCriteria.tenantId, tenantId),
          eq(publicationAudienceCriteria.publicationId, publicationId),
        ),
      )
      .orderBy(
        asc(publicationAudienceCriteria.dimension),
        asc(publicationAudienceCriteria.id),
      );

    return mapAudienceCriteria(
      tenantId,
      publicationId,
      publication,
      criteriaRows,
    );
  }

  public async replaceDraftPublicationAudienceForTenant(
    tenantId: string,
    publicationId: string,
    definition: unknown,
  ): Promise<PublicationAudienceDefinition | null> {
    if (
      !isUuid(tenantId) ||
      !isUuid(publicationId) ||
      !isPublicationAudienceDefinition(definition) ||
      definition.tenantId !== tenantId ||
      definition.publicationId !== publicationId
    ) {
      return null;
    }

    try {
      return await this.database.transaction(async (transaction) => {
        const lockedRows = await transaction
          .select()
          .from(publications)
          .where(
            and(
              eq(publications.tenantId, tenantId),
              eq(publications.id, publicationId),
            ),
          )
          .for("update")
          .limit(1);
        const publication = lockedRows[0]
          ? toPublication(lockedRows[0])
          : null;

        if (
          publication === null ||
          (publication.lifecycle !== "draft" &&
            publication.lifecycle !== "scheduled")
        ) {
          return null;
        }

        if (
          definition.mode === "targeted" &&
          !(await validateAudienceTargets(transaction, definition))
        ) {
          return null;
        }

        const criteriaRows =
          definition.mode === "targeted"
            ? audienceDefinitionToCriteriaRows(definition)
            : [];

        await transaction
          .update(publications)
          .set({ audienceMode: definition.mode, updatedAt: new Date() })
          .where(
            and(
              eq(publications.tenantId, tenantId),
              eq(publications.id, publicationId),
            ),
          );

        await transaction
          .delete(publicationAudienceCriteria)
          .where(
            and(
              eq(publicationAudienceCriteria.tenantId, tenantId),
              eq(publicationAudienceCriteria.publicationId, publicationId),
            ),
          );

        if (criteriaRows.length > 0) {
          await transaction
            .insert(publicationAudienceCriteria)
            .values(criteriaRows);
        }

        return definition;
      });
    } catch {
      return null;
    }
  }

  public async listPublicationCandidatesForTenant(
    input: PublicationCollectionQuery,
  ): Promise<PublicationCollectionCandidatePage> {
    if (
      typeof input !== "object" ||
      input === null ||
      !isUuid(input.tenantId) ||
      parsePublicationCollectionSurface(input.surface) === null ||
      !(input.now instanceof Date) ||
      Number.isNaN(input.now.getTime()) ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_PUBLICATION_CANDIDATES_SCANNED ||
      (input.cursor !== null && !isPublicationCollectionCursor(input.cursor))
    ) {
      return { items: [], hasMoreCandidateRows: false };
    }

    const historicalPublishAt = and(
      isNotNull(publications.publishAt),
      lte(publications.publishAt, input.now),
    );
    const lifecycleAndTime =
      input.surface === "ACTIVE"
        ? and(
            eq(publications.lifecycle, "published"),
            historicalPublishAt,
            or(
              isNull(publications.expiresAt),
              gt(publications.expiresAt, input.now),
            ),
          )
        : and(
            historicalPublishAt,
            or(
              inArray(publications.lifecycle, ["expired", "archived"]),
              and(
                eq(publications.lifecycle, "published"),
                isNotNull(publications.expiresAt),
                lte(publications.expiresAt, input.now),
              ),
            ),
          );
    const cursorAfter =
      input.cursor === null
        ? undefined
        : or(
            lt(publications.publishAt, input.cursor.publishAt),
            and(
              eq(publications.publishAt, input.cursor.publishAt),
              lt(publications.id, input.cursor.id),
            ),
          );
    // Targeted Publications are intentionally excluded until CH-PUB-003 has
    // a real audience evaluator. Direct B.2.2 reads may consume an explicit
    // trusted audience decision; collection reads must not invent one.
    const scope = and(
      eq(publications.tenantId, input.tenantId),
      eq(publications.audienceMode, "entire_tenant"),
      lifecycleAndTime,
      cursorAfter,
    );

    const rows = await this.database
      .select()
      .from(publications)
      .where(scope)
      .orderBy(desc(publications.publishAt), desc(publications.id))
      .limit(input.limit + 1);
    const pageRows = rows.slice(0, input.limit);

    return {
      items: pageRows
        .map((row) => toPublication(row))
        .filter((publication): publication is Publication => publication !== null),
      hasMoreCandidateRows: rows.length > input.limit,
    };
  }
}
