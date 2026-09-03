import type {
  PublicationAudienceMode,
} from "@/domain/content/publication";

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
