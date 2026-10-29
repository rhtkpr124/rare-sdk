import { describe, expect, it } from 'vitest';
import { validatePrintEstimateInput } from '../../../src/sdk/print-estimates-core.js';
import { planPrintReleaseManifestSave, planPrintReleaseManifestRead, planPrintReleaseManifestLookup } from '../../../src/sdk/print-release-manifests-core.js';

const id = '11111111-1111-4111-8111-111111111111';
const entry = { id, metadataUri: 'ipfs://example/1.json', productionUploadKey: 'a'.repeat(64) };
const input = { expectedVersion: 0, idempotencyKey: id, chainId: '11155111', releaseContractAddress: null, entries: [entry] };

describe('print preparation input validation', () => {
  it.each([0, 1001, 1.5, Number.NaN])('rejects unsupported estimate quantity %s', copies => {
    expect(validatePrintEstimateInput({ specificationId: 'GLOBAL-FAP-8X12', destinationCountryCode: 'US', copies }).success).toBe(false);
  });

  it('leaves canonical catalog availability to the server and requires explicit country assumptions', () => {
    expect(validatePrintEstimateInput({ specificationId: 'future-product', destinationCountryCode: 'GB' }).success).toBe(true);
    for (const destinationCountryCode of ['us', '', 'USA']) {
      expect(validatePrintEstimateInput({ specificationId: 'GLOBAL-FAP-8X12', destinationCountryCode }).success).toBe(false);
    }
    expect(validatePrintEstimateInput({ specificationId: ' ', destinationCountryCode: 'US' }).success).toBe(false);
    expect(validatePrintEstimateInput({ specificationId: 'GLOBAL-FAP-8X12', destinationCountryCode: 'US', shippingMethod: 'Express' }).success).toBe(false);
  });

  it('rejects ambiguous manifest assignments before any durable write', () => {
    const other = { ...entry, id: '22222222-2222-4222-8222-222222222222' };
    expect(planPrintReleaseManifestSave(id, { ...input, entries: [entry, entry] }).success).toBe(false);
    expect(planPrintReleaseManifestSave(id, { ...input, entries: [entry, other] }).success).toBe(false);
    expect(planPrintReleaseManifestSave(id, { ...input, entries: [entry, { ...other, metadataUri: null }] }).success).toBe(false);
    expect(planPrintReleaseManifestSave(id, { ...input, removeEntryIds: [entry.id] }).success).toBe(false);
    expect(planPrintReleaseManifestSave(id, { ...input, removeEntryIds: [other.id, other.id] }).success).toBe(false);
  });

  it('supports incomplete preparation, partial saves, and version-bound pagination', () => {
    expect(planPrintReleaseManifestSave(id, { ...input, entries: [{ ...entry, metadataUri: null, productionUploadKey: null }] })).toMatchObject({ success: true, data: { input: { removeEntryIds: [] } } });
    expect(planPrintReleaseManifestSave(id, { ...input, entries: [], expectedVersion: 2, removeEntryIds: [entry.id] }).success).toBe(true);
    expect(planPrintReleaseManifestRead(id, { page: 2, expectedVersion: 3 })).toMatchObject({ success: true, data: { query: { page: 2, perPage: 20, expectedVersion: 3 } } });
    expect(planPrintReleaseManifestRead(id, { expectedVersion: 0 }).success).toBe(false);
    expect(planPrintReleaseManifestRead(id, { perPage: 101 }).success).toBe(false);
  });

  it.each(['gs://private/asset', 'http://example.test/metadata', 'https://user:password@example.test/1.json', 'ipfs://example/1.json?key=private', 'https://example.test/1.json#fragment'])('rejects unsupported metadata URI %s', metadataUri => {
    expect(planPrintReleaseManifestSave(id, { ...input, entries: [{ ...entry, metadataUri }] }).success).toBe(false);
  });

  it('normalizes the release context and rejects unsupported chains and malformed identifiers', () => {
    expect(planPrintReleaseManifestLookup({ chainId: '11155111', releaseContractAddress: `0x${'A'.repeat(40)}` })).toMatchObject({ success: true, data: { releaseContractAddress: `0x${'a'.repeat(40)}` } });
    expect(planPrintReleaseManifestSave('invalid', input).success).toBe(false);
    expect(planPrintReleaseManifestSave(id, { ...input, chainId: '1' }).success).toBe(false);
    expect(planPrintReleaseManifestSave(id, { ...input, expectedVersion: -1 }).success).toBe(false);
    expect(planPrintReleaseManifestSave(id, { ...input, tokenId: '1' }).success).toBe(false);
  });
});
