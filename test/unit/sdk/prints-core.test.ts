import { describe, expect, it } from 'vitest';
import { zeroAddress, zeroHash } from 'viem';
import { parsePrintListingTerms } from '../../../src/sdk/prints-core.js';
import type { PrintListingPreparation } from '../../../src/sdk/types/prints.js';

const listing = { listingSalt: zeroHash, seller: zeroAddress, sku: zeroHash, fulfillmentKind: 1,
  tokenContract: zeroAddress, tokenId: '0', settlementCurrency: zeroAddress, minimumUnitPrice: '15000000',
  availableQuantity: '100', paymentRecipient: zeroAddress };
const preparation = (snapshot: PrintListingPreparation['snapshot']): PrintListingPreparation => ({
  id: '00000000-0000-4000-8000-000000000001', fulfillment_kind: 'PRODIGI_PRINT', user_id: '1', option_id: null,
  chain_id: '11155111', cart_address: zeroAddress, listing_digest: zeroHash, listing_id: null,
  snapshot, created_at: '2026-10-19T00:00:00.000Z',
});

describe('frozen print Listing terms', () => {
  it('retains zero token IDs and converts frozen amounts without changing seller economics', () => {
    const terms = parsePrintListingTerms(preparation({ configured: { listing }, intent: { deadline: '2000000000' } }));
    expect(terms).toEqual({ deadline: 2000000000n, listing: { ...listing, tokenId: 0n,
      minimumUnitPrice: 15000000n, availableQuantity: 100n } });
  });
  it('rejects missing snapshots and unsigned numeric or overflowing amounts before signing', () => {
    expect(() => parsePrintListingTerms(preparation({}))).toThrow('frozen Listing terms');
    for (const tokenId of [-1, '-1', '1.5', (2n ** 256n).toString()]) {
      expect(() => parsePrintListingTerms(preparation({ configured: { listing: { ...listing, tokenId } },
        intent: { deadline: '2000000000' } }))).toThrow('invalid integer');
    }
  });
  it('rejects invalid fulfillment kinds rather than signing an unrelated operation', () => {
    expect(() => parsePrintListingTerms(preparation({ configured: { listing: { ...listing, fulfillmentKind: 6 } },
      intent: { deadline: '2000000000' } }))).toThrow('unsupported fulfillment kind');
  });
});
