/* eslint-disable functional/immutable-data, functional/no-let */
import {
  decodeFunctionData,
  getAddress,
  isAddressEqual,
  size,
  type Address,
  type Hex,
} from 'viem';
import { ETH_ADDRESS, chainIds, type SupportedChain } from '../contracts/addresses.js';
import { getRareAddress, getUsdcAddress, getWrappedEthAddress } from '../swap/known-pools.js';
import type { UniswapQuoteResponse, UniswapSwapResponse } from '../swap/uniswap-api.js';
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

const universalRouterExecuteAbi = [
  {
    type: 'function', name: 'execute', stateMutability: 'payable',
    inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function', name: 'execute', stateMutability: 'payable',
    inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }],
    outputs: [],
  },
] as const;

const allowedCartCommands = new Set([0x00, 0x01, 0x02, 0x04, 0x08, 0x09, 0x0b, 0x0c, 0x10]);

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
  amount: bigint;
};

export type CartRoutingPlan = {
  chain: SupportedChain;
  chainId: number;
  cart: Address;
  paymentCurrency: Address;
  mode: CartRoutingMode;
  directPaymentInput: bigint;
  settlements: CartRoutingSettlement[];
  foreignObligations: CartRoutingForeignObligation[];
};

export type CartRoutingQuotedObligation = CartRoutingForeignObligation & {
  exactOutputResponse: UniswapQuoteResponse;
  executionResponse: UniswapQuoteResponse;
  swapResponse: UniswapSwapResponse;
};

type ValidatedQuote = {
  expectedInput: bigint;
  maximumInput: bigint;
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
    if (routed) foreignObligations.push({ settlementCurrency, amount });
  }
  return {
    chain,
    chainId: chainIds[chain],
    cart: getAddress(cart),
    paymentCurrency,
    mode,
    directPaymentInput,
    settlements,
    foreignObligations,
  };
}

export function resolveCartRoutingMaximumInput(
  plan: CartRoutingPlan,
  obligation: CartRoutingForeignObligation,
  response: UniswapQuoteResponse,
): bigint {
  return validateExactOutputQuote(plan, obligation, response).maximumInput;
}

export function buildCartRoutingQuoteResult(
  plan: CartRoutingPlan,
  universalRouter: Address,
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

  const programs: Array<{ commands: Hex; inputs: Hex[]; routerValue: bigint }> = [];
  const quoteIds: string[] = [];
  const compilerRequestIds: string[] = [];
  const descriptions: string[] = [];
  let routedExpectedInput = 0n;
  let routedMaximumInput = 0n;

  for (const obligation of quoted) {
    const baseline = validateExactOutputQuote(plan, obligation, obligation.exactOutputResponse);
    const execution = validateExecutionQuote(plan, obligation, obligation.executionResponse, baseline.maximumInput);
    const program = decodeAndValidateRouterProgram(plan, universalRouter, obligation.swapResponse);
    programs.push(program);
    routedExpectedInput += execution.expectedInput;
    routedMaximumInput += execution.maximumInput;
    quoteIds.push(obligation.exactOutputResponse.quote.quoteId);
    if (obligation.executionResponse.quote.quoteId !== obligation.exactOutputResponse.quote.quoteId) {
      quoteIds.push(obligation.executionResponse.quote.quoteId);
    }
    compilerRequestIds.push(obligation.swapResponse.requestId);
    descriptions.push(execution.description);
  }

  const commands = (`0x${programs.map(({ commands: value }) => value.slice(2)).join('')}`) as Hex;
  const inputs = programs.flatMap(({ inputs: value }) => value);
  if (size(commands) !== inputs.length || inputs.length > cartRoutingMaxCommands) {
    throw new CartRoutingCoreError('cart_incompatible_route', `Cart route must contain matching commands and inputs and cannot exceed ${cartRoutingMaxCommands} commands.`);
  }
  const routerValue = programs.reduce((total, program) => total + program.routerValue, 0n);
  if (!isAddressEqual(plan.paymentCurrency, ETH_ADDRESS) && routerValue !== 0n) {
    throw new CartRoutingCoreError('cart_incompatible_route', 'ERC-20 funded Cart routes cannot forward native value.');
  }
  if (isAddressEqual(plan.paymentCurrency, ETH_ADDRESS) && routerValue > routedMaximumInput) {
    throw new CartRoutingCoreError('invalid_response', 'Universal Router value exceeds the bounded routed payment input.');
  }

  const expectedPaymentInput = plan.directPaymentInput + routedExpectedInput;
  const maximumPaymentInput = plan.directPaymentInput + routedMaximumInput;
  if (maximumPaymentInput < expectedPaymentInput) {
    throw new CartRoutingCoreError('invalid_response', 'Protected Cart payment input cannot be less than quoted input.');
  }

  const quotedAt = new Date(quotedAtMs).toISOString();
  const expiresAt = new Date(quotedAtMs + quoteLifetimeMs).toISOString();
  const exactOutputs = plan.settlements.map(({ settlementCurrency, amount }) => ({ settlementCurrency, amount }));
  const source = quoted.length === 0 ? 'direct' as const : 'uniswap-api' as const;
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
    route: { commands, inputs, routerValue: routerValue.toString() },
    quotedAt,
    expiresAt,
    evidence: {
      source,
      mode: plan.mode,
      quoteIds,
      compilerRequestIds,
      quotedInput: expectedPaymentInput.toString(),
      protectedMaximumInput: maximumPaymentInput.toString(),
      exactOutputs,
      quotedAt,
      expiresAt,
      routeDescription: quoted.length === 0 ? 'DIRECT' : descriptions.join(' | '),
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

function validateExactOutputQuote(
  plan: CartRoutingPlan,
  obligation: CartRoutingForeignObligation,
  response: UniswapQuoteResponse,
): ValidatedQuote {
  validateQuoteEnvelope(plan, obligation, response);
  const quote = response.quote;
  if (quote.tradeType !== 'EXACT_OUTPUT' || BigInt(quote.output.amount) !== obligation.amount) {
    throw new CartRoutingCoreError('invalid_response', 'Uniswap did not quote the exact requested settlement output.', obligation.settlementCurrency);
  }
  const expectedInput = positiveInteger(quote.input.amount, 'quote.input.amount', obligation.settlementCurrency);
  const maximumInput = quote.input.maximumAmount === undefined
    ? applyCartQuoteSpread(expectedInput, BigInt(cartRoutingDefaultSlippageBps))
    : positiveInteger(quote.input.maximumAmount, 'quote.input.maximumAmount', obligation.settlementCurrency);
  if (maximumInput < expectedInput) {
    throw new CartRoutingCoreError('invalid_response', 'Uniswap maximum input is below its quoted input.', obligation.settlementCurrency);
  }
  return { expectedInput, maximumInput, description: quote.routeString ?? `${plan.paymentCurrency} -> ${obligation.settlementCurrency}` };
}

function validateExecutionQuote(
  plan: CartRoutingPlan,
  obligation: CartRoutingForeignObligation,
  response: UniswapQuoteResponse,
  protectedMaximum: bigint,
): ValidatedQuote {
  if (plan.mode === 'exact-output') return validateExactOutputQuote(plan, obligation, response);
  validateQuoteEnvelope(plan, obligation, response);
  const quote = response.quote;
  const exactInput = positiveInteger(quote.input.amount, 'quote.input.amount', obligation.settlementCurrency);
  const minimumOutput = positiveInteger(quote.output.minimumAmount, 'quote.output.minimumAmount', obligation.settlementCurrency);
  if (quote.tradeType !== 'EXACT_INPUT' || exactInput !== protectedMaximum || minimumOutput < obligation.amount) {
    throw new CartRoutingCoreError('invalid_response', 'Exact-input execution does not guarantee the requested settlement within the protected input.', obligation.settlementCurrency);
  }
  return {
    expectedInput: exactInput,
    maximumInput: exactInput,
    description: quote.routeString ?? `${plan.paymentCurrency} -> ${obligation.settlementCurrency}`,
  };
}

function validateQuoteEnvelope(
  plan: CartRoutingPlan,
  obligation: CartRoutingForeignObligation,
  response: UniswapQuoteResponse,
): void {
  const quote = response.quote;
  if (quote.chainId !== plan.chainId ||
    !isAddressEqual(quote.input.token, plan.paymentCurrency) ||
    !isAddressEqual(quote.output.token, obligation.settlementCurrency) ||
    !isAddressEqual(quote.swapper, plan.cart) ||
    !isAddressEqual(quote.output.recipient, plan.cart)) {
    throw new CartRoutingCoreError('invalid_response', 'Uniswap quote endpoints, recipient, or chain do not match the Cart request.', obligation.settlementCurrency);
  }
}

function decodeAndValidateRouterProgram(
  plan: CartRoutingPlan,
  universalRouter: Address,
  response: UniswapSwapResponse,
): { commands: Hex; inputs: Hex[]; routerValue: bigint } {
  const transaction = response.swap;
  if (transaction.chainId !== plan.chainId ||
    !isAddressEqual(transaction.from, plan.cart) ||
    !isAddressEqual(transaction.to, universalRouter)) {
    throw new CartRoutingCoreError('invalid_response', 'Compiled Universal Router transaction has the wrong chain or endpoints.');
  }
  let decoded: ReturnType<typeof decodeFunctionData<typeof universalRouterExecuteAbi>>;
  try {
    decoded = decodeFunctionData({ abi: universalRouterExecuteAbi, data: transaction.data });
  } catch (cause) {
    throw new CartRoutingCoreError('cart_incompatible_route', `Uniswap returned invalid Universal Router calldata: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const commands = decoded.args[0];
  const inputs = [...decoded.args[1]];
  if (size(commands) === 0 || size(commands) !== inputs.length) {
    throw new CartRoutingCoreError('cart_incompatible_route', 'Universal Router commands and inputs must be non-empty and have equal lengths.');
  }
  for (let index = 0; index < size(commands); index += 1) {
    const command = Number.parseInt(commands.slice(2 + index * 2, 4 + index * 2), 16);
    if (!allowedCartCommands.has(command)) {
      throw new CartRoutingCoreError('cart_incompatible_route', `Universal Router command 0x${command.toString(16).padStart(2, '0')} is not allowed by Cart.`);
    }
  }
  const routerValue = nonNegativeInteger(transaction.value, 'swap.value');
  return { commands, inputs, routerValue };
}

function positiveInteger(value: string | undefined, field: string, settlementCurrency?: Address): bigint {
  const parsed = nonNegativeInteger(value, field, settlementCurrency);
  if (parsed === 0n) throw new CartRoutingCoreError('invalid_response', `${field} must be a positive integer.`, settlementCurrency);
  return parsed;
}

function nonNegativeInteger(value: string | undefined, field: string, settlementCurrency?: Address): bigint {
  try {
    const parsed = BigInt(value ?? '');
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new CartRoutingCoreError('invalid_response', `${field} must be a non-negative integer.`, settlementCurrency);
  }
}

function requireSupportedCurrency(chain: SupportedChain, value: Address): Address {
  const currency = getAddress(value);
  const supported = [ETH_ADDRESS, getRareAddress(chain), getUsdcAddress(chain), getWrappedEthAddress(chain)]
    .filter((candidate): candidate is Address => candidate !== undefined)
    .map((candidate) => getAddress(candidate));
  const match = supported.find((candidate) => isAddressEqual(candidate, currency));
  if (!match) throw new CartRoutingCoreError('unsupported_currency', `Currency ${currency} is not supported for Cart routing.`);
  return match;
}
