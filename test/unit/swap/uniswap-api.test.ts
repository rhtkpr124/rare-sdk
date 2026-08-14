/* eslint-disable no-restricted-syntax */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import { ETH_ADDRESS } from '../../../src/contracts/addresses.js';
import {
  requestUniswapApproval,
  requestUniswapQuote,
  requestUniswapSwap,
  type UniswapQuotePayload,
  type UniswapTransactionRequest,
} from '../../../src/swap/uniswap-api.js';

const tokenIn = ETH_ADDRESS;
const tokenOut = '0x197FaeF3f59eC80113e773Bb6206a17d183F97CB' satisfies Address;
const swapper = '0x1234567890123456789012345678901234567890' satisfies Address;
const baseUrl = 'https://uniswap.test/v1';

describe('Uniswap Trade API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('posts quote requests with required headers and parses rich quote payloads', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => Response.json(buildQuoteResponse()));
    vi.stubGlobal('fetch', fetchMock);

    const quote = await requestUniswapQuote({
      apiKey: 'test-key',
      baseUrl,
      chainId: 11_155_111,
      tokenIn,
      tokenOut,
      amount: 1_000_000_000_000_000n,
      swapper,
      slippageBps: 125,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = getFetchCall(fetchMock);
    expect(url).toBe(`${baseUrl}/quote`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': 'test-key',
      'x-permit2-disabled': 'true',
      'x-universal-router-version': '2.0',
    });
    expect(parseJsonBody(init)).toEqual({
      type: 'EXACT_INPUT',
      tokenInChainId: 11_155_111,
      tokenOutChainId: 11_155_111,
      amount: '1000000000000000',
      tokenIn,
      tokenOut,
      swapper,
      protocols: ['V4', 'V3', 'V2'],
      routingPreference: 'BEST_PRICE',
      urgency: 'normal',
      slippageTolerance: 1.25,
    });
    expect(quote.quote.output.amount).toBe('2000');
    expect(quote.quote.aggregatedOutputs?.[0]?.minAmount).toBe('1900');
  });

  it('requires an API key before sending requests', async () => {
    const fetchMock = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestUniswapQuote({
      baseUrl,
      chainId: 1,
      tokenIn,
      tokenOut,
      amount: 1n,
      swapper,
      slippageBps: 50,
    })).rejects.toThrow('A Uniswap API key is required to use the Uniswap route.');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the default base URL when process is unavailable', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => Response.json(buildQuoteResponse()));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('process', undefined);

    await requestUniswapQuote({
      apiKey: 'test-key',
      chainId: 11_155_111,
      tokenIn,
      tokenOut,
      amount: 1_000_000_000_000_000n,
      swapper,
      slippageBps: 125,
    });

    expect(getFetchCall(fetchMock).url).toBe('https://trade-api.gateway.uniswap.org/v1/quote');
  });

  it('surfaces non-OK API errors with response messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => Response.json(
      { message: 'route unavailable' },
      { status: 400, statusText: 'Bad Request' },
    )));

    await expect(requestUniswapQuote({
      apiKey: 'test-key',
      baseUrl,
      chainId: 1,
      tokenIn,
      tokenOut,
      amount: 1n,
      swapper,
      slippageBps: 50,
    })).rejects.toThrow('Uniswap API 400 Bad Request: route unavailable');
  });

  it('validates quote, approval, and swap response shapes before returning them', async () => {
    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => Response.json({
      ...buildQuoteResponse(),
      quote: {
        ...buildQuotePayload(),
        output: {
          amount: '2000',
          token: 'not-an-address',
          recipient: swapper,
        },
      },
    })));

    await expect(requestUniswapQuote({
      apiKey: 'test-key',
      baseUrl,
      chainId: 1,
      tokenIn,
      tokenOut,
      amount: 1n,
      swapper,
      slippageBps: 50,
    })).rejects.toThrow('response.quote.output.token');

    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => Response.json({
      requestId: 'approval-1',
      approval: {
        ...buildTransactionRequest(),
        data: 'not-hex',
      },
      cancel: null,
    })));

    await expect(requestUniswapApproval({
      apiKey: 'test-key',
      baseUrl,
      chainId: 1,
      walletAddress: swapper,
      token: tokenOut,
      amount: 1n,
      tokenOut: tokenIn,
    })).rejects.toThrow('response.approval.data');

    vi.stubGlobal('fetch', vi.fn(async (): Promise<Response> => Response.json({
      requestId: 'swap-1',
      swap: {
        ...buildTransactionRequest(),
        chainId: '1',
      },
    })));

    await expect(requestUniswapSwap({
      apiKey: 'test-key',
      baseUrl,
      quote: buildQuotePayload(),
    })).rejects.toThrow('response.swap.chainId');
  });

  it('posts approval and swap bodies to the expected endpoints', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = fetchInputUrl(input);
      if (url.endsWith('/check_approval')) {
        return Response.json({
          requestId: 'approval-1',
          approval: buildTransactionRequest(),
          cancel: null,
          gasFee: '100',
        });
      }
      return Response.json({
        requestId: 'swap-1',
        swap: buildTransactionRequest(),
        gasFee: '200',
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const approval = await requestUniswapApproval({
      apiKey: 'test-key',
      baseUrl,
      chainId: 11_155_111,
      walletAddress: swapper,
      token: tokenOut,
      amount: 123n,
      tokenOut: tokenIn,
    });
    const swap = await requestUniswapSwap({
      apiKey: 'test-key',
      baseUrl,
      quote: buildQuotePayload(),
      deadline: 1_800_000_000,
    });

    const approvalCall = getFetchCall(fetchMock, 0);
    expect(approvalCall.url).toBe(`${baseUrl}/check_approval`);
    expect(parseJsonBody(approvalCall.init)).toMatchObject({
      chainId: 11_155_111,
      walletAddress: swapper,
      token: tokenOut,
      amount: '123',
      tokenOut: tokenIn,
      tokenOutChainId: 11_155_111,
      includeGasInfo: true,
      urgency: 'normal',
    });

    const swapCall = getFetchCall(fetchMock, 1);
    expect(swapCall.url).toBe(`${baseUrl}/swap`);
    expect(parseJsonBody(swapCall.init)).toMatchObject({
      quote: buildQuotePayload(),
      refreshGasPrice: true,
      simulateTransaction: true,
      safetyMode: 'SAFE',
      urgency: 'normal',
      deadline: 1_800_000_000,
    });
    expect(approval.approval?.to).toBe(tokenOut);
    expect(swap.swap.to).toBe(tokenOut);
  });
});

function getFetchCall(
  fetchMock: ReturnType<typeof vi.fn>,
  index = 0,
): { url: string; init: RequestInit } {
  const call = fetchMock.mock.calls[index];
  if (call === undefined) {
    throw new Error(`Missing fetch call at index ${index}.`);
  }

  const [input, init] = call as [RequestInfo | URL, RequestInit | undefined];
  if (init === undefined) {
    throw new Error('Expected fetch init.');
  }
  const url = fetchInputUrl(input);
  return { url, init };
}

function fetchInputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function parseJsonBody(init: RequestInit): unknown {
  if (typeof init.body !== 'string') {
    throw new Error('Expected JSON string request body.');
  }
  return JSON.parse(init.body) as unknown;
}

function buildQuoteResponse(): {
  requestId: string;
  routing: string;
  quote: UniswapQuotePayload;
  permitData: null;
} {
  return {
    requestId: 'quote-1',
    routing: 'CLASSIC',
    quote: buildQuotePayload(),
    permitData: null,
  };
}

function buildQuotePayload(): UniswapQuotePayload {
  return {
    chainId: 11_155_111,
    input: {
      amount: '1000',
      token: tokenIn,
    },
    output: {
      amount: '2000',
      token: tokenOut,
      recipient: swapper,
    },
    swapper,
    route: [[{
      type: 'v4-pool',
      tokenIn: {
        chainId: 11_155_111,
        decimals: '18',
        address: tokenIn,
        symbol: 'ETH',
      },
      tokenOut: {
        chainId: 11_155_111,
        decimals: '18',
        address: tokenOut,
        symbol: 'RARE',
      },
      fee: '3000',
      tickSpacing: '60',
      hooks: tokenIn,
      amountIn: '1000',
      amountOut: '2000',
    }]],
    slippage: 1.25,
    tradeType: 'EXACT_INPUT',
    quoteId: 'quote-id',
    routeString: 'ETH -> RARE',
    aggregatedOutputs: [{
      amount: '2000',
      token: tokenOut,
      recipient: swapper,
      bps: 10_000,
      minAmount: '1900',
    }],
    txFailureReasons: ['SIMULATION_UNAVAILABLE'],
  };
}

function buildTransactionRequest(): UniswapTransactionRequest {
  return {
    to: tokenOut,
    from: swapper,
    data: '0x1234',
    value: '0',
    chainId: 11_155_111,
    gasLimit: '21000',
    maxFeePerGas: '100',
    maxPriorityFeePerGas: '1',
  };
}
