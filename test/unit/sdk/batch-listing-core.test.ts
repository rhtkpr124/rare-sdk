import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { ETH_ADDRESS } from '../../../src/contracts/addresses.js';
import { buildBatchTokenTreeArtifact } from '../../../src/sdk/batch-core.js';
import {
  parseBatchListingCreateRootArtifactInput,
  planBatchListingCreateArtifact,
  planBatchListingRootRegistration,
  shapeBatchListingStatus,
  shouldResolveBatchListingAllowListProof,
  uniqueAddresses,
  validateBatchListingBuyProofPolicy,
} from '../../../src/sdk/batch-listing-core.js';
import type { BatchListingRootArtifact } from '../../../src/sdk/batch-listing.js';
import type { BatchListingProofArtifact } from '../../../src/sdk/types/batch-listing.js';

const seller: Address = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const collaborator: Address = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const contract: Address = '0x1111111111111111111111111111111111111111';
const otherContract: Address = '0x2222222222222222222222222222222222222222';
const root: `0x${string}` = `0x${'22'.repeat(32)}`;
const allowListRoot: `0x${string}` = `0x${'33'.repeat(32)}`;

const artifact = {
  root,
  currency: ETH_ADDRESS,
  amount: '1',
  splitAddresses: [],
  splitRatios: [],
  tokens: [
    { contract, tokenId: '1' },
    { contract, tokenId: '2' },
  ],
} satisfies BatchListingRootArtifact;

describe('batch listing core', () => {
  it('deduplicates addresses without changing first-seen order', () => {
    expect(uniqueAddresses([contract, otherContract, contract])).toEqual([contract, otherContract]);
  });

  it('parses root artifact inputs without treating token trees as listing roots', () => {
    expect(parseBatchListingCreateRootArtifactInput(artifact)).toBe(artifact);
    expect(parseBatchListingCreateRootArtifactInput({
      version: 1,
      type: 'rare-batch-token-list',
      root,
      count: 2,
      tokens: [
        { contractAddress: contract, tokenId: '1' },
        { contractAddress: contract, tokenId: '2' },
      ],
      entries: [],
    })).toBeUndefined();
    expect(() => parseBatchListingCreateRootArtifactInput({})).toThrow('root must be a 0x-prefixed bytes32 hex string');
  });

  it('plans batch listing create artifacts from root and token-tree inputs', () => {
    expect(planBatchListingCreateArtifact({
      kind: 'root-artifact',
      artifact,
      currencyOverride: collaborator,
      amountOverride: '2',
      splitAddresses: [seller, collaborator],
      splitRatios: [60, 40],
    })).toEqual({
      ...artifact,
      currency: collaborator,
      amount: '2',
      splitAddresses: [seller, collaborator],
      splitRatios: [60, 40],
    });

    const tokenTree = buildBatchTokenTreeArtifact({
      content: JSON.stringify([
        { contractAddress: otherContract, tokenId: '2' },
        { contractAddress: contract, tokenId: '1' },
      ]),
      format: 'json',
      chainId: 11_155_111,
    });

    expect(planBatchListingCreateArtifact({
      kind: 'token-tree',
      artifact: tokenTree,
      currency: ETH_ADDRESS,
      amount: '10',
    })).toEqual({
      root: tokenTree.root,
      currency: ETH_ADDRESS,
      amount: '10',
      splitAddresses: [],
      splitRatios: [],
      tokens: [
        { contract, tokenId: '1' },
        { contract: otherContract, tokenId: '2' },
      ],
    });
  });

  it('rejects incomplete root artifact overrides while planning batch listing create artifacts', () => {
    expect(() => planBatchListingCreateArtifact({
      kind: 'root-artifact',
      artifact,
      currencyOverride: collaborator,
    })).toThrow('--currency requires --price when overriding a batch listing root artifact.');
  });

  it('plans default and explicit root registration splits', () => {
    expect(planBatchListingRootRegistration(artifact, seller)).toEqual({
      splitAddresses: [seller],
      splitRatios: [100],
    });

    expect(planBatchListingRootRegistration({
      ...artifact,
      splitAddresses: [seller, collaborator],
      splitRatios: [70, 30],
    }, seller)).toEqual({
      splitAddresses: [seller, collaborator],
      splitRatios: [70, 30],
    });
  });

  it('rejects root registrations that would produce empty contract proofs', () => {
    expect(() =>
      planBatchListingRootRegistration({
        ...artifact,
        tokens: [{ contract, tokenId: '1' }],
      }, seller),
    ).toThrow(/at least two tokens/);

    expect(() =>
      planBatchListingRootRegistration({
        ...artifact,
        allowList: {
          root: allowListRoot,
          addresses: [seller],
          endTimestamp: '1234',
        },
      }, seller),
    ).toThrow(/Allowlist must contain at least two addresses/);
  });

  it('rejects invalid explicit root registration splits', () => {
    expect(() =>
      planBatchListingRootRegistration({
        ...artifact,
        splitAddresses: [seller, collaborator],
        splitRatios: [100],
      }, seller),
    ).toThrow('splitAddresses and splitRatios must have the same length.');

    expect(() =>
      planBatchListingRootRegistration({
        ...artifact,
        splitAddresses: [seller, collaborator],
        splitRatios: [80, 10],
      }, seller),
    ).toThrow('splitRatios must sum to 100 (got 90).');
  });

  it('decides when an active allowlist proof needs API resolution', () => {
    const tokenProof: BatchListingProofArtifact = {
      root,
      contract,
      tokenId: '1',
      proof: [`0x${'44'.repeat(32)}`],
    };
    const allowList = { root: allowListRoot, endTimestamp: 100n };

    expect(shouldResolveBatchListingAllowListProof({
      allowList,
      tokenProof,
      nowTimestamp: 99n,
    })).toBe(true);
    expect(shouldResolveBatchListingAllowListProof({
      allowList,
      tokenProof,
      nowTimestamp: 100n,
    })).toBe(false);
    expect(shouldResolveBatchListingAllowListProof({
      allowList,
      tokenProof: { ...tokenProof, allowListProof: [`0x${'55'.repeat(32)}`] },
      nowTimestamp: 99n,
    })).toBe(false);
  });

  it('validates batch listing proof policy separately from artifact shape', () => {
    const tokenProof: BatchListingProofArtifact = {
      root,
      contract,
      tokenId: '1',
      proof: [`0x${'44'.repeat(32)}`],
    };
    const allowList = { root: allowListRoot, endTimestamp: 100n };

    expect(validateBatchListingBuyProofPolicy({
      allowList: undefined,
      tokenProof: { ...tokenProof, proof: [] },
      nowTimestamp: undefined,
    })).toMatchObject({
      isValid: false,
      error: 'empty-token-proof',
    });

    expect(validateBatchListingBuyProofPolicy({
      allowList,
      tokenProof: { ...tokenProof, allowListProof: [] },
      nowTimestamp: 99n,
    })).toMatchObject({
      isValid: false,
      error: 'empty-active-allowlist-proof',
    });

    expect(validateBatchListingBuyProofPolicy({
      allowList,
      tokenProof: { ...tokenProof, allowListProof: [] },
      nowTimestamp: 100n,
    })).toEqual({ isValid: true });
  });

  it('shapes active and cancelled status from read results', () => {
    const active = shapeBatchListingStatus({
      root,
      creator: seller,
      listingConfig: {
        currency: ETH_ADDRESS,
        amount: 1n,
        splitRecipients: [seller],
        splitRatios: [100],
        nonce: 3n,
      },
      cancellationNonce: 3n,
      allowList: undefined,
      tokenStatus: { tokenInRoot: true, tokenNonce: 0n },
    });

    expect(active).toMatchObject({
      root,
      seller,
      currencyAddress: ETH_ADDRESS,
      amount: 1n,
      splitRecipients: [seller],
      splitRatios: [100],
      nonce: 3n,
      isEth: true,
      hasListing: true,
      tokenInRoot: true,
      tokenNonce: 0n,
    });

    expect(shapeBatchListingStatus({
      root,
      creator: seller,
      listingConfig: {
        currency: ETH_ADDRESS,
        amount: 1n,
        splitRecipients: [],
        splitRatios: [],
        nonce: 3n,
      },
      cancellationNonce: 4n,
      allowList: undefined,
      tokenStatus: {},
    }).hasListing).toBe(false);
  });
});
