import { describe, expect, it } from 'vitest';
import { encodeFunctionData, zeroAddress, type Address, type Hex } from 'viem';
import { getCartAddress } from '../../../src/contracts/addresses.js';
import {
  assertCartRoutingQuoteFresh,
  buildCartRoutingQuoteResult,
  CartRoutingCoreError,
  planCartRoutingQuote,
  protectCartRoutingExactInput,
  resolveCartRoutingMaximumInput,
  type CartRoutingForeignObligation,
  type CartRoutingPlan,
} from '../../../src/sdk/cart-routing-core.js';
import { getRareAddress, getUsdcAddress, getWrappedEthAddress } from '../../../src/swap/known-pools.js';
import type { UniswapQuoteResponse, UniswapSwapResponse } from '../../../src/swap/uniswap-api.js';

const chain = 'sepolia' as const;
const cart = getCartAddress(chain);
const router = '0x00000000000000000000000000000000000000aa' as Address;
const eth = zeroAddress;
const rare = getRareAddress(chain);
const usdc = getUsdcAddress(chain);
const weth = getWrappedEthAddress(chain)!;
const currencies = [eth, usdc, rare, weth] as const;

const executeAbi = [{
  type: 'function', name: 'execute', stateMutability: 'payable', outputs: [],
  inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }],
}] as const;

describe('Cart routing functional core', () => {
  it('packages opaque compiled routes for every supported Sepolia currency direction', () => {
    for (const paymentCurrency of currencies) {
      for (const settlementCurrency of currencies) {
        if (paymentCurrency === settlementCurrency) continue;
        const plan = planCartRoutingQuote(chain, cart, {
          paymentCurrency,
          obligations: [{ settlementCurrency, amount: 500n }],
        });
        const result = buildCartRoutingQuoteResult(plan, router, [quoted(plan, plan.foreignObligations[0]!)], 1_800_000_000_000);
        expect(result.route).toEqual({
          commands: '0x1004',
          inputs: ['0x1234', '0xabcd'],
          routerValue: paymentCurrency === eth ? '1100' : '0',
        });
        expect(result.expectedPaymentInput).toBe('1000');
        expect(result.maximumPaymentInput).toBe('1100');
        expect(result.evidence.compilerRequestIds).toHaveLength(1);
        expect(() => JSON.stringify({ ...result, route: { ...result.route, routerValue: result.route.routerValue.toString() } })).not.toThrow();
      }
    }
  });

  it('composes direct and foreign obligations into one order-wide program', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [
        { settlementCurrency: usdc, amount: 300n },
        { settlementCurrency: eth, amount: 500n },
        { settlementCurrency: rare, amount: 500n },
        { settlementCurrency: rare, amount: 250n },
      ],
    });
    const result = buildCartRoutingQuoteResult(
      plan, router, plan.foreignObligations.map((obligation) => quoted(plan, obligation)), 1_800_000_000_000,
    );
    expect(result.route.commands).toBe('0x10041004');
    expect(result.route.inputs).toHaveLength(4);
    expect(result.route.routerValue).toBe('0');
    expect(result.directPaymentInput).toBe('300');
    expect(result.expectedPaymentInput).toBe('2300');
    expect(result.maximumPaymentInput).toBe('2500');
  });

  it('returns an empty program when every obligation is direct', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: rare,
      obligations: [{ settlementCurrency: rare, amount: 7n }],
    });
    const result = buildCartRoutingQuoteResult(plan, zeroAddress, [], 1_800_000_000_000);
    expect(result.route).toEqual({ commands: '0x', inputs: [], routerValue: '0' });
    expect(result.expectedPaymentInput).toBe('7');
    expect(result.maximumPaymentInput).toBe('7');
    expect(result.evidence.source).toBe('direct');
    expect(result.evidence.compilerRequestIds).toEqual([]);
    expect(assertCartRoutingQuoteFresh(result, 1_800_000_030_000)).toBe(result);
    expect(() => assertCartRoutingQuoteFresh(result, 1_800_000_060_000)).toThrow('expired');
  });

  it('ignores zero obligations and supports a fully free checkout', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: rare,
      obligations: [
        { settlementCurrency: eth, amount: 0n },
        { settlementCurrency: rare, amount: 0n },
      ],
    });
    const result = buildCartRoutingQuoteResult(plan, zeroAddress, [], 1_800_000_000_000);

    expect(plan.settlements).toEqual([]);
    expect(result.maximumPaymentInput).toBe('0');
    expect(result.route).toEqual({ commands: '0x', inputs: [], routerValue: '0' });
  });

  it('supports exact-input only when its protected input guarantees the fixed output', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [{ settlementCurrency: rare, amount: 500n }],
      mode: 'exact-input',
    });
    const obligation = plan.foreignObligations[0]!;
    const baseline = quote(plan, obligation, 'EXACT_OUTPUT');
    const execution = quote(plan, obligation, 'EXACT_INPUT');
    const result = buildCartRoutingQuoteResult(plan, router, [{
      ...obligation,
      exactOutputResponse: baseline,
      executionResponse: execution,
      swapResponse: swap(plan, '0x08'),
    }], 1_800_000_000_000);
    expect(result.mode).toBe('exact-input');
    expect(result.expectedPaymentInput).toBe('1100');
    expect(result.maximumPaymentInput).toBe('1100');

    execution.quote.output.minimumAmount = '499';
    expect(() => buildCartRoutingQuoteResult(plan, router, [{
      ...obligation, exactOutputResponse: baseline, executionResponse: execution, swapResponse: swap(plan, '0x08'),
    }], 1_800_000_000_000)).toThrow('does not guarantee');
  });

  it('uses provider maximum input or the SDK protection default', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [{ settlementCurrency: rare, amount: 500n }],
    });
    const obligation = plan.foreignObligations[0]!;
    const response = quote(plan, obligation, 'EXACT_OUTPUT');
    expect(resolveCartRoutingMaximumInput(plan, obligation, response)).toBe(1100n);
    delete response.quote.input.maximumAmount;
    expect(resolveCartRoutingMaximumInput(plan, obligation, response)).toBe(1005n);
    expect(protectCartRoutingExactInput(1005n)).toBe(1011n);
  });

  it('accepts only the Cart command families without interpreting their inputs', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [{ settlementCurrency: rare, amount: 500n }],
    });
    const obligation = plan.foreignObligations[0]!;
    const item = quoted(plan, obligation, '0x0001020408090b0c10', Array.from({ length: 9 }, () => '0xdead'));
    expect(buildCartRoutingQuoteResult(plan, router, [item], 1_800_000_000_000).route.inputs).toHaveLength(9);

    for (const commands of ['0x11', '0x80'] as Hex[]) {
      const invalid = quoted(plan, obligation, commands, ['0x']);
      expect(() => buildCartRoutingQuoteResult(plan, router, [invalid], 1_800_000_000_000))
        .toThrow('not allowed');
    }
  });

  it('accepts arbitrary settlement currencies while failing closed on malformed addresses and compiler envelopes', () => {
    const arbitraryCurrency = '0x00000000000000000000000000000000000000ff' as Address;
    expect(planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [{ settlementCurrency: arbitraryCurrency, amount: 1n }],
    }).foreignObligations).toEqual([{ settlementCurrency: arbitraryCurrency, amount: 1n }]);

    expect(() => planCartRoutingQuote(chain, cart, {
      paymentCurrency: 'not-an-address' as Address,
      obligations: [{ settlementCurrency: rare, amount: 1n }],
    })).toThrowError(CartRoutingCoreError);

    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [{ settlementCurrency: rare, amount: 500n }],
    });
    const obligation = plan.foreignObligations[0]!;
    const wrongRouter = quoted(plan, obligation);
    wrongRouter.swapResponse.swap.to = zeroAddress;
    expect(() => buildCartRoutingQuoteResult(plan, router, [wrongRouter], 1_800_000_000_000)).toThrow('wrong chain or endpoints');

    const mismatched = quoted(plan, obligation, '0x10', ['0x', '0x']);
    expect(() => buildCartRoutingQuoteResult(plan, router, [mismatched], 1_800_000_000_000)).toThrow('equal lengths');
  });
});

function quoted(
  plan: CartRoutingPlan,
  obligation: CartRoutingForeignObligation,
  commands: Hex = '0x1004',
  inputs: Hex[] = ['0x1234', '0xabcd'],
) {
  const response = quote(plan, obligation, 'EXACT_OUTPUT');
  return {
    ...obligation,
    exactOutputResponse: response,
    executionResponse: response,
    swapResponse: swap(plan, commands, inputs),
  };
}

function quote(
  plan: CartRoutingPlan,
  obligation: CartRoutingForeignObligation,
  tradeType: 'EXACT_INPUT' | 'EXACT_OUTPUT',
): UniswapQuoteResponse {
  return {
    requestId: `quote-request-${obligation.settlementCurrency}`,
    routing: 'CLASSIC',
    permitData: null,
    quote: {
      chainId: plan.chainId,
      input: { amount: tradeType === 'EXACT_INPUT' ? '1100' : '1000', maximumAmount: '1100', token: plan.paymentCurrency },
      output: {
        amount: tradeType === 'EXACT_INPUT' ? '550' : obligation.amount.toString(),
        minimumAmount: obligation.amount.toString(),
        token: obligation.settlementCurrency,
        recipient: plan.cart,
      },
      swapper: plan.cart,
      route: [],
      tradeType,
      quoteId: `${tradeType}-${obligation.settlementCurrency}`,
      routeString: `${plan.paymentCurrency} -> ${obligation.settlementCurrency}`,
    },
  };
}

function swap(
  plan: CartRoutingPlan,
  commands: Hex,
  inputs: Hex[] = Array.from({ length: (commands.length - 2) / 2 }, () => '0x1234'),
): UniswapSwapResponse {
  return {
    requestId: 'compiler-request',
    swap: {
      to: router,
      from: plan.cart,
      chainId: plan.chainId,
      value: plan.paymentCurrency === eth ? '1100' : '0',
      data: encodeFunctionData({ abi: executeAbi, functionName: 'execute', args: [commands, inputs, 1_800_000_060n] }),
    },
  };
}
