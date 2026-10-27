import { describe, expect, expectTypeOf, it } from 'vitest';
import { zeroAddress, zeroHash } from 'viem';
import type { paths } from '../../../src/data-access/commerce-schema.js';
import { parsePrintListingTerms, validatePrintListingQuantityLimit } from '../../../src/sdk/prints-core.js';
import type { ConfigurePrintOption, CreatePrintDrop, PreparePrintListing, PrintListingPreparation, PrintDrop, PublicPrintDrop } from '../../../src/sdk/types/prints.js';

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
    deadline: '2000000000', availableQuantity: '10' };
  it('exposes physical print configuration without an NFT receipt or fulfillment selector', () => {
    expectTypeOf<ConfigurePrintOption>().not.toHaveProperty('receipt');
    expectTypeOf<PreparePrintListing>().not.toHaveProperty('fulfillmentKind');
    expectTypeOf<PublicPrintDrop['options'][number]>().not.toHaveProperty('receipt');
  });
  it('validates copy limits before remote preparation and preserves the one-copy default', () => {
    expect(validatePrintListingQuantityLimit(input)).toEqual({ valid: true });
    expect(validatePrintListingQuantityLimit({ ...input, maxQuantityPerCheckout: '1000' })).toEqual({ valid: true });
    for (const maxQuantityPerCheckout of ['0', '-1', '1.5', '01', '1001', '999999999999999999999']) {
      expect(validatePrintListingQuantityLimit({ ...input, maxQuantityPerCheckout }).valid).toBe(false);
    }
  });
  it('requires physical print details and keeps NFT attribution separate from creation and response identity', () => {
    expectTypeOf<CreatePrintDrop['chainId']>().toEqualTypeOf<'11155111'>();
    expectTypeOf<CreatePrintDrop['print']>().toEqualTypeOf<NonNullable<CreatePrintDrop['print']>>();
    expectTypeOf<CreatePrintDrop['print']>().toHaveProperty('productionUploadKey').toEqualTypeOf<string>();
    expectTypeOf<CreatePrintDrop['print']>().toHaveProperty('sourceUniversalTokenId');
    expectTypeOf<CreatePrintDrop['print']>().not.toHaveProperty('productionImageUri');
    expectTypeOf<CreatePrintDrop>().not.toHaveProperty('universalTokenId');
    expectTypeOf<PrintDrop>().not.toHaveProperty('universal_token_id');
    expectTypeOf<PublicPrintDrop>().not.toHaveProperty('universalTokenId');
    expectTypeOf<paths>().not.toHaveProperty('/v1/prints/orders/{id}');
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
    for (const fulfillmentKind of [0, 2, 3, 4, 5, 6]) {
      expect(() => parsePrintListingTerms(preparation({ dropId, configured: { listing: { ...listing, fulfillmentKind } },
        intent: { deadline: '2000000000' } }))).toThrow('unsupported fulfillment kind');
    }
  });
  it('requires the owned drop identity before any approval preflight', () => {
    expect(() => parsePrintListingTerms(preparation({ configured: { listing }, intent: { deadline: '2000000000' } }))).toThrow('owned drop');
  });
});
