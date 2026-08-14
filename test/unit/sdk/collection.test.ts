import { describe, expect, it, vi } from 'vitest';
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
} from 'viem';
import { mainnet } from 'viem/chains';
import { collectionOwnerAbi } from '../../../src/contracts/abis/collection-owner.js';
import { collectionStatusAbi } from '../../../src/contracts/abis/collection-status.js';
import { createCollectionNamespace } from '../../../src/sdk/collection.js';

const contract = '0x1111111111111111111111111111111111111111';
const receiver = '0x2222222222222222222222222222222222222222';
const defaultReceiver = '0x3333333333333333333333333333333333333333';

type DefaultRoyaltyReadMode = 'available' | 'unsupported' | 'failed';
type CollectionRead = ReturnType<typeof decodeFunctionData>;

function createTestCollectionNamespace(mode: DefaultRoyaltyReadMode): ReturnType<typeof createCollectionNamespace> {
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }): Promise<`0x${string}`> => {
    if (method !== 'eth_call') {
      throw new Error(`unexpected RPC method ${method}`);
    }

    const { functionName } = decodeFunctionData({
      abi: collectionOwnerAbi,
      data: getCallData(params),
    });

    if (functionName === 'royaltyInfo') {
      return encodeFunctionResult({
        abi: collectionOwnerAbi,
        functionName,
        result: [receiver, 500n],
      });
    }

    if (mode === 'unsupported') {
      return '0x';
    }

    if (mode === 'failed' && functionName === 'getDefaultRoyaltyReceiver') {
      throw new Error('temporary RPC failure');
    }

    if (functionName === 'getDefaultRoyaltyReceiver') {
      return encodeFunctionResult({
        abi: collectionOwnerAbi,
        functionName,
        result: defaultReceiver,
      });
    }

    if (functionName === 'getDefaultRoyaltyPercentage') {
      return encodeFunctionResult({
        abi: collectionOwnerAbi,
        functionName,
        result: 10n,
      });
    }

    throw new Error(`unexpected read ${functionName}`);
  });
  const publicClient = createPublicClient({ chain: mainnet, transport: custom({ request }) });

  return createCollectionNamespace(
    publicClient,
    { publicClient },
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
}

function createStatusTestCollectionNamespace(): ReturnType<typeof createCollectionNamespace> {
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }): Promise<`0x${string}`> => {
    if (method !== 'eth_call') {
      throw new Error(`unexpected RPC method ${method}`);
    }

    const decoded = decodeCollectionCall(getCallData(params));

    if (decoded.functionName === 'name') {
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: 'Standard Collection',
      });
    }

    if (decoded.functionName === 'symbol') {
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: 'STD',
      });
    }

    if (decoded.functionName === 'owner') {
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: defaultReceiver,
      });
    }

    if (decoded.functionName === 'totalSupply') {
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: 12n,
      });
    }

    if (decoded.functionName === 'maxTokens') {
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: 100n,
      });
    }

    if (decoded.functionName === 'disabled') {
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: false,
      });
    }

    if (decoded.functionName === 'areTokenURIsLocked') {
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: true,
      });
    }

    if (decoded.functionName === 'getBatchCount') {
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: 2n,
      });
    }

    if (decoded.functionName === 'supportsInterface') {
      const [interfaceId] = decoded.args;
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: typeof interfaceId === 'string' &&
          ['0x01ffc9a7', '0x80ac58cd', '0x5b5e139f'].includes(interfaceId),
      });
    }

    if (decoded.functionName === 'ownerOf') {
      return encodeFunctionResult({
        abi: collectionStatusAbi,
        functionName: decoded.functionName,
        result: receiver,
      });
    }

    if (decoded.functionName === 'royaltyInfo') {
      return encodeFunctionResult({
        abi: collectionOwnerAbi,
        functionName: decoded.functionName,
        result: [receiver, 500n],
      });
    }

    if (decoded.functionName === 'getDefaultRoyaltyReceiver') {
      return encodeFunctionResult({
        abi: collectionOwnerAbi,
        functionName: decoded.functionName,
        result: defaultReceiver,
      });
    }

    if (decoded.functionName === 'getDefaultRoyaltyPercentage') {
      return encodeFunctionResult({
        abi: collectionOwnerAbi,
        functionName: decoded.functionName,
        result: 10n,
      });
    }

    if (
      decoded.functionName === 'getMintConfig' ||
      decoded.functionName === 'tokenURI' ||
      decoded.functionName === 'tokenCreator'
    ) {
      return '0x';
    }

    throw new Error(`unexpected read ${decoded.functionName}`);
  });
  const publicClient = createPublicClient({ chain: mainnet, transport: custom({ request }) });

  return createCollectionNamespace(
    publicClient,
    { publicClient },
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
}

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

function getCallData(params: unknown[] | undefined): `0x${string}` {
  const [call] = params ?? [];
  if (isCallWithData(call)) {
    return call.data;
  }

  throw new Error('eth_call params must include call data');
}

function decodeCollectionCall(data: `0x${string}`): CollectionRead {
  try {
    return decodeCollectionOwnerCall(data);
  } catch {
    return decodeCollectionStatusCall(data);
  }
}

function decodeCollectionOwnerCall(data: `0x${string}`): ReturnType<typeof decodeFunctionData> {
  return decodeFunctionData({
    abi: collectionOwnerAbi,
    data,
  });
}

function decodeCollectionStatusCall(data: `0x${string}`): ReturnType<typeof decodeFunctionData> {
  return decodeFunctionData({
    abi: collectionStatusAbi,
    data,
  });
}

function isCallWithData(value: unknown): value is { data: `0x${string}` } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    isHex(value.data)
  );
}

function isHex(value: unknown): value is `0x${string}` {
  return typeof value === 'string' && value.startsWith('0x');
}

describe('SDK collection namespace', () => {
  it('includes default royalty reads when the collection supports them', async () => {
    const collection = createTestCollectionNamespace('available');

    await expect(collection.royalty.status({ contract, tokenId: 1 })).resolves.toMatchObject({
      receiver,
      royaltyAmount: 500n,
      defaultReceiver,
      defaultPercentage: 10n,
    });
  });

  it('omits default royalty fields when optional methods are unsupported', async () => {
    const collection = createTestCollectionNamespace('unsupported');
    const status = await collection.royalty.status({ contract, tokenId: 1 });

    expect(status.receiver).toBe(receiver);
    expect(status.royaltyAmount).toBe(500n);
    expect(status).not.toHaveProperty('defaultReceiver');
    expect(status).not.toHaveProperty('defaultPercentage');
  });

  it('throws default royalty read failures instead of returning partial status', async () => {
    const collection = createTestCollectionNamespace('failed');

    await expect(collection.royalty.status({ contract, tokenId: 1 })).rejects.toThrow(
      `Collection ${contract} does not support getDefaultRoyaltyReceiver`,
    );
  });

  it('returns best-effort collection status and omits unsupported fields', async () => {
    const collection = createStatusTestCollectionNamespace();
    const status = await collection.status({ contract, tokenId: 1 });

    expect(status).toMatchObject({
      contract,
      name: 'Standard Collection',
      symbol: 'STD',
      owner: defaultReceiver,
      totalSupply: 12n,
      maxTokens: 100n,
      disabled: false,
      tokenUrisLocked: true,
      batchCount: 2n,
      defaultReceiver,
      defaultPercentage: 10n,
      interfaces: {
        erc165: true,
        erc721: true,
        erc721Metadata: true,
        erc2981: false,
      },
      token: {
        tokenId: 1n,
        owner: receiver,
        royalty: {
          salePrice: 10000n,
          receiver,
          amount: 500n,
        },
      },
    });
    expect(status).not.toHaveProperty('mintConfig');
    expect(status.token).not.toHaveProperty('tokenUri');
    expect(status.token).not.toHaveProperty('creator');
  });

});
