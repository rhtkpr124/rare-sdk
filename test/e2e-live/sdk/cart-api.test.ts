import { createCartApiNamespace } from '../../../src/sdk/cart-api.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getAddress,
  isAddressEqual,
  keccak256,
  recoverAddress,
  toBytes,
  zeroAddress,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createRareClient } from '../../../src/sdk/client.js';
import type { RareClient } from '../../../src/sdk/types/client.js';
import type { CartFulfillmentKind, CartListing } from '../../../src/sdk/types/cart.js';
import { cartAbi } from '../../../src/contracts/abis/cart.js';
import { getCartAddress } from '../../../src/contracts/addresses.js';
import {
  computeCartListingMerkleRoot,
  cartDomain,
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

const describeRareApi = process.env.RARE_API_BASE_URL && process.env.RARE_API_AUTH_TOKEN && hasTestRpcUrl()
  ? describe.sequential
  : describe.skip;

const seller = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const recipient = getAddress('0x00000000000000000000000000000000000000aa');

describeRareApi('SDK Cart rare-api integration', () => {
  let scenario: Awaited<ReturnType<typeof createCartScenario>>;

  beforeAll(async () => {
    scenario = await createCartScenario();
  }, 120_000);

  it('searches Cart Products and Variants independently', async () => {
    const { rare, product, skuA } = scenario;
    await expect(rare.cart.catalog.products.get(product.id)).resolves.toMatchObject({ id: product.id });
    const products = await rare.cart.catalog.products.search({ id: product.id, page: 1, perPage: 100 });
    expect(products.data.some((candidate) => candidate.id === product.id)).toBe(true);
    const variants = await rare.cart.catalog.variants.search({ sku: skuA.sku, page: 1, perPage: 100 });
    expect(variants.data.some((candidate) => candidate.sku === skuA.sku)).toBe(true);
  }, 30_000);

  it('gets and searches signed Listings with filtering and pagination', async () => {
    const { rare, cart, chainId, skuA, createdListings, listings } = scenario;
    expect(createdListings).toHaveLength(2);
    for (const [index, listing] of listings.entries()) {
      expect(createdListings[index]!.listingDigest).toBe(hashCartListing(listing, BigInt(chainId), cart));
      await expect(rare.cart.listing.get(createdListings[index]!.listingDigest)).resolves.toMatchObject({
        listingDigest: createdListings[index]!.listingDigest,
      });
    }
    const filteredListings = await rare.cart.listing.search({
      sku: skuA.sku, page: 1, perPage: 1, sortBy: 'priceAsc',
    });
    expect(filteredListings.data).toHaveLength(1);
    expect(filteredListings.data[0]!.listingDigest).toBe(createdListings[0]!.listingDigest);
    expect(filteredListings.pagination.page).toBe(1);
    expect(filteredListings.pagination.perPage).toBe(1);
  }, 30_000);

  it('ingests seller-authorized Listing Roots and rejects invalid signatures', async () => {
    const { rare, cart, chainId, listings, listingNonce, artifact, signedArtifact, ingested } = scenario;
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
    await expect(scenario.api.listing.publish({
      ...invalidRoot,
      signature: `0x${'00'.repeat(65)}`,
    } as typeof invalidRoot & { signature: `0x${string}` })).rejects.toThrow();
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
    const preparation = await rare.cart.checkout.prepare(draft);
    expect(preparation.intent).toEqual(draft);
    expect(preparation.paymentAmount).toBeGreaterThan(0n);
    expect(Date.parse(preparation.expiresAt)).toBeGreaterThan(Date.now());
    const prepared = await scenario.api.checkout.prepare(draft);
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
    const receipt = await rare.cart.checkout.receipt(prepared.executePurchase.order.orderId);
    expect(receipt.status).toBe('pending');
    expect(receipt.issues).toEqual([]);
    const allocations = receipt.feeAllocations?.allocations;
    if (allocations === undefined) throw new Error('Signed checkout lost its item-level fee allocations.');
    const sellerFees = allocations.filter(allocation => allocation.bearer === 'SELLER');
    expect(sellerFees).toHaveLength(2);
    expect(new Set(sellerFees.map(allocation => allocation.finalLineIndex)).size).toBe(1);
    expect(sellerFees.map(allocation => allocation.sourceLineIndex)).toEqual([0, 1]);
    expect(prepared.executePurchase.lines.filter(line => line.fulfillmentKind === 0)).toHaveLength(2);
    expect(prepared.executePurchase.lines).toHaveLength(4);
    for (const [index, line] of prepared.executePurchase.lines.entries()) {
      if (line.fulfillmentKind !== 0) continue;
      expect(allocations.filter(allocation => allocation.finalLineIndex === index)
        .reduce((sum, allocation) => sum + BigInt(allocation.amount), 0n)).toBe(line.amount);
    }
    expect((await rare.cart.checkout.receipt(prepared.executePurchase.order.orderId)).feeAllocations).toEqual(receipt.feeAllocations);
    const feeLine = prepared.executePurchase.lines.find(line => line.fulfillmentKind === 0 && line.amount > 1n);
    if (feeLine === undefined) throw new Error('Fixture requires a divisible fee line.');
    const expandedLines = prepared.executePurchase.lines.flatMap(line => line === feeLine
      ? [{ ...line, amount: 1n }, { ...line, amount: line.amount - 1n }] : [line]);
    const expandedSigner = await recoverAddress({
      hash: hashCartPurchaseOrder({ ...prepared.executePurchase.order, orderLinesHash: hashCartOrderLines(expandedLines) }, prepared.chainId, prepared.cartAddress),
      signature: prepared.executePurchase.platformSignature,
    });
    expect(isAddressEqual(expandedSigner, platformSigner)).toBe(false);
  }, 60_000);

  it('handles off-chain Listings and real API not-found errors', async () => {
    const { rare, runId, skuA } = scenario;
    const offChainListing = await postCartFixture<{ listing: { fulfillmentKind: number; minimumUnitPrice: string } }>(
      scenario.apiFetch, scenario.apiBaseUrl, '/v1/cart/listings', {
      seller: seller.address,
      sku: skuA.sku,
      fulfillmentKind: 1,
      settlementCurrency: zeroAddress,
      paymentRecipient: seller.address,
      displayUnitPrice: '500',
      availableQuantity: '1',
      listingSalt: keccak256(toBytes(`offchain:${runId}`)),
      chainId: '11155111',
      cartAddress: scenario.cart,
    });
    expect(offChainListing.listing.fulfillmentKind).toBe(1);
    expect(BigInt(offChainListing.listing.minimumUnitPrice)).toBeGreaterThan(0n);

    const missingListingDigest = keccak256(toBytes(`missing:${runId}`));
    await expect(rare.cart.listing.get(missingListingDigest)).rejects.toThrow();
  }, 30_000);

  it('invalidates a Listing after all purchase preparation checks', async () => {
    const { rare, createdListings } = scenario;
    const listingDigest = createdListings[0]!.listingDigest;
    const invalidated = await rare.cart.listing.invalidate(listingDigest, new Date().toISOString());
    expect(invalidated.listingDigest).toBe(listingDigest);
    expect(invalidated.invalidatedAt).not.toBeNull();
    await expect(rare.cart.listing.get(listingDigest)).resolves.toMatchObject({
      listingDigest,
      invalidatedAt: expect.any(String),
    });
  }, 30_000);
});

async function createCartScenario() {
  const apiBaseUrl = process.env.RARE_API_BASE_URL;
  const authToken = process.env.RARE_API_AUTH_TOKEN;
  if (!apiBaseUrl || !authToken) throw new Error('RARE_API_BASE_URL and RARE_API_AUTH_TOKEN are required.');
  const apiFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${authToken}`);
    return fetch(input, { ...init, headers });
  };
  const publicClient = createTestSepoliaPublicClient();
  const cart = getCartAddress('sepolia');
  const chainId = 11_155_111;
  const tokenContract = getAddress('0x0000000000000000000000000000000000000011');
  const rare = createRareClient({ publicClient, apiBaseUrl, apiFetch });
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const product = await postCartFixture<{ id: string }>(apiFetch, apiBaseUrl, '/v1/cart/products', {
    slug: `sdk-cart-${runId}`,
    metadata: { source: 'rare-sdk', test: 'cart-api', runId },
  });
  const configuredVariants = await postCartFixture<{variants:Array<{sku: `0x${string}`}>}>(apiFetch, apiBaseUrl, `/v1/cart/products/${product.id}/variants`, {variants:[{metadata:{chainId:chainId.toString(),tokenContract,tokenId:'1000'}},{metadata:{chainId:chainId.toString(),tokenContract,tokenId:'2000'}}]});
  const skuA=configuredVariants.variants[0],skuB=configuredVariants.variants[1];
  if(skuA===undefined||skuB===undefined)throw new Error('Creator fixture did not return its variants');
  const listingInputs = [
    { sku: skuA.sku, price: 1000n },
    { sku: skuB.sku, price: 2000n },
  ] as const;
  const createdListings = await Promise.all(listingInputs.map(async (input) => postCartFixture<{
    listingDigest: `0x${string}`;
    listing: {
      listingSalt: `0x${string}`; seller: Address; sku: `0x${string}`; fulfillmentKind: number;
      tokenContract: Address; tokenId: string; settlementCurrency: Address; minimumUnitPrice: string;
      availableQuantity: string; paymentRecipient: Address;
    };
  }>(apiFetch, apiBaseUrl, '/v1/cart/listings', {
    seller: seller.address,
    sku: input.sku,
    fulfillmentKind: 2,
    tokenContract,
    tokenId: input.price.toString(),
    settlementCurrency: zeroAddress,
    availableQuantity: '1',
    paymentRecipient: seller.address,
    displayUnitPrice: input.price.toString(),
    listingSalt: keccak256(toBytes(`${runId}:${input.sku}`)),
    chainId: chainId.toString(),
    cartAddress: cart,
  })));
  const listings: CartListing[] = createdListings.map((entry) => ({
    ...entry.listing,
    seller: getAddress(entry.listing.seller),
    tokenContract: getAddress(entry.listing.tokenContract),
    tokenId: BigInt(entry.listing.tokenId),
    settlementCurrency: getAddress(entry.listing.settlementCurrency),
    minimumUnitPrice: BigInt(entry.listing.minimumUnitPrice),
    availableQuantity: BigInt(entry.listing.availableQuantity),
    paymentRecipient: getAddress(entry.listing.paymentRecipient),
    fulfillmentKind: entry.listing.fulfillmentKind as CartFulfillmentKind,
  }));
  const listingNonce = await publicClient.readContract({
    address: cart,
    abi: cartAbi,
    functionName: 'listingNonces',
    args: [seller.address],
  });
  const artifact = rare.utils.cart.buildListingRoot({
    listings,
    chainId,
    cart,
    nonce: listingNonce,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  });
  const signature = await seller.signTypedData({ domain: cartDomain(chainId, cart), primaryType: 'ListingRoot', types: { ListingRoot: [
    { name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ] }, message: { listingsRoot: artifact.root.listingsRoot, nonce: BigInt(artifact.root.nonce), deadline: BigInt(artifact.root.deadline) } });
  const signed = { ...artifact, signature };
  const api = createCartApiNamespace({ baseUrl: apiBaseUrl, fetch: apiFetch }, { chainId, cartAddress: cart });
  const ingested = await api.listing.publish(signed);
  await waitForListingSearch(rare, skuA.sku, createdListings[0]!.listingDigest);
  return { rare, api, publicClient, cart, chainId, runId, apiFetch, apiBaseUrl, product, skuA, createdListings, listings,
    listingNonce, artifact, signedArtifact: signed, ingested };
}

async function postCartFixture<T = unknown>(
  apiFetch: typeof fetch,
  apiBaseUrl: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await apiFetch(new URL(path, apiBaseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Cart fixture request ${path} failed with ${response.status}.`);
  const payload = await response.json() as { data?: T };
  if (payload.data === undefined) throw new Error(`Cart fixture request ${path} returned no data.`);
  return payload.data;
}

async function waitForListingSearch(
  rare: RareClient,
  sku: `0x${string}`,
  digest: `0x${string}`,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await rare.cart.listing.search({ sku, perPage: 100 });
    if (result.data.some((listing) => listing.listingDigest === digest)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for Cart Listing ${digest} to become searchable.`);
}
