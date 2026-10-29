import { z } from 'zod';

const formatConfigurationSchema = z.object({
  dropId: z.uuid(),
  input: z.object({ displayPriceUsdCents: z.string().regex(/^(0|[1-9][0-9]*)$/).max(18) }).strict(),
}).strict();
const optionSelectionSchema = z.object({
  preparationId: z.uuid(),
  optionId: z.uuid(),
}).strict();
const optionSelectionsSchema = z.array(optionSelectionSchema).min(1).max(5).refine(selections => {
  return new Set(selections.map(selection => selection.preparationId.toLowerCase())).size === selections.length;
}, 'Select one print format per artwork.').optional();

export function validatePrintFormatConfiguration(input: unknown) {
  return formatConfigurationSchema.safeParse(input);
}

export function validatePrintOptionSelections(input: unknown) {
  return optionSelectionsSchema.safeParse(input);
}
