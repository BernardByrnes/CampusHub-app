import type { PublicationAudienceDefinition } from "@/domain/authorization/publication-audience";
import type {
  Publication,
  PublicationAudienceMode,
} from "@/domain/content/publication";

/**
 * One transaction-consistent Publication audience snapshot. The repository
 * owns the transaction and returns no recipient identity data.
 */
export type PublicationAudienceReadinessSnapshot = Readonly<{
  publication: Publication;
  definition: PublicationAudienceDefinition | null;
  targetsCurrentlyValid: boolean;
  estimatedRecipientCount: number | null;
}>;

/**
 * Server-owned facts used by a future publish capability. This is deliberately
 * an estimate contract, not a recipient or identity projection.
 */
export type PublicationAudienceReadiness = Readonly<{
  tenantId: string;
  publicationId: string;
  publicationVersion: number;
  audienceMode: PublicationAudienceMode;
  estimatedRecipientCount: number | null;
  audienceDefinitionValid: boolean;
  targetsCurrentlyValid: boolean;
  requiresAudienceSizeConfirmation: boolean;
}>;
