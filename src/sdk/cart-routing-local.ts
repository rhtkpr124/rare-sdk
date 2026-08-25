import type { Address, PublicClient } from 'viem';
import { uniswapV4QuoterAbi } from '../contracts/abis/uniswap-v4-quoter.js';
import { getLiquidEditionPoolKey } from '../swap/liquid-edition.js';
import { getV4Quoter } from '../swap/known-pools.js';
import type { ResolvedV4RouteStep } from '../swap/route-types.js';
import { applyCartQuoteSpread } from './cart-core.js';
import {
  CartRoutingCoreError,
  cartRoutingDefaultSlippageBps,
  type CartRoutingPlan,
} from './cart-routing-core.js';
import {
  buildKnownPoolCartRoutingResult,
  compileKnownCartRoute,
  exactInputPathKeys,
  exactOutputPathKeys,
  resolveKnownCartRoute,
} from './cart-routing-local-core.js';
import type { CartRoutingQuoteResult } from './types/cart-routing.js';

export async function buildKnownPoolCartRoutingQuote(
  publicClient: PublicClient,
  plan: CartRoutingPlan,
  quotedAtMs = Date.now(),
): Promise<CartRoutingQuoteResult | null> {
  const routeSteps = await Promise.all(plan.foreignObligations.map(async (obligation) => {
    const known = resolveKnownCartRoute(plan, obligation.settlementCurrency);
    if (known !== null) return known;
    const liquidEditionPool = await getLiquidEditionPoolKey(publicClient, obligation.settlementCurrency);
    return liquidEditionPool === null
      ? null
      : resolveKnownCartRoute(plan, obligation.settlementCurrency, liquidEditionPool);
  }));
  if (routeSteps.some((steps) => steps === null)) return null;

  const quoter = getV4Quoter(plan.chain);
  const compiled = await Promise.all(plan.foreignObligations.map(async (obligation, index) => {
    const steps = routeSteps[index]!;
    const expectedInput = await quoteKnownCartRouteExactOutput(publicClient, quoter, steps, obligation.amount);
    const maximumInput = applyCartQuoteSpread(expectedInput, BigInt(cartRoutingDefaultSlippageBps));
    if (plan.mode === 'exact-input') {
      const estimatedOutput = await quoteKnownCartRouteExactInput(publicClient, quoter, steps, maximumInput);
      if (estimatedOutput < obligation.amount) {
        throw new CartRoutingCoreError('insufficient_liquidity', 'Known-pool exact-input quote cannot satisfy the fixed Cart settlement.', obligation.settlementCurrency);
      }
    }
    return compileKnownCartRoute(
      plan,
      steps,
      plan.mode === 'exact-input' ? maximumInput : expectedInput,
      maximumInput,
      obligation.amount,
    );
  }));
  return buildKnownPoolCartRoutingResult(plan, compiled, quotedAtMs);
}

async function quoteKnownCartRouteExactOutput(
  publicClient: PublicClient,
  quoter: Address,
  steps: ResolvedV4RouteStep[],
  amountOut: bigint,
): Promise<bigint> {
  const result = steps.length === 1
    ? await publicClient.simulateContract({
        address: quoter, abi: uniswapV4QuoterAbi, functionName: 'quoteExactOutputSingle',
        args: [{ poolKey: steps[0]!.poolKey, zeroForOne: steps[0]!.zeroForOne, exactAmount: uint128(amountOut), hookData: '0x' }],
      })
    : await publicClient.simulateContract({
        address: quoter, abi: uniswapV4QuoterAbi, functionName: 'quoteExactOutput',
        args: [{ exactCurrency: steps.at(-1)!.tokenOut, path: exactOutputPathKeys(steps), exactAmount: uint128(amountOut) }],
      });
  return result.result[0];
}

async function quoteKnownCartRouteExactInput(
  publicClient: PublicClient,
  quoter: Address,
  steps: ResolvedV4RouteStep[],
  amountIn: bigint,
): Promise<bigint> {
  const result = steps.length === 1
    ? await publicClient.simulateContract({
        address: quoter, abi: uniswapV4QuoterAbi, functionName: 'quoteExactInputSingle',
        args: [{ poolKey: steps[0]!.poolKey, zeroForOne: steps[0]!.zeroForOne, exactAmount: uint128(amountIn), hookData: '0x' }],
      })
    : await publicClient.simulateContract({
        address: quoter, abi: uniswapV4QuoterAbi, functionName: 'quoteExactInput',
        args: [{ exactCurrency: steps[0]!.tokenIn, path: exactInputPathKeys(steps), exactAmount: uint128(amountIn) }],
      });
  return result.result[0];
}

function uint128(value: bigint): bigint {
  if (value < 0n || value > (1n << 128n) - 1n) throw new CartRoutingCoreError('invalid_response', 'Cart routing amount must fit uint128.');
  return value;
}
