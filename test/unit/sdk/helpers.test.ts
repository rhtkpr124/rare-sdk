import { describe, expect, it, vi } from 'vitest';
import { createPublicClient, createWalletClient, custom, http, type Hash, type PublicClient, type TransactionReceipt, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import {
  approveNftContractIfNeeded,
  ensureTokenAllowance,
  getKnownCurrencyDecimals,
  NftApprovalRequiredError,
  PaymentApprovalRequiredError,
  preparePaymentAmountForSpender,
  requireWallet,
  resolveCurrencyDecimals,
  resolveChainFromPublicClient,
  resolveDeadline,
  sendPreparedTransaction,
  toCurrencyAmount,
  toInteger,
  toNonNegativeInteger,
  toNonNegativeWei,
  toPositiveInteger,
  toPositiveWei,
  toSafeIntegerNumber,
  toUnixTimestamp,
  toWei,
} from '../../../src/sdk/helpers.js';
import { resolveCurrency } from '../../../src/contracts/addresses.js';
import type { UniswapTransactionRequest } from '../../../src/swap/uniswap-api.js';

const sellerAccount = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
);
const sellerAddress = sellerAccount.address;
const buyerAddress = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000002',
).address;

describe('SDK helper normalization', () => {
  it('normalizes integer inputs to bigint', () => {
    expect(toInteger(12n, 'tokenId')).toBe(12n);
    expect(toInteger(12, 'tokenId')).toBe(12n);
    expect(toInteger('12', 'tokenId')).toBe(12n);
  });

  it('rejects invalid integer inputs', () => {
    expect(() => toInteger(1.2, 'tokenId')).toThrow('tokenId must be an integer.');
    expect(() => toInteger(Number.POSITIVE_INFINITY, 'tokenId')).toThrow('tokenId must be an integer.');
    expect(() => toInteger('abc', 'tokenId')).toThrow('tokenId must be an integer.');
    expect(() => toInteger('', 'tokenId')).toThrow('tokenId must be an integer.');
    expect(() => toInteger('   ', 'tokenId')).toThrow('tokenId must be an integer.');
  });

  it('rejects unsafe numeric integers', () => {
    expect(toInteger(Number.MAX_SAFE_INTEGER, 'tokenId')).toBe(9_007_199_254_740_991n);
    expect(toInteger('9007199254740993', 'tokenId')).toBe(9_007_199_254_740_993n);
    expect(() => toInteger(Number.MAX_SAFE_INTEGER + 1, 'tokenId')).toThrow('string or bigint');
  });

  it('rejects integer strings that cannot round-trip through number', () => {
    expect(toSafeIntegerNumber('1714500000', 'deadline')).toBe(1_714_500_000);
    expect(() => toSafeIntegerNumber('9007199254740993', 'deadline')).toThrow('safe JavaScript integer');
  });

  it('rejects negative uint inputs before contract writes', () => {
    expect(toNonNegativeInteger(0, 'tokenId')).toBe(0n);
    expect(() => toNonNegativeInteger('-1', 'tokenId')).toThrow(
      'tokenId must be greater than or equal to 0.',
    );
  });

  it('rejects non-positive integer inputs where zero is unsafe', () => {
    expect(toPositiveInteger('1', 'duration')).toBe(1n);
    expect(() => toPositiveInteger(0, 'duration')).toThrow('duration must be greater than 0.');
    expect(() => toPositiveInteger(-1, 'duration')).toThrow('duration must be greater than 0.');
  });

  it('rejects non-positive explicit deadlines', () => {
    expect(resolveDeadline('1')).toBe(1n);
    expect(() => resolveDeadline(0)).toThrow('deadline must be greater than 0.');
    expect(() => resolveDeadline('-1')).toThrow('deadline must be greater than 0.');
  });

  it('normalizes unix timestamp and ISO date inputs', () => {
    expect(toUnixTimestamp('1778500000', 'startTime')).toBe(1_778_500_000n);
    expect(toUnixTimestamp('2026-05-18T12:30:45Z', 'startTime')).toBe(1_779_107_445n);
    expect(toUnixTimestamp('2026-05-18T12:30:45', 'startTime')).toBe(1_779_107_445n);
    expect(toUnixTimestamp('2026-05-18T08:30:45-04:00', 'startTime')).toBe(1_779_107_445n);
  });

  it('rejects signed and malformed timestamp strings through integer validation', () => {
    expect(() => toUnixTimestamp('-1', 'startTime')).toThrow('startTime must be greater than 0.');
    expect(() => toUnixTimestamp('2026-05-18Tbad', 'startTime')).toThrow('startTime must be an integer.');
  });

  it('normalizes amount inputs to wei', () => {
    expect(toWei(5n)).toBe(5n);
    expect(toWei('1')).toBe(1_000_000_000_000_000_000n);
    expect(toWei(0.5)).toBe(500_000_000_000_000_000n);
  });

  it('rejects unsafe numeric amounts', () => {
    expect(toWei('1.000000000000000001')).toBe(1_000_000_000_000_000_001n);
    expect(toWei(0.1)).toBe(100_000_000_000_000_000n);
    expect(() => toWei(Number.MAX_SAFE_INTEGER + 1)).toThrow('string or bigint');
  });

  it('allows zero money amounts when zero is a meaningful contract value', () => {
    expect(toNonNegativeWei('0', 'price')).toBe(0n);
    expect(toNonNegativeWei('1', 'price')).toBe(1_000_000_000_000_000_000n);
    expect(() => toNonNegativeWei('-0.1', 'price')).toThrow(
      'price must be greater than or equal to 0.',
    );
  });

  it('rejects non-positive money amounts before payment writes', () => {
    expect(toPositiveWei('1', 'amount')).toBe(1_000_000_000_000_000_000n);
    expect(() => toPositiveWei('0', 'amount')).toThrow('amount must be greater than 0.');
    expect(() => toPositiveWei('-0.1', 'amount')).toThrow('amount must be greater than 0.');
  });
});

describe('payment approval planning', () => {
  const approvalTxHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

  it('does not approve when ERC20 allowance reads fail', async () => {
    const currency = '0x9999999999999999999999999999999999999999';
    const spender = '0x8888888888888888888888888888888888888888';
    const writeContract = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected approval write');
    });
    const waitForTransactionReceipt = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected approval receipt wait');
    });
    const readError = new Error('allowance RPC failed');
    const payment = preparePaymentAmountForSpender({
      publicClient: {
        async readContract(params: { functionName: string }): Promise<never> {
          expect(params.functionName).toBe('allowance');
          throw readError;
        },
        waitForTransactionReceipt,
      },
      walletClient: {
        writeContract,
      },
      account: sellerAddress,
      accountAddress: sellerAddress,
      spenderAddress: spender,
      currency,
      requiredAmount: 5n,
    });

    await expect(payment).rejects.toBe(readError);
    expect(writeContract).not.toHaveBeenCalled();
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it('returns a typed approval-required error before writing when auto approval is disabled', async () => {
    const currency = '0x9999999999999999999999999999999999999999';
    const spender = '0x8888888888888888888888888888888888888888';
    const payment = preparePaymentAmountForSpender({
      publicClient: {
        async readContract(params: { functionName: string }): Promise<bigint> {
          expect(params.functionName).toBe('allowance');
          return 4n;
        },
        async waitForTransactionReceipt(): Promise<never> {
          throw new Error('unexpected approval receipt wait');
        },
      },
      walletClient: {
        async writeContract(): Promise<never> {
          throw new Error('unexpected approval write');
        },
      },
      account: sellerAddress,
      accountAddress: sellerAddress,
      spenderAddress: spender,
      currency,
      requiredAmount: 5n,
      autoApprove: false,
    });

    await expect(payment).rejects.toBeInstanceOf(PaymentApprovalRequiredError);
    await expect(payment).rejects.toMatchObject({
      requiredAmount: 5n,
      spenderAddress: spender,
    });
  });

  it('rejects a reverted ERC20 approval receipt before returning the approval hash', async () => {
    const currency = '0x9999999999999999999999999999999999999999';
    const spender = '0x8888888888888888888888888888888888888888';
    const payment = preparePaymentAmountForSpender({
      // eslint-disable-next-line no-restricted-syntax
      publicClient: {
        async readContract(params: { functionName: string }): Promise<bigint> {
          expect(params.functionName).toBe('allowance');
          return 4n;
        },
        async waitForTransactionReceipt() {
          return { status: 'reverted' };
        },
      } as never,
      walletClient: {
        async writeContract(): Promise<Hash> {
          return approvalTxHash;
        },
      },
      account: sellerAddress,
      accountAddress: sellerAddress,
      spenderAddress: spender,
      currency,
      requiredAmount: 5n,
    });

    await expect(payment).rejects.toThrow(`ERC20 approval transaction ${approvalTxHash} did not succeed.`);
  });

  it('times out when ERC20 allowance never propagates after a mined approval', async () => {
    vi.useFakeTimers();
    const currency = '0x9999999999999999999999999999999999999999';
    const spender = '0x8888888888888888888888888888888888888888';
    try {
      const payment = preparePaymentAmountForSpender({
        publicClient: {
          async readContract(params: { functionName: string }): Promise<bigint> {
            expect(params.functionName).toBe('allowance');
            return 4n;
          },
          async waitForTransactionReceipt() {
            return mockTransactionReceipt();
          },
        },
        walletClient: {
          async writeContract(): Promise<Hash> {
            return approvalTxHash;
          },
        },
        account: sellerAddress,
        accountAddress: sellerAddress,
        spenderAddress: spender,
        currency,
        requiredAmount: 5n,
      });

      const assertion = expect(payment).rejects.toThrow(
        `ERC20 approval transaction ${approvalTxHash} was mined but allowance for spender ${spender}`,
      );
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('polls stale ERC20 allowance reads before returning approval details', async () => {
    vi.useFakeTimers();
    const currency = '0x9999999999999999999999999999999999999999';
    const spender = '0x8888888888888888888888888888888888888888';
    let allowanceReads = 0;
    try {
      const paymentPromise = preparePaymentAmountForSpender({
        publicClient: {
          async readContract(params: { functionName: string }): Promise<bigint> {
            expect(params.functionName).toBe('allowance');
            allowanceReads += 1;
            return allowanceReads < 3 ? 4n : 5n;
          },
          async waitForTransactionReceipt() {
            return mockTransactionReceipt();
          },
        },
        walletClient: {
          async writeContract(): Promise<Hash> {
            return approvalTxHash;
          },
        },
        account: sellerAddress,
        accountAddress: sellerAddress,
        spenderAddress: spender,
        currency,
        requiredAmount: 5n,
      });
      await vi.advanceTimersByTimeAsync(500);
      const payment = await paymentPromise;

      expect(allowanceReads).toBe(3);
      expect(payment).toMatchObject({
        value: 0n,
        requiredAmount: 5n,
        approvalTxHash,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not approve token allowance when the allowance read fails', async () => {
    const token = '0x9999999999999999999999999999999999999999';
    const spender = '0x8888888888888888888888888888888888888888';
    const writeContract = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected approval write');
    });
    const waitForTransactionReceipt = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected approval receipt wait');
    });
    const readError = new Error('allowance RPC failed');

    await expect(ensureTokenAllowance(
      // eslint-disable-next-line no-restricted-syntax
      {
        async readContract(params: { functionName: string }): Promise<never> {
          expect(params.functionName).toBe('allowance');
          throw readError;
        },
        waitForTransactionReceipt,
      } as never,
      // eslint-disable-next-line no-restricted-syntax
      {
        writeContract,
      } as never,
      sellerAccount,
      sellerAddress,
      token,
      spender,
      5n,
    )).rejects.toBe(readError);

    expect(writeContract).not.toHaveBeenCalled();
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
  });

  it('returns a typed ERC20 approval-required error before writing when auto approval is disabled', async () => {
    const token = '0x9999999999999999999999999999999999999999';
    const spender = '0x8888888888888888888888888888888888888888';
    const writeContract = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected approval write');
    });
    const waitForTransactionReceipt = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected approval receipt wait');
    });

    await expect(ensureTokenAllowance(
      // eslint-disable-next-line no-restricted-syntax
      {
        async readContract(params: { functionName: string }): Promise<bigint> {
          expect(params.functionName).toBe('allowance');
          return 4n;
        },
        waitForTransactionReceipt,
      } as never,
      // eslint-disable-next-line no-restricted-syntax
      {
        writeContract,
      } as never,
      sellerAccount,
      sellerAddress,
      token,
      spender,
      5n,
      false,
    )).rejects.toBeInstanceOf(PaymentApprovalRequiredError);

    expect(writeContract).not.toHaveBeenCalled();
    expect(waitForTransactionReceipt).not.toHaveBeenCalled();
  });
});

describe('NFT approval planning', () => {
  it('returns a typed approval-required error before writing when auto approval is disabled', async () => {
    const nftAddress = '0x7777777777777777777777777777777777777777';
    const operator = '0x8888888888888888888888888888888888888888';
    const approval = approveNftContractIfNeeded({
      publicClient: {
        async readContract(params: { functionName: string }): Promise<boolean> {
          expect(params.functionName).toBe('isApprovedForAll');
          return false;
        },
        async waitForTransactionReceipt(): Promise<never> {
          throw new Error('unexpected approval receipt wait');
        },
      },
      walletClient: {
        async writeContract(): Promise<never> {
          throw new Error('unexpected approval write');
        },
      },
      account: sellerAddress,
      accountAddress: sellerAddress,
      nftAddress,
      operator,
      autoApprove: false,
    });

    await expect(approval).rejects.toBeInstanceOf(NftApprovalRequiredError);
    await expect(approval).rejects.toMatchObject({
      nftAddress,
      operator,
    });
  });
});

function mockTransactionReceipt(): TransactionReceipt {
  const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
  const address = '0x0000000000000000000000000000000000000001';
  return {
    blockHash: hash,
    blockNumber: 123n,
    contractAddress: null,
    cumulativeGasUsed: 0n,
    effectiveGasPrice: 0n,
    from: address,
    gasUsed: 0n,
    logs: [],
    logsBloom: '0x',
    status: 'success',
    to: address,
    transactionHash: hash,
    transactionIndex: 0,
    type: 'eip1559',
  };
}

describe('currency decimal resolution', () => {
  it('uses configured decimals for known currencies without an RPC read', async () => {
    // eslint-disable-next-line no-restricted-syntax
    const client = {
      async readContract(): Promise<number> {
        throw new Error('unexpected decimals read');
      },
    } as never;
    const eth = resolveCurrency('eth', 'sepolia');
    const rare = resolveCurrency('rare', 'sepolia');
    const usdc = resolveCurrency('usdc', 'sepolia');

    expect(getKnownCurrencyDecimals(eth, 'sepolia')).toBe(18);
    expect(getKnownCurrencyDecimals(rare, 'sepolia')).toBe(18);
    expect(getKnownCurrencyDecimals(usdc, 'sepolia')).toBe(6);
    expect(await resolveCurrencyDecimals(client, 'sepolia', usdc)).toBe(6);
    expect(await toCurrencyAmount(client, 'sepolia', usdc, '1.25', 'price')).toBe(1250000n);
  });

  it('reads decimals for arbitrary ERC20 currencies', async () => {
    const currency = '0x9999999999999999999999999999999999999999';
    // eslint-disable-next-line no-restricted-syntax
    const client = {
      async readContract({ address, functionName }: { address: string; functionName: string }): Promise<number> {
        expect(address).toBe(currency);
        expect(functionName).toBe('decimals');
        return 8;
      },
    } as never;

    expect(getKnownCurrencyDecimals(currency, 'sepolia')).toBeNull();
    expect(await resolveCurrencyDecimals(client, 'sepolia', currency)).toBe(8);
  });
});

describe('wallet resolution', () => {
  it('requires a wallet client for write operations', () => {
    expect(() => requireWallet({ publicClient: publicClient() })).toThrow(
      'walletClient is required for write operations.',
    );
  });

  it('uses the wallet account when no override account is configured', () => {
    const result = requireWallet({ publicClient: publicClient(), walletClient: walletClient(sellerAccount) });

    expect(result.account).toBe(sellerAccount);
    expect(result.accountAddress).toBe(sellerAddress);
  });

  it('keeps the wallet account object when it matches the configured account', () => {
    const result = requireWallet({
      publicClient: publicClient(),
      walletClient: walletClient(sellerAccount),
      account: sellerAddress,
    });

    expect(result.account).toBe(sellerAccount);
    expect(result.accountAddress).toBe(sellerAddress);
  });

  it('uses a configured account address when it differs from the wallet account object', () => {
    const result = requireWallet({
      publicClient: publicClient(),
      walletClient: walletClient(sellerAccount),
      account: buyerAddress,
    });

    expect(result.account).toBe(buyerAddress);
    expect(result.accountAddress).toBe(buyerAddress);
  });
});

describe('prepared transaction sending', () => {
  it('rejects API-prepared transactions for a different sender before sending', async () => {
    const request = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected RPC request');
    });
    const publicClient = createPublicClient({ chain: mainnet, transport: custom({ request }) });
    const walletClient = createWalletClient({ account: sellerAccount, chain: mainnet, transport: custom({ request }) });
    const tx = buildPreparedTransaction({ from: buyerAddress, chainId: mainnet.id });

    await expect(sendPreparedTransaction(publicClient, walletClient, sellerAccount, tx, {
      accountAddress: sellerAddress,
      chainId: mainnet.id,
    })).rejects.toThrow('does not match wallet account');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects API-prepared transactions for a different chain before sending', async () => {
    const request = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected RPC request');
    });
    const publicClient = createPublicClient({ chain: mainnet, transport: custom({ request }) });
    const walletClient = createWalletClient({ account: sellerAccount, chain: mainnet, transport: custom({ request }) });
    const tx = buildPreparedTransaction({ from: sellerAddress, chainId: 11155111 });

    await expect(sendPreparedTransaction(publicClient, walletClient, sellerAccount, tx, {
      accountAddress: sellerAddress,
      chainId: mainnet.id,
    })).rejects.toThrow('does not match client chain ID');
    expect(request).not.toHaveBeenCalled();
  });
});

describe('chain resolution', () => {
  it('maps public client chain IDs to supported chain names', () => {
    expect(resolveChainFromPublicClient(publicClient(mainnet))).toBe('mainnet');
  });

  it('requires an explicit chain on the public client', () => {
    expect(() => resolveChainFromPublicClient(publicClient(undefined))).toThrow(
      'Unable to resolve chain from publicClient.chain.id.',
    );
  });

  it('rejects unsupported chain IDs', () => {
    expect(() =>
      resolveChainFromPublicClient(publicClient({ ...mainnet, id: 999_999 })),
    ).toThrow('Unsupported chain id: 999999.');
  });
});

function buildPreparedTransaction(
  overrides: Pick<UniswapTransactionRequest, 'from' | 'chainId'>,
): UniswapTransactionRequest {
  return {
    to: '0x9999999999999999999999999999999999999999',
    data: '0x',
    value: '0',
    ...overrides,
  };
}

function publicClient(chain?: PublicClient['chain']): PublicClient {
  return createPublicClient({
    chain,
    transport: http('http://127.0.0.1'),
  });
}

function walletClient(account: WalletClient['account']): WalletClient {
  return createWalletClient({
    account,
    transport: http('http://127.0.0.1'),
  });
}
