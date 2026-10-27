import { describe, expect, it } from 'vitest';
import { createWalletClient, erc20Abi, erc721Abi, http, isHex, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../../dist/sdk/index.js';
import { resolveCurrency } from '../../../src/contracts/addresses.js';
import { createCreatorCartScenario } from '../../helpers/cart-creator-fixture.js';
import { loadDotEnv } from '../../helpers/env.js';
import { getTestRpcUrl } from '../../helpers/liveViem.js';

loadDotEnv();

describe('SDK mixed Listing and currency swap checkout', () => {
  it('receives an NFT and exact ERC20 output in the same Cart transaction', async () => {
    const key = process.env.E2E_BUYER_PRIVATE_KEYS?.split(/[,\s]+/u).find(Boolean);
    if (!key || !isHex(key) || key.length !== 66) throw new Error('Mixed Cart test requires a funded Sepolia buyer.');
    const buyer = privateKeyToAccount(key);
    const scenario = await createCreatorCartScenario({ tokenCount: 1 });
    const rare = createRareClient({ publicClient: scenario.publicClient, apiBaseUrl: scenario.apiBaseUrl,
      walletClient: createWalletClient({ account: buyer, chain: sepolia, transport: http(getTestRpcUrl()) }) });
    try {
      await rare.auth.loginWithWallet({ address: buyer.address, chainId: scenario.chainId,
        signMessage: message => buyer.signMessage({ message }) });
      const listing = scenario.listings[0];
      const published = scenario.createdListings[0];
      if (!listing || !published) throw new Error('Mixed Cart fixture returned no NFT Listing.');
      const outputCurrency = resolveCurrency('rare', 'sepolia');
      const outputAmount = 10_000_000_000_000_000n;
      const readTokens = () => scenario.publicClient.readContract({ address: outputCurrency, abi: erc20Abi,
        functionName: 'balanceOf', args: [buyer.address] });
      const before = await readTokens();
      const preparation = await rare.cart.checkout.prepare({ paymentCurrency: zeroAddress, items: [
        { kind: 'listing', listingDigest: published.listingDigest, quantity: 1n, recipient: buyer.address },
        { kind: 'swap', mode: 'exact-output', outputCurrency, outputAmount, recipient: buyer.address },
      ] });
      expect(preparation.paymentAmount).toBeLessThanOrEqual(1_000_000_000_000_000n);
      expect(preparation.lines.filter(line => line.fulfillmentKind === 6)).toHaveLength(1);
      const result = await rare.cart.checkout.purchase({ preparation });
      expect(result.receipt.status).toBe('success');
      expect(await readTokens() - before).toBe(outputAmount);
      await expect(scenario.publicClient.readContract({ address: listing.tokenContract, abi: erc721Abi,
        functionName: 'ownerOf', args: [listing.tokenId] })).resolves.toBe(buyer.address);
    } finally {
      await rare.auth.logout();
      await scenario.rare.auth.logout();
    }
  }, 600_000);
});
