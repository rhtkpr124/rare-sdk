import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWalletClient, erc20Abi, http, isHex, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createRareAccountClient, createRareClient, type CartCheckoutIntentItem } from '../../../dist/sdk/index.js';
import { resolveCurrency } from '../../../src/contracts/addresses.js';
import { loadDotEnv } from '../../helpers/env.js';
import { createTestSepoliaPublicClient, getTestRpcUrl } from '../../helpers/liveViem.js';

loadDotEnv();

describe.sequential('SDK standalone Cart swap purchases', () => {
  const publicClient = createTestSepoliaPublicClient();
  const accountClient = createRareAccountClient({ apiBaseUrl: process.env.RARE_API_BASE_URL });
  const outputCurrency = resolveCurrency('rare', 'sepolia');
  let rare: ReturnType<typeof createRareClient>;
  let buyer: ReturnType<typeof privateKeyToAccount>;

  beforeAll(async () => {
    const key = process.env.E2E_BUYER_PRIVATE_KEYS?.split(/[,\s]+/u).find(Boolean);
    if (!key || !isHex(key) || key.length !== 66 || !process.env.RARE_API_BASE_URL) {
      throw new Error('Cart swap tests require a deployed RARE_API_BASE_URL and funded E2E_BUYER_PRIVATE_KEYS.');
    }
    if (await publicClient.getChainId() !== 11155111) throw new Error('Cart swap tests only support Sepolia.');
    buyer = privateKeyToAccount(key);
    await accountClient.auth.loginWithWallet({ address: buyer.address, chainId: 11155111,
      signMessage: message => buyer.signMessage({ message }) });
    rare = createRareClient({ publicClient, apiBaseUrl: process.env.RARE_API_BASE_URL, accountClient,
      walletClient: createWalletClient({ account: buyer, chain: sepolia, transport: http(getTestRpcUrl()) }) });
  }, 60_000);
  afterAll(async () => { await accountClient.auth.logout(); });

  it.each([
    { mode: 'exact-input' as const, paymentCurrency: zeroAddress },
    { mode: 'exact-output' as const, paymentCurrency: resolveCurrency('usdc', 'sepolia') },
  ])('buys RARE with $paymentCurrency using $mode quoting', async ({ mode, paymentCurrency }) => {
    const item: CartCheckoutIntentItem = mode === 'exact-input'
      ? { kind: 'swap', mode, outputCurrency, inputAmount: 10_000_000_000_000n, recipient: buyer.address }
      : { kind: 'swap', mode, outputCurrency, outputAmount: 10_000_000_000_000_000n, recipient: buyer.address };
    const preparation = await rare.cart.checkout.prepare({ paymentCurrency, items: [item] });
    expect(preparation.paymentAmount).toBeLessThanOrEqual(mode === 'exact-input' ? 10_000_000_000_000n : 1_000_000n);
    const outputLines = preparation.lines.filter(line => line.fulfillmentKind === 6);
    expect(outputLines).toHaveLength(1);
    const outputLine = outputLines[0];
    if (!outputLine) throw new Error('Swap quote returned no token output.');
    if (item.mode === 'exact-output') expect(outputLine.amount).toBe(item.outputAmount);
    expect(outputLine.amount).toBeGreaterThan(0n);
    const readOutputBalance = () => publicClient.readContract({ address: outputCurrency, abi: erc20Abi,
      functionName: 'balanceOf', args: [buyer.address] });
    const before = await readOutputBalance();
    const result = await rare.cart.checkout.purchase({ preparation, autoApprove: true });
    expect(result.receipt.status).toBe('success');
    expect(await readOutputBalance() - before).toBe(outputLine.amount);
  }, 180_000);
});
