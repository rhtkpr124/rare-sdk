/* eslint-disable no-restricted-syntax, @typescript-eslint/explicit-function-return-type, functional/immutable-data */
import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { createBatchListingNamespace } from '../../../src/sdk/batch-listing.js';
import { getBatchListingAddress } from '../../../src/contracts/addresses.js';

const batchListingAddress = '0xF2bE72d4343beD375Cb6d0E799a3c003163860e0' as Address;
const marketplaceSettingsAddress = '0x972dEe8fa339ad2D9c6cbDA31b67f98Fac242d13' as Address;
const erc20ApprovalManagerAddress = '0x4619eB29e84392CE91C27FC936A5c94d1D14b93f' as Address;
const approvalManagerAddress = '0x5fa0a461d3a2Ea3bFDf03e8BD37CAbB4ae84205E' as Address;
const accountAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const hex32 = (byte: string): `0x${string}` => `0x${byte.repeat(64)}`;
const addresses = {
  batchListing: batchListingAddress,
  marketplaceSettings: marketplaceSettingsAddress,
  erc20ApprovalManager: erc20ApprovalManagerAddress,
  erc721ApprovalManager: approvalManagerAddress,
  chain: 'sepolia',
  chainId: 11155111,
} as const;

function receipt() {
  return { blockNumber: 1n } as never;
}

function rareApiRootFetch(root = hex32('2')): typeof fetch {
  return async () => new Response(JSON.stringify({ merkleRoot: root }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function parseJsonBody(input: RequestInfo | URL, init: RequestInit | undefined): Promise<unknown> {
  const body = input instanceof Request ? await input.clone().text() : init?.body;
  if (typeof body !== 'string') {
    throw new Error('Expected request body to be a JSON string.');
  }
  return JSON.parse(body);
}

describe('batch listing namespace', () => {
  it('skips approval tx hashes when approval is already in place', async () => {
    const writeCalls: unknown[] = [];
    const namespace = createBatchListingNamespace(
      {
        async readContract(params: { functionName: string }) {
          if (params.functionName === 'ownerOf') return accountAddress;
          if (params.functionName === 'isApprovedForAll') return true;
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
        async waitForTransactionReceipt() {
          return receipt();
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch: rareApiRootFetch(),
        walletClient: {
          account: { address: accountAddress },
          async writeContract(params: unknown) {
            writeCalls.push(params);
            return hex32('1');
          },
        } as never,
      },
      addresses,
    );

    const result = await namespace.create({
      artifact: {
        root: hex32('2'),
        currency: '0x0000000000000000000000000000000000000000',
        amount: '1',
        splitAddresses: [],
        splitRatios: [],
        tokens: [
          { contract: accountAddress, tokenId: '1' },
          { contract: accountAddress, tokenId: '2' },
        ],
      },
    });

    expect(result.approvalTxHashes).toBeUndefined();
    expect(writeCalls.length).toBe(1);
    expect((writeCalls[0] as { args: unknown[] }).args[3]).toEqual([accountAddress]);
    expect((writeCalls[0] as { args: unknown[] }).args[4]).toEqual([100]);
  });

  it('fails early when sampled token ownership does not match the configured wallet', async () => {
    const namespace = createBatchListingNamespace(
      {
        async readContract(params: { functionName: string }) {
          if (params.functionName === 'ownerOf') return '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch: rareApiRootFetch(),
        walletClient: {
          account: { address: accountAddress },
        } as never,
      },
      addresses,
    );

    await expect(
      namespace.create({
        artifact: {
          root: hex32('2'),
          currency: '0x0000000000000000000000000000000000000000',
          amount: '1',
          splitAddresses: [],
          splitRatios: [],
          tokens: [
            { contract: accountAddress, tokenId: '1' },
            { contract: accountAddress, tokenId: '2' },
          ],
        },
      }),
    ).rejects.toThrow(/is owned by/);
  });

  it('submits an empty allowListProof when the proof artifact does not include one', async () => {
    const writeCalls: Array<{ functionName: string; args: unknown[] }> = [];
    const namespace = createBatchListingNamespace(
      {
        async readContract(params: { functionName: string; args?: unknown[] }) {
          if (params.functionName === 'calculateMarketplaceFee') return 0n;
          if (params.functionName === 'allowance') {
            expect(params.args?.[1]).toBe(erc20ApprovalManagerAddress);
            return 10n ** 18n;
          }
          if (params.functionName === 'getAllowListConfig') {
            return {
              root: `0x${'00'.repeat(32)}`,
              endTimestamp: 0n,
            };
          }
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
        async waitForTransactionReceipt() {
          return receipt();
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch: rareApiRootFetch(),
        walletClient: {
          account: { address: accountAddress },
          async writeContract(params: { functionName: string; args: unknown[] }) {
            writeCalls.push(params);
            return hex32('3');
          },
        } as never,
      },
      addresses,
    );

    await namespace.buy({
      creator: accountAddress,
      currency: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      price: 1n,
      proofArtifact: {
        root: hex32('4'),
        contract: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        proof: [hex32('5')],
      },
    });

    expect(writeCalls.length).toBe(1);
    expect(writeCalls[0]?.functionName).toBe('buyWithMerkleProof');
    expect(writeCalls[0]?.args[7]).toEqual([]);
  });

  it('rejects explicit empty allowListProof while the allowlist is active', async () => {
    const writeCalls: Array<{ functionName: string; args: unknown[] }> = [];
    const namespace = createBatchListingNamespace(
      {
        async readContract(params: { functionName: string }) {
          if (params.functionName === 'getAllowListConfig') {
            return {
              root: hex32('6'),
              endTimestamp: 101n,
            };
          }
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
        async getBlock() {
          return { timestamp: 100n };
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch: rareApiRootFetch(),
        walletClient: {
          account: { address: accountAddress },
          async writeContract(params: { functionName: string; args: unknown[] }) {
            writeCalls.push(params);
            return hex32('7');
          },
        } as never,
      },
      addresses,
    );

    await expect(namespace.buy({
      creator: accountAddress,
      currency: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      price: 1n,
      proofArtifact: {
        root: hex32('4'),
        contract: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        proof: [hex32('5')],
        allowListProof: [],
      },
    })).rejects.toThrow(/allowListProof must not be empty/);

    expect(writeCalls).toEqual([]);
  });

  it('approves the ERC721 approval manager rather than the marketplace', async () => {
    const writeCalls: Array<{ functionName: string; args: unknown[] }> = [];
    let approvalChecks = 0;
    const namespace = createBatchListingNamespace(
      {
        async readContract(params: { functionName: string; args?: unknown[] }) {
          if (params.functionName === 'ownerOf') return accountAddress;
          if (params.functionName === 'isApprovedForAll') {
            expect(params.args?.[1]).toBe(approvalManagerAddress);
            approvalChecks += 1;
            return approvalChecks > 1;
          }
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
        async waitForTransactionReceipt() {
          return receipt();
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch: rareApiRootFetch(),
        walletClient: {
          account: { address: accountAddress },
          async writeContract(params: { functionName: string; args: unknown[] }) {
            writeCalls.push(params);
            return params.functionName === 'setApprovalForAll' ? hex32('6') : hex32('7');
          },
        } as never,
      },
      addresses,
    );

    const result = await namespace.create({
      artifact: {
        root: hex32('2'),
        currency: '0x0000000000000000000000000000000000000000',
        amount: '1',
        splitAddresses: [],
        splitRatios: [],
        tokens: [
          { contract: accountAddress, tokenId: '1' },
          { contract: accountAddress, tokenId: '2' },
        ],
      },
    });

    expect(writeCalls[0]?.functionName).toBe('setApprovalForAll');
    expect(writeCalls[0]?.args).toEqual([approvalManagerAddress, true]);
    expect(writeCalls[1]?.functionName).toBe('registerSalePriceMerkleRoot');
    expect(result.approvalTxHashes).toEqual([hex32('6')]);
  });

  it('serializes NFT approvals across multiple collection contracts', async () => {
    const contractA = '0x1111111111111111111111111111111111111111' as Address;
    const contractB = '0x2222222222222222222222222222222222222222' as Address;
    const writeCalls: Array<{ address: Address; functionName: string; args: unknown[] }> = [];
    const approvedContracts = new Set<Address>();
    let activeApprovalWrites = 0;
    let maxActiveApprovalWrites = 0;
    const namespace = createBatchListingNamespace(
      {
        async readContract(params: { address: Address; functionName: string }) {
          if (params.functionName === 'ownerOf') return accountAddress;
          if (params.functionName === 'isApprovedForAll') return approvedContracts.has(params.address);
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
        async waitForTransactionReceipt() {
          return receipt();
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch: rareApiRootFetch(),
        walletClient: {
          account: { address: accountAddress },
          async writeContract(params: { address: Address; functionName: string; args: unknown[] }) {
            writeCalls.push(params);
            if (params.functionName === 'setApprovalForAll') {
              activeApprovalWrites += 1;
              maxActiveApprovalWrites = Math.max(maxActiveApprovalWrites, activeApprovalWrites);
              await new Promise((resolve) => setTimeout(resolve, 0));
              activeApprovalWrites -= 1;
              approvedContracts.add(params.address);
              return params.address === contractA ? hex32('6') : hex32('7');
            }
            return hex32('8');
          },
        } as never,
      },
      addresses,
    );

    const result = await namespace.create({
      artifact: {
        root: hex32('2'),
        currency: '0x0000000000000000000000000000000000000000',
        amount: '1',
        splitAddresses: [],
        splitRatios: [],
        tokens: [
          { contract: contractA, tokenId: '1' },
          { contract: contractB, tokenId: '2' },
        ],
      },
    });

    expect(maxActiveApprovalWrites).toBe(1);
    expect(writeCalls.map((call) => call.functionName)).toEqual([
      'setApprovalForAll',
      'setApprovalForAll',
      'registerSalePriceMerkleRoot',
    ]);
    expect(result.approvalTxHashes).toEqual([hex32('6'), hex32('7')]);
  });

  it('resolves the cancel root from rare-api when token identity is provided', async () => {
    const contract = '0x1111111111111111111111111111111111111111' as Address;
    const root = hex32('8');
    const writeCalls: Array<{ functionName: string; args: unknown[] }> = [];
    const namespace = createBatchListingNamespace(
      {
        async waitForTransactionReceipt() {
          return receipt();
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch: async (input, init) => {
          await expect(parseJsonBody(input, init)).resolves.toMatchObject({
            chainId: addresses.chainId,
            contractAddress: contract,
            tokenId: '1',
            context: 'batch-listing',
            creator: accountAddress,
          });
          return new Response(JSON.stringify({
            root,
            contractAddress: contract,
            tokenId: '1',
            leaf: hex32('9'),
            proof: [hex32('a')],
          }), { headers: { 'Content-Type': 'application/json' } });
        },
        walletClient: {
          account: { address: accountAddress },
          async writeContract(params: { functionName: string; args: unknown[] }) {
            writeCalls.push(params);
            return hex32('b');
          },
        } as never,
      },
      addresses,
    );

    const result = await namespace.cancel({ contract, tokenId: '1' });

    expect(result.root).toBe(root);
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]?.functionName).toBe('cancelSalePriceMerkleRoot');
    expect(writeCalls[0]?.args).toEqual([root]);
  });

  it('sets an allowlist from artifact data without requiring root inputs', async () => {
    const root = hex32('c');
    const allowListRoot = hex32('d');
    const writeCalls: Array<{ functionName: string; args: unknown[] }> = [];
    const namespace = createBatchListingNamespace(
      {
        async waitForTransactionReceipt() {
          return receipt();
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch: async (input, init) => {
          await expect(parseJsonBody(input, init)).resolves.toMatchObject({
            addresses: [accountAddress, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
            storageTarget: 'batch-listing',
          });
          return new Response(JSON.stringify({ merkleRoot: allowListRoot }), {
            headers: { 'Content-Type': 'application/json' },
          });
        },
        walletClient: {
          account: { address: accountAddress },
          async writeContract(params: { functionName: string; args: unknown[] }) {
            writeCalls.push(params);
            return hex32('e');
          },
        } as never,
      },
      addresses,
    );

    const result = await namespace.setAllowlist({
      artifact: {
        root,
        currency: '0x0000000000000000000000000000000000000000',
        amount: '1',
        splitAddresses: [],
        splitRatios: [],
        tokens: [
          { contract: accountAddress, tokenId: '1' },
          { contract: accountAddress, tokenId: '2' },
        ],
        allowList: {
          root: hex32('f'),
          addresses: [accountAddress, '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
          endTimestamp: '123',
        },
      },
    });

    expect(result).toMatchObject({ root, allowListRoot, endTime: 123n });
    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]?.functionName).toBe('setAllowListConfig');
    expect(writeCalls[0]?.args).toEqual([root, allowListRoot, 123n]);
  });
});

describe('batch listing addresses', () => {
  it('resolves the deployed marketplace for configured chains', () => {
    expect(getBatchListingAddress('base')).toBe('0x36A66dF396877f6771D9f9981AD70B712ee523CF');
    expect(getBatchListingAddress('base-sepolia')).toBe('0xAF5686eAdc6A575a0e9f455978ad712201744B3F');
  });
});
