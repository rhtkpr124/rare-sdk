import { describe, expect, it } from 'vitest';
import { zeroAddress, type Address, type Hex } from 'viem';
import {
  cartAbi,
  cartHashesAbi,
  getCartAddress,
  getCartHashesAddress,
} from '../../../src/sdk/contracts.js';
import {
  buildCartListingRoot,
  buildCartPurchaseOrder,
  deriveCartListingMerkleLeaf,
  hashCartFulfillmentActions,
  hashCartListing,
  hashCartListingRoot,
  hashCartOrderLines,
  hashCartPayoutRoute,
  hashCartPurchaseOrder,
} from '../../../src/sdk/public-utils.js';
import { cartFulfillmentKinds, type CartListing } from '../../../src/sdk/types/cart.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeLive = hasTestRpcUrl() ? describe : describe.skip;
const chain = 'sepolia' as const;
const cart = getCartAddress(chain);
const hashes = getCartHashesAddress(chain)!;
const seller = '0x1000000000000000000000000000000000000000' as Address;
const bytes32 = (character: string): Hex => `0x${character.repeat(64)}` as Hex;

describeLive('SDK Cart hashing parity', () => {
  it('matches the deployed CartHashes helper for every signed protocol component', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const domainSeparator = await publicClient.readContract({
      address: cart,
      abi: cartAbi,
      functionName: 'DOMAIN_SEPARATOR',
    });
    const listing: CartListing = {
      listingSalt: bytes32('1'),
      seller,
      sku: bytes32('a'),
      fulfillmentKind: cartFulfillmentKinds.offChain,
      tokenContract: zeroAddress,
      tokenId: 0n,
      settlementCurrency: zeroAddress,
      minimumUnitPrice: 100n,
      availableQuantity: 2n,
      paymentRecipient: seller,
    };
    const artifact = buildCartListingRoot({
      listings: [listing],
      chainId: 11_155_111,
      cart,
      nonce: 0n,
      deadline: 2_000_000_000n,
    });
    const root = {
      listingsRoot: artifact.root.listingsRoot,
      nonce: 0n,
      deadline: 2_000_000_000n,
    };
    const line = {
      sku: listing.sku,
      listingDigest: artifact.entries[0]!.listingDigest,
      fulfillmentKind: listing.fulfillmentKind,
      quantity: 1n,
      settlementCurrency: listing.settlementCurrency,
      amount: 100n,
      paymentRecipient: listing.paymentRecipient,
    };
    const route = { commands: '0x' as Hex, inputs: [] as Hex[], routerValue: 0n };
    const action = { lineIndex: 0n, quantity: 1n, recipient: seller };
    const built = buildCartPurchaseOrder({
      orderId: bytes32('c'),
      paymentCurrency: zeroAddress,
      deadline: 2_000_000_000n,
      paymentAmount: 100n,
      lines: [line],
      route,
      actions: [action],
    });

    const [listingDigest, rootDigest, leaf, linesHash, routeHash, actionsHash, orderDigest] = await Promise.all([
      publicClient.readContract({ address: hashes, abi: cartHashesAbi, functionName: 'hashListing', args: [domainSeparator, listing] }),
      publicClient.readContract({ address: hashes, abi: cartHashesAbi, functionName: 'hashListingRoot', args: [domainSeparator, root] }),
      publicClient.readContract({ address: hashes, abi: cartHashesAbi, functionName: 'hashListingLeaf', args: [artifact.entries[0]!.listingDigest] }),
      publicClient.readContract({ address: hashes, abi: cartHashesAbi, functionName: 'hashOrderLines', args: [[line]] }),
      publicClient.readContract({ address: hashes, abi: cartHashesAbi, functionName: 'hashPayoutRoute', args: [route] }),
      publicClient.readContract({ address: hashes, abi: cartHashesAbi, functionName: 'hashFulfillmentActions', args: [[action]] }),
      publicClient.readContract({ address: hashes, abi: cartHashesAbi, functionName: 'hashOrder', args: [domainSeparator, built.order] }),
    ]);

    expect(listingDigest).toBe(hashCartListing(listing, 11_155_111n, cart));
    expect(rootDigest).toBe(hashCartListingRoot(root, 11_155_111n, cart));
    expect(leaf).toBe(deriveCartListingMerkleLeaf(artifact.entries[0]!.listingDigest));
    expect(linesHash).toBe(hashCartOrderLines([line]));
    expect(routeHash).toBe(hashCartPayoutRoute(route));
    expect(actionsHash).toBe(hashCartFulfillmentActions([action]));
    expect(orderDigest).toBe(hashCartPurchaseOrder(built.order, 11_155_111n, cart));
  });
});
