import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWalletClient, erc1155Abi, erc721Abi, http, isAddressEqual, isHex, zeroAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createRareClient, type EligibilityClaim, type EligibilityRuleDefinition, type RareClient } from '../../../dist/sdk/index.js';
import { createCreatorCartScenario } from '../../helpers/cart-creator-fixture.js';
import { loadDotEnv } from '../../helpers/env.js';
import { getTestRpcUrl } from '../../helpers/liveViem.js';

loadDotEnv();

type Source = { contract: Address; tokenId: bigint; quantity: bigint; fulfillmentKind: 2 | 3 };
const ruleKinds: EligibilityRuleDefinition['kind'][] = ['PRIMARY_SALE', 'EVERY_SALE', 'CURRENT_HOLDER'];
const standards = ['ERC721', 'ERC1155'] as const;
const available = (claims: EligibilityClaim[]) => claims.filter(claim => claim.status === 'AVAILABLE');
const consumed = (claims: EligibilityClaim[]) => claims.filter(claim => claim.status === 'CONSUMED');

describe.sequential('quantity-aware eligibility across token standards', () => {
  let creator: Awaited<ReturnType<typeof createCreatorCartScenario>>;
  let buyer: RareClient;
  let buyerWallet: ReturnType<typeof createWalletClient>;
  let buyerAddress: Address;
  let reward: { contract: Address; tokenId: bigint };

  beforeAll(async () => {
    const key = process.env.E2E_BUYER_PRIVATE_KEYS?.split(/[,\s]+/u).find(Boolean);
    if (!key || !isHex(key) || key.length !== 66) throw new Error('Set a registered, funded Sepolia E2E_BUYER_PRIVATE_KEYS wallet.');
    creator = await createCreatorCartScenario({ tokenCount: 1, eligibility: true });
    const account = privateKeyToAccount(key);
    if (isAddressEqual(account.address, creator.seller.address)) throw new Error('Eligibility requires distinct creator and buyer wallets.');
    buyerAddress = account.address;
    buyerWallet = createWalletClient({ account, chain: sepolia, transport: http(getTestRpcUrl()) });
    buyer = createRareClient({ apiBaseUrl: creator.apiBaseUrl, publicClient: creator.publicClient, walletClient: buyerWallet });
    await buyer.auth.loginWithWallet({ address: buyerAddress, chainId: sepolia.id, signMessage: message => account.signMessage({ message }) });
    await buyer.profile.get();
    const collection = await creator.rare.collection.deploy.erc1155({ name: `Eligibility rewards ${randomUUID()}`, symbol: 'RIGHT', baseUri: '' });
    const token = await creator.rare.collection.erc1155.createToken({ contract: collection.contract, maxSupply: 100n,
      tokenUri: 'data:application/json,%7B%22name%22%3A%22Eligibility%20reward%22%7D' });
    await creator.rare.collection.erc1155.mint({ contract: collection.contract, tokenId: token.tokenId, quantity: 100n });
    reward = { contract: collection.contract, tokenId: token.tokenId };
  }, 600_000);

  afterAll(async () => {
    await buyer?.auth.logout();
    await creator?.accountClient.auth.logout();
  });

  const publish = async (source: Source, ruleId?: string) => {
    const preparation = await creator.rare.cart.listing.prepare({ seller: creator.seller.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600), ...(ruleId === undefined ? {} : { eligibilityRuleId: ruleId }),
      listings: [{ nft: { contract: source.contract, tokenId: source.tokenId }, fulfillmentKind: source.fulfillmentKind,
        settlementCurrency: zeroAddress, unitPrice: 1_000_000_000_000n, quantity: source.quantity }] });
    const publication = await creator.rare.cart.listing.publish({ preparation, autoApprove: true });
    const entry = publication.signedArtifact.entries[0];
    if (!entry) throw new Error('Eligibility publication returned no Listing.');
    return entry;
  };

  const checkout = async (listingDigest: Hex, quantity: bigint) => {
    const preparation = await buyer.cart.checkout.prepare({ paymentCurrency: zeroAddress,
      items: [{ kind: 'listing', listingDigest, quantity, recipient: buyerAddress }] });
    expect(preparation.paymentAmount).toBeLessThanOrEqual(1_000_000_000_000_000n);
    return preparation;
  };

  const transfer = async (source: Source, quantity: bigint, back: boolean) => {
    const account = back ? creator.seller : buyerWallet.account;
    if (!account) throw new Error('Transfer wallet has no account.');
    const wallet = back
      ? createWalletClient({ account: creator.seller, chain: sepolia, transport: http(getTestRpcUrl()) })
      : buyerWallet;
    const from = back ? creator.seller.address : buyerAddress;
    const to = back ? buyerAddress : creator.seller.address;
    const hash = source.fulfillmentKind === 3
      ? await wallet.writeContract({ account, chain: sepolia, address: source.contract, abi: erc1155Abi,
        functionName: 'safeTransferFrom', args: [from, to, source.tokenId, quantity, '0x'] })
      : await wallet.writeContract({ account, chain: sepolia, address: source.contract, abi: erc721Abi,
        functionName: 'transferFrom', args: [from, to, source.tokenId] });
    expect((await creator.publicClient.waitForTransactionReceipt({ hash })).status).toBe('success');
  };

  for (const standard of standards) {
    for (const kind of ruleKinds) {
      it(`${standard} ${kind}: issues per copy, consumes partial quantities and transfers unused rights first`, async () => {
        const source: Source = await (async () => {
          if (standard === 'ERC721') {
            const collection = await creator.rare.collection.deploy.erc721({ name: `Claim source ${randomUUID()}`, symbol: 'CLAIM', maxTokens: 1 });
            const token = await creator.rare.collection.mint({ contract: collection.contract, tokenUri: 'data:application/json,%7B%22name%22%3A%22Claim%20source%22%7D' });
            return { contract: collection.contract, tokenId: token.tokenId, quantity: 1n, fulfillmentKind: 2 };
          }
          const collection = await creator.rare.collection.deploy.erc1155({ name: `Claim editions ${randomUUID()}`, symbol: 'CLAIM', baseUri: '' });
          const token = await creator.rare.collection.erc1155.createToken({ contract: collection.contract, maxSupply: 5n,
            tokenUri: 'data:application/json,%7B%22name%22%3A%22Claim%20source%22%7D' });
          await creator.rare.collection.erc1155.mint({ contract: collection.contract, tokenId: token.tokenId, quantity: 5n });
          return { contract: collection.contract, tokenId: token.tokenId, quantity: 5n, fulfillmentKind: 3 };
        })();
        const rewardListing = await publish({ ...reward, quantity: 20n, fulfillmentKind: 3 });
        const rule = await creator.rare.eligibility.createRule({ definition: { kind,
          source: { chainId: String(sepolia.id), tokenContract: source.contract, tokenIds: [String(source.tokenId)] },
          targets: [{ sku: rewardListing.listing.sku }] } });
        try {
          await creator.rare.eligibility.setListingRequirement({ chainId: String(sepolia.id), cartAddress: creator.cart,
            listingDigest: rewardListing.listingDigest, ruleId: rule.id });
          const claims = () => buyer.eligibility.listClaims({ ruleId: rule.id });
          const creatorClaims = () => creator.rare.eligibility.listClaims({ ruleId: rule.id });
          const sourceListing = await publish(source);
          const purchase = await buyer.cart.checkout.purchase({ preparation: await checkout(sourceListing.listingDigest, source.quantity) });
          expect(purchase.receipt.status).toBe('success');
          await expect.poll(async () => available(await claims()).length, { timeout: 180_000, interval: 2_000 }).toBe(Number(source.quantity));
          const issued = await claims();
          expect(new Set(issued.map(claim => claim.id)).size).toBe(Number(source.quantity));
          const redeemQuantity = standard === 'ERC1155' ? 2n : 1n;
          const quote = await checkout(rewardListing.listingDigest, redeemQuantity);
          const reserved = await buyer.cart.api.checkout.prepare(quote.preparationReference);
          expect((await buyer.cart.api.checkout.prepare(quote.preparationReference)).executePurchase.order.orderId).toBe(reserved.executePurchase.order.orderId);
          expect((await claims()).filter(claim => claim.status === 'RESERVED')).toHaveLength(Number(redeemQuantity));
          expect((await buyer.cart.checkout.execute(reserved.executePurchase)).receipt.status).toBe('success');
          await expect.poll(async () => consumed(await claims()).length, { timeout: 180_000, interval: 2_000 }).toBe(Number(redeemQuantity));
          const consumedIds = consumed(await claims()).map(claim => claim.id).sort();
          const moved = standard === 'ERC1155' ? 2n : 1n;
          await transfer(source, moved, false);
          if (kind === 'CURRENT_HOLDER') {
            await expect.poll(async () => available(await creatorClaims()).length, { timeout: 180_000, interval: 2_000 }).toBe(standard === 'ERC1155' ? 2 : 0);
            await expect.poll(async () => available(await claims()).length, { timeout: 180_000, interval: 2_000 }).toBe(standard === 'ERC1155' ? 1 : 0);
          } else {
            expect(available(await claims())).toHaveLength(Number(source.quantity - redeemQuantity));
            expect(available(await creatorClaims())).toHaveLength(0);
          }
          await transfer(source, moved, true);
          await expect.poll(async () => available(await claims()).length, { timeout: 180_000, interval: 2_000 }).toBe(Number(source.quantity - redeemQuantity));
          expect(consumed(await claims()).map(claim => claim.id).sort()).toEqual(consumedIds);
          // A later sale is new evidence, but PRIMARY_SALE must not award twice.
          if (kind !== 'CURRENT_HOLDER') {
            await transfer(source, moved, false);
            const resale = await publish({ ...source, quantity: moved });
            expect((await buyer.cart.checkout.purchase({ preparation: await checkout(resale.listingDigest, moved) })).receipt.status).toBe('success');
            const expected = Number(source.quantity - redeemQuantity + (kind === 'EVERY_SALE' ? moved : 0n));
            await expect.poll(async () => available(await claims()).length, { timeout: 180_000, interval: 2_000 }).toBe(expected);
            expect(consumed(await claims()).map(claim => claim.id).sort()).toEqual(consumedIds);
          }
        } finally {
          await creator.rare.eligibility.disableRule(rule.id);
        }
      }, 900_000);
    }
  }
});
