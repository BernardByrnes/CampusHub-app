export const ASSURANCE_LEVELS = ["L0", "L1", "L2", "L3"] as const;

export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number];

/**
 * The numeric order is deliberately private to this module. Callers compare
 * assurance through assuranceAtLeast rather than copying a ranking table.
 */
const ASSURANCE_RANK: Readonly<Record<AssuranceLevel, number>> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};

export const ASSURANCE_LEVEL_LABELS: Readonly<Record<AssuranceLevel, string>> = {
  L0: "L0 — Registered",
  L1: "L1 — Weak Affiliation",
  L2: "L2 — Roster Match",
  L3: "L3 — Strong Institutional Proof",
};

export const ASSURANCE_LABELS = ASSURANCE_LEVEL_LABELS;

export const ASSURANCE_LABEL_TEXT: Readonly<Record<AssuranceLevel, string>> = {
  L0: "Registered",
  L1: "Weak Affiliation",
  L2: "Roster Match",
  L3: "Strong Institutional Proof",
};

export function parseAssuranceLevel(value: unknown): AssuranceLevel | null {
  return typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ASSURANCE_RANK, value)
    ? (value as AssuranceLevel)
    : null;
}

export function assuranceAtLeast(actual: unknown, required: unknown): boolean {
  const actualLevel = parseAssuranceLevel(actual);
  const requiredLevel = parseAssuranceLevel(required);

  return (
    actualLevel !== null &&
    requiredLevel !== null &&
    ASSURANCE_RANK[actualLevel] >= ASSURANCE_RANK[requiredLevel]
  );
}

export function assuranceLabel(value: unknown): string | null {
  const level = parseAssuranceLevel(value);
  return level === null ? null : ASSURANCE_LEVEL_LABELS[level];
}

export function assuranceLabelText(value: unknown): string | null {
  const level = parseAssuranceLevel(value);
  return level === null ? null : ASSURANCE_LABEL_TEXT[level];
}
