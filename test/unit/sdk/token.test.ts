import { describe, expect, it, vi } from 'vitest';
import {
  createPublicClient,
  custom,
} from 'viem';
import { mainnet } from 'viem/chains';
import { createTokenNamespace } from '../../../src/sdk/token.js';

const contract = '0x1111111111111111111111111111111111111111';

describe('SDK token namespace', () => {
  it('rejects negative token IDs before token reads', async () => {
    const readContract = vi.fn();
    const publicClient = createPublicClient({
      chain: mainnet,
      transport: custom({
        async request(): Promise<never> {
          readContract();
          throw new Error('unexpected RPC call');
        },
      }),
    });
    const token = createTokenNamespace(publicClient, 'mainnet');

    await expect(token.status({ contract, tokenId: '-1' })).rejects.toThrow(
      'tokenId must be greater than or equal to 0.',
    );
    expect(readContract).not.toHaveBeenCalled();
  });
});
