export const PROFILE_FIELD_PROVENANCES = [
  "institution_verified",
  "roster_derived",
  "self_declared",
  "optional",
] as const;

export type ProfileFieldProvenance =
  (typeof PROFILE_FIELD_PROVENANCES)[number];

export const MEMBERSHIP_RESIDENCE_STATES = [
  "unknown",
  "non_resident",
  "resident",
] as const;

export type MembershipResidenceState =
  (typeof MEMBERSHIP_RESIDENCE_STATES)[number];
