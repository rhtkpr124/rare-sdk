import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../src/sdk/client.js';

describe('random NFT search through the SDK and real API', () => {
  it('returns a random NFT and respects chain, contract and limit filters', async () => {
    const baseUrl = process.env.RARE_ACCOUNT_TEST_API_URL;
    if (!baseUrl) throw new Error('Missing RARE_ACCOUNT_TEST_API_URL');
    const api = createRareClient({ apiBaseUrl: baseUrl });
    const random = await api.search.nfts({ sortBy: 'random', chainId: 1, perPage: 1 });
    expect(random.data).toHaveLength(1);
    expect(random.data[0]?.chainId).toBe('1');
    const contract = random.data[0]?.contractAddress;
    if (!contract) throw new Error('Expected a public NFT fixture');
    const filtered = await api.search.nfts({ sortBy: 'random', chainId: 1, contractAddress: contract, perPage: 3 });
    expect(filtered.data.length).toBeGreaterThan(0);
    expect(filtered.data.length).toBeLessThanOrEqual(3);
    expect(filtered.data.every(nft => nft.chainId === '1' && nft.contractAddress.toLowerCase() === contract.toLowerCase())).toBe(true);
  }, 60000);
});
