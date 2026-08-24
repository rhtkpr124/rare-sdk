/* eslint-disable functional/immutable-data */
import {
  encodeAbiParameters,
  encodePacked,
  getAddress,
  isAddressEqual,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import { ETH_ADDRESS, chainIds, type SupportedChain } from '../contracts/addresses.js';
import { getRareAddress, getUsdcAddress, getWrappedEthAddress } from '../swap/known-pools.js';
import { sortCurrencies } from '../swap/build-route.js';
import type {
  UniswapQuoteResponse,
  UniswapQuoteRouteHop,
} from '../swap/uniswap-api.js';
import { applyCartQuoteSpread } from './cart-core.js';
import type {
  CartRoutingErrorCode,
  CartRoutingMode,
  CartRoutingQuoteParams,
  CartRoutingQuoteResult,
  CartRoutingSettlement,
} from './types/cart-routing.js';

export const cartRoutingDefaultMode: CartRoutingMode = 'exact-output';
export const cartRoutingDefaultSlippageBps = 50;
export const cartRoutingDefaultQuoteLifetimeMs = 60_000;
export const cartRoutingMaxCommands = 32;

export class CartRoutingCoreError extends Error {
  readonly code: CartRoutingErrorCode;
  readonly settlementCurrency?: Address;

  constructor(code: CartRoutingErrorCode, message: string, settlementCurrency?: Address) {
    super(message);
    this.name = 'CartRoutingCoreError';
    this.code = code;
    this.settlementCurrency = settlementCurrency;
  }
}

export type CartRoutingForeignObligation = {
  settlementCurrency: Address;
  outputToken: Address;
  amount: bigint;
};

export type CartRoutingPlan = {
  chain: SupportedChain;
  chainId: number;
  cart: Address;
  paymentCurrency: Address;
  inputToken: Address;
  mode: CartRoutingMode;
  directPaymentInput: bigint;
  settlements: CartRoutingSettlement[];
  foreignObligations: CartRoutingForeignObligation[];
};

export type CartRoutingQuotedObligation = CartRoutingForeignObligation & {
  response: UniswapQuoteResponse;
};

type EncodedPath = {
  command: number;
  input: Hex;
  expectedInput: bigint;
  maximumInput: bigint;
  exactOutput: bigint;
  description: string;
};

export function planCartRoutingQuote(
  chain: SupportedChain,
  cart: Address,
  params: CartRoutingQuoteParams,
): CartRoutingPlan {
  if (params.obligations.length === 0) {
    throw new CartRoutingCoreError('invalid_response', 'Cart routing requires at least one settlement obligation.');
  }
  const paymentCurrency = requireSupportedCurrency(chain, params.paymentCurrency);
  const inputToken = toRoutingToken(chain, paymentCurrency);
  const mode = params.mode ?? cartRoutingDefaultMode;
  const totals = new Map<Address, bigint>();
  for (const [index, obligation] of params.obligations.entries()) {
    if (obligation.amount <= 0n) {
      throw new CartRoutingCoreError('invalid_response', `obligations[${index}].amount must be positive.`);
    }
    const currency = requireSupportedCurrency(chain, obligation.settlementCurrency);
    totals.set(currency, (totals.get(currency) ?? 0n) + obligation.amount);
  }

  const settlements: CartRoutingSettlement[] = [];
  const foreignObligations: CartRoutingForeignObligation[] = [];
  const directPaymentInput = totals.get(paymentCurrency) ?? 0n;
  for (const [settlementCurrency, amount] of totals) {
    const routed = !isAddressEqual(settlementCurrency, paymentCurrency);
    settlements.push({ settlementCurrency, amount: amount.toString(), routed });
    if (!routed) continue;
    foreignObligations.push({ settlementCurrency, outputToken: toRoutingToken(chain, settlementCurrency), amount });
  }
  if (foreignObligations.length > cartRoutingMaxCommands) {
    throw new CartRoutingCoreError('cart_incompatible_route', `Cart routing cannot exceed ${cartRoutingMaxCommands} foreign obligations.`);
  }
  return {
    chain,
    chainId: chainIds[chain],
    cart: getAddress(cart),
    paymentCurrency,
    inputToken,
    mode,
    directPaymentInput,
    settlements,
    foreignObligations,
  };
}

export function buildCartRoutingQuoteResult(
  plan: CartRoutingPlan,
  quoted: readonly CartRoutingQuotedObligation[],
  quotedAtMs: number,
  quoteLifetimeMs = cartRoutingDefaultQuoteLifetimeMs,
): CartRoutingQuoteResult {
  if (!Number.isFinite(quotedAtMs) || quotedAtMs < 0 || !Number.isFinite(quoteLifetimeMs) || quoteLifetimeMs <= 0) {
    throw new CartRoutingCoreError('invalid_response', 'Cart routing quote timestamps are invalid.');
  }
  if (quoted.length !== plan.foreignObligations.length) {
    throw new CartRoutingCoreError('invalid_response', 'Cart routing quote coverage does not match the requested obligations.');
  }

  const encodedPaths: EncodedPath[] = [];
  const quoteIds: string[] = [];
  const descriptions: string[] = [];
  for (const obligation of quoted) {
    const encoded = encodeQuotedObligation(plan, obligation);
    encodedPaths.push(...encoded);
    quoteIds.push(obligation.response.quote.quoteId);
    descriptions.push(obligation.response.quote.routeString ?? encoded.map((path) => path.description).join(' + '));
  }
  if (encodedPaths.length > cartRoutingMaxCommands) {
    throw new CartRoutingCoreError('cart_incompatible_route', `Cart route cannot exceed ${cartRoutingMaxCommands} commands.`);
  }

  const commands = encodedPaths.length === 0
    ? '0x' as Hex
    : encodePacked(encodedPaths.map(() => 'uint8'), encodedPaths.map((path) => path.command));
  const inputs = encodedPaths.map((path) => path.input);
  const routedExpectedInput = encodedPaths.reduce((total, path) => total + path.expectedInput, 0n);
  const routedMaximumInput = encodedPaths.reduce((total, path) => total + path.maximumInput, 0n);
  const expectedPaymentInput = plan.directPaymentInput + routedExpectedInput;
  const maximumPaymentInput = plan.directPaymentInput + routedMaximumInput;
  if (maximumPaymentInput < expectedPaymentInput) {
    throw new CartRoutingCoreError('invalid_response', 'Protected Cart payment input cannot be less than quoted input.');
  }

  const quotedAt = new Date(quotedAtMs).toISOString();
  const expiresAt = new Date(quotedAtMs + quoteLifetimeMs).toISOString();
  const exactOutputs = plan.settlements.map(({ settlementCurrency, amount }) => ({ settlementCurrency, amount }));
  const source = quoted.length === 0 ? 'direct' as const : 'uniswap-api' as const;
  const routeDescription = quoted.length === 0 ? 'DIRECT' : descriptions.join(' | ');
  return {
    schemaVersion: 1,
    chain: plan.chain,
    chainId: plan.chainId,
    paymentCurrency: plan.paymentCurrency,
    mode: plan.mode,
    expectedPaymentInput: expectedPaymentInput.toString(),
    maximumPaymentInput: maximumPaymentInput.toString(),
    directPaymentInput: plan.directPaymentInput.toString(),
    settlements: plan.settlements,
    route: { commands, inputs, routerValue: '0' },
    quotedAt,
    expiresAt,
    evidence: {
      source,
      mode: plan.mode,
      quoteIds,
      quotedInput: expectedPaymentInput.toString(),
      protectedMaximumInput: maximumPaymentInput.toString(),
      exactOutputs,
      quotedAt,
      expiresAt,
      routeDescription,
    },
  };
}

export function assertCartRoutingQuoteFresh(
  quote: CartRoutingQuoteResult,
  nowMs = Date.now(),
): CartRoutingQuoteResult {
  const expiresAtMs = Date.parse(quote.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs)) {
    throw new CartRoutingCoreError('invalid_response', 'Cart routing quote timestamps are invalid.');
  }
  if (nowMs >= expiresAtMs) {
    throw new CartRoutingCoreError('quote_expired', 'The Cart routing quote has expired.');
  }
  return quote;
}

function encodeQuotedObligation(plan: CartRoutingPlan, obligation: CartRoutingQuotedObligation): EncodedPath[] {
  const { response } = obligation;
  const quote = response.quote;
  if (response.routing !== 'CLASSIC') {
    throw new CartRoutingCoreError('cart_incompatible_route', `Cart requires CLASSIC routing, received ${response.routing}.`, obligation.settlementCurrency);
  }
  if (quote.tradeType !== 'EXACT_OUTPUT' || quote.chainId !== plan.chainId) {
    throw new CartRoutingCoreError('invalid_response', 'Uniswap returned the wrong trade type or chain.', obligation.settlementCurrency);
  }
  if (!isAddressEqual(quote.input.token, plan.inputToken) || !isAddressEqual(quote.output.token, obligation.outputToken) ||
    !isAddressEqual(quote.swapper, plan.cart) || !isAddressEqual(quote.output.recipient, plan.cart)) {
    throw new CartRoutingCoreError('invalid_response', 'Uniswap quote endpoints or recipient do not match the Cart request.', obligation.settlementCurrency);
  }
  if (BigInt(quote.output.amount) !== obligation.amount || quote.route.length === 0) {
    throw new CartRoutingCoreError('invalid_response', 'Uniswap quote does not provide the exact requested settlement output.', obligation.settlementCurrency);
  }

  const expectedInput = positiveInteger(quote.input.amount, 'quote.input.amount', obligation.settlementCurrency);
  const providerMaximum = quote.input.maximumAmount === undefined
    ? applyCartQuoteSpread(expectedInput, BigInt(cartRoutingDefaultSlippageBps))
    : positiveInteger(quote.input.maximumAmount, 'quote.input.maximumAmount', obligation.settlementCurrency);
  if (providerMaximum < expectedInput) {
    throw new CartRoutingCoreError('invalid_response', 'Uniswap maximum input is below its quoted input.', obligation.settlementCurrency);
  }

  const pathAmounts = quote.route.map((path, index) => validateQuotePath(plan, obligation, path, index));
  const routeExpectedInput = pathAmounts.reduce((total, path) => total + path.expectedInput, 0n);
  const routeExactOutput = pathAmounts.reduce((total, path) => total + path.exactOutput, 0n);
  if (routeExpectedInput !== expectedInput || routeExactOutput !== obligation.amount) {
    throw new CartRoutingCoreError('invalid_response', 'Uniswap route amounts do not reconcile with its normalized quote.', obligation.settlementCurrency);
  }
  const allocations = allocateMaximumInput(pathAmounts.map((path) => path.expectedInput), providerMaximum);
  return pathAmounts.map((path, index) => encodePath(plan.mode, path.hops, path.expectedInput, allocations[index]!, path.exactOutput));
}

function validateQuotePath(
  plan: CartRoutingPlan,
  obligation: CartRoutingForeignObligation,
  hops: readonly UniswapQuoteRouteHop[],
  pathIndex: number,
): { hops: readonly UniswapQuoteRouteHop[]; expectedInput: bigint; exactOutput: bigint } {
  if (hops.length === 0) {
    throw new CartRoutingCoreError('invalid_response', `Uniswap route[${pathIndex}] is empty.`, obligation.settlementCurrency);
  }
  for (const [index, hop] of hops.entries()) {
    if (hop.tokenIn.chainId !== plan.chainId || hop.tokenOut.chainId !== plan.chainId ||
      (index > 0 && !isAddressEqual(hops[index - 1]!.tokenOut.address, hop.tokenIn.address))) {
      throw new CartRoutingCoreError('invalid_response', `Uniswap route[${pathIndex}] is discontinuous or on the wrong chain.`, obligation.settlementCurrency);
    }
  }
  if (!isAddressEqual(hops[0]!.tokenIn.address, plan.inputToken) ||
    !isAddressEqual(hops[hops.length - 1]!.tokenOut.address, obligation.outputToken)) {
    throw new CartRoutingCoreError('cart_incompatible_route', `Uniswap route[${pathIndex}] does not match Cart endpoints.`, obligation.settlementCurrency);
  }
  const protocol = routeProtocol(hops[0]!);
  if (hops.some((hop) => routeProtocol(hop) !== protocol)) {
    throw new CartRoutingCoreError('cart_incompatible_route', `Uniswap route[${pathIndex}] mixes protocols in one path.`, obligation.settlementCurrency);
  }
  return {
    hops,
    expectedInput: positiveInteger(hops[0]!.amountIn, `quote.route[${pathIndex}][0].amountIn`, obligation.settlementCurrency),
    exactOutput: positiveInteger(hops[hops.length - 1]!.amountOut, `quote.route[${pathIndex}].amountOut`, obligation.settlementCurrency),
  };
}

function allocateMaximumInput(expected: readonly bigint[], maximum: bigint): bigint[] {
  const total = expected.reduce((sum, value) => sum + value, 0n);
  return expected.map((value, index) => {
    if (index < expected.length - 1) return (value * maximum) / total;
    const prior = expected.slice(0, index)
      .reduce((sum, item) => sum + (item * maximum) / total, 0n);
    return maximum - prior;
  });
}

function encodePath(
  mode: CartRoutingMode,
  hops: readonly UniswapQuoteRouteHop[],
  expectedInput: bigint,
  maximumInput: bigint,
  exactOutput: bigint,
): EncodedPath {
  const protocol = routeProtocol(hops[0]!);
  const path = [getAddress(hops[0]!.tokenIn.address), ...hops.map((hop) => getAddress(hop.tokenOut.address))];
  if (protocol === 'v2') {
    const command = mode === 'exact-output' ? 0x09 : 0x08;
    return {
      command,
      input: encodeAbiParameters(
        parseAbiParameters('address recipient, uint256 amountOutOrIn, uint256 amountInMaxOrOutMin, address[] path, bool payerIsUser'),
        ['0x0000000000000000000000000000000000000001', mode === 'exact-output' ? exactOutput : maximumInput,
          mode === 'exact-output' ? maximumInput : exactOutput, path, true],
      ),
      expectedInput,
      maximumInput,
      exactOutput,
      description: path.join(' -> '),
    };
  }
  if (protocol === 'v3') {
    const fees = hops.map((hop, index) => uint24(hop.fee, `route[${index}].fee`));
    const encodedPath = encodeV3Path(mode === 'exact-output' ? [...path].reverse() : path,
      mode === 'exact-output' ? [...fees].reverse() : fees);
    return {
      command: mode === 'exact-output' ? 0x01 : 0x00,
      input: encodeAbiParameters(
        parseAbiParameters('address recipient, uint256 amountOutOrIn, uint256 amountInMaxOrOutMin, bytes path, bool payerIsUser'),
        ['0x0000000000000000000000000000000000000001', mode === 'exact-output' ? exactOutput : maximumInput,
          mode === 'exact-output' ? maximumInput : exactOutput, encodedPath, true],
      ),
      expectedInput,
      maximumInput,
      exactOutput,
      description: path.join(' -> '),
    };
  }
  return {
    command: 0x10,
    input: encodeV4Path(mode, hops, maximumInput, exactOutput),
    expectedInput,
    maximumInput,
    exactOutput,
    description: path.join(' -> '),
  };
}

function encodeV4Path(mode: CartRoutingMode, hops: readonly UniswapQuoteRouteHop[], maximumInput: bigint, exactOutput: bigint): Hex {
  const input = getAddress(hops[0]!.tokenIn.address);
  const output = getAddress(hops[hops.length - 1]!.tokenOut.address);
  const actions = encodePacked(['uint8', 'uint8', 'uint8'], [
    mode === 'exact-output' ? (hops.length === 1 ? 0x08 : 0x09) : (hops.length === 1 ? 0x06 : 0x07),
    0x0c,
    0x0f,
  ]);
  const swap = hops.length === 1
    ? encodeV4Single(mode, hops[0]!, maximumInput, exactOutput)
    : encodeV4Multi(mode, hops, maximumInput, exactOutput);
  const settle = encodeAbiParameters(parseAbiParameters('address currency, uint256 maximum'), [input, maximumInput]);
  const take = encodeAbiParameters(parseAbiParameters('address currency, uint128 minimum'), [output, exactOutput]);
  return encodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), [actions, [swap, settle, take]]);
}

function encodeV4Single(mode: CartRoutingMode, hop: UniswapQuoteRouteHop, maximumInput: bigint, exactOutput: bigint): Hex {
  const [rawCurrency0, rawCurrency1] = sortCurrencies(hop.tokenIn.address, hop.tokenOut.address);
  const currency0 = getAddress(rawCurrency0);
  const currency1 = getAddress(rawCurrency1);
  const tuple = [[currency0, currency1, uint24(hop.fee, 'route.fee'), signedInt24(hop.tickSpacing, 'route.tickSpacing'),
    getAddress(hop.hooks ?? ETH_ADDRESS)], isAddressEqual(hop.tokenIn.address, currency0),
    mode === 'exact-output' ? exactOutput : maximumInput, mode === 'exact-output' ? maximumInput : exactOutput, '0x'] as const;
  return encodeAbiParameters(
    parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,bytes)'),
    [tuple],
  );
}

function encodeV4Multi(mode: CartRoutingMode, hops: readonly UniswapQuoteRouteHop[], maximumInput: bigint, exactOutput: bigint): Hex {
  const ordered = mode === 'exact-output' ? [...hops].reverse() : [...hops];
  const path = ordered.map((hop) => [
    getAddress(mode === 'exact-output' ? hop.tokenIn.address : hop.tokenOut.address),
    uint24(hop.fee, 'route.fee'),
    signedInt24(hop.tickSpacing, 'route.tickSpacing'),
    getAddress(hop.hooks ?? ETH_ADDRESS),
    '0x',
  ] as const);
  return mode === 'exact-output'
    ? encodeAbiParameters(parseAbiParameters('(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'),
        [[getAddress(hops[hops.length - 1]!.tokenOut.address), path, exactOutput, maximumInput]])
    : encodeAbiParameters(parseAbiParameters('(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'),
        [[getAddress(hops[0]!.tokenIn.address), path, maximumInput, exactOutput]]);
}

function encodeV3Path(path: readonly Address[], fees: readonly number[]): Hex {
  const types: Array<'address' | 'uint24'> = [];
  const values: Array<Address | number> = [];
  path.forEach((currency, index) => {
    types.push('address');
    values.push(currency);
    if (fees[index] !== undefined) {
      types.push('uint24');
      values.push(fees[index]!);
    }
  });
  return encodePacked(types, values);
}

function routeProtocol(hop: UniswapQuoteRouteHop): 'v2' | 'v3' | 'v4' {
  const type = hop.type.toLowerCase();
  if (type.includes('v2')) return 'v2';
  if (type.includes('v3')) return 'v3';
  if (type.includes('v4')) return 'v4';
  throw new CartRoutingCoreError('cart_incompatible_route', `Unsupported Uniswap pool type: ${hop.type}.`);
}

function positiveInteger(value: string | undefined, field: string, settlementCurrency?: Address): bigint {
  try {
    const parsed = BigInt(value ?? '');
    if (parsed <= 0n) throw new Error();
    return parsed;
  } catch {
    throw new CartRoutingCoreError('invalid_response', `${field} must be a positive integer.`, settlementCurrency);
  }
}

function uint24(value: string | undefined, field: string): number {
  const parsed = Number(nonNegativeInteger(value, field));
  if (!Number.isSafeInteger(parsed) || parsed > 0xffffff) {
    throw new CartRoutingCoreError('cart_incompatible_route', `${field} must fit uint24.`);
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, field: string): bigint {
  try {
    const parsed = BigInt(value ?? '');
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new CartRoutingCoreError('invalid_response', `${field} must be a non-negative integer.`);
  }
}

function signedInt24(value: string | undefined, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < -0x800000 || parsed > 0x7fffff) {
    throw new CartRoutingCoreError('cart_incompatible_route', `${field} must fit int24.`);
  }
  return parsed;
}

function requireSupportedCurrency(chain: SupportedChain, value: Address): Address {
  const currency = getAddress(value);
  const supported = [ETH_ADDRESS, getRareAddress(chain), getUsdcAddress(chain)].map((candidate) => getAddress(candidate));
  const match = supported.find((candidate) => isAddressEqual(candidate, currency));
  if (!match) throw new CartRoutingCoreError('unsupported_currency', `Currency ${currency} is not supported for Cart routing.`);
  return match;
}

function toRoutingToken(chain: SupportedChain, currency: Address): Address {
  if (!isAddressEqual(currency, ETH_ADDRESS)) return getAddress(currency);
  const weth = getWrappedEthAddress(chain);
  if (!weth) throw new CartRoutingCoreError('unsupported_chain', `Wrapped ETH is not configured on ${chain}.`);
  return getAddress(weth);
}
