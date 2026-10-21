import { getAddress, isAddressEqual, zeroAddress, type Address } from 'viem';
import { cartAbi } from '../contracts/abis/cart.js';
import type { SupportedChain } from '../contracts/addresses.js';
import { requestUniswapQuote, requestUniswapSwap, UniswapApiError } from '../swap/uniswap-api.js';
import {
  assertCartRoutingQuoteFresh,
  buildCartRoutingQuoteResult,
  CartRoutingCoreError,
  cartRoutingDefaultSlippageBps,
  planCartRoutingQuote,
  protectCartRoutingExactInput,
  resolveCartRoutingMaximumInput,
  protectCartInputQuoteOutput,
} from './cart-routing-core.js';
import { buildKnownPoolCartRoutingQuote, quoteKnownPoolCartInput } from './cart-routing-local.js';
import type { RareClientConfig } from './types/client.js';
import type {
  CartRoutingErrorCode,
  CartRoutingErrorDetails,
  CartRoutingNamespace,
  CartRoutingQuoteParams,
} from './types/cart-routing.js';

export type * from './types/cart-routing.js';

export class CartRoutingError extends Error {
  readonly code: CartRoutingErrorCode;
  readonly details?: CartRoutingErrorDetails;

  constructor(code: CartRoutingErrorCode, message: string, details?: CartRoutingErrorDetails, options?: ErrorOptions) {
    super(message, options);
    this.name = 'CartRoutingError';
    this.code = code;
    this.details = details;
  }
}

export function createCartRoutingNamespace(
  config: RareClientConfig,
  chain: SupportedChain,
  cart: Address | undefined,
): CartRoutingNamespace {
  const namespace: CartRoutingNamespace = {
    async quoteInput(params) {
      if (cart === undefined) throw new CartRoutingError('unsupported_chain', `Cart routing is not configured on ${chain}.`);
      if (params.inputAmount <= 0n) throw new CartRoutingError('invalid_response', 'Swap input budget must be positive.');
      if (params.outputCurrency === zeroAddress || isAddressEqual(params.paymentCurrency, params.outputCurrency)) throw new CartRoutingError('unsupported_pair', 'Swap output must be a different ERC20 currency.');
      const plan = createPlan(chain, cart, { paymentCurrency: params.paymentCurrency, obligations: [{ settlementCurrency: params.outputCurrency, amount: 1n }] });
      const apiKey = config.uniswapApiKey ?? await config.resolveUniswapApiKey?.();
      const estimate = async () => {
        if (!apiKey) return quoteKnownPoolCartInput(config.publicClient, plan, params.outputCurrency, params.inputAmount);
        try {
          const response = await requestUniswapQuote({ apiKey, chainId: plan.chainId, tokenIn: plan.paymentCurrency,
            tokenOut: params.outputCurrency, amount: params.inputAmount, swapper: cart,
            slippageBps: cartRoutingDefaultSlippageBps, tradeType: 'EXACT_INPUT', permit2Disabled: false });
          if (response.quote.tradeType !== 'EXACT_INPUT' || !isAddressEqual(response.quote.input.token, plan.paymentCurrency) ||
            !isAddressEqual(response.quote.output.token, params.outputCurrency) || BigInt(response.quote.input.amount) !== params.inputAmount) {
            throw new CartRoutingCoreError('invalid_response', 'Input quote does not match the requested currencies and budget.');
          }
          return BigInt(response.quote.output.amount);
        } catch (cause) {
          if (!(cause instanceof UniswapApiError)) throw cause;
          return quoteKnownPoolCartInput(config.publicClient, plan, params.outputCurrency, params.inputAmount);
        }
      };
      try {
        const quotedOutput = await estimate();
        if (quotedOutput === null) throw new CartRoutingCoreError('no_route', 'No configured route supports this input quote.');
        const outputAmount = protectCartInputQuoteOutput(quotedOutput);
        const fixedQuote = await namespace.quote({ paymentCurrency: params.paymentCurrency,
          obligations: [{ settlementCurrency: params.outputCurrency, amount: outputAmount }], mode: 'exact-output' });
        if (BigInt(fixedQuote.maximumPaymentInput) > params.inputAmount) throw new CartRoutingCoreError('quote_unavailable', 'Routing cannot honor this fixed output within the input budget. Please request a fresh quote.');
        return { inputAmount: params.inputAmount, outputAmount, quotedAt: fixedQuote.quotedAt, expiresAt: fixedQuote.expiresAt };
      } catch (cause) { throw toCartRoutingError(cause, params.paymentCurrency); }
    },
    assertFresh(quote, nowMs) {
      try {
        return assertCartRoutingQuoteFresh(quote, nowMs);
      } catch (cause) {
        throw toCartRoutingError(cause, quote.paymentCurrency);
      }
    },
    async quote(params: CartRoutingQuoteParams) {
      if (cart === undefined) {
        throw new CartRoutingError('unsupported_chain', `Cart routing is not configured on ${chain}.`);
      }
      const plan = createPlan(chain, cart, params);
      if (plan.foreignObligations.length === 0) {
        return buildCartRoutingQuoteResult(plan, zeroAddress, [], Date.now());
      }

      const apiKey = config.uniswapApiKey ?? await config.resolveUniswapApiKey?.();
      if (!apiKey) {
        try {
          const local = await buildKnownPoolCartRoutingQuote(config.publicClient, plan);
          if (local !== null) return local;
        } catch (cause) {
          throw toCartRoutingError(cause, plan.paymentCurrency);
        }
        throw new CartRoutingError('quote_unavailable', 'No configured Cart routing source supports these currencies.',
          { paymentCurrency: plan.paymentCurrency });
      }
      try {
        const universalRouter = getAddress(await config.publicClient.readContract({
          address: plan.cart,
          abi: cartAbi,
          functionName: 'universalRouter',
        }));
        const quoted = await Promise.all(plan.foreignObligations.map(async (obligation) => {
          const exactOutputResponse = await requestUniswapQuote({
            apiKey,
            chainId: plan.chainId,
            tokenIn: plan.paymentCurrency,
            tokenOut: obligation.settlementCurrency,
            amount: obligation.amount,
            swapper: plan.cart,
            slippageBps: cartRoutingDefaultSlippageBps,
            tradeType: 'EXACT_OUTPUT',
            permit2Disabled: false,
          });
          const maximumInput = resolveCartRoutingMaximumInput(plan, obligation, exactOutputResponse);
          const executionResponse = plan.mode === 'exact-output'
            ? exactOutputResponse
            : await requestUniswapQuote({
                apiKey,
                chainId: plan.chainId,
                tokenIn: plan.paymentCurrency,
                tokenOut: obligation.settlementCurrency,
                amount: protectCartRoutingExactInput(maximumInput),
                swapper: plan.cart,
                slippageBps: cartRoutingDefaultSlippageBps,
                tradeType: 'EXACT_INPUT',
                permit2Disabled: false,
              });
          const swapResponse = await requestUniswapSwap({
            apiKey,
            quote: executionResponse.quote,
            deadline: Math.floor(Date.now() / 1_000) + 60,
            permit2Disabled: false,
            simulateTransaction: false,
          });
          return { ...obligation, exactOutputResponse, executionResponse, swapResponse };
        }));
        return buildCartRoutingQuoteResult(plan, universalRouter, quoted, Date.now());
      } catch (cause) {
        if (cause instanceof UniswapApiError) {
          try {
            const local = await buildKnownPoolCartRoutingQuote(config.publicClient, plan);
            if (local !== null) return local;
          } catch (fallbackCause) {
            throw toCartRoutingError(fallbackCause, plan.paymentCurrency);
          }
        }
        throw toCartRoutingError(cause, plan.paymentCurrency);
      }
    },
  };
  return namespace;
}

function createPlan(chain: SupportedChain, cart: Address, params: CartRoutingQuoteParams) {
  try {
    return planCartRoutingQuote(chain, cart, params);
  } catch (cause) {
    throw toCartRoutingError(cause, params.paymentCurrency);
  }
}

function toCartRoutingError(cause: unknown, paymentCurrency?: Address): CartRoutingError {
  if (cause instanceof CartRoutingError) return cause;
  if (cause instanceof CartRoutingCoreError) {
    return new CartRoutingError(cause.code, cause.message, {
      ...(paymentCurrency === undefined ? {} : { paymentCurrency }),
      ...(cause.settlementCurrency === undefined ? {} : { settlementCurrency: cause.settlementCurrency }),
    }, { cause });
  }
  if (cause instanceof UniswapApiError) {
    const code = classifyProviderFailure(cause.status, cause.reason);
    return new CartRoutingError(code, safeRoutingMessage(code), {
      ...(paymentCurrency === undefined ? {} : { paymentCurrency }),
      providerStatus: cause.status,
      ...(cause.requestId === undefined ? {} : { providerRequestId: cause.requestId }),
      ...(cause.reason === undefined ? {} : { reason: cause.reason }),
    }, { cause });
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  const statusMatch = /Uniswap API (\d{3})/.exec(message);
  const providerStatus = statusMatch === null ? undefined : Number(statusMatch[1]);
  const lower = message.toLowerCase();
  const code: CartRoutingErrorCode = providerStatus === 404 || lower.includes('no quote') || lower.includes('no route')
    ? 'no_route'
    : lower.includes('liquidity')
      ? 'insufficient_liquidity'
      : lower.includes('response field') || lower.includes('invalid')
        ? 'invalid_response'
        : 'quote_unavailable';
  return new CartRoutingError(code, safeRoutingMessage(code), {
    ...(paymentCurrency === undefined ? {} : { paymentCurrency }),
    ...(providerStatus === undefined ? {} : { providerStatus }),
  }, { cause });
}

function classifyProviderFailure(status: number, reason?: string): CartRoutingErrorCode {
  const lower = reason?.toLowerCase() ?? '';
  if (status === 404 || lower.includes('no quote') || lower.includes('no route')) return 'no_route';
  if (lower.includes('liquidity')) return 'insufficient_liquidity';
  if (status >= 400 && status < 500) return 'invalid_response';
  return 'quote_unavailable';
}

function safeRoutingMessage(code: CartRoutingErrorCode): string {
  switch (code) {
    case 'no_route': return 'No Cart-compatible route is currently available.';
    case 'insufficient_liquidity': return 'The requested Cart settlement has insufficient liquidity.';
    case 'invalid_response': return 'The routing provider returned an invalid response.';
    default: return 'A Cart routing quote is currently unavailable.';
  }
}
