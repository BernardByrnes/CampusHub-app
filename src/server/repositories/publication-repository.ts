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
  sql,
} from "drizzle-orm";

import {
  isPublicationAudienceDefinition,
  type PublicationAudienceDefinition,
  type PublicationAudienceGroup,
  type PublicationResidenceTarget,
  parsePublicationAudienceProvenancePolicy,
} from "@/domain/authorization/publication-audience";
import {
  validatePublicationAudienceConfirmation,
  type PublicationAudienceConfirmationResult,
} from "@/domain/authorization/publication-audience-confirmation";
import type { PublicationAudienceReadinessSnapshot } from "@/domain/authorization/publication-audience-readiness";
import {
  isPublication,
  parsePublicationAudienceMode,
  parsePublicationLifecycle,
  parsePublicationPriority,
  parsePublicationType,
  type Publication,
} from "@/domain/content/publication";
import {
  parseCreatePublicationDraftInput,
  type CreatePublicationDraftInput,
} from "@/domain/content/publication-draft";
import type { UpdatePublicationDraftInput } from "@/domain/content/publication-draft-edit";
import {
  parseResourceVisibility,
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
import { memberships } from "@/server/db/schema/membership";
import {
  academicDivisions,
  campuses,
  programmes,
  residences,
  tenantAcademicYearConfig,
} from "@/server/db/schema/organization";

export type PublicationAudienceMutationResult =
  | Readonly<{
      ok: true;
      definition: PublicationAudienceDefinition;
      version: number;
    }>
  | Readonly<{
      ok: false;
      error:
        | "NOT_FOUND"
        | "VERSION_CONFLICT"
        | "INVALID_STATE"
        | "INVALID_AUDIENCE";
    }>;

export type PublicationDraftEditMutationResult =
  | Readonly<{
      ok: true;
      publication: Publication;
    }>
  | Readonly<{
      ok: false;
      error: "NOT_FOUND" | "VERSION_CONFLICT" | "INVALID_STATE" | "PERSISTENCE_FAILED";
    }>;

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
    version: row.version,
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

const EVIDENCED_PROVENANCES = [
  "institution_verified",
  "roster_derived",
  "self_declared",
] as const;

const AUTHORITATIVE_PROVENANCES = [
  "institution_verified",
  "roster_derived",
] as const;

function permittedProvenancePredicate(
  column:
    | typeof memberships.campusProvenance
    | typeof memberships.academicDivisionProvenance
    | typeof memberships.programmeProvenance
    | typeof memberships.academicYearProvenance
    | typeof memberships.residenceProvenance,
  policy: PublicationAudienceGroup["provenancePolicy"],
) {
  return inArray(
    column,
    policy === "authoritative_only"
      ? AUTHORITATIVE_PROVENANCES
      : EVIDENCED_PROVENANCES,
  );
}

function buildTargetedMembershipPredicate(
  definition: PublicationAudienceDefinition,
) {
  if (definition.mode !== "targeted") {
    return null;
  }

  const predicates = [
    eq(memberships.tenantId, definition.tenantId),
    isNotNull(memberships.campusId),
    inArray(memberships.campusProvenance, EVIDENCED_PROVENANCES),
  ];

  for (const group of definition.groups) {
    const groupPredicates = (() => {
      switch (group.dimension) {
        case "campus":
          return [
            and(
              inArray(memberships.campusId, [...group.campusIds]),
              permittedProvenancePredicate(
                memberships.campusProvenance,
                group.provenancePolicy,
              ),
            ),
          ];
        case "academic_division":
          return [
            and(
              inArray(memberships.academicDivisionId, [
                ...group.academicDivisionIds,
              ]),
              permittedProvenancePredicate(
                memberships.academicDivisionProvenance,
                group.provenancePolicy,
              ),
            ),
          ];
        case "programme":
          return [
            and(
              inArray(memberships.programmeId, [...group.programmeIds]),
              permittedProvenancePredicate(
                memberships.programmeProvenance,
                group.provenancePolicy,
              ),
            ),
          ];
        case "academic_year":
          return [
            and(
              inArray(memberships.academicYear, [...group.academicYears]),
              permittedProvenancePredicate(
                memberships.academicYearProvenance,
                group.provenancePolicy,
              ),
            ),
          ];
        case "residence":
          return group.residenceTargets.map((target) => {
            const provenance = permittedProvenancePredicate(
              memberships.residenceProvenance,
              group.provenancePolicy,
            );
            switch (target.kind) {
              case "specific_residence":
                return and(
                  eq(memberships.residenceState, "resident"),
                  eq(memberships.residenceId, target.residenceId),
                  provenance,
                );
              case "any_resident":
                return and(
                  eq(memberships.residenceState, "resident"),
                  provenance,
                );
              case "non_resident":
                return and(
                  eq(memberships.residenceState, "non_resident"),
                  provenance,
                );
            }
          });
      }
    })();
    const groupPredicate = or(...groupPredicates);
    if (groupPredicate === undefined) {
      return null;
    }
    predicates.push(groupPredicate);
  }

  return and(...predicates);
}

function isPositivePublicationVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

async function countAudienceMemberships(
  database: SelectOnlyDatabase,
  definition: PublicationAudienceDefinition,
): Promise<number | null> {
  const scope =
    definition.mode === "entire_tenant"
      ? eq(memberships.tenantId, definition.tenantId)
      : buildTargetedMembershipPredicate(definition);
  if (scope === null || scope === undefined) {
    return null;
  }

  try {
    const rows = await database
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .where(scope);
    const rawCount = rows[0]?.count;
    const count =
      typeof rawCount === "number"
        ? rawCount
        : typeof rawCount === "string" && /^\d+$/.test(rawCount)
          ? Number(rawCount)
          : NaN;
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  } catch {
    return null;
  }
}

async function readPublicationAudienceReadinessSnapshot(
  database: SelectOnlyDatabase,
  tenantId: string,
  publicationId: string,
): Promise<PublicationAudienceReadinessSnapshot | null> {
  const lockedRows = await database
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
  const publication = lockedRows[0] ? toPublication(lockedRows[0]) : null;
  if (publication === null) {
    return null;
  }

  const criteriaRows = await database
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
  const definition = mapAudienceCriteria(
    tenantId,
    publicationId,
    publication,
    criteriaRows,
  );

  if (
    definition === null ||
    !isPublicationAudienceDefinition(definition) ||
    definition.tenantId !== tenantId ||
    definition.publicationId !== publicationId ||
    definition.mode !== publication.audienceMode
  ) {
    return {
      publication,
      definition: null,
      targetsCurrentlyValid: false,
      estimatedRecipientCount: null,
    };
  }

  let targetsCurrentlyValid = definition.mode === "entire_tenant";
  if (definition.mode === "targeted") {
    try {
      targetsCurrentlyValid = await validateAudienceTargets(database, definition);
    } catch {
      targetsCurrentlyValid = false;
    }
  }

  if (!targetsCurrentlyValid) {
    return {
      publication,
      definition,
      targetsCurrentlyValid: false,
      estimatedRecipientCount: null,
    };
  }

  return {
    publication,
    definition,
    targetsCurrentlyValid: true,
    estimatedRecipientCount: await countAudienceMemberships(
      database,
      definition,
    ),
  };
}

type PublicationInsertDatabase = Pick<CampusHubDatabase, "insert">;
type PublicationUpdateDatabase = Pick<CampusHubDatabase, "update">;

async function createPublicationUsingDatabase(
  database: PublicationInsertDatabase,
  tenantId: string,
  input: unknown,
): Promise<Publication | null> {
  if (!isUuid(tenantId)) {
    return null;
  }

  const draft = parseCreatePublicationDraftInput(input);
  if (draft === null) {
    return null;
  }

  const rows = await database
    .insert(publications)
    .values({
      tenantId,
      version: 1,
      type: draft.type,
      title: draft.title,
      body: draft.body,
      priority: draft.priority,
      visibility: draft.visibility,
      lifecycle: "draft",
      audienceMode: draft.audienceMode,
      authorOfficeLabel: draft.authorOfficeLabel,
      publishAt: null,
      expiresAt: draft.expiresAt,
    })
    .returning();

  return rows[0] ? toPublication(rows[0]) : null;
}

export class DrizzlePublicationRepository {
  public constructor(private readonly database: CampusHubDatabase = db) {}

  public async createPublicationDraftInTransaction(
    transaction: PublicationInsertDatabase,
    tenantId: string,
    input: CreatePublicationDraftInput,
  ): Promise<Publication | null> {
    return createPublicationUsingDatabase(transaction, tenantId, input);
  }

  public async updatePublicationDraftInTransaction(
    transaction: PublicationUpdateDatabase,
    tenantId: string,
    publicationId: string,
    input: UpdatePublicationDraftInput,
  ): Promise<PublicationDraftEditMutationResult> {
    if (
      !isUuid(tenantId) ||
      !isUuid(publicationId) ||
      !isPositivePublicationVersion(input.expectedVersion)
    ) {
      return { ok: false, error: "NOT_FOUND" };
    }

    try {
      const rows = await transaction
        .update(publications)
        .set({
          type: input.type,
          title: input.title,
          body: input.body,
          priority: input.priority,
          visibility: input.visibility,
          authorOfficeLabel: input.authorOfficeLabel,
          expiresAt: input.expiresAt,
          version: sql`${publications.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(publications.tenantId, tenantId),
            eq(publications.id, publicationId),
            eq(publications.version, input.expectedVersion),
            eq(publications.lifecycle, "draft"),
          ),
        )
        .returning();

      if (rows.length !== 1) {
        return { ok: false, error: "PERSISTENCE_FAILED" };
      }

      const publication = toPublication(rows[0]);
      return publication === null
        ? { ok: false, error: "PERSISTENCE_FAILED" }
        : { ok: true, publication };
    } catch {
      return { ok: false, error: "PERSISTENCE_FAILED" };
    }
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

  public async findPublicationAudienceDefinitionsForTenant(
    tenantId: string,
    publicationIds: readonly string[],
  ): Promise<ReadonlyMap<string, PublicationAudienceDefinition>> {
    const definitions = new Map<string, PublicationAudienceDefinition>();

    if (
      !isUuid(tenantId) ||
      !Array.isArray(publicationIds) ||
      publicationIds.length === 0 ||
      publicationIds.length > MAX_PUBLICATION_CANDIDATES_SCANNED ||
      publicationIds.some((publicationId) => !isUuid(publicationId)) ||
      new Set(publicationIds).size !== publicationIds.length
    ) {
      return definitions;
    }

    const requestedPublicationIds = new Set(publicationIds);

    try {
      const publicationRows = await this.database
        .select()
        .from(publications)
        .where(
          and(
            eq(publications.tenantId, tenantId),
            inArray(publications.id, [...requestedPublicationIds]),
          ),
        )
        .limit(publicationIds.length);
      const hydratedPublications = new Map<string, Publication>();

      for (const row of publicationRows) {
        const publication = toPublication(row);
        if (
          publication !== null &&
          publication.tenantId === tenantId &&
          requestedPublicationIds.has(publication.id)
        ) {
          hydratedPublications.set(publication.id, publication);
        }
      }

      if (hydratedPublications.size === 0) {
        return definitions;
      }

      const criteriaRows = await this.database
        .select()
        .from(publicationAudienceCriteria)
        .where(
          and(
            eq(publicationAudienceCriteria.tenantId, tenantId),
            inArray(
              publicationAudienceCriteria.publicationId,
              [...hydratedPublications.keys()],
            ),
          ),
        )
        .orderBy(
          asc(publicationAudienceCriteria.publicationId),
          asc(publicationAudienceCriteria.dimension),
          asc(publicationAudienceCriteria.id),
        );
      const criteriaByPublicationId = new Map<
        string,
        PublicationAudienceCriteriaRow[]
      >();

      for (const row of criteriaRows) {
        if (
          row.tenantId !== tenantId ||
          !hydratedPublications.has(row.publicationId)
        ) {
          continue;
        }

        const rows = criteriaByPublicationId.get(row.publicationId) ?? [];
        rows.push(row);
        criteriaByPublicationId.set(row.publicationId, rows);
      }

      for (const publicationId of publicationIds) {
        const publication = hydratedPublications.get(publicationId);
        if (publication === undefined) {
          continue;
        }

        const definition = mapAudienceCriteria(
          tenantId,
          publicationId,
          publication,
          criteriaByPublicationId.get(publicationId) ?? [],
        );
        if (definition !== null) {
          definitions.set(publicationId, definition);
        }
      }
    } catch {
      definitions.clear();
    }

    return definitions;
  }

  public async readPublicationAudienceReadinessSnapshotForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<PublicationAudienceReadinessSnapshot | null> {
    if (!isUuid(tenantId) || !isUuid(publicationId)) {
      return null;
    }

    try {
      return await this.database.transaction((transaction) =>
        readPublicationAudienceReadinessSnapshot(
          transaction,
          tenantId,
          publicationId,
        ),
      );
    } catch {
      return null;
    }
  }

  public async validatePublicationAudienceConfirmationAtomicallyForTenant(
    tenantId: string,
    publicationId: string,
    input: unknown,
  ): Promise<PublicationAudienceConfirmationResult | null> {
    if (!isUuid(tenantId) || !isUuid(publicationId)) {
      return null;
    }

    try {
      return await this.database.transaction(async (transaction) => {
        const snapshot = await readPublicationAudienceReadinessSnapshot(
          transaction,
          tenantId,
          publicationId,
        );
        if (snapshot === null) {
          return null;
        }

        return validatePublicationAudienceConfirmation(input, {
          publicationVersion: snapshot.publication.version,
          estimatedRecipientCount: snapshot.estimatedRecipientCount,
          audienceDefinitionValid: snapshot.definition !== null,
          targetsCurrentlyValid: snapshot.targetsCurrentlyValid,
        });
      });
    } catch {
      return null;
    }
  }

  public async replaceDraftPublicationAudienceForTenant(
    tenantId: string,
    publicationId: string,
    expectedVersion: number,
    definition: unknown,
  ): Promise<PublicationAudienceMutationResult> {
    if (
      !isUuid(tenantId) ||
      !isUuid(publicationId)
    ) {
      return { ok: false, error: "NOT_FOUND" };
    }

    if (
      !isPositivePublicationVersion(expectedVersion) ||
      !isPublicationAudienceDefinition(definition) ||
      definition.tenantId !== tenantId ||
      definition.publicationId !== publicationId
    ) {
      return { ok: false, error: "INVALID_AUDIENCE" };
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

        if (publication === null) {
          return { ok: false, error: "NOT_FOUND" };
        }

        if (publication.version !== expectedVersion) {
          return { ok: false, error: "VERSION_CONFLICT" };
        }

        if (
          publication.lifecycle !== "draft" &&
          publication.lifecycle !== "scheduled"
        ) {
          return { ok: false, error: "INVALID_STATE" };
        }

        if (
          definition.mode === "targeted" &&
          !(await validateAudienceTargets(transaction, definition))
        ) {
          return { ok: false, error: "INVALID_AUDIENCE" };
        }

        const criteriaRows =
          definition.mode === "targeted"
            ? audienceDefinitionToCriteriaRows(definition)
            : [];

        await transaction
          .update(publications)
          .set({
            audienceMode: definition.mode,
            version: sql`${publications.version} + 1`,
            updatedAt: new Date(),
          })
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

        return {
          ok: true,
          definition,
          version: publication.version + 1,
        };
      });
    } catch {
      return { ok: false, error: "INVALID_AUDIENCE" };
    }
  }

  public async arePublicationAudienceTargetsCurrentlyValidForTenant(
    tenantId: string,
    definition: unknown,
  ): Promise<boolean> {
    if (
      !isUuid(tenantId) ||
      !isPublicationAudienceDefinition(definition) ||
      definition.tenantId !== tenantId
    ) {
      return false;
    }

    if (definition.mode === "entire_tenant") {
      return true;
    }

    try {
      return await validateAudienceTargets(this.database, definition);
    } catch {
      return false;
    }
  }

  public async countPublicationAudienceMembershipsForTenant(
    tenantId: string,
    publicationId: string,
  ): Promise<number | null> {
    if (!isUuid(tenantId) || !isUuid(publicationId)) {
      return null;
    }

    const definition =
      await this.findPublicationAudienceDefinitionForTenant(
        tenantId,
        publicationId,
      );
    if (definition === null) {
      return null;
    }

    return countAudienceMemberships(this.database, definition);
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
    const scope = and(
      eq(publications.tenantId, input.tenantId),
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
