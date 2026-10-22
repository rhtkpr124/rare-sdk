import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../src/sdk/client.js';
import type { LiquidEdition } from '../../src/sdk/api.js';
import { createApiClient, RareApiError } from '../../src/data-access/index.js';

// Public dev editions verified on 2026-09-21. Missing/changed fixtures should
// fail visibly; never replace them with whichever editions happen to be newest.
const editions = [
  {
    contract: '0x1a9e355ba82542ef9d0654347026a63b09e53b26',
    name: 'LQE 9/21',
    creatorAddress: '0x817e2368138736c22366175bd67cdfa6eb95adcd',
    mediaType: 'IMAGE',
    mimeType: 'image/gif',
    tag: 'lqe',
  },
  {
    contract: '0xeedad60508165cffebb8f8b71a68bea3cc6ad235',
    name: 'Liquid Lens HTML Example',
    creatorAddress: '0x9242c7baa8f1a39ec3fc346052264bbc19a3192a',
    mediaType: 'HTML',
    mimeType: 'text/html',
    tag: undefined,
  },
] as const;

const baseUrl = process.env.RARE_API_INTEGRATION_URL
  ?? 'https://rare-api-devmainnet-784573620320.us-east1.run.app';
const requestTimeout = 20_000;
const testTimeout = 50_000;
const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(requestTimeout) });

function expectEdition(edition: LiquidEdition, fixture: typeof editions[number]) {
  expect(edition).toMatchObject({
    id: `${sepolia.id}-${fixture.contract}`,
    chainId: String(sepolia.id),
    contractAddress: fixture.contract,
    creatorAddress: fixture.creatorAddress,
    name: fixture.name,
    mediaType: fixture.mediaType,
    creator: { address: fixture.creatorAddress },
    stats: {
      decimals: expect.any(Number),
      totalSupply: expect.stringMatching(/^\d+$/),
      holderCount: expect.any(Number),
    },
    media: {
      image: { uri: expect.any(String), mimeType: expect.any(String) },
    },
  });
  for (const field of ['username', 'fullName', 'avatar'] as const) {
    expect(edition.creator[field] === null || typeof edition.creator[field] === 'string').toBe(true);
  }
  const media = fixture.mediaType === 'HTML' ? edition.media?.html : edition.media?.image;
  expect(media).toMatchObject({ uri: expect.any(String), mimeType: fixture.mimeType });
  expect(Number.isNaN(Date.parse(edition.createdAt))).toBe(false);
  expect(edition).not.toHaveProperty('holders');
  if (edition.currentPrice !== null) {
    expect(edition.currentPrice).toMatchObject({
      cryptoAmount: expect.any(String),
      usdAmount: expect.any(Number),
      currency: { address: expect.any(String), decimals: expect.any(Number), symbol: expect.any(String) },
    });
    expect(edition.currentPrice.usdAmount).toBeGreaterThanOrEqual(0);
  }
}

describe.skipIf(process.env.RARE_API_INTEGRATION !== '1')('live liquid edition discovery (dev Sepolia fixtures)', () => {
  const api = createRareClient({ apiBaseUrl: baseUrl, apiFetch: fetchWithTimeout });
  const rare = createRareClient({
    // Discovery is HTTP-only; an RPC connection and wallet are not needed.
    publicClient: createPublicClient({ chain: sepolia, transport: http() }),
    apiBaseUrl: baseUrl,
    apiFetch: fetchWithTimeout,
  });

  for (const fixture of editions) {
    it(`reads ${fixture.name} through RPC-free and chain-bound detail methods`, async () => {
      const [standalone, bound] = await Promise.all([
        api.liquidEdition.get({ chainId: sepolia.id, contract: fixture.contract }),
        rare.liquidEdition.get({ contract: fixture.contract }),
      ]);
      expectEdition(standalone, fixture);
      expectEdition(bound, fixture);
    }, testTimeout);

    it(`discovers ${fixture.name} with combined filters`, async () => {
      const result = await rare.search.liquidEditions({
        query: fixture.name,
        contractAddress: fixture.contract,
        creatorAddress: fixture.creatorAddress,
        mediaType: fixture.mediaType,
        // Match-any semantics: a nonexistent tag must not exclude the fixture.
        tags: fixture.tag ? ['sdk-integration-nonexistent-tag', fixture.tag] : undefined,
        perPage: 1,
      });
      expect(result.data).toHaveLength(1);
      expectEdition(result.data[0]!, fixture);
      expect(result.pagination).toEqual({ page: 1, perPage: 1, totalCount: 1, totalPages: 1 });
    }, testTimeout);
  }

  it('finds a known edition through RPC-free all-chain search', async () => {
    const result = await api.search.liquidEditions({ contractAddress: editions[0].contract });
    const edition = result.data.find((item) => item.id === `${sepolia.id}-${editions[0].contract}`);
    expect(edition).toBeDefined();
    expectEdition(edition!, editions[0]);
  }, testTimeout);

  it('reads a known edition through the typed low-level HTTP client', async () => {
    const client = createApiClient(baseUrl, fetchWithTimeout);
    const result = await client.GET('/v1/liquid-editions/{id}', {
      params: { path: { id: `${sepolia.id}-${editions[1].contract}` } },
    });
    expect(result.response.status).toBe(200);
    expectEdition(result.data!.data, editions[1]);
  }, testTimeout);

  it('paginates an exact contract search without repeating the first result', async () => {
    const result = await api.search.liquidEditions({
      chainId: sepolia.id, contractAddress: editions[0].contract, page: 2, perPage: 1,
    });
    expect(result.data).toEqual([]);
    expect(result.pagination).toEqual({ page: 2, perPage: 1, totalCount: 1, totalPages: 1 });
  }, testTimeout);

  it('excludes a known edition when the creator filter mismatches', async () => {
    const result = await rare.search.liquidEditions({
      contractAddress: editions[0].contract, creatorAddress: editions[1].creatorAddress,
    });
    expect(result.data).toEqual([]);
    expect(result.pagination.totalCount).toBe(0);
  }, testTimeout);

  it.each(['oldest', 'newest'] as const)(
    'orders live editions by creation time: %s', async (sortBy) => {
      const result = await rare.search.liquidEditions({ sortBy, perPage: 20 });
      expect(result.data.length).toBeGreaterThan(1);
      const timestamps = result.data.map((edition) => Date.parse(edition.createdAt));
      expect(timestamps.every(Number.isFinite)).toBe(true);
      expect(timestamps).toEqual(timestamps.toSorted((a, b) => sortBy === 'oldest' ? a - b : b - a));
    }, testTimeout,
  );

  it.each(['holderCountAsc', 'holderCountDesc'] as const)(
    'orders live editions by %s', async (sortBy) => {
      const result = await rare.search.liquidEditions({ sortBy, perPage: 20 });
      expect(result.data.length).toBeGreaterThan(1);
      const counts = result.data.map((edition) => edition.stats.holderCount);
      expect(counts.every((count) => Number.isInteger(count) && count >= 0)).toBe(true);
      expect(counts).toEqual(counts.toSorted((a, b) => sortBy === 'holderCountAsc' ? a - b : b - a));
    }, testTimeout,
  );

  it('preserves a real validation error for contradictory price filters', async () => {
    await expect(api.search.liquidEditions({ hasCurrentPrice: false, sortBy: 'priceAsc' }))
      .rejects.toMatchObject({ name: 'RareApiError', status: 400, path: '/v1/liquid-editions' });
  }, testTimeout);

  it('preserves a real missing-edition error', async () => {
    const id = `${sepolia.id}-0x0000000000000000000000000000000000000000`;
    await expect(api.liquidEdition.get({ chainId: sepolia.id, contract: '0x0000000000000000000000000000000000000000' })).rejects.toMatchObject({
      name: RareApiError.name, status: 404, path: `/v1/liquid-editions/${id}`,
    });
  }, testTimeout);
});
