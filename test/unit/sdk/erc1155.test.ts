/* eslint-disable no-restricted-syntax */
import { describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import { ETH_ADDRESS, type ContractAddresses } from '../../../src/contracts/addresses.js';
import { createErc1155ListingNamespace } from '../../../src/sdk/erc1155.js';
import { buildReleaseAllowlistArtifact } from '../../../src/sdk/release-core.js';

const account = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const contract = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
const seller = '0xcccccccccccccccccccccccccccccccccccccccc' as Address;
const recipient = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' as Address;
const erc20 = '0xdddddddddddddddddddddddddddddddddddddddd' as Address;
const marketplace = '0x1111111111111111111111111111111111111111' as Address;
const approvalManager = '0x2222222222222222222222222222222222222222' as Address;
const erc20ApprovalManager = '0x7777777777777777777777777777777777777777' as Address;
const marketplaceSettings = '0x3333333333333333333333333333333333333333' as Address;
const hex32 = (byte: string): `0x${string}` => `0x${byte.repeat(64)}`;

const addresses: ContractAddresses = {
  factory: '0x4444444444444444444444444444444444444444',
  auction: '0x5555555555555555555555555555555555555555',
  erc1155Marketplace: marketplace,
  erc1155ContractFactory: '0x6666666666666666666666666666666666666666',
  erc1155ApprovalManager: approvalManager,
  erc20ApprovalManager,
  marketplaceSettings,
};

function receipt(): never {
  return { status: 'success', blockNumber: 1n, logs: [] } as never;
}

async function parseJsonBody(input: RequestInfo | URL, init: RequestInit | undefined): Promise<unknown> {
  const body = input instanceof Request ? await input.clone().text() : init?.body;
  if (typeof body !== 'string') {
    throw new Error('Expected request body to be a JSON string.');
  }
  return JSON.parse(body);
}

describe('ERC1155 listing namespace preflight', () => {
  it('rejects ERC1155 listing reads when the address set is incomplete', async () => {
    const namespace = createErc1155ListingNamespace(
      {} as never,
      {
        publicClient: {} as never,
        account,
        walletClient: { writeContract: vi.fn() } as never,
      },
      'mainnet',
      {
        factory: '0x4444444444444444444444444444444444444444',
        auction: '0x5555555555555555555555555555555555555555',
      },
    );

    await expect(namespace.status({
      contract,
      tokenId: '1',
      seller,
    })).rejects.toThrow('ERC1155 contracts are not configured for "mainnet". Supported chains: sepolia, mainnet, base, base-sepolia');
  });

  it('rejects insufficient seller balance before writing NFT approval', async () => {
    const writeContract = vi.fn(async () => hex32('1'));
    const namespace = createErc1155ListingNamespace(
      {
        async readContract(params: { functionName: string }) {
          if (params.functionName === 'balanceOf') return 1n;
          if (params.functionName === 'isApprovedForAll') return false;
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
      } as never,
      {
        publicClient: {} as never,
        account,
        walletClient: { writeContract } as never,
      },
      'sepolia',
      addresses,
    );

    await expect(namespace.create({
      contract,
      tokenId: '1',
      quantity: '2',
      price: 1n,
      currency: ETH_ADDRESS,
    })).rejects.toThrow(`but ${account} owns 1.`);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('rejects stale buy params before writing ERC20 approval', async () => {
    const writeContract = vi.fn(async () => hex32('1'));
    const namespace = createErc1155ListingNamespace(
      {
        async readContract(params: { functionName: string }) {
          if (params.functionName === 'getSalePrice') {
            return [erc20, 2n, 10n, 0n, [seller], [100]];
          }
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
      } as never,
      {
        publicClient: {} as never,
        account,
        walletClient: { writeContract } as never,
      },
      'sepolia',
      addresses,
    );

    await expect(namespace.buy({
      contract,
      seller,
      tokenId: '1',
      quantity: '1',
      price: 1n,
      currency: erc20,
    })).rejects.toThrow('ERC1155 listing price changed during preflight.');
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('rejects insufficient ERC20 balance before writing ERC20 approval', async () => {
    const writeContract = vi.fn(async () => hex32('1'));
    const namespace = createErc1155ListingNamespace(
      {
        async readContract(params: { functionName: string; args?: unknown[] }) {
          if (params.functionName === 'getSalePrice') {
            return [erc20, 1n, 10n, 0n, [seller], [100]];
          }
          if (params.functionName === 'calculateMarketplaceFee') return 0n;
          if (params.functionName === 'isApprovedForAll') return true;
          if (params.functionName === 'balanceOf' && params.args?.length === 2) return 10n;
          if (params.functionName === 'balanceOf' && params.args?.length === 1) return 0n;
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
      } as never,
      {
        publicClient: {} as never,
        account,
        walletClient: { writeContract } as never,
      },
      'sepolia',
      addresses,
    );

    await expect(namespace.buy({
      contract,
      seller,
      tokenId: '1',
      quantity: '1',
      price: 1n,
      currency: erc20,
    })).rejects.toThrow(`but ${account} owns 0.`);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('passes recipient to ERC1155 listing buy writes', async () => {
    const txHash = hex32('1');
    const writeContract = vi.fn(async () => txHash);
    const simulateContract = vi.fn(async () => ({}));
    const namespace = createErc1155ListingNamespace(
      {
        async readContract(params: { functionName: string; args?: unknown[] }) {
          if (params.functionName === 'getSalePrice') {
            return [ETH_ADDRESS, 1n, 10n, 0n, [seller], [100]];
          }
          if (params.functionName === 'calculateMarketplaceFee') return 0n;
          if (params.functionName === 'isApprovedForAll') return true;
          if (params.functionName === 'balanceOf') return 10n;
          throw new Error(`Unexpected readContract: ${params.functionName}`);
        },
        simulateContract,
        async waitForTransactionReceipt() {
          return { status: 'success', blockNumber: 1n, logs: [] };
        },
      } as never,
      {
        publicClient: {} as never,
        account,
        walletClient: { writeContract } as never,
      },
      'sepolia',
      addresses,
    );

    const result = await namespace.buy({
      contract,
      seller,
      tokenId: '1',
      quantity: '2',
      price: 1n,
      currency: ETH_ADDRESS,
      recipient,
    });

    expect(result).toMatchObject({ buyer: account, recipient });
    expect(simulateContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'buyBatch',
      args: [contract, seller, ETH_ADDRESS, recipient, [{ tokenId: 1n, price: 1n, quantity: 2n }]],
      value: 2n,
    }));
    expect(writeContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'buyBatch',
      args: [contract, seller, ETH_ADDRESS, recipient, [{ tokenId: 1n, price: 1n, quantity: 2n }]],
      value: 2n,
    }));
  });

  it('uploads ERC1155 release allowlist artifact addresses before writing config', async () => {
    const artifact = buildReleaseAllowlistArtifact([account, recipient]);
    const txHash = hex32('1');
    const writeContract = vi.fn(async () => txHash);
    const apiFetch = vi.fn<typeof fetch>(async (input, init) => {
      await expect(parseJsonBody(input, init)).resolves.toEqual({
        addresses: artifact.wallets.map((wallet) => wallet.address),
        storageTarget: 'collection-allowlist',
      });
      return new Response(JSON.stringify({ merkleRoot: artifact.root }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const namespace = createErc1155ListingNamespace(
      {
        async waitForTransactionReceipt() {
          return receipt();
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch,
        walletClient: {
          account: { address: account },
          writeContract,
        } as never,
      },
      'sepolia',
      addresses,
    );

    const result = await namespace.release.allowlist.setConfig({
      contract,
      tokenId: '1',
      artifact,
      endTime: 2_000,
    });

    expect(result.config.root).toBe(artifact.root);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(writeContract).toHaveBeenCalledWith(expect.objectContaining({
      address: marketplace,
      functionName: 'setTokenAllowListConfigs',
      args: [contract, [{ tokenId: 1n, root: artifact.root, endTimestamp: 2_000n }]],
    }));
  });

  it('rejects mismatched rare-api ERC1155 release allowlist roots before writing config', async () => {
    const artifact = buildReleaseAllowlistArtifact([account, recipient]);
    const apiRoot = hex32('1');
    const writeContract = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected allowlist write');
    });
    const namespace = createErc1155ListingNamespace(
      {
        async waitForTransactionReceipt() {
          return receipt();
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch: async () => new Response(JSON.stringify({ merkleRoot: apiRoot }), {
          headers: { 'Content-Type': 'application/json' },
        }),
        walletClient: {
          account: { address: account },
          writeContract,
        } as never,
      },
      'sepolia',
      addresses,
    );

    await expect(namespace.release.allowlist.setConfig({
      contract,
      tokenId: '1',
      artifact,
      endTime: 2_000,
    })).rejects.toThrow(`rare-api allowlist root ${apiRoot} does not match artifact root ${artifact.root}.`);
    expect(writeContract).not.toHaveBeenCalled();
  });

  it('skips rare-api upload for explicit ERC1155 release allowlist roots', async () => {
    const root = hex32('1');
    const writeContract = vi.fn(async () => hex32('2'));
    const apiFetch = vi.fn<typeof fetch>(async (): Promise<never> => {
      throw new Error('unexpected rare-api upload');
    });
    const namespace = createErc1155ListingNamespace(
      {
        async waitForTransactionReceipt() {
          return receipt();
        },
      } as never,
      {
        publicClient: {} as never,
        apiFetch,
        walletClient: {
          account: { address: account },
          writeContract,
        } as never,
      },
      'sepolia',
      addresses,
    );

    const result = await namespace.release.allowlist.setConfig({
      contract,
      tokenId: '1',
      root,
      endTime: 2_000,
    });

    expect(result.config.root).toBe(root);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(writeContract).toHaveBeenCalledOnce();
  });
});
