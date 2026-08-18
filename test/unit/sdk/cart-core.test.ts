import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, zeroAddress, type Address, type Hex } from 'viem';
import {
  aggregateCartSettlementObligations,
  applyCartQuoteSpread,
  buildCartListingAuthorization,
  buildCartListingRootArtifact,
  buildCartOrder,
  buildCartPayoutRoute,
} from '../../../src/sdk/cart-core.js';
import { cartFulfillmentKinds, type CartListing } from '../../../src/sdk/types/cart.js';

const seller = '0x1000000000000000000000000000000000000000' as Address;
const cart = '0x2000000000000000000000000000000000000000' as Address;
const bytes32 = (character: string): Hex => `0x${character.repeat(64)}` as Hex;

const listings: CartListing[] = [
  {
    listingId: bytes32('1'), seller, sku: bytes32('a'), fulfillmentKind: cartFulfillmentKinds.erc721Transfer,
    tokenContract: cart, tokenId: 1n, settlementCurrency: zeroAddress, minimumUnitPrice: 100n,
    availableQuantity: 1n, paymentRecipient: seller,
  },
  {
    listingId: bytes32('2'), seller, sku: bytes32('b'), fulfillmentKind: cartFulfillmentKinds.erc1155Transfer,
    tokenContract: cart, tokenId: 2n, settlementCurrency: zeroAddress, minimumUnitPrice: 200n,
    availableQuantity: 5n, paymentRecipient: seller,
  },
];

describe('Cart functional core', () => {
  it('builds a portable deterministic Listing Root artifact', () => {
    const artifact = buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n });
    expect(artifact.root.listingsRoot).toBe('0xb2e29f917ba4d63da25bff0f13a46a02caa94b1c081b66ec51b93761a8ec3bc2');
    expect(artifact.entries.map((entry) => entry.listingDigest)).toEqual([
      '0x056a20bad3561c36a41a1ed629e7a2021fbc9d2570c1a8692342ef2c1c97023e',
      '0x39805ad1aa6fa18731378769f4f3558d791294fbb489b8745855b300be97965b',
    ]);
    expect(() => JSON.stringify(artifact)).not.toThrow();
  });

  it('assembles deduplicated seller authorization witnesses', () => {
    const artifact = { ...buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n }), signature: '0x1234' as Hex };
    const result = buildCartListingAuthorization(artifact.entries.map((entry) => ({ artifact, listingDigest: entry.listingDigest })));
    expect(result.listings).toEqual(listings);
    expect(result.authorization.listingRoots).toHaveLength(1);
    expect(result.authorization.listingRootIndexes).toEqual([0n, 0n]);
  });

  it('hashes the complete immutable Purchase Order payload', () => {
    const artifact = buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n });
    const built = buildCartOrder({
      orderId: bytes32('c'), paymentCurrency: zeroAddress, deadline: 2_000_000_000n, paymentAmount: 500n,
      lines: [{ sku: bytes32('a'), listingHash: artifact.entries[0]!.listingDigest,
        fulfillmentKind: cartFulfillmentKinds.erc721Transfer, quantity: 1n, settlementCurrency: zeroAddress,
        amount: 100n, paymentRecipient: seller }],
      actions: [{ lineIndex: 0n, quantity: 1n, recipient: seller }],
    });
    expect(built.order.orderLinesHash).toBe('0xc02b9f957c0dd381478d59c0534f943355a7d70f36563a47b23b70d4e476f8e9');
    expect(built.order.payoutRouteHash).toBe('0x3112387f541288de916e2809d7bf60d3f35729f4f1385c6c0b3385d6100c97ec');
    expect(built.order.fulfillmentActionsHash).toBe('0xba849680009431518c33bc2af2eb9cdc70aab55365b8e33eac1c35eb3223b1ff');
  });

  it('aggregates settlement obligations and rounds fixed quote spread upward', () => {
    const lines = [
      { sku: bytes32('a'), listingHash: bytes32('0'), fulfillmentKind: cartFulfillmentKinds.none,
        quantity: 1n, settlementCurrency: zeroAddress, amount: 100n, paymentRecipient: seller },
      { sku: bytes32('b'), listingHash: bytes32('0'), fulfillmentKind: cartFulfillmentKinds.none,
        quantity: 1n, settlementCurrency: zeroAddress, amount: 25n, paymentRecipient: seller },
    ];
    expect(aggregateCartSettlementObligations(lines).get(zeroAddress)).toBe(125n);
    expect(applyCartQuoteSpread(101n, 50n)).toBe(102n);
  });

  it('encodes an order-wide exact-output route using Cart policy sentinels', () => {
    const output = '0x3000000000000000000000000000000000000000' as Address;
    const route = buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { protocol: 'v2', mode: 'exact-output', path: [seller, output], amountOut: 7n, amountInMaximum: 11n },
    ] });
    expect(route.commands).toBe('0x09');
    expect(decodeAbiParameters([
      { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'bool' },
    ], route.inputs[0]!)).toEqual([
      '0x0000000000000000000000000000000000000001', 7n, 11n, [seller, output], true,
    ]);
  });

  it('rejects seller Listings that use the platform-only currency swap kind', () => {
    expect(() => buildCartListingRootArtifact({ listings: [{ ...listings[0]!, fulfillmentKind: cartFulfillmentKinds.currencySwap }],
      chainId: 11_155_111, cart, nonce: 0n, deadline: 1n })).toThrow('CURRENCY_SWAP');
  });
});
