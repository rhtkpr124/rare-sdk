import { describe, expect, expectTypeOf, it } from 'vitest';
import { zeroAddress, zeroHash } from 'viem';
import { parsePrintListingTerms, validatePrintListingQuantityLimit } from '../../../src/sdk/prints-core.js';
import type { CreatePrintDrop, PreparePrintListing, PrintListingPreparation } from '../../../src/sdk/types/prints.js';

const listing = { listingSalt: zeroHash, seller: zeroAddress, sku: zeroHash, fulfillmentKind: 1,
  tokenContract: zeroAddress, tokenId: '0', settlementCurrency: zeroAddress, minimumUnitPrice: '15000000',
  availableQuantity: '100', paymentRecipient: zeroAddress };
const dropId = '00000000-0000-4000-8000-000000000001';
const preparation = (snapshot: PrintListingPreparation['snapshot']): PrintListingPreparation => ({
  id: '00000000-0000-4000-8000-000000000001', fulfillment_kind: 'PRODIGI_PRINT', user_id: '1', option_id: null,
  chain_id: '11155111', cart_address: zeroAddress, listing_digest: zeroHash, listing_id: null,
  snapshot, created_at: '2026-10-19T00:00:00.000Z',
});

describe('frozen print Listing terms', () => {
  const input: PreparePrintListing = { optionId: dropId, seller: zeroAddress, listingSalt: zeroHash,
    deadline: '2000000000', availableQuantity: '10', fulfillmentKind: 1 };
  it('validates copy limits before remote preparation and preserves the one-copy default', () => {
    expect(validatePrintListingQuantityLimit(input)).toEqual({ valid: true });
    expect(validatePrintListingQuantityLimit({ ...input, maxQuantityPerCheckout: '1000' })).toEqual({ valid: true });
    for (const maxQuantityPerCheckout of ['0', '-1', '1.5', '01', '1001', '999999999999999999999']) {
      expect(validatePrintListingQuantityLimit({ ...input, maxQuantityPerCheckout }).valid).toBe(false);
    }
  });
  it('does not offer multi-copy ERC-721 transfer fulfillment', () => {
    expect(validatePrintListingQuantityLimit({ ...input, fulfillmentKind: 2 })).toEqual({ valid: true });
    expect(validatePrintListingQuantityLimit({ ...input, fulfillmentKind: 2, maxQuantityPerCheckout: '2' }).valid).toBe(false);
    for (const fulfillmentKind of [1, 3, 5] as const) {
      expect(validatePrintListingQuantityLimit({ ...input, fulfillmentKind, maxQuantityPerCheckout: '2' })).toEqual({ valid: true });
    }
  });
  it('requires private upload keys rather than public master URLs for new standalone prints', () => {
    expectTypeOf<NonNullable<CreatePrintDrop['print']>>().toHaveProperty('productionUploadKey').toEqualTypeOf<string>();
    expectTypeOf<NonNullable<CreatePrintDrop['print']>>().not.toHaveProperty('productionImageUri');
  });
  it('retains zero token IDs and converts frozen amounts without changing seller economics', () => {
    const terms = parsePrintListingTerms(preparation({ dropId, configured: { listing }, intent: { deadline: '2000000000' } }));
    expect(terms).toEqual({ dropId, deadline: 2000000000n, listing: { ...listing, tokenId: 0n,
      minimumUnitPrice: 15000000n, availableQuantity: 100n } });
  });
  it('rejects missing snapshots and unsigned numeric or overflowing amounts before signing', () => {
    expect(() => parsePrintListingTerms(preparation({}))).toThrow('frozen Listing terms');
    for (const tokenId of [-1, '-1', '1.5', (2n ** 256n).toString()]) {
      expect(() => parsePrintListingTerms(preparation({ dropId, configured: { listing: { ...listing, tokenId } },
        intent: { deadline: '2000000000' } }))).toThrow('invalid integer');
    }
  });
  it('rejects invalid fulfillment kinds rather than signing an unrelated operation', () => {
    expect(() => parsePrintListingTerms(preparation({ dropId, configured: { listing: { ...listing, fulfillmentKind: 6 } },
      intent: { deadline: '2000000000' } }))).toThrow('unsupported fulfillment kind');
  });
  it('requires the owned drop identity before any approval preflight', () => {
    expect(() => parsePrintListingTerms(preparation({ configured: { listing }, intent: { deadline: '2000000000' } }))).toThrow('owned drop');
  });
});
