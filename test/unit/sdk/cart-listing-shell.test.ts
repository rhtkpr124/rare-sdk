import { zeroAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  addCartListingSalt,
  generateCartListingSalt,
} from '../../../src/sdk/cart-listing-shell.js';
import type { CartListingInput } from '../../../src/sdk/types/cart.js';

const listing = {
  seller: '0x1000000000000000000000000000000000000000',
  sku: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  fulfillmentKind: 1,
  tokenContract: zeroAddress,
  tokenId: 0n,
  settlementCurrency: zeroAddress,
  minimumUnitPrice: 1n,
  availableQuantity: 1n,
  paymentRecipient: '0x1000000000000000000000000000000000000000',
} satisfies CartListingInput;

describe('Cart Listing salt generation', () => {
  it('adds a distinct random bytes32 salt when the caller does not provide one', () => {
    const first = addCartListingSalt(listing);
    const second = addCartListingSalt(listing);

    expect(first.listingSalt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(second.listingSalt).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.listingSalt).not.toBe(second.listingSalt);
  });

  it('preserves an explicit salt for deterministic protocol workflows', () => {
    const listingSalt = generateCartListingSalt();

    expect(addCartListingSalt({ ...listing, listingSalt }).listingSalt).toBe(
      listingSalt,
    );
  });
});
