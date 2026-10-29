import { z } from 'zod';

const identifierSchema = z.uuid().transform(value => value.toLowerCase());
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => value.toLowerCase());
const metadataUriSchema = z.string().min(1).max(2048).refine(value => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return ['https:', 'ipfs:'].includes(url.protocol) && url.hostname.length > 0 &&
    !url.username && !url.password && !url.search && !url.hash;
}, 'Metadata URI must be an HTTPS or IPFS URI without credentials, query, or fragment.');
const entrySchema = z.object({
  id: identifierSchema,
  metadataUri: metadataUriSchema.nullable(),
  productionUploadKey: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
}).strict();
const saveSchema = z.object({
  expectedVersion: z.number().int().min(0).max(2147483646),
  idempotencyKey: identifierSchema,
  chainId: z.literal('11155111'),
  releaseContractAddress: addressSchema.nullable(),
  entries: z.array(entrySchema).max(100),
  removeEntryIds: z.array(identifierSchema).max(100).default([]),
}).strict().superRefine((input, context) => {
  const duplicated = (values: readonly string[]) => new Set(values).size !== values.length;
  if (duplicated(input.entries.map(entry => entry.id)) || duplicated(input.removeEntryIds)) {
    context.addIssue({ code: 'custom', message: 'Manifest entry identifiers must be unique.' });
  }
  if (duplicated(input.entries.flatMap(entry => entry.metadataUri === null ? [] : [entry.metadataUri])) ||
    duplicated(input.entries.flatMap(entry => entry.productionUploadKey === null ? [] : [entry.productionUploadKey]))) {
    context.addIssue({ code: 'custom', message: 'A metadata URI or production file cannot identify multiple entries.' });
  }
  if (input.entries.some(entry => input.removeEntryIds.includes(entry.id))) {
    context.addIssue({ code: 'custom', message: 'An entry cannot be saved and removed in the same mutation.' });
  }
});
const pageSchema = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(100).default(20),
  expectedVersion: z.number().int().min(1).optional(),
}).strict().refine(({ page, perPage }) => (page - 1) * perPage <= 2147483647, 'Pagination offset is too large.');
const lookupSchema = z.object({
  chainId: z.literal('11155111'),
  releaseContractAddress: addressSchema,
}).strict();

export function planPrintReleaseManifestSave(id: unknown, input: unknown) {
  const value: unknown = { id, input };
  return z.object({ id: identifierSchema, input: saveSchema }).safeParse(value);
}

export function planPrintReleaseManifestRead(id: unknown, query: unknown) {
  const value: unknown = { id, query };
  return z.object({ id: identifierSchema, query: pageSchema }).safeParse(value);
}

export function planPrintReleaseManifestLookup(query: unknown) {
  return lookupSchema.safeParse(query);
}
