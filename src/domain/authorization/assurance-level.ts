export const ASSURANCE_LEVELS = ["L0", "L1", "L2", "L3"] as const;

export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number];
