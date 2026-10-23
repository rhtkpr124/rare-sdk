import type { SignedPrintListingArtifact } from './types/prints.js';

/** Retain the exact authorization when publication fails after the wallet signs. */
export class PrintPublicationError extends Error {
  constructor(readonly preparationId: string, readonly signedArtifact: SignedPrintListingArtifact, cause: unknown) {
    super('Print Listing was signed but publication failed. Retry publication with the same signed artifact.', { cause });
    this.name = 'PrintPublicationError';
  }
}
