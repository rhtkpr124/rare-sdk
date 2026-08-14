import { describe, expect, it, vi } from 'vitest';
import { maxUint256, type Address, type Hash, type PublicClient, type WalletClient } from 'viem';
import type { ApprovalSideEffectError } from '../../../src/sdk/approvals-shell.js';
import { PaymentApprovalRequiredError } from '../../../src/sdk/payments-shell.js';
import { createRareClient } from '../../../src/sdk/client.js';
import { encodeBridgeDistribution, getBridgeInfo } from '../../../src/sdk/bridge-core.js';

const accountAddress = '0x1234567890123456789012345678901234567890' as const;
const recipientAddress = '0x9999999999999999999999999999999999999999' as const;
const approvalHash = `0x${'aa'.repeat(32)}` as const;
const bridgeHash = `0x${'bb'.repeat(32)}` as const;
const receipt = { status: 'success' };

type WriteContractParams = {
  address: Address;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};

describe('bridge SDK namespace', () => {
  it('quotes the CCIP native fee with the web app RareBridge arguments', async () => {
    const publicClient = makePublicClient({
      async readContract(params) {
        expect(params).toMatchObject({
          address: getBridgeInfo('sepolia').rareBridgeAddress,
          functionName: 'getFee',
          args: [
            getBridgeInfo('base-sepolia').ccipChainSelector,
            getBridgeInfo('base-sepolia').rareBridgeAddress,
            encodeBridgeDistribution({ recipient: recipientAddress, amount: 1500000000000000000n }),
            '0x',
            false,
          ],
        });
        return 123n;
      },
      async estimateGas(params) {
        expect(params).toMatchObject({
          account: accountAddress,
          to: getBridgeInfo('sepolia').rareBridgeAddress,
          value: 123n,
        });
        return 456n;
      },
    });
    const rare = createRareClient({ publicClient, account: accountAddress });

    const quote = await rare.bridge.quote({
      amount: '1.5',
      destinationChain: 'base-sepolia',
      recipient: recipientAddress,
    });

    expect(quote).toMatchObject({
      sourceChain: 'sepolia',
      destinationChain: 'base-sepolia',
      sourceBridgeAddress: getBridgeInfo('sepolia').rareBridgeAddress,
      destinationBridgeAddress: getBridgeInfo('base-sepolia').rareBridgeAddress,
      rareTokenAddress: getBridgeInfo('sepolia').rareTokenAddress,
      destinationCcipChainSelector: getBridgeInfo('base-sepolia').ccipChainSelector,
      amount: 1500000000000000000n,
      recipient: recipientAddress,
      nativeFee: 123n,
      estimatedGas: 456n,
    });
  });

  it('approves RARE when allowance is below the bridge amount and sends with the quoted native fee', async () => {
    const writeContract = vi.fn(async (params: WriteContractParams): Promise<Hash> =>
      params.functionName === 'approve' ? approvalHash : bridgeHash);
    let allowanceReads = 0;
    const publicClient = makePublicClient({
      async readContract(params) {
        if (params.functionName === 'getFee') return 321n;
        if (params.functionName === 'allowance') {
          allowanceReads += 1;
          return allowanceReads === 1 ? 0n : maxUint256;
        }
        throw new Error(`unexpected read: ${String(params.functionName)}`);
      },
      async waitForTransactionReceipt() {
        return receipt;
      },
    });
    const walletClient = makeWalletClient({ writeContract });
    const rare = createRareClient({ publicClient, walletClient });

    const result = await rare.bridge.send({
      amount: 2n,
      destinationChain: 'base-sepolia',
      recipient: recipientAddress,
    });

    expect(writeContract.mock.calls.map(([params]) => params)).toEqual([
      expect.objectContaining({
        address: getBridgeInfo('sepolia').rareTokenAddress,
        functionName: 'approve',
        args: [getBridgeInfo('sepolia').rareBridgeAddress, maxUint256],
      }),
      expect.objectContaining({
        address: getBridgeInfo('sepolia').rareBridgeAddress,
        functionName: 'send',
        args: [
          getBridgeInfo('base-sepolia').ccipChainSelector,
          getBridgeInfo('base-sepolia').rareBridgeAddress,
          encodeBridgeDistribution({ recipient: recipientAddress, amount: 2n }),
          '0x',
          false,
        ],
        value: 321n,
      }),
    ]);
    expect(result.txHash).toBe(bridgeHash);
    expect(result.approvalTxHash).toBe(approvalHash);
    expect(result.ccipExplorerUrl).toBe(`https://ccip.chain.link/tx/${bridgeHash}`);
  });

  it('reports a mined approval when bridge gas estimation fails afterward', async () => {
    const writeContract = vi.fn(async (_params: WriteContractParams): Promise<Hash> => approvalHash);
    const estimateFailure = new Error('estimate failed');
    let allowanceReads = 0;
    const publicClient = makePublicClient({
      async readContract(params) {
        if (params.functionName === 'getFee') return 321n;
        if (params.functionName === 'allowance') {
          allowanceReads += 1;
          return allowanceReads === 1 ? 0n : maxUint256;
        }
        throw new Error(`unexpected read: ${String(params.functionName)}`);
      },
      async estimateGas(): Promise<never> {
        throw estimateFailure;
      },
      async waitForTransactionReceipt() {
        return receipt;
      },
    });
    const walletClient = makeWalletClient({ writeContract });
    const rare = createRareClient({ publicClient, walletClient });

    await expect(rare.bridge.send({
      amount: 2n,
      destinationChain: 'base-sepolia',
      recipient: recipientAddress,
    })).rejects.toMatchObject({
      name: 'ApprovalSideEffectError',
      operation: 'bridge send',
      approvals: [{
        type: 'erc20',
        approvalTxHash: approvalHash,
        target: getBridgeInfo('sepolia').rareTokenAddress,
        spender: getBridgeInfo('sepolia').rareBridgeAddress,
      }],
      cause: estimateFailure,
    } satisfies Partial<ApprovalSideEffectError>);

    expect(writeContract).toHaveBeenCalledOnce();
  });

  it('does not approve when allowance already covers the bridge amount and defaults recipient to the wallet account', async () => {
    const writeContract = vi.fn(async (_params: WriteContractParams): Promise<Hash> => bridgeHash);
    const publicClient = makePublicClient({
      async readContract(params) {
        if (params.functionName === 'getFee') return 321n;
        if (params.functionName === 'allowance') return 3n;
        throw new Error(`unexpected read: ${String(params.functionName)}`);
      },
      async waitForTransactionReceipt() {
        return receipt;
      },
    });
    const walletClient = makeWalletClient({ writeContract });
    const rare = createRareClient({ publicClient, walletClient });

    const result = await rare.bridge.send({
      amount: 2n,
      destinationChain: 'base-sepolia',
    });

    expect(writeContract).toHaveBeenCalledOnce();
    expect(writeContract.mock.calls[0]?.[0]).toMatchObject({
      functionName: 'send',
      args: [
        getBridgeInfo('base-sepolia').ccipChainSelector,
        getBridgeInfo('base-sepolia').rareBridgeAddress,
        encodeBridgeDistribution({ recipient: accountAddress, amount: 2n }),
        '0x',
        false,
      ],
      value: 321n,
    });
    expect(result.recipient).toBe(accountAddress);
    expect(result.approvalTxHash).toBeUndefined();
  });

  it('throws PaymentApprovalRequiredError before sending when autoApprove is false', async () => {
    const writeContract = vi.fn(async (_params: WriteContractParams): Promise<Hash> => bridgeHash);
    const publicClient = makePublicClient({
      async readContract(params) {
        if (params.functionName === 'getFee') return 321n;
        if (params.functionName === 'allowance') return 0n;
        throw new Error(`unexpected read: ${String(params.functionName)}`);
      },
    });
    const walletClient = makeWalletClient({ writeContract });
    const rare = createRareClient({ publicClient, walletClient });

    await expect(rare.bridge.send({
      amount: 2n,
      destinationChain: 'base-sepolia',
      autoApprove: false,
    })).rejects.toBeInstanceOf(PaymentApprovalRequiredError);

    expect(writeContract).not.toHaveBeenCalled();
  });

  it('rejects unsupported bridge routes before wallet writes', async () => {
    const writeContract = vi.fn(async (_params: WriteContractParams): Promise<Hash> => bridgeHash);
    const publicClient = makePublicClient({
      async readContract(): Promise<bigint> {
        throw new Error('unexpected read');
      },
    });
    const walletClient = makeWalletClient({ writeContract });
    const rare = createRareClient({ publicClient, walletClient });

    await expect(rare.bridge.send({
      amount: 2n,
      destinationChain: 'base',
    })).rejects.toThrow('Unsupported RARE bridge route "sepolia" -> "base"');

    expect(writeContract).not.toHaveBeenCalled();
  });
});

function makePublicClient(overrides: {
  readContract?: (params: { address: Address; functionName: string; args?: readonly unknown[] }) => Promise<bigint>;
  estimateGas?: (params: { account?: Address; to?: Address; data?: `0x${string}`; value?: bigint }) => Promise<bigint>;
  waitForTransactionReceipt?: (params: { hash: Hash }) => Promise<unknown>;
}): PublicClient {
  // eslint-disable-next-line no-restricted-syntax
  return {
    chain: { id: 11155111 },
    readContract: overrides.readContract ?? (async (): Promise<bigint> => 0n),
    estimateGas: overrides.estimateGas ?? (async (): Promise<bigint> => 0n),
    waitForTransactionReceipt: overrides.waitForTransactionReceipt ?? (async (): Promise<unknown> => receipt),
  } as unknown as PublicClient;
}

function makeWalletClient(overrides: {
  writeContract: (params: WriteContractParams) => Promise<Hash>;
}): WalletClient {
  // eslint-disable-next-line no-restricted-syntax
  return {
    account: { address: accountAddress },
    writeContract: overrides.writeContract,
  } as unknown as WalletClient;
}
