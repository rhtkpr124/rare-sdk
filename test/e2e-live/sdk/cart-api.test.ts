import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isAddressEqual,
  isHex,
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
import { isRecord } from '../../../src/sdk/account-auth-core.js';
import { createCreatorCartScenario } from '../../helpers/cart-creator-fixture.js';
import { RareApiError } from '../../../dist/sdk/index.js';

loadDotEnv();

const recipient: Address = '0x00000000000000000000000000000000000000aa';

describe.sequential('SDK Cart rare-api integration', () => {
  let scenario: Awaited<ReturnType<typeof createCreatorCartScenario>>;

  beforeAll(async () => {
    scenario = await createCreatorCartScenario();
  }, 360_000);

  afterAll(async () => {
    await scenario?.rare.auth.logout();
  });

  it('checks out 64 merchandise selections without counting generated fees against capacity', async () => {
    const { rare, seller, cart } = scenario;
    const collection = await rare.collection.deploy.erc1155({ name: 'Cart capacity', symbol: 'CAP', baseUri: '' });
    const edition = await rare.collection.erc1155.createToken({ contract: collection.contract, maxSupply: 64n,
      tokenUri: `data:application/json,${encodeURIComponent(JSON.stringify({ name: 'Cart capacity', image: scenario.imageUrl }))}` });
    await rare.collection.erc1155.setMinterApproval({ contract: collection.contract, minter: cart, approved: true });
    const product = await rare.cart.catalog.products.create({ metadata: { title: '64-item capacity fixture' } });
    try {
      const configured = await rare.cart.catalog.variants.add(product.id, { variants: [{ metadata: {
        type: 'ERC1155', chainId: '11155111', tokenContract: collection.contract, tokenId: edition.tokenId.toString(),
      } }] });
      const variant: unknown = configured.variants[0];
      if (!isRecord(variant) || typeof variant.sku !== 'string' || !isHex(variant.sku)) throw new Error('Capacity fixture requires a SKU.');
      const sku = variant.sku;
      const publication = await rare.cart.listing.publish({ preparation: await rare.cart.listing.prepare({
        seller: seller.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
        listings: Array.from({ length: 64 }, () => ({ sku, fulfillmentKind: 5, quantity: 1n,
          unitPrice: 1_000_000_000_000n, settlementCurrency: zeroAddress })),
      }) });
      const preview = await rare.cart.checkout.prepare({ paymentCurrency: zeroAddress,
        items: publication.signedArtifact.entries.map(entry => ({ kind: 'listing', listingDigest: entry.listingDigest, quantity: 1n, recipient: seller.address })),
      });
      expect(preview.intent.items).toHaveLength(64);
      const signed = await rare.cart.checkout.authorize(preview);
      expect(signed.executePurchase.lines.filter(line => line.fulfillmentKind === 5)).toHaveLength(64);
      expect(signed.executePurchase.lines.length).toBeGreaterThan(64);
      expect(signed.executePurchase.platformSignature).not.toBe('0x');
      expect(preview.paymentAmount).toBeLessThan(1_000_000_000_000_000n);
      const purchase = await rare.cart.checkout.purchase({ preparation: preview });
      expect(purchase.receipt.status).toBe('success');
      expect(purchase.actionCount).toBe(64);
      expect(purchase.lineCount).toBeGreaterThan(64);
      expect(purchase.receipt.gasUsed).toBeLessThanOrEqual(12_000_000n);
      console.info('Cart 64-item checkout', { txHash: purchase.txHash, gasUsed: purchase.receipt.gasUsed.toString() });
    } finally {
      await rare.cart.catalog.products.archive(product.id);
    }
  }, 600_000);

  it('refuses to release a signed checkout whose mint execution exceeds 12 million gas', async () => {
    const { rare, seller, cart, publicClient } = scenario;
    const collection = await rare.collection.deploy.lazyErc721({ name: 'Cart gas policy', symbol: 'GAS', maxTokens: 512n });
    await rare.collection.prepareLazyMint({ contract: collection.contract, baseUri: `data:application/json,${encodeURIComponent(JSON.stringify({ name: 'Gas policy', image: scenario.imageUrl }))}`, amount: 512n, minter: cart });
    const product = await rare.cart.catalog.products.create({ metadata: { title: 'Cart gas policy fixture' } });
    try {
      const configured = await rare.cart.catalog.variants.add(product.id, { variants: [{ metadata: {
        type: 'ERC721', chainId: '11155111', tokenContract: collection.contract, tokenId: '0',
      } }] });
      const variant: unknown = configured.variants[0];
      if (!isRecord(variant) || typeof variant.sku !== 'string' || !isHex(variant.sku)) throw new Error('Gas policy fixture requires a mint SKU.');
      const publication = await rare.cart.listing.publish({ preparation: await rare.cart.listing.prepare({
        seller: seller.address, deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), listings: [{
          sku: variant.sku, fulfillmentKind: 4, quantity: 512n, unitPrice: 1_000_000_000n, settlementCurrency: zeroAddress,
        }],
      }) });
      const entry = publication.signedArtifact.entries[0];
      if (!entry) throw new Error('Gas policy fixture requires a published mint Listing.');
      const prepare = async (quantity: bigint) => {
        const preview = await rare.cart.checkout.prepare({ paymentCurrency: zeroAddress, items: [{
          kind: 'listing', listingDigest: entry.listingDigest, quantity, recipient: seller.address,
        }] });
        return rare.cart.checkout.authorize(preview);
      };
      // A one-token control proves permissions and the fixture are executable.
      expect((await prepare(1n)).executePurchase.platformSignature).not.toBe('0x');
      // Find a workload above our policy but below the provider's own gas cap.
      // An RPC gas-cap failure alone must not count as testing our 12m guard.
      const findPolicyRejection = async (minimum: bigint, maximum: bigint): Promise<boolean> => {
        if (minimum > maximum) return false;
        const quantity = (minimum + maximum) / 2n;
        try {
          await prepare(quantity);
          return findPolicyRejection(quantity + 1n, maximum);
        } catch (error) {
          if (!(error instanceof RareApiError) || error.status !== 422) throw error;
          if (error.code === 'resource_limit_exceeded') return true;
          if (error.code === 'checkout_simulation_failed') return findPolicyRejection(minimum, quantity - 1n);
          throw error;
        }
      };
      expect(await findPolicyRejection(2n, 512n)).toBe(true);
      expect(await publicClient.readContract({ address: collection.contract, abi: [{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }], functionName: 'totalSupply' })).toBe(0n);
    } finally {
      await rare.cart.catalog.products.archive(product.id);
    }
  }, 600_000);

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

  it('publishes seller-authorized Listing Roots and rejects tampered preparations', async () => {
    const { rare, cart, chainId, artifact, signedArtifact, ingested, seller } = scenario;
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
    const invalidRoot: typeof artifact = { ...artifact, root: { ...artifact.root, listingsRoot: '0x0000000000000000000000000000000000000000000000000000000000000000' } };
    await expect(rare.cart.listing.publish({ preparation: { intent: scenario.listingIntent,
      artifact: invalidRoot, requiredApprovals: [] } })).rejects.toThrow();
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
    const prepared = await rare.cart.checkout.authorize(preparation);
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

  it('rejects unauthorized variant attachment and returns real API not-found errors', async () => {
    const { rare, runId, product } = scenario;
    await expect(rare.cart.catalog.variants.add(product.id, {
      universalTokenIds: ['11155111-0x0000000000000000000000000000000000000001-0'],
    })).rejects.toMatchObject({ status: 409 });

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

