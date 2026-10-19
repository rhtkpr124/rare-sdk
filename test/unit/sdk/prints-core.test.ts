import { describe, expect, expectTypeOf, it } from 'vitest';
import { zeroAddress, zeroHash } from 'viem';
import { parsePrintListingTerms } from '../../../src/sdk/prints-core.js';
import type { CreatePrintDrop, PrintListingPreparation } from '../../../src/sdk/types/prints.js';

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
