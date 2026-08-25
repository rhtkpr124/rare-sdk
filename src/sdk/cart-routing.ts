import { getAddress, zeroAddress, type Address } from 'viem';
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
} from './cart-routing-core.js';
import { buildKnownPoolCartRoutingQuote } from './cart-routing-local.js';
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
  return {
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
