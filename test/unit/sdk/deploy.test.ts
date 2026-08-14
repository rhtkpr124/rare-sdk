import { describe, expect, it, vi } from 'vitest';
import { createPublicClient, createWalletClient, custom } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';
import { createDeployNamespace } from '../../../src/sdk/deploy.js';

const account = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
);
const factory = '0x1111111111111111111111111111111111111111';
const lazyBatchMintFactory = '0x2222222222222222222222222222222222222222';

function createTestDeployNamespace(): {
  deploy: ReturnType<typeof createDeployNamespace>;
  request: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn(async () => {
    throw new Error('unexpected RPC request');
  });
  const transport = custom({ request });
  const publicClient = createPublicClient({ chain: mainnet, transport });
  const walletClient = createWalletClient({ account, chain: mainnet, transport });

  const config = {
    publicClient,
    walletClient,
  };

  return {
    deploy: createDeployNamespace(publicClient, config, { factory, lazyBatchMintFactory }),
    request,
  };
}

function createReadOnlyDeployNamespace(addresses: {
  factory?: typeof factory;
  lazyBatchMintFactory?: typeof lazyBatchMintFactory;
} = {}): ReturnType<typeof createDeployNamespace> {
  const request = vi.fn(async () => {
    throw new Error('unexpected RPC request');
  });
  const transport = custom({ request });
  const publicClient = createPublicClient({ chain: mainnet, transport });

  return createDeployNamespace(publicClient, { publicClient }, {
    factory: addresses.factory ?? factory,
    lazyBatchMintFactory: addresses.lazyBatchMintFactory,
  });
}

describe('SDK collection deploy namespace', () => {
  it('rejects non-positive ERC-721 maxTokens before writing', async () => {
    const { deploy, request } = createTestDeployNamespace();

    await expect(deploy.erc721({
      name: 'Invalid Cap',
      symbol: 'CAP',
      maxTokens: 0,
    })).rejects.toThrow('maxTokens must be greater than 0.');

    await expect(deploy.erc721({
      name: 'Invalid Cap',
      symbol: 'CAP',
      maxTokens: '-1',
    })).rejects.toThrow('maxTokens must be greater than 0.');

    expect(request).not.toHaveBeenCalled();
  });

  it('rejects non-positive ERC-721 maxTokens before requiring a wallet', async () => {
    const deploy = createReadOnlyDeployNamespace();

    await expect(deploy.erc721({
      name: 'Invalid Cap',
      symbol: 'CAP',
      maxTokens: 0,
    })).rejects.toThrow('maxTokens must be greater than 0.');
  });

  it('rejects non-positive lazy batch mint maxTokens before writing', async () => {
    const { deploy, request } = createTestDeployNamespace();

    await expect(deploy.lazyBatchMint({
      name: 'Invalid Lazy Cap',
      symbol: 'LCAP',
      maxTokens: 0n,
    })).rejects.toThrow('maxTokens must be greater than 0.');

    await expect(deploy.lazyBatchMint({
      name: 'Invalid Lazy Cap',
      symbol: 'LCAP',
      maxTokens: -1,
    })).rejects.toThrow('maxTokens must be greater than 0.');

    expect(request).not.toHaveBeenCalled();
  });

  it('rejects non-positive lazy batch mint maxTokens before wallet and factory guards', async () => {
    const deploy = createReadOnlyDeployNamespace();

    await expect(deploy.lazyBatchMint({
      name: 'Invalid Lazy Cap',
      symbol: 'LCAP',
      maxTokens: 0,
    })).rejects.toThrow('maxTokens must be greater than 0.');
  });
});
