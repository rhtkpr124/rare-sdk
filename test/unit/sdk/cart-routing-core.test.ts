import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, encodePacked, getAddress, parseAbiParameters, zeroAddress, type Address } from 'viem';
import { getCartAddress } from '../../../src/contracts/addresses.js';
import {
  assertCartRoutingQuoteFresh,
  buildCartRoutingQuoteResult,
  CartRoutingCoreError,
  planCartRoutingQuote,
  type CartRoutingForeignObligation,
  type CartRoutingPlan,
} from '../../../src/sdk/cart-routing-core.js';
import { getRareAddress, getUsdcAddress, getWrappedEthAddress } from '../../../src/swap/known-pools.js';
import type { UniswapQuoteResponse, UniswapQuoteRouteHop } from '../../../src/swap/uniswap-api.js';

const chain = 'sepolia' as const;
const cart = getCartAddress(chain);
const eth = zeroAddress;
const rare = getRareAddress(chain);
const usdc = getUsdcAddress(chain);
const weth = getWrappedEthAddress(chain)!;
const currencies = [eth, usdc, rare] as const;

describe('Cart routing functional core', () => {
  it('builds Cart-compatible exact-output routes for every Sepolia currency direction', () => {
    for (const paymentCurrency of currencies) {
      for (const settlementCurrency of currencies) {
        if (paymentCurrency === settlementCurrency) continue;
        const plan = planCartRoutingQuote(chain, cart, {
          paymentCurrency,
          obligations: [{ settlementCurrency, amount: 500n }],
        });
        const result = buildCartRoutingQuoteResult(plan, [quoteObligation(plan, plan.foreignObligations[0]!)], 1_800_000_000_000);
        expect(result.mode).toBe('exact-output');
        expect(result.route.commands).toBe('0x10');
        expect(result.expectedPaymentInput).toBe('1000');
        expect(result.maximumPaymentInput).toBe('1100');
        expect(result.settlements).toEqual([{ settlementCurrency: getAddress(settlementCurrency), amount: '500', routed: true }]);
        expect(() => JSON.stringify(result)).not.toThrow();
      }
    }
  });

  it('composes direct and foreign obligations into one bounded route', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [
        { settlementCurrency: usdc, amount: 300n },
        { settlementCurrency: eth, amount: 500n },
        { settlementCurrency: rare, amount: 500n },
        { settlementCurrency: rare, amount: 250n },
      ],
    });
    const quoted = plan.foreignObligations.map((obligation) => quoteObligation(plan, obligation));
    const result = buildCartRoutingQuoteResult(plan, quoted, 1_800_000_000_000);
    expect(result.route.commands).toBe('0x1010');
    expect(result.directPaymentInput).toBe('300');
    expect(result.expectedPaymentInput).toBe('2300');
    expect(result.maximumPaymentInput).toBe('2500');
    expect(result.settlements).toEqual([
      { settlementCurrency: usdc, amount: '300', routed: false },
      { settlementCurrency: eth, amount: '500', routed: true },
      { settlementCurrency: rare, amount: '750', routed: true },
    ]);
    expect(result.evidence.exactOutputs).toEqual(result.settlements.map(({ settlementCurrency, amount }) => ({ settlementCurrency, amount })));
  });

  it('returns an empty route when every obligation is direct', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: rare,
      obligations: [{ settlementCurrency: rare, amount: 7n }],
    });
    const result = buildCartRoutingQuoteResult(plan, [], 1_800_000_000_000);
    expect(result.route).toEqual({ commands: '0x', inputs: [], routerValue: '0' });
    expect(result.expectedPaymentInput).toBe('7');
    expect(result.maximumPaymentInput).toBe('7');
    expect(result.evidence.source).toBe('direct');
    expect(assertCartRoutingQuoteFresh(result, 1_800_000_030_000)).toBe(result);
    expect(() => assertCartRoutingQuoteFresh(result, 1_800_000_060_000)).toThrow('expired');
  });

  it('encodes exact-input execution while preserving fixed settlement minimums', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [{ settlementCurrency: rare, amount: 500n }],
      mode: 'exact-input',
    });
    const result = buildCartRoutingQuoteResult(plan, [quoteObligation(plan, plan.foreignObligations[0]!)], 1_800_000_000_000);
    const [actions] = decodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), result.route.inputs[0]!);
    expect(actions).toBe('0x070c0f');
    expect(result.mode).toBe('exact-input');
    expect(result.evidence.mode).toBe('exact-input');
  });

  it('encodes provider V2 and V3 routes using the existing Cart command conventions', () => {
    for (const protocol of ['v2', 'v3'] as const) {
      const plan = planCartRoutingQuote(chain, cart, {
        paymentCurrency: usdc,
        obligations: [{ settlementCurrency: rare, amount: 500n }],
      });
      const obligation = plan.foreignObligations[0]!;
      const response = quoteResponse(plan, obligation, [[
        hop(plan.inputToken, weth, '1000', '700', protocol),
        hop(weth, obligation.outputToken, '700', '500', protocol),
      ]]);
      const result = buildCartRoutingQuoteResult(plan, [{ ...obligation, response }], 1_800_000_000_000);
      expect(result.route.commands).toBe(protocol === 'v2' ? '0x09' : '0x01');

      if (protocol === 'v2') {
        const decoded = decodeAbiParameters(
          parseAbiParameters('address,uint256,uint256,address[],bool'),
          result.route.inputs[0]!,
        );
        expect(decoded).toEqual([
          '0x0000000000000000000000000000000000000001', 500n, 1100n,
          [plan.inputToken, weth, obligation.outputToken], true,
        ]);
      } else {
        const decoded = decodeAbiParameters(
          parseAbiParameters('address,uint256,uint256,bytes,bool'),
          result.route.inputs[0]!,
        );
        expect(decoded[1]).toBe(500n);
        expect(decoded[2]).toBe(1100n);
        expect(decoded[3]).toBe(encodePacked(
          ['address', 'uint24', 'address', 'uint24', 'address'],
          [obligation.outputToken, 3000, weth, 3000, plan.inputToken],
        ));
      }
    }
  });

  it('composes split provider paths without exceeding the provider maximum input', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [{ settlementCurrency: rare, amount: 500n }],
    });
    const obligation = plan.foreignObligations[0]!;
    const response = quoteResponse(plan, obligation, [
      [hop(plan.inputToken, weth, '400', '250'), hop(weth, obligation.outputToken, '250', '200')],
      [hop(plan.inputToken, weth, '600', '350'), hop(weth, obligation.outputToken, '350', '300')],
    ]);
    const result = buildCartRoutingQuoteResult(plan, [{ ...obligation, response }], 1_800_000_000_000);
    expect(result.route.commands).toBe('0x1010');
    expect(result.maximumPaymentInput).toBe('1100');
  });

  it('fails closed for unsupported currencies and invalid provider routes', () => {
    expect(() => planCartRoutingQuote(chain, cart, {
      paymentCurrency: '0x00000000000000000000000000000000000000ff',
      obligations: [{ settlementCurrency: rare, amount: 1n }],
    })).toThrowError(CartRoutingCoreError);

    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [{ settlementCurrency: rare, amount: 500n }],
    });
    const obligation = plan.foreignObligations[0]!;
    const response = quoteResponse(plan, obligation, [[hop(plan.inputToken, obligation.outputToken, '1000', '499')]]);
    expect(() => buildCartRoutingQuoteResult(plan, [{ ...obligation, response }], 1_800_000_000_000))
      .toThrow('do not reconcile');
  });
});

function quoteObligation(plan: CartRoutingPlan, obligation: CartRoutingForeignObligation) {
  const middle = plan.inputToken === weth || obligation.outputToken === weth ? [] : [weth];
  const tokens = [plan.inputToken, ...middle, obligation.outputToken];
  const hops = tokens.slice(0, -1).map((tokenIn, index) => hop(
    tokenIn,
    tokens[index + 1]!,
    index === 0 ? '1000' : '700',
    index === tokens.length - 2 ? obligation.amount.toString() : '700',
  ));
  return { ...obligation, response: quoteResponse(plan, obligation, [hops]) };
}

function quoteResponse(
  plan: CartRoutingPlan,
  obligation: CartRoutingForeignObligation,
  route: UniswapQuoteRouteHop[][],
): UniswapQuoteResponse {
  return {
    requestId: `request-${obligation.settlementCurrency}`,
    routing: 'CLASSIC',
    permitData: null,
    quote: {
      chainId: plan.chainId,
      input: { amount: '1000', maximumAmount: '1100', token: plan.inputToken },
      output: { amount: obligation.amount.toString(), minimumAmount: obligation.amount.toString(), token: obligation.outputToken, recipient: plan.cart },
      swapper: plan.cart,
      route,
      slippage: 0.5,
      tradeType: 'EXACT_OUTPUT',
      quoteId: `quote-${obligation.settlementCurrency}`,
      routeString: `${plan.inputToken} -> ${obligation.outputToken}`,
    },
  };
}

function hop(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: string,
  amountOut: string,
  protocol: 'v2' | 'v3' | 'v4' = 'v4',
): UniswapQuoteRouteHop {
  return {
    type: `${protocol}-pool`,
    tokenIn: { chainId: 11_155_111, decimals: '18', address: tokenIn },
    tokenOut: { chainId: 11_155_111, decimals: '18', address: tokenOut },
    fee: '3000',
    tickSpacing: '60',
    hooks: zeroAddress,
    amountIn,
    amountOut,
  };
}
