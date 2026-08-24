import { describe, expect, it, type TestContext } from 'vitest';
import { isAddressEqual, zeroAddress, type Address } from 'viem';
import { cartLensAbi, getCartAddress, getCartLensAddress, resolveCurrency } from '../../../src/sdk/contracts.js';
import { createRareClient } from '../../../src/sdk/client.js';
import type { CartRoutingRoute } from '../../../src/sdk/types/cart-routing.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeLive = hasTestRpcUrl() && process.env.UNISWAP_API_KEY ? describe : describe.skip;
const currencies = [
  { address: zeroAddress, amount: 1_000_000_000_000_000n },
  { address: resolveCurrency('usdc', 'sepolia'), amount: 1_000_000n },
  { address: resolveCurrency('rare', 'sepolia'), amount: 1_000_000_000_000_000_000n },
] as const;

describeLive('SDK Cart routing integration', () => {
  it('quotes every Sepolia commerce direction and passes the deployed Cart route policy', async (ctx) => {
    const publicClient = createTestSepoliaPublicClient();
    const cart = getCartAddress('sepolia');
    const lens = getCartLensAddress('sepolia')!;
    const rare = createRareClient({ publicClient, uniswapApiKey: process.env.UNISWAP_API_KEY });

    for (const payment of currencies) {
      const direct = await rare.cart.routing.quote({
        paymentCurrency: payment.address,
        obligations: [{ settlementCurrency: payment.address, amount: payment.amount }],
      });
      expect(direct.route).toEqual({ commands: '0x', inputs: [] });

      for (const settlement of currencies) {
        if (isAddressEqual(payment.address, settlement.address)) continue;
        const quote = await quoteOrSkip(ctx, () => rare.cart.routing.quote({
          paymentCurrency: payment.address,
          obligations: [{ settlementCurrency: settlement.address, amount: settlement.amount }],
        }));
        expect(BigInt(quote.maximumPaymentInput)).toBeGreaterThanOrEqual(BigInt(quote.expectedPaymentInput));
        expect(quote.settlements).toEqual([{ settlementCurrency: settlement.address, amount: settlement.amount.toString(), routed: true }]);
        await expectRoutePolicy(publicClient, lens, cart, quote.route);
      }
    }
  }, 120_000);

  it('composes mixed settlements in either Universal Router execution mode', async (ctx) => {
    const publicClient = createTestSepoliaPublicClient();
    const cart = getCartAddress('sepolia');
    const lens = getCartLensAddress('sepolia')!;
    const rare = createRareClient({ publicClient, uniswapApiKey: process.env.UNISWAP_API_KEY });
    for (const mode of ['exact-output', 'exact-input'] as const) {
      const quote = await quoteOrSkip(ctx, () => rare.cart.routing.quote({
        paymentCurrency: currencies[1].address,
        obligations: currencies.map((currency) => ({ settlementCurrency: currency.address, amount: currency.amount })),
        mode,
      }));
      expect(quote.mode).toBe(mode);
      expect(quote.route.inputs).toHaveLength(2);
      await expectRoutePolicy(publicClient, lens, cart, quote.route);
    }
  }, 120_000);
});

async function expectRoutePolicy(
  publicClient: ReturnType<typeof createTestSepoliaPublicClient>,
  lens: Address,
  cart: Address,
  route: CartRoutingRoute,
) {
  const preview = await publicClient.readContract({
    address: lens,
    abi: cartLensAbi,
    functionName: 'previewRoute',
    args: [cart, { ...route, routerValue: BigInt(route.routerValue) }],
  });
  expect(preview.valid, `Cart route policy code ${preview.code}, reason ${preview.reason}`).toBe(true);
}

async function quoteOrSkip<T>(ctx: TestContext, quote: () => Promise<T>): Promise<T> {
  try {
    return await quote();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('routing quote') || message.includes('route is currently') || message.includes('liquidity')) {
      ctx.skip(`Uniswap Cart route unavailable: ${message}`);
    }
    throw error;
  }
}
