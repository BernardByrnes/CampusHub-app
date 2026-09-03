export const PUBLICATION_AUDIENCE_DIMENSIONS = [
  "campus",
  "academic_division",
  "programme",
  "academic_year",
  "residence",
] as const;

export type PublicationAudienceDimension =
  (typeof PUBLICATION_AUDIENCE_DIMENSIONS)[number];

export const PUBLICATION_AUDIENCE_PROVENANCE_POLICIES = [
  "authoritative_only",
  "allow_self_declared",
] as const;

export type PublicationAudienceProvenancePolicy =
  (typeof PUBLICATION_AUDIENCE_PROVENANCE_POLICIES)[number];

export const PUBLICATION_RESIDENCE_TARGETS = [
  "specific_residence",
  "any_resident",
  "non_resident",
] as const;

export type PublicationResidenceTargetKind =
  (typeof PUBLICATION_RESIDENCE_TARGETS)[number];
