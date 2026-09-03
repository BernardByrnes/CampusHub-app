export const CAMPUS_LIFECYCLE_STATUSES = ["active", "inactive"] as const;
export type CampusLifecycle = (typeof CAMPUS_LIFECYCLE_STATUSES)[number];

export const ACADEMIC_DIVISION_LIFECYCLE_STATUSES = [
  "active",
  "inactive",
  "merged",
] as const;
export type AcademicDivisionLifecycle =
  (typeof ACADEMIC_DIVISION_LIFECYCLE_STATUSES)[number];

export const PROGRAMME_LIFECYCLE_STATUSES = [
  "active",
  "inactive",
  "merged",
] as const;
export type ProgrammeLifecycle =
  (typeof PROGRAMME_LIFECYCLE_STATUSES)[number];

export const RESIDENCE_LIFECYCLE_STATUSES = ["active", "inactive"] as const;
export type ResidenceLifecycle =
  (typeof RESIDENCE_LIFECYCLE_STATUSES)[number];

export const ACADEMIC_DIVISION_LEVELS = [1, 2] as const;
export type AcademicDivisionLevel = (typeof ACADEMIC_DIVISION_LEVELS)[number];

function parseLifecycle<T extends readonly string[]>(
  values: T,
  value: unknown,
): T[number] | null {
  return typeof value === "string" &&
    (values as readonly string[]).includes(value)
    ? (value as T[number])
    : null;
}

export function parseCampusLifecycle(
  value: unknown,
): CampusLifecycle | null {
  return parseLifecycle(CAMPUS_LIFECYCLE_STATUSES, value);
}

export function parseAcademicDivisionLifecycle(
  value: unknown,
): AcademicDivisionLifecycle | null {
  return parseLifecycle(ACADEMIC_DIVISION_LIFECYCLE_STATUSES, value);
}

export function parseProgrammeLifecycle(
  value: unknown,
): ProgrammeLifecycle | null {
  return parseLifecycle(PROGRAMME_LIFECYCLE_STATUSES, value);
}

export function parseResidenceLifecycle(
  value: unknown,
): ResidenceLifecycle | null {
  return parseLifecycle(RESIDENCE_LIFECYCLE_STATUSES, value);
}

export function isAcademicDivisionLevel(
  value: unknown,
): value is AcademicDivisionLevel {
  return value === 1 || value === 2;
}
