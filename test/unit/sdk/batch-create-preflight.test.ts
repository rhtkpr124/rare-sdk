import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import { createBatchAuctionNamespace } from '../../../src/sdk/batch-auction.js';
import { createBatchOfferNamespace } from '../../../src/sdk/batch-offer.js';
import { buildBatchTokenTreeArtifact } from '../../../src/sdk/batch-core.js';
import type { RareClientConfig } from '../../../src/sdk/types/client.js';

const artifact = buildBatchTokenTreeArtifact({
  content: JSON.stringify([
    { contractAddress: '0x1111111111111111111111111111111111111111', tokenId: '1' },
    { contractAddress: '0x2222222222222222222222222222222222222222', tokenId: '2' },
  ]),
  format: 'json',
});

const config = {} as RareClientConfig;

describe('batch create local preflight ordering', () => {
  it('rejects an invalid offer price before block or API access', async () => {
    const getBlock = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const offer = createBatchOfferNamespace({ getBlock } as unknown as PublicClient, config, 'sepolia');

    await expect(offer.create({ artifact, price: 0n, endTime: '4102444800' })).rejects.toThrow(
      'price must be greater than 0.',
    );
    expect(getBlock).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects an expired auction before API root generation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const auction = createBatchAuctionNamespace({} as PublicClient, config, 'sepolia');

    await expect(auction.create({ artifact, price: 1_000_000_000_000_000_000n, endTime: '1' })).rejects.toThrow(
      'endTime must be in the future.',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects a mismatched artifact before API root generation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const auction = createBatchAuctionNamespace({} as PublicClient, config, 'sepolia');
    const invalidArtifact = {
      ...artifact,
      root: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const,
    };

    await expect(auction.create({ artifact: invalidArtifact, price: 1_000_000_000_000_000_000n, endTime: '4102444800' })).rejects.toThrow(
      'Batch token artifact root does not match its token list.',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
