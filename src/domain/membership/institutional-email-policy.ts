import "server-only";

import { parseAssuranceLevel, type AssuranceLevel } from "@/domain/authorization/assurance-level";

export type InstitutionalEmailAttestation = Readonly<{
  identityBinding: boolean;
  currentEnrollment: boolean;
  reliableRevocation: boolean;
}>;

function isCompleteAttestation(
  value: unknown,
): value is InstitutionalEmailAttestation {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.identityBinding === true &&
    candidate.currentEnrollment === true &&
    candidate.reliableRevocation === true
  );
}

/** An institutional email is evidence, not by itself Strong Institutional Proof. */
export function institutionalEmailSupportsL3(value: unknown): boolean {
  return isCompleteAttestation(value);
}

/**
 * Returns the maximum level that this evidence could support. The caller must
 * still combine it with the Membership's existing assurance and tenant policy;
 * this helper does not perform a verification workflow or grant L3.
 */
export function institutionalEmailEvidenceMaximum(
  value: unknown,
): AssuranceLevel {
  return isCompleteAttestation(value) ? "L3" : "L2";
}

export function assuranceRemainsWithinInstitutionalEmailCap(
  current: unknown,
  attestation: unknown,
): boolean {
  const currentLevel = parseAssuranceLevel(current);
  const maximum = institutionalEmailEvidenceMaximum(attestation);

  if (currentLevel === null) {
    return false;
  }

  return maximum === "L3" || currentLevel !== "L3";
}
