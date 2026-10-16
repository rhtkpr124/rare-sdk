import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isAddressEqual,
  keccak256,
  recoverAddress,
  toBytes,
  zeroAddress,
  type Address,
} from 'viem';
import { cartAbi } from '../../../src/contracts/abis/cart.js';
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
import { createCreatorCartScenario } from '../../helpers/cart-creator-fixture.js';

loadDotEnv();

const recipient: Address = '0x00000000000000000000000000000000000000aa';

describe.sequential('SDK Cart rare-api integration', () => {
  let scenario: Awaited<ReturnType<typeof createCreatorCartScenario>>;

  beforeAll(async () => {
    scenario = await createCreatorCartScenario();
  }, 360_000);

  afterAll(async () => {
    await scenario?.accountClient.auth.logout();
  });

  it('searches Cart Products and Variants independently', async () => {
    const { rare, product, skuA } = scenario;
    await expect(rare.cart.api.catalog.products.get(product.id)).resolves.toMatchObject({ id: product.id });
    const products = await rare.cart.api.catalog.products.search({ id: product.id, page: 1, perPage: 100 });
    expect(products.data.some((candidate) => candidate.id === product.id)).toBe(true);
    const variants = await rare.cart.api.catalog.variants.search({ sku: skuA.sku, page: 1, perPage: 100 });
    expect(variants.data.some((candidate) => candidate.sku === skuA.sku)).toBe(true);
  }, 30_000);

  it('gets and searches signed Listings with filtering and pagination', async () => {
    const { rare, cart, chainId, skuA, createdListings, listings } = scenario;
    expect(createdListings).toHaveLength(2);
    for (const [index, listing] of listings.entries()) {
      expect(createdListings[index]!.listingDigest).toBe(hashCartListing(listing, BigInt(chainId), cart));
      await expect(rare.cart.api.listing.get(createdListings[index]!.listingDigest)).resolves.toMatchObject({
        listingDigest: createdListings[index]!.listingDigest,
      });
    }
    const filteredListings = await rare.cart.api.listing.search({
      sku: skuA.sku, page: 1, perPage: 1, sortBy: 'priceAsc',
    });
    expect(filteredListings.data).toHaveLength(1);
    expect(filteredListings.data[0]!.listingDigest).toBe(createdListings[0]!.listingDigest);
    expect(filteredListings.pagination.page).toBe(1);
    expect(filteredListings.pagination.perPage).toBe(1);
  }, 30_000);

  it('ingests seller-authorized Listing Roots and rejects invalid signatures', async () => {
    const { rare, cart, chainId, listings, listingNonce, artifact, signedArtifact, ingested, seller } = scenario;
    const recoveredSeller = await recoverAddress({
      hash: hashCartListingRoot({
        listingsRoot: artifact.root.listingsRoot,
        nonce: BigInt(artifact.root.nonce),
        deadline: BigInt(artifact.root.deadline),
      }, BigInt(chainId), cart),
      signature: signedArtifact.signature,
    });
    expect(isAddressEqual(recoveredSeller, seller.address)).toBe(true);
    expect(ingested.listingCount).toBe(2);
    expect(ingested.root.listingsRoot).toBe(artifact.root.listingsRoot);
    expect(ingested.signature).toBe(signedArtifact.signature);
    const invalidRoot = rare.utils.cart.buildListingRoot({
      listings,
      chainId,
      cart,
      nonce: listingNonce + 1n,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
    });
    await expect(rare.cart.api.listing.publish(scenario.listingIntent, {
      ...invalidRoot,
      signature: `0x${'00'.repeat(65)}`,
    })).rejects.toThrow();
  }, 30_000);

  it('prepares checkout without a wallet, then creates and verifies its signed Purchase', async () => {
    const { rare, publicClient, cart, createdListings } = scenario;
    const draft = {
      paymentCurrency: zeroAddress,
      items: createdListings.map((listing) => ({
        kind: 'listing' as const,
        listingDigest: listing.listingDigest,
        quantity: 1n,
        recipient,
      })),
    };
    const preparation = await rare.cart.api.checkout.preview(draft);
    expect(preparation.intent).toEqual(draft);
    expect(preparation.paymentAmount).toBeGreaterThan(0n);
    expect(Date.parse(preparation.expiresAt)).toBeGreaterThan(Date.now());
    const prepared = await rare.cart.api.checkout.prepare(preparation.preparationReference);
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
  }, 60_000);

  it('rejects unauthorized variant attachment and returns real API not-found errors', async () => {
    const { rare, runId, product, apiBaseUrl, apiFetch } = scenario;
    const response = await apiFetch(new URL(`/v1/cart/products/${product.id}/variants`, apiBaseUrl), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ universalTokenIds: ['11155111-0x0000000000000000000000000000000000000001-0'] }),
    });
    expect(response.status).toBe(409);

    const missingListingDigest = keccak256(toBytes(`missing:${runId}`));
    await expect(rare.cart.api.listing.get(missingListingDigest)).rejects.toThrow();
  }, 30_000);

  it('invalidates a Listing after all purchase preparation checks', async () => {
    const { rare, createdListings } = scenario;
    const listingDigest = createdListings[0]!.listingDigest;
    const invalidated = await rare.cart.api.listing.invalidate(listingDigest, new Date().toISOString());
    expect(invalidated.listingDigest).toBe(listingDigest);
    expect(invalidated.invalidatedAt).not.toBeNull();
    await expect(rare.cart.api.listing.get(listingDigest)).resolves.toMatchObject({
      listingDigest,
      invalidatedAt: expect.any(String),
    });
  }, 30_000);
});

