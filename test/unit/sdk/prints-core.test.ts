import { describe, expect, expectTypeOf, it } from 'vitest';
import { zeroAddress, zeroHash } from 'viem';
import type { paths } from '../../../src/data-access/commerce-schema.js';
import { parsePrintListingTerms, validatePrintListingQuantityLimit, validatePrintOptionConfiguration } from '../../../src/sdk/prints-core.js';
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
    deadline: '2000000000', availableQuantity: '10', fulfillmentKind: 1 };
  it('supports receipt configuration and server-derived fulfillment through the existing methods', () => {
    expectTypeOf<ConfigurePrintOption>().toHaveProperty('receipt');
    const withoutKind: PreparePrintListing = { optionId: dropId, seller: zeroAddress, listingSalt: zeroHash,
      deadline: '2000000000', availableQuantity: '10' };
    expect(validatePrintListingQuantityLimit(withoutKind)).toEqual({ valid: true });
    expect(validatePrintOptionConfiguration({ displayPriceUsdCents: '2500', receipt: { sku: zeroHash } })).toEqual({ valid: true });
    expect(validatePrintOptionConfiguration({ displayPriceUsdCents: '2500', receipt: null })).toEqual({ valid: true });
    expect(validatePrintOptionConfiguration({ displayPriceUsdCents: '2500' })).toEqual({ valid: true });
    expect(validatePrintOptionConfiguration({ displayPriceUsdCents: '2500', receipt: { sku: 'invalid' } }).valid).toBe(false);
  });
  it('keeps the print SKU distinct from its receipt and verifies the frozen mint target', () => {
    const receipt = { sku: `0x${'a'.repeat(64)}`, chainId: '11155111', tokenContract: zeroAddress, tokenId: '7' };
    const snapshot = { dropId, receipt, configured: { listing: { ...listing, fulfillmentKind: 5, tokenId: '7' } }, intent: { deadline: '2000000000' } };
    const terms = parsePrintListingTerms(preparation(snapshot));
    expect(terms.listing.sku).toBe(zeroHash);
    expect(terms.listing.fulfillmentKind).toBe(5);
    expect(terms.listing.tokenId).toBe(7n);
    for (const changed of [{ ...receipt, chainId: '1' }, { ...receipt, tokenId: '8' }]) {
      expect(() => parsePrintListingTerms(preparation({ ...snapshot, receipt: changed }))).toThrow('does not match');
    }
    expect(() => parsePrintListingTerms(preparation({ ...snapshot, configured: { listing } }))).toThrow('does not match');
  });
  it('validates copy limits before remote preparation and preserves the one-copy default', () => {
    expect(validatePrintListingQuantityLimit(input)).toEqual({ valid: true });
    expect(validatePrintListingQuantityLimit({ ...input, maxQuantityPerCheckout: '1000' })).toEqual({ valid: true });
    for (const maxQuantityPerCheckout of ['0', '-1', '1.5', '01', '1001', '999999999999999999999']) {
      expect(validatePrintListingQuantityLimit({ ...input, maxQuantityPerCheckout }).valid).toBe(false);
    }
  });
  it('supports multiple copies with physical fulfillment and optional receipt minting', () => {
    const fulfillmentKinds: readonly NonNullable<PreparePrintListing['fulfillmentKind']>[] = [1, 5];
    for (const fulfillmentKind of fulfillmentKinds) {
      expect(validatePrintListingQuantityLimit({ ...input, fulfillmentKind, maxQuantityPerCheckout: '2' })).toEqual({ valid: true });
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
    for (const fulfillmentKind of [2, 3, 6]) {
      expect(() => parsePrintListingTerms(preparation({ dropId, configured: { listing: { ...listing, fulfillmentKind } },
        intent: { deadline: '2000000000' } }))).toThrow('unsupported fulfillment kind');
    }
  });
  it('requires the owned drop identity before any approval preflight', () => {
    expect(() => parsePrintListingTerms(preparation({ configured: { listing }, intent: { deadline: '2000000000' } }))).toThrow('owned drop');
  });
});
