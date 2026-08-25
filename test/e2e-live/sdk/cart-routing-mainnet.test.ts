import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  getAddress,
  http,
  isAddressEqual,
  size,
  zeroAddress,
  type Address,
} from 'viem';
import { mainnet } from 'viem/chains';
import { resolveCurrency } from '../../../src/contracts/addresses.js';
import {
  buildCartRoutingQuoteResult,
  cartRoutingDefaultSlippageBps,
  planCartRoutingQuote,
  protectCartRoutingExactInput,
  resolveCartRoutingMaximumInput,
  type CartRoutingPlan,
} from '../../../src/sdk/cart-routing-core.js';
import {
  requestUniswapQuote,
  requestUniswapSwap,
  type UniswapQuoteResponse,
} from '../../../src/swap/uniswap-api.js';
import { getLiquidEditionPoolKey } from '../../../src/swap/liquid-edition.js';
import { loadDotEnv } from '../../helpers/env.js';

loadDotEnv();

const apiKey = process.env.UNISWAP_API_KEY;
const describeLive = apiKey ? describe : describe.skip;
const chain = 'mainnet' as const;
const chainId = 1;
const prospectiveCart = getAddress('0x000000000000000000000000000000000000cA47');
const eth = zeroAddress;
const usdc = resolveCurrency('usdc', chain);
const rare = resolveCurrency('rare', chain);
const liquidEdition = getAddress('0x26f99499094004Eba714b8bc11cAa7556b760B02');
const liquidEditionHooks = getAddress('0x7dD3F8fe4AdD16c0d297D5DC1813fe4a5f4020cc');
const publicClient = createPublicClient({ chain: mainnet, transport: http() });

describeLive('SDK Cart mainnet route discovery integration', () => {
  it('reads the canonical hooked RARE pool from the Liquid Edition', async () => {
    await expect(getLiquidEditionPoolKey(publicClient, liquidEdition)).resolves.toEqual({
      currency0: liquidEdition,
      currency1: rare,
      fee: 0,
      tickSpacing: 60,
      hooks: liquidEditionHooks,
    });
  }, 30_000);

  it.each([
    { name: 'USDC to ETH', paymentCurrency: usdc, settlementCurrency: eth, amount: 5_000_000_000_000_000n },
    { name: 'ETH to RARE', paymentCurrency: eth, settlementCurrency: rare, amount: 1_000_000_000_000_000_000_000n },
    { name: 'RARE to USDC', paymentCurrency: rare, settlementCurrency: usdc, amount: 10_000_000n },
  ])('discovers and compiles an exact-output $name route', async ({ paymentCurrency, settlementCurrency, amount }) => {
    const result = await discoverCartRoute(paymentCurrency, settlementCurrency, amount, 'exact-output');

    expect(result.evidence.source).toBe('uniswap-api');
    expect(result.evidence.quoteIds).toHaveLength(1);
    expect(result.evidence.compilerRequestIds).toHaveLength(1);
    expect(result.settlements).toEqual([{
      settlementCurrency,
      amount: amount.toString(),
      routed: true,
    }]);
    expect(BigInt(result.maximumPaymentInput)).toBeGreaterThanOrEqual(BigInt(result.expectedPaymentInput));
    expect(size(result.route.commands)).toBe(result.route.inputs.length);
    expect(result.route.inputs.length).toBeGreaterThan(0);
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.parse(result.quotedAt));
  }, 60_000);

  it('discovers an exact-input route that still guarantees a fixed RARE settlement', async () => {
    const amount = 1_000_000_000_000_000_000_000n;
    const result = await discoverCartRoute(usdc, rare, amount, 'exact-input');

    expect(result.mode).toBe('exact-input');
    expect(result.evidence.quoteIds).toHaveLength(2);
    expect(result.expectedPaymentInput).toBe(result.maximumPaymentInput);
    expect(result.evidence.exactOutputs).toEqual([{ settlementCurrency: rare, amount: amount.toString() }]);
    expect(size(result.route.commands)).toBe(result.route.inputs.length);
  }, 60_000);

  it.each([
    { name: 'ETH', paymentCurrency: eth },
    { name: 'USDC', paymentCurrency: usdc },
  ])('discovers an exact-output Liquid Edition route from $name and compiles it for Cart', async ({ paymentCurrency }) => {
    const amount = 1_000_000_000_000_000_000n;
    const quoteResponse = await quote(paymentCurrency, liquidEdition, amount, 'EXACT_OUTPUT');
    const hops = quoteResponse.quote.route.flat();

    expect(quoteResponse.quote.output.amount).toBe(amount.toString());
    expect(isAddressEqual(quoteResponse.quote.output.token, liquidEdition)).toBe(true);
    expect(hops.length).toBeGreaterThan(0);
    expect(hops.some((hop) => hop.type === 'v4-pool')).toBe(true);
    expect(hops.some((hop) => isAddressEqual(hop.tokenOut.address, liquidEdition))).toBe(true);

    const swapResponse = await requestUniswapSwap({
      apiKey,
      quote: quoteResponse.quote,
      deadline: Math.floor(Date.now() / 1_000) + 60,
      permit2Disabled: false,
      simulateTransaction: false,
    });
    const obligation = { settlementCurrency: liquidEdition, amount };
    const plan: CartRoutingPlan = {
      chain,
      chainId,
      cart: prospectiveCart,
      paymentCurrency,
      mode: 'exact-output',
      directPaymentInput: 0n,
      settlements: [{ settlementCurrency: liquidEdition, amount: amount.toString(), routed: true }],
      foreignObligations: [obligation],
    };
    const result = buildCartRoutingQuoteResult(plan, swapResponse.swap.to, [{
      ...obligation,
      exactOutputResponse: quoteResponse,
      executionResponse: quoteResponse,
      swapResponse,
    }], Date.now());
    expect(result.evidence.source).toBe('uniswap-api');
    expect(size(result.route.commands)).toBe(result.route.inputs.length);
    expect(result.route.inputs.length).toBeGreaterThan(0);
  }, 60_000);
});

async function discoverCartRoute(
  paymentCurrency: Address,
  settlementCurrency: Address,
  amount: bigint,
  mode: 'exact-output' | 'exact-input',
) {
  const plan = planCartRoutingQuote(chain, prospectiveCart, {
    paymentCurrency,
    obligations: [{ settlementCurrency, amount }],
    mode,
  });
  const obligation = plan.foreignObligations[0]!;
  const exactOutputResponse = await quote(paymentCurrency, settlementCurrency, amount, 'EXACT_OUTPUT');
  const maximumInput = resolveCartRoutingMaximumInput(plan, obligation, exactOutputResponse);
  const executionResponse = mode === 'exact-output'
    ? exactOutputResponse
    : await quote(paymentCurrency, settlementCurrency, protectCartRoutingExactInput(maximumInput), 'EXACT_INPUT');
  const swapResponse = await requestUniswapSwap({
    apiKey,
    quote: executionResponse.quote,
    deadline: Math.floor(Date.now() / 1_000) + 60,
    permit2Disabled: false,
    simulateTransaction: false,
  });

  return buildCartRoutingQuoteResult(plan, swapResponse.swap.to, [{
    ...obligation,
    exactOutputResponse,
    executionResponse,
    swapResponse,
  }], Date.now());
}

function quote(
  tokenIn: Address,
  tokenOut: Address,
  amount: bigint,
  tradeType: 'EXACT_OUTPUT' | 'EXACT_INPUT',
): Promise<UniswapQuoteResponse> {
  return requestUniswapQuote({
    apiKey,
    chainId,
    tokenIn,
    tokenOut,
    amount,
    swapper: prospectiveCart,
    slippageBps: cartRoutingDefaultSlippageBps,
    tradeType,
    permit2Disabled: false,
  });
}
