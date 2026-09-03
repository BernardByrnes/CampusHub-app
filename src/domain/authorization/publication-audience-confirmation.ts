export type PublicationAudienceConfirmationInput = Readonly<{
  confirmedRecipientCount: number;
  expectedPublicationVersion: number;
}>;

export type PublicationAudienceConfirmationState = Readonly<{
  publicationVersion: number;
  estimatedRecipientCount: number | null;
  audienceDefinitionValid: boolean;
  targetsCurrentlyValid: boolean;
}>;

export type PublicationAudienceConfirmationResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      error: "VERSION_CONFLICT" | "RECONFIRM_REQUIRED" | "NOT_READY";
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isConfirmationInput(
  value: unknown,
): value is PublicationAudienceConfirmationInput {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value).sort();
  return (
    keys.length === 2 &&
    keys[0] === "confirmedRecipientCount" &&
    keys[1] === "expectedPublicationVersion" &&
    isNonNegativeInteger(value.confirmedRecipientCount) &&
    isPositiveInteger(value.expectedPublicationVersion)
  );
}

function isConfirmationState(
  value: unknown,
): value is PublicationAudienceConfirmationState {
  return (
    isRecord(value) &&
    isPositiveInteger(value.publicationVersion) &&
    (value.estimatedRecipientCount === null ||
      isNonNegativeInteger(value.estimatedRecipientCount)) &&
    typeof value.audienceDefinitionValid === "boolean" &&
    typeof value.targetsCurrentlyValid === "boolean"
  );
}

/**
 * Revalidates the exact current version and scalar estimate. A caller cannot
 * supply identities, a recipient list, or a threshold-specific exception.
 */
export function validatePublicationAudienceConfirmation(
  input: unknown,
  currentState: unknown,
): PublicationAudienceConfirmationResult {
  if (!isConfirmationInput(input) || !isConfirmationState(currentState)) {
    return { ok: false, error: "RECONFIRM_REQUIRED" };
  }

  if (input.expectedPublicationVersion !== currentState.publicationVersion) {
    return { ok: false, error: "VERSION_CONFLICT" };
  }

  if (
    !currentState.audienceDefinitionValid ||
    !currentState.targetsCurrentlyValid ||
    currentState.estimatedRecipientCount === null
  ) {
    return { ok: false, error: "NOT_READY" };
  }

  return input.confirmedRecipientCount === currentState.estimatedRecipientCount
    ? { ok: true }
    : { ok: false, error: "RECONFIRM_REQUIRED" };
}
