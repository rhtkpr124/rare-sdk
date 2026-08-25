import { describe, expect, it } from 'vitest';
import { isAddressEqual, zeroAddress, type Address } from 'viem';
import { cartLensAbi, getCartAddress, getCartLensAddress, resolveCurrency } from '../../../src/sdk/contracts.js';
import { createRareClient } from '../../../src/sdk/client.js';
import type { CartRoutingRoute } from '../../../src/sdk/types/cart-routing.js';
import { getLiquidEditionPoolKey } from '../../../src/swap/liquid-edition.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeLive = hasTestRpcUrl() && process.env.UNISWAP_API_KEY ? describe : describe.skip;
const currencies = [
  { address: zeroAddress, amount: 1_000_000_000_000_000n },
  { address: resolveCurrency('usdc', 'sepolia'), amount: 1_000_000n },
  { address: resolveCurrency('rare', 'sepolia'), amount: 1_000_000_000_000_000_000n },
] as const;
const liquidEdition = '0x7AEaB936a2D6217E100b4dcfCFcE14E056B386fA' as Address;
const liquidEditionHooks = '0xB32eC4b5eC46fBd8E68a39308b8569538d0620CC' as Address;

describeLive('SDK Cart routing integration', () => {
  it('strictly quotes one canonical Sepolia USDC to ETH route', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const cart = getCartAddress('sepolia');
    const lens = getCartLensAddress('sepolia')!;
    const rare = createRareClient({ publicClient, uniswapApiKey: process.env.UNISWAP_API_KEY });
    const quote = await rare.cart.routing.quote({
      paymentCurrency: currencies[1].address,
      obligations: [{ settlementCurrency: currencies[0].address, amount: currencies[0].amount }],
    });
    expect(BigInt(quote.maximumPaymentInput)).toBeGreaterThanOrEqual(BigInt(quote.expectedPaymentInput));
    await expectRoutePolicy(publicClient, lens, cart, quote.route);
  }, 60_000);

  it('quotes every Sepolia commerce direction and passes the deployed Cart route policy', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const cart = getCartAddress('sepolia');
    const lens = getCartLensAddress('sepolia')!;
    const rare = createRareClient({ publicClient, uniswapApiKey: process.env.UNISWAP_API_KEY });

    for (const payment of currencies) {
      const direct = await rare.cart.routing.quote({
        paymentCurrency: payment.address,
        obligations: [{ settlementCurrency: payment.address, amount: payment.amount }],
      });
      expect(direct.route).toEqual({ commands: '0x', inputs: [], routerValue: '0' });

      for (const settlement of currencies) {
        if (isAddressEqual(payment.address, settlement.address)) continue;
        const quote = await rare.cart.routing.quote({
          paymentCurrency: payment.address,
          obligations: [{ settlementCurrency: settlement.address, amount: settlement.amount }],
        });
        expect(BigInt(quote.maximumPaymentInput)).toBeGreaterThanOrEqual(BigInt(quote.expectedPaymentInput));
        expect(quote.settlements).toEqual([{ settlementCurrency: settlement.address, amount: settlement.amount.toString(), routed: true }]);
        await expectRoutePolicy(publicClient, lens, cart, quote.route);
      }
    }
  }, 120_000);

  it('composes mixed settlements in either Universal Router execution mode', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const cart = getCartAddress('sepolia');
    const lens = getCartLensAddress('sepolia')!;
    const rare = createRareClient({ publicClient, uniswapApiKey: process.env.UNISWAP_API_KEY });
    for (const mode of ['exact-output', 'exact-input'] as const) {
      const quote = await rare.cart.routing.quote({
        paymentCurrency: currencies[1].address,
        obligations: currencies.map((currency) => ({ settlementCurrency: currency.address, amount: currency.amount })),
        mode,
      });
      expect(quote.mode).toBe(mode);
      expect(quote.route.inputs).toHaveLength(2);
      await expectRoutePolicy(publicClient, lens, cart, quote.route);
    }
  }, 120_000);

  it.each([
    { name: 'ETH', paymentCurrency: currencies[0].address },
    { name: 'USDC', paymentCurrency: currencies[1].address },
  ])('quotes the canonical Sepolia Liquid Edition from $name and passes Cart route policy', async ({ paymentCurrency }) => {
    const publicClient = createTestSepoliaPublicClient();
    const cart = getCartAddress('sepolia');
    const lens = getCartLensAddress('sepolia')!;
    const rare = createRareClient({ publicClient, uniswapApiKey: process.env.UNISWAP_API_KEY });
    const poolKey = await getLiquidEditionPoolKey(publicClient, liquidEdition);
    expect(poolKey).toEqual({
      currency0: currencies[2].address,
      currency1: liquidEdition,
      fee: 0,
      tickSpacing: 60,
      hooks: liquidEditionHooks,
    });

    const amount = 1_000_000_000_000_000_000n;
    const quote = await rare.cart.routing.quote({
      paymentCurrency,
      obligations: [{ settlementCurrency: liquidEdition, amount }],
    });
    expect(quote.evidence.source).toBe('known-pool-rpc');
    expect(quote.settlements).toEqual([{ settlementCurrency: liquidEdition, amount: amount.toString(), routed: true }]);
    expect(BigInt(quote.maximumPaymentInput)).toBeGreaterThanOrEqual(BigInt(quote.expectedPaymentInput));
    await expectRoutePolicy(publicClient, lens, cart, quote.route);
  }, 60_000);
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
