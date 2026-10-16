import { describe, expect, it } from 'vitest';
import { buildNftSearchQuery } from '../src/sdk/api-core.js';

describe('random NFT search', () => {
  it('preserves random sorting, filters and result limits', () => {
    expect(buildNftSearchQuery({ sortBy: 'random', chainId: 1, creatorAddress: '0x' + '1'.repeat(40), perPage: 1 })).toMatchObject({ sortBy: 'random', chainId: 1, creatorAddress: '0x' + '1'.repeat(40), perPage: 1 });
  });
  it('does not change the existing default sort', () => {
    expect(buildNftSearchQuery().sortBy).toBe('recentActivity');
  });
});
