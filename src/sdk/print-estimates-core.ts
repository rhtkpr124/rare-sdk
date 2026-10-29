import { z } from 'zod';

// The server catalog owns product availability. Local validation rejects malformed
// requests without freezing another copy of the provider catalog into the SDK.
const printEstimateInputSchema = z.object({
  specificationId: z.string().regex(/^\S+$/),
  copies: z.number().int().min(1).max(1000).optional(),
  destinationCountryCode: z.string().regex(/^[A-Z]{2}$/),
  shippingMethod: z.literal('Standard').optional(),
}).strict();

export function validatePrintEstimateInput(input: unknown) {
  return printEstimateInputSchema.safeParse(input);
}
