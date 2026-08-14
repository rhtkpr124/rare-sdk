import { describe, expect, it } from 'vitest';
import { zeroAddress, type Address } from 'viem';
import {
  addMarketplaceFee,
  planBatchAuctionBid,
  planBatchAuctionCreate,
  planBatchAuctionRoot,
  planBatchAuctionStatus,
  shapeBatchAuctionCurrentBidRead,
  shapeBatchAuctionDetailsRead,
  shapeBatchAuctionMerkleConfigRead,
  shapeBatchAuctionStatus,
} from '../../../src/sdk/batch-auction-core.js';
import {
  buildBatchTokenTreeArtifact,
  getBatchTokenProof,
} from '../../../src/sdk/batch-core.js';

const ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
const CREATOR: Address = '0x2222222222222222222222222222222222222222';
const CONTRACT: Address = '0x3333333333333333333333333333333333333333';
const ROOT: `0x${string}` = '0xc9ea7316e48c69cf113a1746956da366068e750940ab24ae2633c3c55291f0cf';
const ZERO_ADDRESS = zeroAddress;
const NOW_SECONDS = 1767225600n;
const END_TIME = '1767229200';

function buildArtifact(): ReturnType<typeof buildBatchTokenTreeArtifact> {
  return buildBatchTokenTreeArtifact({
    content: JSON.stringify([
      { contractAddress: CONTRACT, tokenId: '1' },
      { contractAddress: CONTRACT, tokenId: '2' },
    ]),
    format: 'json',
  });
}

describe('batch auction core', () => {
  it('plans create inputs with artifact-backed approvals', () => {
    const artifact = buildArtifact();

    expect(planBatchAuctionCreate({
      artifact,
      price: '0.5',
      endTime: END_TIME,
    }, ACCOUNT, NOW_SECONDS)).toEqual({
      root: ROOT,
      currency: ZERO_ADDRESS,
      reserveAmount: 500000000000000000n,
      duration: 3600n,
      splitAddresses: [ACCOUNT],
      splitRatios: [100],
      approvalContracts: [CONTRACT],
    });

    expect(planBatchAuctionRoot({ root: ROOT })).toEqual({ root: ROOT });
  });

  it('plans approval contracts independently from auto approval and validates create inputs', () => {
    const artifact = buildArtifact();

    expect(planBatchAuctionCreate({
      artifact,
      price: '0.5',
      endTime: END_TIME,
      autoApprove: false,
    }, ACCOUNT, NOW_SECONDS).approvalContracts).toEqual([CONTRACT]);

    expect(() => planBatchAuctionCreate({
      artifact,
      root: '0x1111111111111111111111111111111111111111111111111111111111111111',
      price: '0.5',
      endTime: END_TIME,
    }, ACCOUNT, NOW_SECONDS)).toThrow('root does not match artifact root.');

    expect(() => planBatchAuctionCreate({
      root: ROOT,
      price: '0',
      endTime: END_TIME,
    }, ACCOUNT, NOW_SECONDS)).toThrow('price must be greater than 0.');
  });

  it('plans proof-backed bids and fee-inclusive payment', () => {
    const artifact = buildArtifact();
    const proof = getBatchTokenProof({
      artifact,
      contractAddress: CONTRACT,
      tokenId: 2,
    });

    expect(planBatchAuctionBid({
      creator: CREATOR,
      proofArtifact: proof,
      contract: CONTRACT,
      tokenId: '2',
      price: '1',
    })).toEqual({
      creator: CREATOR,
      root: ROOT,
      proof: proof.proof,
      contract: CONTRACT,
      tokenId: 2n,
      currency: ZERO_ADDRESS,
      amount: 1000000000000000000n,
      requiredPayment: 1030000000000000000n,
    });
    expect(addMarketplaceFee(100n)).toBe(103n);
  });

  it('rejects invalid bid and status proofs', () => {
    const artifact = buildArtifact();
    const proof = getBatchTokenProof({
      artifact,
      contractAddress: CONTRACT,
      tokenId: 2,
    });

    expect(() => planBatchAuctionBid({
      creator: CREATOR,
      proofArtifact: proof,
      contract: CONTRACT,
      tokenId: '1',
      price: '1',
    })).toThrow('Batch auction proof is not valid for the requested token.');

    expect(() => planBatchAuctionStatus({
      proofArtifact: proof,
      contract: CONTRACT,
      tokenId: '1',
    })).toThrow('Batch auction proof is not valid for the requested token.');
  });

  it('shapes configured, active, ended, and empty statuses', () => {
    const inactiveDetails = {
      seller: ZERO_ADDRESS,
      creationBlock: 0n,
      startingTime: 0n,
      duration: 0n,
      currency: ZERO_ADDRESS,
      reserveAmount: 0n,
      splitAddresses: [],
      splitRatios: [],
    };
    const emptyBid = {
      bidder: ZERO_ADDRESS,
      currency: ZERO_ADDRESS,
      amount: 0n,
      marketplaceFee: 0,
    };
    const rootContext = {
      creator: CREATOR,
      root: ROOT,
      config: {
        currency: ZERO_ADDRESS,
        reserveAmount: 10n,
        duration: 60n,
        nonce: 1,
        splitAddresses: [CREATOR],
        splitRatios: [100],
      },
      rootNonce: 1,
      tokenNonce: 0,
    };

    expect(shapeBatchAuctionStatus(inactiveDetails, emptyBid, rootContext, 100n)).toMatchObject({
      state: 'RESERVE_NOT_MET',
      hasRootConfig: true,
      hasAuction: false,
      reserveAmount: 10n,
      seller: CREATOR,
      root: ROOT,
    });

    expect(shapeBatchAuctionStatus(inactiveDetails, emptyBid, {
      ...rootContext,
      rootNonce: 2,
    }, 100n)).toMatchObject({
      state: 'NONE',
      hasRootConfig: false,
      tokenNonceConsumed: true,
      hasAuction: false,
      reserveAmount: 0n,
      duration: 0n,
      splitAddresses: [],
      splitRatios: [],
      seller: CREATOR,
      root: ROOT,
      rootNonce: 2,
    });

    const activeDetails = {
      ...inactiveDetails,
      seller: CREATOR,
      creationBlock: 123n,
      startingTime: 100n,
      duration: 60n,
      reserveAmount: 10n,
    };
    expect(shapeBatchAuctionStatus(activeDetails, {
      bidder: ACCOUNT,
      currency: ZERO_ADDRESS,
      amount: 12n,
      marketplaceFee: 3,
    }, rootContext, 120n)).toMatchObject({
      state: 'ACTIVE',
      hasAuction: true,
      currentBidder: ACCOUNT,
      settlementEligible: false,
      minimumNextBid: 12n,
    });

    expect(shapeBatchAuctionStatus(activeDetails, {
      bidder: ACCOUNT,
      currency: ZERO_ADDRESS,
      amount: 12n,
      marketplaceFee: 3,
    }, rootContext, 161n)).toMatchObject({
      state: 'ENDED',
      ended: true,
      settlementEligible: true,
    });

    expect(shapeBatchAuctionStatus(inactiveDetails, emptyBid, undefined, 100n)).toMatchObject({
      state: 'NONE',
      hasRootConfig: false,
      hasAuction: false,
      root: null,
    });
  });

  it('shapes raw batch auction reads', () => {
    expect(shapeBatchAuctionDetailsRead([
      CREATOR,
      123,
      100n,
      60n,
      ZERO_ADDRESS,
      10n,
      [CREATOR],
      [100],
    ])).toEqual({
      seller: CREATOR,
      creationBlock: 123n,
      startingTime: 100n,
      duration: 60n,
      currency: ZERO_ADDRESS,
      reserveAmount: 10n,
      splitAddresses: [CREATOR],
      splitRatios: [100],
    });
    expect(shapeBatchAuctionCurrentBidRead([ACCOUNT, ZERO_ADDRESS, 12n, 3])).toEqual({
      bidder: ACCOUNT,
      currency: ZERO_ADDRESS,
      amount: 12n,
      marketplaceFee: 3,
    });
    expect(shapeBatchAuctionMerkleConfigRead({
      currency: ZERO_ADDRESS,
      startingAmount: 10n,
      duration: 60n,
      nonce: 1,
      splitAddresses: [CREATOR],
      splitRatios: [100],
    })).toEqual({
      currency: ZERO_ADDRESS,
      reserveAmount: 10n,
      duration: 60n,
      nonce: 1,
      splitAddresses: [CREATOR],
      splitRatios: [100],
    });
  });
});
