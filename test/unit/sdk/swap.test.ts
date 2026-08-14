/* eslint-disable no-restricted-syntax */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicClient, createWalletClient, custom } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { resolveCurrency, viemChains } from '../../../src/contracts/addresses.js';
import { createRareClient } from '../../../src/sdk/client.js';
import { createSwapNamespace, type BuyTokenParams, type SellTokenParams } from '../../../src/sdk/swap.js';
import { PaymentApprovalRequiredError } from '../../../src/sdk/helpers.js';

const accountAddress = '0x1234567890123456789012345678901234567890' as const;
const rareAddress = resolveCurrency('rare', 'sepolia');
const baseRareAddress = resolveCurrency('rare', 'base');
const swapAccount = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
);
const buyTokenAutoApproveParams = {
  token: rareAddress,
  amountIn: '1',
  autoApprove: false,
} satisfies BuyTokenParams;
const sellTokenAutoApproveParams = {
  token: rareAddress,
  amountIn: '1',
  autoApprove: false,
} satisfies SellTokenParams;

void buyTokenAutoApproveParams;
void sellTokenAutoApproveParams;

describe('Swap SDK fallback handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('surfaces canonical local quote failures instead of falling back to Uniswap', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new Error('unexpected Uniswap fallback');
    });
    vi.stubGlobal('fetch', fetchMock);

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: custom({
        async request({ method }) {
          if (method === 'eth_call') {
            throw new Error('bad local quoter');
          }

          throw new Error(`unexpected RPC method: ${method}`);
        },
      }),
    });
    const rare = createRareClient({
      publicClient,
      account: accountAddress,
    });

    await expect(rare.swap.quoteBuyToken({
      token: rareAddress,
      amountIn: '0.001',
    })).rejects.toThrow('bad local quoter');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-positive Uniswap API deadlines before quoting', async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => {
      throw new Error('unexpected Uniswap API request');
    });
    const request = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected RPC request');
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = custom({ request });
    const publicClient = createPublicClient({ chain: sepolia, transport });
    const walletClient = createWalletClient({ account: swapAccount, chain: sepolia, transport });
    const rare = createRareClient({ publicClient, walletClient, uniswapApiKey: 'test-key' });

    await expect(rare.swap.buyToken({
      token: rareAddress,
      amountIn: '0.001',
      route: 'uniswap',
      deadline: 0,
    })).rejects.toThrow('deadline must be greater than 0.');

    await expect(rare.swap.sellToken({
      token: rareAddress,
      amountIn: '1',
      route: 'uniswap',
      deadline: '-1',
    })).rejects.toThrow('deadline must be greater than 0.');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('requires an explicit configured Uniswap API key for forced hosted routes', async () => {
    const fetchMock = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected Uniswap API request');
    });
    const request = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected RPC request');
    });
    vi.stubGlobal('fetch', fetchMock);

    const publicClient = createPublicClient({ chain: sepolia, transport: custom({ request }) });
    const rare = createRareClient({ publicClient, account: accountAddress });

    await expect(rare.swap.quoteBuyToken({
      token: rareAddress,
      amountIn: '0.001',
      route: 'uniswap',
    })).rejects.toThrow('A Uniswap API key is required to use the Uniswap route.');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it('passes the configured Uniswap API key to hosted route requests', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('stop after headers');
    });
    vi.stubGlobal('fetch', fetchMock);

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: custom({
        async request(): Promise<never> {
          throw new Error('unexpected RPC request');
        },
      }),
    });
    const rare = createRareClient({ publicClient, account: accountAddress, uniswapApiKey: 'configured-key' });

    await expect(rare.swap.quoteBuyToken({
      token: rareAddress,
      amountIn: '0.001',
      route: 'uniswap',
    })).rejects.toThrow('stop after headers');

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-api-key': 'configured-key',
    });
  });

  it('falls back to Uniswap for known tokens when auto routing has no configured local pool', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error('reached Uniswap fallback');
    });
    vi.stubGlobal('fetch', fetchMock);

    const request = vi.fn(async ({ method }: { method: string }): Promise<`0x${string}`> => {
      if (method === 'eth_call') {
        return '0x';
      }
      throw new Error(`unexpected RPC method: ${method}`);
    });
    const publicClient = createPublicClient({ chain: viemChains.base, transport: custom({ request }) });
    const rare = createRareClient({ publicClient, account: accountAddress, uniswapApiKey: 'configured-key' });

    await expect(rare.swap.quoteBuyToken({
      token: baseRareAddress,
      amountIn: '0.001',
      route: 'auto',
    })).rejects.toThrow('reached Uniswap fallback');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      'x-api-key': 'configured-key',
    });
  });

  it('rejects malformed raw router calldata before allowance side effects', async () => {
    const request = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected RPC request');
    });
    const transport = custom({ request });
    const publicClient = createPublicClient({ chain: sepolia, transport });
    const writeContract = vi.fn(async (): Promise<`0x${string}`> => {
      throw new Error('unexpected wallet write');
    });
    const walletClient = createWalletClient({ account: swapAccount, chain: sepolia, transport }).extend(() => ({
      writeContract,
    }));
    const rare = createRareClient({ publicClient, walletClient });

    await expect(rare.swap.sellToken({
      token: rareAddress,
      amountIn: '1',
      minAmountOut: '0.1',
      route: 'raw',
      commands: '0xzz',
      inputs: ['0x12'],
    })).rejects.toThrow('Router commands must be an even-length hex string.');

    expect(request).not.toHaveBeenCalled();
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('honors autoApprove false for raw token sells before writing approvals', async () => {
    const writeContract = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected approval write');
    });
    const waitForTransactionReceipt = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected receipt wait');
    });
    const namespace = createSwapNamespace(
      {
        publicClient: {
          async readContract(params: { functionName: string }) {
            if (params.functionName === 'decimals') return 18;
            if (params.functionName === 'allowance') return 0n;
            throw new Error(`unexpected readContract: ${params.functionName}`);
          },
          waitForTransactionReceipt,
        } as never,
        account: accountAddress,
        walletClient: {
          account: { address: accountAddress },
          writeContract,
        } as never,
      },
      'sepolia',
      11_155_111,
      { swapRouter: '0x2222222222222222222222222222222222222222' },
    );

    await expect(namespace.sellToken({
      route: 'raw',
      token: rareAddress,
      amountIn: '1',
      minAmountOut: '0.1',
      commands: '0x00',
      inputs: ['0x00'],
      autoApprove: false,
    })).rejects.toBeInstanceOf(PaymentApprovalRequiredError);
    expect(writeContract).not.toHaveBeenCalled();
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
  });
});
