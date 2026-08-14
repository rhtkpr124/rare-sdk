import { describe, expect, it } from 'vitest';
import { buildNftUniversalTokenId } from '../../../src/sdk/nft-core.js';

const contract = '0xb932a70A57673d89f4ACFfBE830E8ed7f75Fb9E0';

describe('nft identity core', () => {
  it('builds API token IDs from chain ID, contract, and token ID', () => {
    expect(
      buildNftUniversalTokenId({
        chainId: 1,
        contract,
        tokenId: '12345',
      }),
    ).toBe('1-0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0-12345');
  });

  it('resolves supported chain names into chain IDs', () => {
    expect(
      buildNftUniversalTokenId({
        chain: 'sepolia',
        contract,
        tokenId: 7,
      }),
    ).toBe('11155111-0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0-7');
  });

  it('rejects missing or invalid chain and token IDs', () => {
    expect(() =>
      buildNftUniversalTokenId({
        contract,
        tokenId: 1,
      }),
    ).toThrow('Pass chainId or chain.');

    expect(() =>
      buildNftUniversalTokenId({
        chainId: 0,
        contract,
        tokenId: 1,
      }),
    ).toThrow('chainId must be greater than 0.');

    expect(() =>
      buildNftUniversalTokenId({
        chainId: 1,
        contract,
        tokenId: -1,
      }),
    ).toThrow('tokenId must be greater than or equal to 0.');
  });
});
