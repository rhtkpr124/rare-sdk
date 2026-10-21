import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRareAccountClient, createRareClient } from '../../../dist/sdk/index.js';
import { createCreatorCartScenario } from '../../helpers/cart-creator-fixture.js';
import { loadDotEnv } from '../../helpers/env.js';
import { createWalletClient, erc721Abi, http, isAddressEqual, isHex, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { getTestRpcUrl } from '../../helpers/liveViem.js';

loadDotEnv();

describe.sequential('SDK eligibility against the deployed Rare API', () => {
  let scenario: Awaited<ReturnType<typeof createCreatorCartScenario>>;

  beforeAll(async () => { scenario = await createCreatorCartScenario({ tokenCount: 3, eligibility: true }); }, 360_000);
  afterAll(async () => { await scenario?.accountClient.auth.logout(); });

  it('creates an owned rule, opts a Listing in and out, and disables the rule', async () => {
    const listing = scenario.listings[0];
    const created = scenario.createdListings[0];
    if (listing === undefined || created === undefined) throw new Error('Eligibility fixture requires a Listing.');
    const rule = await scenario.rare.eligibility.createRule({ definition: {
      kind: 'PRIMARY_SALE',
      source: { chainId: String(scenario.chainId), tokenContract: listing.tokenContract },
      targets: [{ sku: listing.sku }],
    } });
    try {
      expect(rule.enabled).toBe(true);
      expect(rule.definition.kind).toBe('PRIMARY_SALE');
      expect((await scenario.rare.eligibility.listRules()).some(candidate => candidate.id === rule.id)).toBe(true);
      const item = scenario.listingIntent.listings[0];
      if (item === undefined) throw new Error('Eligibility fixture requires a Listing intent.');
      const preparation = await scenario.rare.cart.listing.prepare({ ...scenario.listingIntent,
        listings: [item], eligibilityRuleId: rule.id });
      const published = await scenario.rare.cart.listing.publish({ preparation });
      const gated = published.signedArtifact.entries[0];
      if (gated === undefined) throw new Error('Gated publication returned no Listing.');
      const preview = await scenario.rare.cart.api.checkout.preview({ paymentCurrency: zeroAddress,
        items: [{ kind: 'listing', listingDigest: gated.listingDigest, quantity: 1n, recipient: scenario.seller.address }] });
      await expect(scenario.rare.cart.api.checkout.prepare(preview.preparationReference)).rejects.toThrow();
      const scope = { chainId: String(scenario.chainId), cartAddress: scenario.cart,
        listingDigest: created.listingDigest };
      await scenario.rare.eligibility.setListingRequirement({ ...scope, ruleId: rule.id });
      await scenario.rare.eligibility.clearListingRequirement(scope);
      expect(Array.isArray(await scenario.rare.eligibility.listClaims())).toBe(true);
      const anonymous = createRareClient({ publicClient: scenario.publicClient, apiBaseUrl: scenario.apiBaseUrl });
      await expect(anonymous.eligibility.listRules()).rejects.toThrow();
      await expect(anonymous.eligibility.listClaims()).rejects.toThrow();
    } finally {
      await scenario.rare.eligibility.disableRule(rule.id);
    }
    expect((await scenario.rare.eligibility.listRules()).find(candidate => candidate.id === rule.id)?.enabled).toBe(false);
  }, 90_000);

  it('issues a purchase claim, reserves it for gated checkout, and consumes it exactly once', async () => {
    const source = scenario.listings[0];
    const reward = scenario.listings[1];
    const alternative = scenario.listings[2];
    const sourceListing = scenario.createdListings[0];
    const rewardListing = scenario.createdListings[1];
    const alternativeListing = scenario.createdListings[2];
    if (!source || !reward || !alternative || !sourceListing || !rewardListing || !alternativeListing) {
      throw new Error('Eligibility lifecycle requires one source and two unspent reward Listings.');
    }
    const key = process.env.E2E_BUYER_PRIVATE_KEYS?.split(/[,\s]+/u).find(Boolean);
    if (!key || !isHex(key) || key.length !== 66) throw new Error('Set E2E_BUYER_PRIVATE_KEYS to a registered, funded Sepolia buyer.');
    const buyer = privateKeyToAccount(key);
    if (isAddressEqual(buyer.address, scenario.seller.address)) throw new Error('Eligibility buyer and creator must be different wallets.');
    const accountClient = createRareAccountClient({ apiBaseUrl: scenario.apiBaseUrl });
    await accountClient.auth.loginWithWallet({ address: buyer.address, chainId: scenario.chainId,
      signMessage: message => buyer.signMessage({ message }) });
    try {
      await accountClient.profile.get();
      const rare = createRareClient({ publicClient: scenario.publicClient,
        walletClient: createWalletClient({ account: buyer, chain: sepolia, transport: http(getTestRpcUrl()) }),
        apiBaseUrl: scenario.apiBaseUrl, accountClient });
      const rule = await scenario.rare.eligibility.createRule({ definition: {
        kind: 'EVERY_SALE',
        source: { chainId: String(scenario.chainId), tokenContract: source.tokenContract, tokenIds: [source.tokenId.toString()] },
        targets: [{ sku: reward.sku }, { sku: alternative.sku }],
      } });
      try {
        for (const listing of [rewardListing, alternativeListing]) {
          await scenario.rare.eligibility.setListingRequirement({ chainId: String(scenario.chainId),
            cartAddress: scenario.cart, listingDigest: listing.listingDigest, ruleId: rule.id });
        }
        const claims = () => rare.eligibility.listClaims({ ruleId: rule.id });
        const preview = (listingDigest: typeof rewardListing.listingDigest) => rare.cart.checkout.prepare({
          paymentCurrency: zeroAddress, items: [{ kind: 'listing', listingDigest, quantity: 1n, recipient: buyer.address }],
        });
        expect(await claims()).toEqual([]);
        const denied = await preview(rewardListing.listingDigest);
        await expect(rare.cart.api.checkout.prepare(denied.preparationReference)).rejects.toMatchObject({
          status: 409, message: expect.stringContaining('Insufficient unreserved claims'),
        });

        const sourcePreparation = await preview(sourceListing.listingDigest);
        expect(sourcePreparation.paymentAmount).toBeLessThanOrEqual(1_000_000_000_000_000n);
        const sourcePurchase = await rare.cart.checkout.purchase({ preparation: sourcePreparation });
        expect(sourcePurchase.receipt.status).toBe('success');
        await expect(scenario.publicClient.readContract({ address: source.tokenContract, abi: erc721Abi,
          functionName: 'ownerOf', args: [source.tokenId] })).resolves.toBe(buyer.address);
        await expect.poll(claims, { timeout: 180_000, interval: 2_000 }).toMatchObject([
          { ruleId: rule.id, status: 'AVAILABLE', allowedSkus: expect.arrayContaining([reward.sku.toLowerCase(), alternative.sku.toLowerCase()]) },
        ]);
        const [issued] = await claims();
        if (!issued) throw new Error('Indexed qualifying purchase did not issue a claim.');

        const prepared = await rare.cart.api.checkout.prepare((await preview(rewardListing.listingDigest)).preparationReference);
        expect(prepared.executePurchase.order.paymentAmount).toBeLessThanOrEqual(1_000_000_000_000_000n);
        expect(await claims()).toMatchObject([{ id: issued.id, status: 'RESERVED' }]);
        const retried = await rare.cart.api.checkout.prepare((await preview(rewardListing.listingDigest)).preparationReference);
        expect(retried.executePurchase.order.orderId).toBe(prepared.executePurchase.order.orderId);
        const redemption = await rare.cart.checkout.execute(prepared.executePurchase);
        expect(redemption.receipt.status).toBe('success');
        expect(redemption.orderId).toBe(prepared.executePurchase.order.orderId);
        await expect.poll(claims, { timeout: 180_000, interval: 2_000 }).toMatchObject([{ id: issued.id, status: 'CONSUMED' }]);
        expect(await claims()).toHaveLength(1);
        await expect(scenario.publicClient.readContract({ address: reward.tokenContract, abi: erc721Abi,
          functionName: 'ownerOf', args: [reward.tokenId] })).resolves.toBe(buyer.address);

        // Another eligible SKU remains in stock, so denial proves claim consumption, not sold-out inventory.
        await expect(scenario.publicClient.readContract({ address: alternative.tokenContract, abi: erc721Abi,
          functionName: 'ownerOf', args: [alternative.tokenId] })).resolves.toBe(scenario.seller.address);
        const exhausted = await preview(alternativeListing.listingDigest);
        await expect(rare.cart.api.checkout.prepare(exhausted.preparationReference)).rejects.toMatchObject({
          status: 409, message: expect.stringContaining('Insufficient unreserved claims'),
        });
        expect(await claims()).toMatchObject([{ id: issued.id, status: 'CONSUMED' }]);
      } finally {
        await scenario.rare.eligibility.disableRule(rule.id);
      }
    } finally {
      await accountClient.auth.logout();
    }
  }, 600_000);
});
