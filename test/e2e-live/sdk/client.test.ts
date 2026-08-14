import { describe, expect, it, type TestContext } from 'vitest';
import { createPublicClient, getAddress, http } from 'viem';
import { baseSepolia, mainnet } from 'viem/chains';
import { getContractAddresses } from '../../../src/contracts/addresses.js';
import { RareApiError } from '../../../src/data-access/errors.js';
import { createRareClient } from '../../../src/sdk/client.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeLive = hasTestRpcUrl() ? describe : describe.skip;

describe('Rare SDK client API integration', () => {
  it('exposes read API methods through the client using public inputs', async (ctx) => {
    const rare = createRareClient({
      publicClient: createPublicClient({
        chain: mainnet,
        transport: http('http://127.0.0.1:8545'),
      }),
    });

    const nftSearch = await searchNftsOrSkip(ctx, () => rare.search.nfts({ page: 1, perPage: 1 }));
    const nftSearchResult = nftSearch.data[0];
    if (nftSearchResult === undefined) {
      throw new Error('Expected at least one NFT search result.');
    }

    const nft = await searchNftsOrSkip(ctx, () => rare.nft.get({
      contract: getAddress(nftSearchResult.contractAddress),
      tokenId: nftSearchResult.tokenId,
    }));
    expect(nft.universalTokenId).toBe(nftSearchResult.universalTokenId);

    const nftEvents = await searchNftsOrSkip(ctx, () => rare.search.events({
      contract: getAddress(nftSearchResult.contractAddress),
      tokenId: nftSearchResult.tokenId,
      page: 1,
      perPage: 1,
      eventType: ['CREATE_NFT'],
    }));
    expect(nftEvents.pagination).toMatchObject({ page: 1, perPage: 1 });
    expect(Array.isArray(nftEvents.data)).toBe(true);

    const collectionSearch = await searchNftsOrSkip(ctx, () => rare.search.collections({ page: 1, perPage: 1 }));
    const collectionSearchResult = collectionSearch.data[0];
    if (collectionSearchResult === undefined) {
      throw new Error('Expected at least one collection search result.');
    }

    const collection = await searchNftsOrSkip(ctx, () => rare.collection.get(collectionSearchResult.collectionId));
    expect(collection.collectionId).toBe(collectionSearchResult.collectionId);

    const collectionEvents = await searchNftsOrSkip(ctx, () => rare.search.events({
      collectionId: collectionSearchResult.collectionId,
      page: 1,
      perPage: 1,
      eventType: ['CREATE_NFT'],
    }));
    expect(collectionEvents.pagination).toMatchObject({ page: 1, perPage: 1 });
    expect(Array.isArray(collectionEvents.data)).toBe(true);

    const user = await searchNftsOrSkip(ctx, () => rare.user.get('0x510FF10EFfd8b645D177b04541544DD54067C839'));
    expect(user.address.toLowerCase()).toBe('0x510ff10effd8b645d177b04541544dd54067c839');
  }, 30_000);

  it('exposes the canonical batch and release namespaces without old aliases', () => {
    const rare = createRareClient({
      publicClient: createPublicClient({
        chain: mainnet,
        transport: http('http://127.0.0.1:8545'),
      }),
    });

    expect(rare.listing.batch).toBeDefined();
    expect(rare.offer.batch).toBeDefined();
    expect(rare.auction.batch).toBeDefined();
    expect(rare.listing.release.allowlist).toBeDefined();
    expect(rare.listing.release.limits).toBeDefined();
    expect('batch' in rare).toBe(false);
    expect('batchListing' in rare).toBe(false);
    expect('events' in rare.nft).toBe(false);
    expect('events' in rare.collection).toBe(false);
  });

  it('rejects per-call chain overrides on the bound SDK client', async () => {
    const rare = createRareClient({
      publicClient: createPublicClient({
        chain: mainnet,
        transport: http('http://127.0.0.1:8545'),
      }),
    });

    await expect(rare.search.nfts({
      // @ts-expect-error exercising runtime validation for JavaScript callers.
      chainId: 11_155_111,
      page: 1,
      perPage: 2,
    })).rejects.toThrow(
      'rare.search.nfts uses the RareClient chain (mainnet).',
    );
    await expect(rare.search.events({
      // @ts-expect-error exercising runtime validation for JavaScript callers.
      chain: 'sepolia',
      contract: '0x1000000000000000000000000000000000000000',
    })).rejects.toThrow(
      'rare.search.events uses the RareClient chain (mainnet).',
    );
    await expect(rare.nft.get({
      // @ts-expect-error exercising runtime validation for JavaScript callers.
      chainId: 11_155_111,
      contract: '0x1000000000000000000000000000000000000000',
      tokenId: 1,
    })).rejects.toThrow(
      'rare.nft.get uses the RareClient chain (mainnet).',
    );
  });

  it('exposes marketplace currency alias resolution through the SDK client', async () => {
    const rare = createRareClient({
      publicClient: createPublicClient({
        chain: mainnet,
        transport: http('http://127.0.0.1:8545'),
      }),
    });

    expect(rare.currency.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'eth', symbol: 'ETH', decimals: 18, isNative: true }),
      expect.objectContaining({ name: 'rare', symbol: 'RARE', decimals: 18 }),
      expect.objectContaining({ name: 'usdc', symbol: 'USDC', decimals: 6 }),
    ]));
    expect(rare.currency.resolve('usdc')).toEqual(expect.objectContaining({
      name: 'usdc',
      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      decimals: 6,
    }));
    await expect(rare.currency.resolveDecimals('rare')).resolves.toEqual(expect.objectContaining({
      name: 'rare',
      decimals: 18,
    }));
    // @ts-expect-error exercising runtime validation for an invalid user string.
    expect(() => rare.currency.resolve('doge')).toThrow(
      'Unknown currency "doge". Supported: eth, rare, usdc or a 0x address.',
    );
  });
});

describeLive('Rare SDK client live integration', () => {
  it('uses a real viem Sepolia public client for chain and contract resolution', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const rare = createRareClient({ publicClient });

    await expect(publicClient.getChainId()).resolves.toBe(11_155_111);
    expect(rare.chain).toBe('sepolia');
    expect(rare.chainId).toBe(11_155_111);
    expect(rare.contracts).toEqual(getContractAddresses('sepolia'));
    expect(rare.listing.release).toBeDefined();
    expect('release' in rare).toBe(false);
  }, 30_000);

  it('defaults NFT search requests to the real client chain ID', async (ctx) => {
    const rare = createRareClient({ publicClient: createTestSepoliaPublicClient() });

    const result = await searchNftsOrSkip(ctx, () => rare.search.nfts({ page: 1, perPage: 2 }));

    expect(result.pagination).toMatchObject({ page: 1, perPage: 2 });
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data.every((nft) => Number(nft.chainId) === 11_155_111)).toBe(true);
  }, 30_000);

  it('requires an owner for SDK import before posting to the API', async () => {
    const rare = createRareClient({ publicClient: createTestSepoliaPublicClient() });

    await expect(
      rare.import.erc721({ contract: '0x1000000000000000000000000000000000000000' }),
    ).rejects.toThrow('No owner available for import.');
  });

  it('requires a wallet for lazy batch mint deploys on chains with a configured lazy factory', async () => {
    const rare = createRareClient({
      // @ts-expect-error viem client transaction union differs between test and SDK entry imports.
      publicClient: createPublicClient({
        chain: baseSepolia,
        transport: http('http://127.0.0.1:8545'),
      }),
    });

    await expect(
      rare.collection.deploy.lazyBatchMint({ name: 'Lazy Collection', symbol: 'LC' }),
    ).rejects.toThrow('walletClient is required for write operations.');
  });
});

async function searchNftsOrSkip<T>(ctx: TestContext, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    skipIfRareApiUnavailable(ctx, error);
    throw error;
  }
}

function skipIfRareApiUnavailable(ctx: TestContext, error: unknown): void {
  if (error instanceof RareApiError && error.status >= 500) {
    ctx.skip(`Rare API ${error.path} returned ${error.status}.`);
  }
}
