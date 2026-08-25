import {
  encodeAbiParameters,
  encodePacked,
  isAddressEqual,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import { ETH_ADDRESS } from '../contracts/addresses.js';
import { buildV4SwapStep } from '../swap/build-route.js';
import {
  getCanonicalRareEthPoolKey,
  getCanonicalUsdcEthPoolKey,
  getRareAddress,
  getUsdcAddress,
} from '../swap/known-pools.js';
import { inferBaseCurrencyAddress } from '../swap/pool-core.js';
import type { PoolKey, ResolvedV4RouteStep } from '../swap/route-types.js';
import {
  CartRoutingCoreError,
  cartRoutingDefaultQuoteLifetimeMs,
  cartRoutingMaxCommands,
  type CartRoutingPlan,
} from './cart-routing-core.js';
import type { CartRoutingQuoteResult } from './types/cart-routing.js';

export type LocalCompiledObligation = {
  expectedInput: bigint;
  maximumInput: bigint;
  commands: Hex;
  inputs: Hex[];
  routerValue: bigint;
  description: string;
};

export function resolveKnownCartRoute(
  plan: CartRoutingPlan,
  output: Address,
  liquidEditionPool?: PoolKey,
): ResolvedV4RouteStep[] | null {
  const direct = resolveCanonicalRoute(plan, plan.paymentCurrency, output);
  if (direct !== null) return direct;
  if (liquidEditionPool === undefined) return null;

  const baseCurrency = inferBaseCurrencyAddress(liquidEditionPool, output);
  if (baseCurrency === null) return null;
  const prefix = resolveCanonicalRoute(plan, plan.paymentCurrency, baseCurrency);
  if (prefix === null) return null;
  return [...prefix, buildV4SwapStep(baseCurrency, output, liquidEditionPool)];
}

function resolveCanonicalRoute(
  plan: CartRoutingPlan,
  input: Address,
  output: Address,
): ResolvedV4RouteStep[] | null {
  if (isAddressEqual(input, output)) return [];
  const rare = getRareAddress(plan.chain);
  const usdc = getUsdcAddress(plan.chain);
  const poolFor = (currency: Address) => isAddressEqual(currency, rare)
    ? getCanonicalRareEthPoolKey(plan.chain)
    : isAddressEqual(currency, usdc)
      ? getCanonicalUsdcEthPoolKey(plan.chain)
      : null;
  if (isAddressEqual(input, ETH_ADDRESS)) {
    const pool = poolFor(output);
    return pool === null ? null : [buildV4SwapStep(input, output, pool)];
  }
  if (isAddressEqual(output, ETH_ADDRESS)) {
    const pool = poolFor(input);
    return pool === null ? null : [buildV4SwapStep(input, output, pool)];
  }
  const inputPool = poolFor(input);
  const outputPool = poolFor(output);
  return inputPool === null || outputPool === null
    ? null
    : [buildV4SwapStep(input, ETH_ADDRESS, inputPool), buildV4SwapStep(ETH_ADDRESS, output, outputPool)];
}

export function exactInputPathKeys(steps: ResolvedV4RouteStep[]) {
  return steps.map((step) => ({
    intermediateCurrency: step.tokenOut,
    fee: step.poolKey.fee,
    tickSpacing: step.poolKey.tickSpacing,
    hooks: step.poolKey.hooks,
    hookData: '0x' as Hex,
  }));
}

export function exactOutputPathKeys(steps: ResolvedV4RouteStep[]) {
  return steps.map((step) => ({
    intermediateCurrency: step.tokenIn,
    fee: step.poolKey.fee,
    tickSpacing: step.poolKey.tickSpacing,
    hooks: step.poolKey.hooks,
    hookData: '0x' as Hex,
  }));
}

export function compileKnownCartRoute(
  plan: CartRoutingPlan,
  steps: ResolvedV4RouteStep[],
  expectedInput: bigint,
  maximumInput: bigint,
  exactOutput: bigint,
): LocalCompiledObligation {
  const input = plan.paymentCurrency;
  const output = steps.at(-1)!.tokenOut;
  const isExactOutput = plan.mode === 'exact-output';
  const action = isExactOutput ? (steps.length === 1 ? 0x08 : 0x09) : (steps.length === 1 ? 0x06 : 0x07);
  const swap = steps.length === 1
    ? encodeAbiParameters(
        parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,bytes)'),
        [[[steps[0]!.poolKey.currency0, steps[0]!.poolKey.currency1, steps[0]!.poolKey.fee,
          steps[0]!.poolKey.tickSpacing, steps[0]!.poolKey.hooks], steps[0]!.zeroForOne,
        uint128(isExactOutput ? exactOutput : maximumInput), uint128(isExactOutput ? maximumInput : exactOutput), '0x']],
      )
    : encodeAbiParameters(
        parseAbiParameters('(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'),
        [[isExactOutput ? output : input, (isExactOutput ? exactOutputPathKeys(steps) : exactInputPathKeys(steps)).map((key) =>
          [key.intermediateCurrency, key.fee, key.tickSpacing, key.hooks, key.hookData] as const),
          uint128(isExactOutput ? exactOutput : maximumInput), uint128(isExactOutput ? maximumInput : exactOutput)]],
      );
  const actions = encodePacked(['uint8', 'uint8', 'uint8'], [action, 0x0c, 0x0f]);
  const settle = encodeAbiParameters(parseAbiParameters('address currency, uint256 maximum'), [input, maximumInput]);
  const take = encodeAbiParameters(parseAbiParameters('address currency, uint128 minimum'), [output, exactOutput]);
  return {
    expectedInput,
    maximumInput,
    commands: '0x10',
    inputs: [encodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), [actions, [swap, settle, take]])],
    routerValue: isAddressEqual(input, ETH_ADDRESS) ? maximumInput : 0n,
    description: steps.map((step) => `${step.tokenIn}->${step.tokenOut}`).join(' -> '),
  };
}

export function buildKnownPoolCartRoutingResult(
  plan: CartRoutingPlan,
  compiled: LocalCompiledObligation[],
  quotedAtMs: number,
): CartRoutingQuoteResult {
  const inputs = compiled.flatMap((item) => item.inputs);
  if (inputs.length > cartRoutingMaxCommands) throw new CartRoutingCoreError('cart_incompatible_route', `Cart route cannot exceed ${cartRoutingMaxCommands} commands.`);
  const routedExpected = compiled.reduce((sum, item) => sum + item.expectedInput, 0n);
  const routedMaximum = compiled.reduce((sum, item) => sum + item.maximumInput, 0n);
  const quotedAt = new Date(quotedAtMs).toISOString();
  const expiresAt = new Date(quotedAtMs + cartRoutingDefaultQuoteLifetimeMs).toISOString();
  const exactOutputs = plan.settlements.map(({ settlementCurrency, amount }) => ({ settlementCurrency, amount }));
  const expected = plan.directPaymentInput + routedExpected;
  const maximum = plan.directPaymentInput + routedMaximum;
  return {
    schemaVersion: 1, chain: plan.chain, chainId: plan.chainId, paymentCurrency: plan.paymentCurrency, mode: plan.mode,
    expectedPaymentInput: expected.toString(), maximumPaymentInput: maximum.toString(), directPaymentInput: plan.directPaymentInput.toString(),
    settlements: plan.settlements,
    route: {
      commands: (`0x${compiled.map((item) => item.commands.slice(2)).join('')}`) as Hex,
      inputs,
      routerValue: compiled.reduce((sum, item) => sum + item.routerValue, 0n).toString(),
    },
    quotedAt, expiresAt,
    evidence: {
      source: 'known-pool-rpc', mode: plan.mode, quoteIds: [], compilerRequestIds: [],
      quotedInput: expected.toString(), protectedMaximumInput: maximum.toString(), exactOutputs, quotedAt, expiresAt,
      routeDescription: compiled.map((item) => item.description).join(' | '),
    },
  };
}

function uint128(value: bigint): bigint {
  if (value < 0n || value > (1n << 128n) - 1n) throw new CartRoutingCoreError('invalid_response', 'Cart routing amount must fit uint128.');
  return value;
}
