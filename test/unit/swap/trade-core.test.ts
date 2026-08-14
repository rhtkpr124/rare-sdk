import { test } from 'vitest';
import assert from 'node:assert/strict';
import { ETH_ADDRESS } from '../../../src/contracts/addresses.js';
import { inferBaseCurrencyAddress } from '../../../src/swap/pool-core.js';
import {
  assertRecipientSupportedForUniswapFallback,
  buildBuyRareQuoteFromTokenQuote,
  buildCanonicalEthTradeRoute,
  buildLiquidRouterTradeQuote,
  buildUniswapTradeQuote,
  computeMinAmountOut,
  computeSlippageBpsFromAmounts,
  getQuotedRecipientAmount,
  resolveSlippageBps,
} from '../../../src/swap/trade-core.js';

const rareAddress = '0xba5BDe662c17e2aDFF1075610382B9B691296350' as const;
const tokenAddress = '0xf100000000000000000000000000000000000001' as const;
const accountAddress = '0x1234567890123456789012345678901234567890' as const;
const otherAddress = '0x9999999999999999999999999999999999999999' as const;
const poolKey = {
  currency0: ETH_ADDRESS,
  currency1: rareAddress,
  fee: 3000,
  tickSpacing: 60,
  hooks: ETH_ADDRESS,
};

test('trade core computes slippage and minimum output', () => {
  assert.equal(resolveSlippageBps(undefined), 50);
  assert.equal(resolveSlippageBps('125'), 125);
  assert.throws(() => resolveSlippageBps('10000'), /between 0 and 9999/i);
  assert.throws(() => resolveSlippageBps(Number.MAX_SAFE_INTEGER + 1), /string or bigint/i);
  assert.equal(computeMinAmountOut(10_000n, 50), 9_950n);
  assert.equal(computeSlippageBpsFromAmounts(10_000n, 9_500n), 500);
});

test('buildCanonicalEthTradeRoute builds a pure route from a supplied pool key', () => {
  const route = buildCanonicalEthTradeRoute({
    chain: 'mainnet',
    token: rareAddress,
    direction: 'buy',
    poolKey,
    routeSource: 'known-pool',
  });

  assert.ok(route);
  assert.equal(route?.routeSource, 'known-pool');
  assert.equal(route?.tokenIn, ETH_ADDRESS);
  assert.equal(route?.tokenOut, rareAddress);
});

test('inferBaseCurrencyAddress returns the non-token side of a pool', () => {
  assert.equal(inferBaseCurrencyAddress(poolKey, rareAddress), ETH_ADDRESS);
  assert.equal(inferBaseCurrencyAddress(poolKey, tokenAddress), null);
});

test('buildLiquidRouterTradeQuote shapes local route quote details', () => {
  const route = buildCanonicalEthTradeRoute({
    chain: 'mainnet',
    token: rareAddress,
    direction: 'buy',
    poolKey,
    routeSource: 'known-pool',
  });
  if (!route) {
    throw new Error('Expected canonical ETH trade route.');
  }

  const quote = buildLiquidRouterTradeQuote({
    amountIn: 1_000n,
    route,
    routeQuote: { amountOut: 2_000n, minAmountOut: 1_900n, steps: route.steps },
    minAmountOut: 1_900n,
    inputDecimals: 18,
    outputDecimals: 18,
    defaultSlippageBps: 50,
    usedMinAmountOutOverride: true,
    commands: '0x10',
    inputs: ['0x1234'],
  });

  assert.equal(quote.execution, 'liquid-router');
  assert.equal(quote.slippageBps, 500);
  assert.equal(quote.commands, '0x10');
});

test('buildBuyRareQuoteFromTokenQuote requires liquid-router calldata', () => {
  const quote = buildBuyRareQuoteFromTokenQuote(rareAddress, {
    amountIn: 1_000n,
    estimatedAmountOut: 2_000n,
    minAmountOut: 1_900n,
    tokenIn: ETH_ADDRESS,
    tokenOut: rareAddress,
    inputDecimals: 18,
    outputDecimals: 18,
    slippageBps: 50,
    routeSource: 'known-pool',
    execution: 'liquid-router',
    routeDescription: 'ETH->RARE',
    commands: '0x10',
    inputs: ['0x1234'],
  });

  assert.equal(quote.rareAddress, rareAddress);
  assert.equal(quote.minRareOut, 1_900n);
});

test('Uniswap quote helpers select recipient output and enforce recipient limitation', () => {
  const quotePayload = {
    output: { amount: '1000' },
    routeString: 'CLASSIC route',
    aggregatedOutputs: [
      { amount: '900', minAmount: '850', recipient: otherAddress },
      { amount: '1200', minAmount: '1100', recipient: accountAddress },
    ],
  };

  assert.deepEqual(getQuotedRecipientAmount(quotePayload, accountAddress), {
    estimatedAmountOut: 1200n,
    minAmountOut: 1100n,
  });
  assert.throws(
    () => assertRecipientSupportedForUniswapFallback(otherAddress, accountAddress),
    /recipient override/i,
  );

  const quote = buildUniswapTradeQuote({
    amountIn: 500n,
    quote: quotePayload,
    recipient: accountAddress,
    tokenIn: ETH_ADDRESS,
    tokenOut: tokenAddress,
    inputDecimals: 18,
    outputDecimals: 18,
    routing: 'CLASSIC',
  });

  assert.equal(quote.execution, 'uniswap-api');
  assert.equal(quote.estimatedAmountOut, 1200n);
  assert.equal(quote.minAmountOut, 1100n);
  assert.equal(quote.routeDescription, 'CLASSIC route');
});

test('Uniswap quote helper rejects aggregated outputs without the requested recipient', () => {
  const quotePayload = {
    output: { amount: '1000' },
    aggregatedOutputs: [
      { amount: '900', minAmount: '850', recipient: otherAddress },
    ],
  };

  assert.throws(
    () => getQuotedRecipientAmount(quotePayload, accountAddress),
    /requested recipient/i,
  );
});

test('Uniswap quote helper applies top-level slippage when aggregated outputs are omitted', () => {
  assert.deepEqual(getQuotedRecipientAmount({
    output: { amount: '10000' },
    slippage: 1.25,
  }, accountAddress), {
    estimatedAmountOut: 10000n,
    minAmountOut: 9875n,
  });
});
