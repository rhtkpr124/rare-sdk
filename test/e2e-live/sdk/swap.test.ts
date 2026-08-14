import { describe, expect, it, type TestContext } from 'vitest';
import { isHex, parseEther, parseUnits } from 'viem';
import { ETH_ADDRESS, resolveCurrency } from '../../../src/contracts/addresses.js';
import { createRareClient } from '../../../src/sdk/client.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeLive = hasTestRpcUrl() ? describe : describe.skip;
const rareAddress = resolveCurrency('rare', 'sepolia');

describeLive('Swap SDK live integration', () => {
  it('quotes the canonical RARE buy route with the live V4 quoter', async () => {
    const rare = createRareClient({ publicClient: createTestSepoliaPublicClient() });

    const quote = await rare.swap.quoteBuyRare({
      amountIn: '0.001',
      slippageBps: 100,
    });

    expect(quote.ethAmount).toBe(parseEther('0.001'));
    expect(quote.rareAddress).toBe(rareAddress);
    expect(quote.estimatedRareOut).toBeGreaterThan(0n);
    expect(quote.minRareOut).toBeGreaterThan(0n);
    expect(quote.minRareOut).toBeLessThanOrEqual(quote.estimatedRareOut);
    expect(isHex(quote.commands)).toBe(true);
    expect(quote.inputs.length).toBeGreaterThan(0);
  }, 30_000);

  it('quotes canonical RARE token buy and sell routes through the SDK', async () => {
    const rare = createRareClient({ publicClient: createTestSepoliaPublicClient() });

    const buy = await rare.swap.quoteBuyToken({
      token: rareAddress,
      amountIn: '0.001',
      slippageBps: 100,
    });
    const sell = await rare.swap.quoteSellToken({
      token: rareAddress,
      amountIn: '1',
      slippageBps: 100,
    });

    expect(buy).toMatchObject({
      amountIn: parseEther('0.001'),
      tokenIn: ETH_ADDRESS,
      tokenOut: rareAddress,
      routeSource: 'known-pool',
      execution: 'liquid-router',
    });
    expect(buy.estimatedAmountOut).toBeGreaterThan(0n);
    expect(buy.minAmountOut).toBeLessThanOrEqual(buy.estimatedAmountOut);

    expect(sell).toMatchObject({
      amountIn: parseUnits('1', 18),
      tokenIn: rareAddress,
      tokenOut: ETH_ADDRESS,
      routeSource: 'known-pool',
      execution: 'liquid-router',
    });
    expect(sell.estimatedAmountOut).toBeGreaterThan(0n);
    expect(sell.minAmountOut).toBeLessThanOrEqual(sell.estimatedAmountOut);
  }, 30_000);

  it('quotes a forced Uniswap API route with an explicit API key from test env', async (ctx) => {
    const uniswapApiKey = process.env.UNISWAP_API_KEY;
    if (!uniswapApiKey) {
      ctx.skip('UNISWAP_API_KEY is not configured for Uniswap API integration coverage.');
    }
    const rare = createRareClient({
      publicClient: createTestSepoliaPublicClient(),
      account: '0x1234567890123456789012345678901234567890',
      uniswapApiKey,
    });

    const quote = await quoteUniswapOrSkip(ctx, () => rare.swap.quoteBuyToken({
      token: rareAddress,
      amountIn: '0.001',
      slippageBps: 100,
      route: 'uniswap',
    }));

    expect(quote).toMatchObject({
      tokenIn: ETH_ADDRESS,
      tokenOut: rareAddress,
      routeSource: 'uniswap-api',
      execution: 'uniswap-api',
    });
    expect(quote.estimatedAmountOut).toBeGreaterThan(0n);
    expect(quote.minAmountOut).toBeGreaterThan(0n);
  }, 30_000);
});

async function quoteUniswapOrSkip<T>(ctx: TestContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('A Uniswap API key is required')) {
      throw error;
    }
    if (message.includes('Uniswap API')) {
      ctx.skip(`Uniswap API route unavailable: ${message}`);
    }
    throw error;
  }
}
