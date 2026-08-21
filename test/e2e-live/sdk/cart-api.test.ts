import { describe, expect, it } from 'vitest';
import {
  getAddress,
  isAddressEqual,
  keccak256,
  recoverAddress,
  toBytes,
  zeroAddress,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createRareClient } from '../../../src/sdk/client.js';
import { cartAbi } from '../../../src/contracts/abis/cart.js';
import { getCartAddress } from '../../../src/contracts/addresses.js';
import {
  computeCartListingMerkleRoot,
  deriveCartListingMerkleLeaf,
  hashCartFulfillmentActions,
  hashCartListing,
  hashCartListingRoot,
  hashCartOrderLines,
  hashCartPayoutRoute,
  hashCartPurchaseOrder,
  verifyCartListingMerkleProof,
} from '../../../src/sdk/cart-core.js';
import { loadDotEnv } from '../../helpers/env.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

loadDotEnv();

const describeRareApi = process.env.RARE_API_BASE_URL && hasTestRpcUrl()
  ? describe.sequential
  : describe.skip;

const seller = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const recipient = getAddress('0x00000000000000000000000000000000000000aa');

describeRareApi('SDK Cart rare-api integration', () => {
  it('round-trips catalog, signed Listing Roots, and a prepared Purchase through rare-api', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const cart = getCartAddress('sepolia');
    const rare = createRareClient({
      publicClient,
      apiBaseUrl: process.env.RARE_API_BASE_URL,
    });
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const product = await rare.cart.api.catalog.products.create({
      slug: `sdk-cart-${runId}`,
      metadata: { source: 'rare-sdk', test: 'cart-api', runId },
    });
    const skuA = await rare.cart.api.catalog.skus.create({ metadata: { runId, line: 'a' } });
    const skuB = await rare.cart.api.catalog.skus.create({ metadata: { runId, line: 'b' } });
    await rare.cart.api.catalog.skus.attach(product.id, {
      sku: skuA.sku,
      position: 0,
      metadata: { runId },
    });
    await rare.cart.api.catalog.skus.attach(product.id, {
      sku: skuB.sku,
      position: 1,
      metadata: { runId },
    });

    const listingInputs = [
      { sku: skuA.sku, listingId: `a:${runId}`, price: 1000n },
      { sku: skuB.sku, listingId: `b:${runId}`, price: 2000n },
    ] as const;
    const createdListings = await Promise.all(listingInputs.map(async (input) => {
      const listingId = keccak256(toBytes(input.listingId));
      return rare.cart.api.listing.create({
        seller: seller.address,
        listingId,
        sku: input.sku,
        fulfillmentKind: 2,
        tokenContract: getAddress('0x0000000000000000000000000000000000000011'),
        tokenId: BigInt(input.price),
        settlementCurrency: zeroAddress,
        availableQuantity: 1n,
        paymentRecipient: seller.address,
        displayUnitPrice: input.price,
      });
    }));

    expect(createdListings.map((listing) => listing.listingDigest)).toHaveLength(2);
    const listings = createdListings.map((entry) => ({
      ...entry.listing,
      seller: getAddress(entry.listing.seller),
      tokenContract: getAddress(entry.listing.tokenContract),
      tokenId: BigInt(entry.listing.tokenId),
      settlementCurrency: getAddress(entry.listing.settlementCurrency),
      minimumUnitPrice: BigInt(entry.listing.minimumUnitPrice),
      availableQuantity: BigInt(entry.listing.availableQuantity),
      paymentRecipient: getAddress(entry.listing.paymentRecipient),
    }));

    for (const [index, listing] of listings.entries()) {
      expect(createdListings[index]!.listingDigest).toBe(hashCartListing(listing, 11_155_111n, cart));
      await expect(rare.cart.api.listing.get(createdListings[index]!.listingDigest)).resolves.toMatchObject({
        listingDigest: createdListings[index]!.listingDigest,
      });
    }

    const artifact = rare.cart.listing.buildRoot({
      listings,
      chainId: 11_155_111,
      cart,
      nonce: BigInt(Date.now()),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    });
    const signedArtifact = await rare.cart.listing.signRoot(artifact, {
      address: seller.address,
      signTypedData: seller.signTypedData,
    });
    if (!signedArtifact.signature) throw new Error('SDK did not produce a Listing Root signature.');

    const ingested = await rare.cart.api.listing.ingestRoot(signedArtifact as typeof signedArtifact & { signature: `0x${string}` });
    expect(ingested.listingCount).toBe(2);
    expect(ingested.root.listingsRoot).toBe(artifact.root.listingsRoot);
    expect(ingested.signature).toBe(signedArtifact.signature);

    await waitForListingSearch(rare, skuA.sku, createdListings[0]!.listingDigest);
    await expect(rare.cart.api.catalog.products.get(product.id)).resolves.toMatchObject({ id: product.id });
    await expect(rare.cart.api.catalog.skus.get(skuA.sku)).resolves.toMatchObject({ sku: skuA.sku });

    const idempotencyKey = crypto.randomUUID();
    const draft = {
      paymentCurrency: zeroAddress,
      items: createdListings.map((listing) => ({
        listingDigest: listing.listingDigest,
        quantity: 1n,
        recipient,
      })),
      idempotencyKey,
    };
    const prepared = await rare.cart.api.checkout.prepareOrder(draft);
    const replayed = await rare.cart.api.checkout.prepareOrder(draft);
    expect(replayed).toEqual(prepared);
    expect(prepared.chainId).toBe(11_155_111n);
    expect(isAddressEqual(prepared.cartAddress, cart)).toBe(true);
    expect(prepared.executePurchase.lines.length).toBeGreaterThanOrEqual(2);
    expect(hashCartOrderLines(prepared.executePurchase.lines)).toBe(prepared.executePurchase.order.orderLinesHash);
    expect(hashCartPayoutRoute(prepared.executePurchase.route)).toBe(prepared.executePurchase.order.payoutRouteHash);
    expect(hashCartFulfillmentActions(prepared.executePurchase.actions)).toBe(prepared.executePurchase.order.fulfillmentActionsHash);
    expect(hashCartPurchaseOrder(prepared.executePurchase.order, prepared.chainId, prepared.cartAddress)).toMatch(/^0x[0-9a-f]{64}$/);

    for (const [index, listing] of prepared.executePurchase.listings.entries()) {
      const digest = hashCartListing(listing, prepared.chainId, prepared.cartAddress);
      expect(digest).toBe(createdListings[index]!.listingDigest);
      const rootIndex = Number(prepared.executePurchase.authorization.listingRootIndexes[index]);
      const root = prepared.executePurchase.authorization.listingRoots[rootIndex]!;
      const proof = prepared.executePurchase.authorization.listingProofs[index]!;
      const leaf = deriveCartListingMerkleLeaf(digest);
      expect(computeCartListingMerkleRoot(leaf, proof)).toBe(root.listingsRoot.toLowerCase());
      expect(verifyCartListingMerkleProof(leaf, proof, root.listingsRoot)).toBe(true);
      expect(hashCartListingRoot(root, prepared.chainId, prepared.cartAddress)).toMatch(/^0x[0-9a-f]{64}$/);
    }

    const platformSigner = await publicClient.readContract({
      address: cart,
      abi: cartAbi,
      functionName: 'platformSigner',
    });
    const recoveredSigner = await recoverAddress({
      hash: hashCartPurchaseOrder(prepared.executePurchase.order, prepared.chainId, prepared.cartAddress),
      signature: prepared.executePurchase.platformSignature,
    });
    expect(isAddressEqual(recoveredSigner, platformSigner)).toBe(true);
  }, 120_000);
});

async function waitForListingSearch(
  rare: ReturnType<typeof createRareClient>,
  sku: `0x${string}`,
  digest: `0x${string}`,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await rare.cart.api.listing.search({ sku, perPage: 100 });
    if (result.data.some((listing) => listing.listingDigest === digest)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for Cart Listing ${digest} to become searchable.`);
}
