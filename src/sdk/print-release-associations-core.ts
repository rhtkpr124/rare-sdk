import { z } from 'zod';

const tokenIdSchema = z.string().max(78).regex(/^(0|[1-9][0-9]*)$/).pipe(
  z.string().refine(value => BigInt(value) <= (1n << 256n) - 1n, 'Token identifier exceeds uint256.'),
);
const verificationSchema = z.object({
  id: z.uuid(),
  input: z.object({
    expectedVersion: z.number().int().positive().max(2147483647),
    tokenIds: z.array(tokenIdSchema).min(1).max(100).refine(values => new Set(values).size === values.length, 'Token identifiers must be unique.'),
  }).strict(),
}).strict();

export function planPrintReleaseAssociationVerification(id: unknown, input: unknown) {
  const value: unknown = { id, input };
  return verificationSchema.safeParse(value);
}
