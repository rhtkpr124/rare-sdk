import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRareClient } from '../../../dist/sdk/index.js';
import { createCreatorCartScenario } from '../../helpers/cart-creator-fixture.js';
import { loadDotEnv } from '../../helpers/env.js';
import { createWalletClient, erc721Abi, http, isAddressEqual, isHex, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { getTestRpcUrl } from '../../helpers/liveViem.js';
import { randomUUID } from 'node:crypto';
import type { CreateEligibilityRule } from '../../../src/sdk/types/eligibility.js';

loadDotEnv();

describe.sequential('SDK eligibility against the deployed Rare API', () => {
  let scenario: Awaited<ReturnType<typeof createCreatorCartScenario>>;

  beforeAll(async () => { scenario = await createCreatorCartScenario({ tokenCount: 3, eligibility: true }); }, 360_000);
  afterAll(async () => { await scenario?.rare.auth.logout(); });

  it('creates an owned rule, opts a Listing in and out, and disables the rule', async () => {
    const listing = scenario.listings[0];
    const created = scenario.createdListings[0];
    if (listing === undefined || created === undefined) throw new Error('Eligibility fixture requires a Listing.');
    const ruleInput = { idempotencyKey: randomUUID(), definition: {
      kind: 'PRIMARY_SALE',
      source: { chainId: String(scenario.chainId), tokenContract: listing.tokenContract },
      targets: [{ sku: listing.sku }],
    } } satisfies CreateEligibilityRule;
    const rule = await scenario.rare.cart.purchaseEligibility.rules.create(ruleInput);
    try {
      expect(rule.enabled).toBe(true);
      expect((await scenario.rare.cart.purchaseEligibility.rules.create(ruleInput)).id).toBe(rule.id);
      await expect(scenario.rare.cart.purchaseEligibility.rules.create({ ...ruleInput,
        definition: { ...ruleInput.definition, kind: 'EVERY_SALE' },
      })).rejects.toMatchObject({ status: 409 });
      expect(rule.definition.kind).toBe('PRIMARY_SALE');
      expect(((await scenario.rare.cart.purchaseEligibility.rules.list()).data).some(candidate => candidate.id === rule.id)).toBe(true);
      const item = scenario.listingIntent.listings[0];
      if (item === undefined) throw new Error('Eligibility fixture requires a Listing intent.');
      const preparation = await scenario.rare.cart.listing.prepare({ ...scenario.listingIntent,
        listings: [item], eligibilityRuleId: rule.id });
      const published = await scenario.rare.cart.listing.publish({ preparation });
      const gated = published.signedArtifact.entries[0];
      if (gated === undefined) throw new Error('Gated publication returned no Listing.');
      const preview = await scenario.rare.cart.checkout.prepare({ paymentCurrency: zeroAddress,
        items: [{ kind: 'listing', listingDigest: gated.listingDigest, quantity: 1n, recipient: scenario.seller.address }] });
      await expect(scenario.rare.cart.checkout.authorize(preview)).rejects.toThrow();
      const scope = { chainId: String(scenario.chainId), cartAddress: scenario.cart,
        listingDigest: created.listingDigest };
      await scenario.rare.cart.purchaseEligibility.listingRequirements.set({ ...scope, ruleId: rule.id });
      await scenario.rare.cart.purchaseEligibility.listingRequirements.clear(scope);
      expect(Array.isArray((await scenario.rare.cart.purchaseEligibility.claims.list()).data)).toBe(true);
      const anonymous = createRareClient({ publicClient: scenario.publicClient, apiBaseUrl: scenario.apiBaseUrl });
      await expect(anonymous.cart.purchaseEligibility.rules.list()).rejects.toThrow();
      await expect(anonymous.cart.purchaseEligibility.claims.list()).rejects.toThrow();
    } finally {
      await scenario.rare.cart.purchaseEligibility.rules.disable(rule.id);
    }
    expect(((await scenario.rare.cart.purchaseEligibility.rules.list()).data).find(candidate => candidate.id === rule.id)?.enabled).toBe(false);
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
    const rare = createRareClient({ publicClient: scenario.publicClient,
      walletClient: createWalletClient({ account: buyer, chain: sepolia, transport: http(getTestRpcUrl()) }),
      apiBaseUrl: scenario.apiBaseUrl });
    await rare.auth.loginWithWallet({ address: buyer.address, chainId: scenario.chainId,
      signMessage: message => buyer.signMessage({ message }) });
    try {
      await rare.profile.get();
      const rule = await scenario.rare.cart.purchaseEligibility.rules.create({ definition: {
        kind: 'EVERY_SALE',
        source: { chainId: String(scenario.chainId), tokenContract: source.tokenContract, tokenIds: [source.tokenId.toString()] },
        targets: [{ sku: reward.sku }, { sku: alternative.sku }],
      } });
      try {
        for (const listing of [rewardListing, alternativeListing]) {
          await scenario.rare.cart.purchaseEligibility.listingRequirements.set({ chainId: String(scenario.chainId),
            cartAddress: scenario.cart, listingDigest: listing.listingDigest, ruleId: rule.id });
        }
        const claims = () => rare.cart.purchaseEligibility.claims.list({ ruleId: rule.id, perPage: 100 }).then(page => page.data);
        const preview = (listingDigest: typeof rewardListing.listingDigest) => rare.cart.checkout.prepare({
          paymentCurrency: zeroAddress, items: [{ kind: 'listing', listingDigest, quantity: 1n, recipient: buyer.address }],
        });
        expect(await claims()).toEqual([]);
        expect((await rare.cart.listing.search({ eligibility: 'eligible', sku: reward.sku })).data
          .some(listing => listing.listingDigest === rewardListing.listingDigest)).toBe(false);
        const denied = await preview(rewardListing.listingDigest);
        await expect(rare.cart.checkout.authorize(denied)).rejects.toMatchObject({
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
        await expect.poll(async () => (await rare.cart.listing.search({ eligibility: 'eligible', sku: reward.sku })).data
          .some(listing => listing.listingDigest === rewardListing.listingDigest), { timeout: 30_000, interval: 2_000 }).toBe(true);

        const prepared = await rare.cart.checkout.authorize((await preview(rewardListing.listingDigest)));
        expect(prepared.executePurchase.order.paymentAmount).toBeLessThanOrEqual(1_000_000_000_000_000n);
        expect(await claims()).toMatchObject([{ id: issued.id, status: 'RESERVED' }]);
        const retried = await rare.cart.checkout.authorize((await preview(rewardListing.listingDigest)));
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
        await expect(rare.cart.checkout.authorize(exhausted)).rejects.toMatchObject({
          status: 409, message: expect.stringContaining('Insufficient unreserved claims'),
        });
        expect(await claims()).toMatchObject([{ id: issued.id, status: 'CONSUMED' }]);
      } finally {
        await scenario.rare.cart.purchaseEligibility.rules.disable(rule.id);
      }
    } finally {
      await rare.auth.logout();
    }
  }, 600_000);
});
