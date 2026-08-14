import { describe, expect, it } from 'vitest';
import { buildCollectionId, resolveEventSearchTarget } from '../../../src/sdk/event-search-core.js';

const contract = '0xb932a70A57673d89f4ACFfBE830E8ed7f75Fb9E0';

describe('event search core', () => {
  it('builds collection IDs from chain and contract filters', () => {
    expect(buildCollectionId({ chainId: 1, contract })).toBe(
      '1-0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0',
    );
    expect(buildCollectionId({ chain: 'sepolia', contract })).toBe(
      '11155111-0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0',
    );
  });

  it('resolves NFT event targets when token ID is present', () => {
    expect(resolveEventSearchTarget({ chainId: 1, contract, tokenId: 123 })).toEqual({
      kind: 'nft',
      universalTokenId: '1-0xb932a70A57673d89f4acfFBE830E8ed7f75Fb9e0-123',
    });
  });

  it('resolves collection event targets from collection ID or contract filters', () => {
    expect(resolveEventSearchTarget({ collectionId: '1-0xabc' })).toEqual({
      kind: 'collection',
      collectionId: '1-0xabc',
    });
    expect(resolveEventSearchTarget({ chainId: 1, contract })).toEqual({
      kind: 'collection',
      collectionId: '1-0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0',
    });
  });

  it('rejects ambiguous or incomplete targets', () => {
    expect(() => resolveEventSearchTarget({ collectionId: '1-0xabc', contract })).toThrow(
      'Pass either collectionId or NFT filters, not both.',
    );
    expect(() => resolveEventSearchTarget({})).toThrow(
      'Pass collectionId, or pass contract with chain/chainId.',
    );
    expect(() => resolveEventSearchTarget({ contract })).toThrow('Pass chainId or chain.');
  });
});
