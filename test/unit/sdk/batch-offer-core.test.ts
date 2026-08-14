import { describe, expect, it } from 'vitest';
import { zeroAddress } from 'viem';
import {
  planBatchOfferAccept,
  planBatchOfferCreate,
  planBatchOfferRoot,
  shapeBatchOfferRead,
  shapeBatchOfferStatus,
} from '../../../src/sdk/batch-offer-core.js';
import {
  buildBatchTokenTreeArtifact,
  getBatchTokenProof,
} from '../../../src/sdk/batch-core.js';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const CREATOR = '0x2222222222222222222222222222222222222222';
const CONTRACT = '0x3333333333333333333333333333333333333333';
const ROOT = '0xc9ea7316e48c69cf113a1746956da366068e750940ab24ae2633c3c55291f0cf';
const ZERO_ADDRESS = zeroAddress;
const ZERO_ROOT = '0x0000000000000000000000000000000000000000000000000000000000000000';

function buildArtifact(): ReturnType<typeof buildBatchTokenTreeArtifact> {
  return buildBatchTokenTreeArtifact({
    content: JSON.stringify([
      { contractAddress: CONTRACT, tokenId: '1' },
      { contractAddress: CONTRACT, tokenId: '2' },
    ]),
    format: 'json',
  });
}

describe('batch offer core', () => {
  it('plans create inputs from roots or artifacts', () => {
    const artifact = buildArtifact();

    expect(planBatchOfferCreate({
      artifact,
      price: '0.5',
      endTime: 200,
    }, 100n)).toEqual({
      root: ROOT,
      amount: 500000000000000000n,
      currency: ZERO_ADDRESS,
      expiry: 200n,
    });

    expect(planBatchOfferRoot({ root: ROOT })).toEqual({ root: ROOT });
  });

  it('rejects mismatched roots and expired create plans', () => {
    const artifact = buildArtifact();

    expect(() => planBatchOfferCreate({
      artifact,
      root: '0x1111111111111111111111111111111111111111111111111111111111111111',
      price: '0.5',
      endTime: 200,
    }, 100n)).toThrow('root does not match artifact root.');

    expect(() => planBatchOfferCreate({
      root: ROOT,
      price: '0.5',
      endTime: 100,
    }, 100n)).toThrow('expiry must be in the future.');
  });

  it('plans accept inputs with proof validation and seller splits', () => {
    const artifact = buildArtifact();
    const proof = getBatchTokenProof({
      artifact,
      contractAddress: CONTRACT,
      tokenId: 2,
    });

    expect(planBatchOfferAccept({
      creator: CREATOR,
      proofArtifact: proof,
      contract: CONTRACT,
      tokenId: '2',
      splitAddresses: [ACCOUNT],
      splitRatios: [100],
    }, ACCOUNT)).toEqual({
      creator: CREATOR,
      root: ROOT,
      proof: proof.proof,
      contract: CONTRACT,
      tokenId: 2n,
      splitAddresses: [ACCOUNT],
      splitRatios: [100],
      autoApprove: true,
    });
  });

  it('rejects invalid accept proofs and split ratios', () => {
    const artifact = buildArtifact();
    const proof = getBatchTokenProof({
      artifact,
      contractAddress: CONTRACT,
      tokenId: 2,
    });

    expect(() => planBatchOfferAccept({
      creator: CREATOR,
      proofArtifact: proof,
      contract: CONTRACT,
      tokenId: '1',
    }, ACCOUNT)).toThrow('Batch offer proof is not valid for the requested token.');

    expect(() => planBatchOfferAccept({
      creator: CREATOR,
      proofArtifact: proof,
      contract: CONTRACT,
      tokenId: '2',
      splitAddresses: [ACCOUNT],
      splitRatios: [99],
    }, ACCOUNT)).toThrow('splitRatios must sum to 100 (got 99).');
  });

  it('shapes active, expired, and absent batch offer statuses', () => {
    expect(shapeBatchOfferStatus({
      creator: CREATOR,
      rootHash: ROOT,
      amount: 10n,
      currency: ZERO_ADDRESS,
      expiry: 200n,
      feePercentage: 300n,
    }, { creator: CREATOR, root: ROOT }, 100n)).toMatchObject({
      hasOffer: true,
      expired: false,
      revoked: false,
      fillable: true,
      state: 'ACTIVE',
    });

    expect(shapeBatchOfferStatus({
      creator: CREATOR,
      rootHash: ROOT,
      amount: 10n,
      currency: ZERO_ADDRESS,
      expiry: 100n,
      feePercentage: 300n,
    }, { creator: CREATOR, root: ROOT }, 100n)).toMatchObject({
      hasOffer: true,
      expired: true,
      fillable: false,
      state: 'EXPIRED',
    });

    expect(shapeBatchOfferStatus({
      creator: ZERO_ADDRESS,
      rootHash: ZERO_ROOT,
      amount: 0n,
      currency: ZERO_ADDRESS,
      expiry: 0n,
      feePercentage: 0n,
    }, { creator: CREATOR, root: ROOT }, 100n)).toMatchObject({
      creator: CREATOR,
      root: ROOT,
      hasOffer: false,
      revoked: null,
      fillable: false,
      state: 'NONE',
    });
  });

  it('shapes raw batch offer reads', () => {
    expect(shapeBatchOfferRead([CREATOR, ROOT, 10n, ZERO_ADDRESS, 200n, 300n])).toEqual({
      creator: CREATOR,
      rootHash: ROOT,
      amount: 10n,
      currency: ZERO_ADDRESS,
      expiry: 200n,
      feePercentage: 300n,
    });
  });
});
