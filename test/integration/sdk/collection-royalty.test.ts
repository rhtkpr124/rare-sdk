import { describe, expect, it } from 'vitest';
import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeFunctionData,
  type Address,
} from 'viem';
import { mainnet } from 'viem/chains';
import { collectionOwnerAbi } from '../../../src/contracts/abis/collection-owner.js';
import { rareErc1155Abi } from '../../../src/contracts/abis/rare-erc1155.js';
import { createCollectionNamespace } from '../../../src/sdk/collection.js';

const contract = '0x1111111111111111111111111111111111111111';
const receiver = '0x2222222222222222222222222222222222222222';
const account = '0x3333333333333333333333333333333333333333';
const txHash = `0x${'44'.repeat(32)}` as const;

describe('SDK collection royalty integration', () => {
  it('falls back to ERC1155 token royalty argument order', async () => {
    const calls: string[] = [];
    const sentTransactions: Array<{ to?: Address; data?: `0x${string}` }> = [];
    const transport = custom({
      async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
        if (method === 'eth_chainId') {
          return '0x1';
        }
        if (method === 'eth_call') {
          const data = getCallData(params);
          const decoded = decodeRoyaltySetter(data);
          calls.push(`${decoded.kind}:${decoded.args.map(String).join(',')}`);
          if (decoded.kind === 'erc721') {
            throw new Error('ERC721 royalty setter unsupported');
          }
          return '0x';
        }
        if (method === 'eth_sendTransaction') {
          const [transaction] = params ?? [];
          if (!isTransaction(transaction)) {
            throw new Error('eth_sendTransaction requires transaction params.');
          }
          sentTransactions.push(transaction);
          return txHash;
        }
        if (method === 'eth_getTransactionReceipt') {
          return {
            transactionHash: txHash,
            blockHash: `0x${'55'.repeat(32)}`,
            blockNumber: '0x7b',
            contractAddress: null,
            cumulativeGasUsed: '0x1',
            effectiveGasPrice: '0x1',
            from: account,
            gasUsed: '0x1',
            logs: [],
            logsBloom: `0x${'00'.repeat(256)}`,
            status: '0x1',
            to: contract,
            transactionIndex: '0x0',
            type: '0x2',
          };
        }
        throw new Error(`unexpected RPC method ${method}`);
      },
    });
    const publicClient = createPublicClient({ chain: mainnet, transport });
    const walletClient = createWalletClient({ account, chain: mainnet, transport });
    const collection = createCollectionNamespace(
      publicClient,
      { publicClient, walletClient },
      'mainnet',
      { async get(): Promise<never> { throw new Error('unexpected collection get'); } },
      {
        async erc721(): Promise<never> { throw new Error('unexpected deploy erc721'); },
        async erc1155(): Promise<never> { throw new Error('unexpected deploy erc1155'); },
        async lazyBatchMint(): Promise<never> { throw new Error('unexpected deploy lazyBatchMint'); },
      },
      createUnexpectedErc1155Namespace(),
      async (): Promise<never> => {
        throw new Error('unexpected collection mint');
      },
    );

    await expect(collection.setTokenRoyaltyReceiver({ contract, tokenId: 7, receiver })).resolves.toMatchObject({
      txHash,
      contract,
      tokenId: 7n,
      receiver,
    });

    expect(calls[0]).toBe(`erc721:${receiver},7`);
    expect(calls.at(-1)).toBe(`erc1155:7,${receiver}`);
    expect(calls.filter((call) => call === `erc1155:7,${receiver}`)).toHaveLength(1);
    expect(sentTransactions).toHaveLength(1);
    const sent = sentTransactions[0];
    expect(sent?.to).toBe(contract);
    expect(decodeRoyaltySetter(sent?.data ?? '0x')).toEqual({
      kind: 'erc1155',
      args: [7n, receiver],
    });
  });
});

function createUnexpectedErc1155Namespace(): ReturnType<typeof createCollectionNamespace>['erc1155'] {
  return {
    async createToken(): Promise<never> { throw new Error('unexpected erc1155 createToken'); },
    async mint(): Promise<never> { throw new Error('unexpected erc1155 mint'); },
    async mintBatch(): Promise<never> { throw new Error('unexpected erc1155 mintBatch'); },
    async setMinterApproval(): Promise<never> { throw new Error('unexpected erc1155 setMinterApproval'); },
    async updateTokenUri(): Promise<never> { throw new Error('unexpected erc1155 updateTokenUri'); },
    async disable(): Promise<never> { throw new Error('unexpected erc1155 disable'); },
    async status(): Promise<never> { throw new Error('unexpected erc1155 status'); },
  };
}

function decodeRoyaltySetter(data: `0x${string}`): { kind: 'erc721' | 'erc1155'; args: readonly unknown[] } {
  try {
    const decoded = decodeFunctionData({
      abi: collectionOwnerAbi,
      data,
    });
    if (decoded.functionName === 'setRoyaltyReceiverForToken') {
      return { kind: 'erc721', args: decoded.args };
    }
  } catch {
    // Try the ERC1155 signature below.
  }

  const decoded = decodeFunctionData({
    abi: rareErc1155Abi,
    data,
  });
  if (decoded.functionName !== 'setRoyaltyReceiverForToken') {
    throw new Error(`unexpected function ${decoded.functionName}`);
  }
  return { kind: 'erc1155', args: decoded.args };
}

function getCallData(params: unknown[] | undefined): `0x${string}` {
  const [call] = params ?? [];
  if (isTransaction(call) && call.data !== undefined) {
    return call.data;
  }
  throw new Error('eth_call params must include call data.');
}

function isTransaction(value: unknown): value is { to?: Address; data?: `0x${string}` } {
  return typeof value === 'object' && value !== null;
}
