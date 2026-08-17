import { isAddressEqual, type Address, type Hex } from 'viem';
import { ETH_ADDRESS } from '../contracts/addresses.js';
import {
  toNonNegativeInteger,
  toPositiveWei,
} from './amounts-core.js';
import {
  requireInput,
  toUnixTimestamp,
} from './validation-core.js';
import { normalizeBytes32, verifyBatchTokenProof } from './batch-core.js';
import { planPayoutSplits } from './splits-core.js';
import type {
  BatchOfferAcceptParams,
  BatchOfferCreateParams,
  BatchOfferStatus,
  BatchOfferStatusParams,
  BatchOfferRevokeParams,
} from './types/batch-offer.js';

type ResolvedCurrencyParam<T extends { currency?: unknown }> = Omit<T, 'currency'> & {
  currency?: Address;
};

export type BatchOfferCreatePlan = {
  root: Hex;
  amount: bigint;
  currency: Address;
  expiry: bigint;
};

export type BatchOfferCreateLocalInputsPlan = Pick<BatchOfferCreatePlan, 'root' | 'amount' | 'expiry'>;

export type BatchOfferRootPlan = {
  root: Hex;
};

export type BatchOfferAcceptPlan = {
  creator: Address;
  root: Hex;
  proof: Hex[];
  contract: Address;
  tokenId: bigint;
  splitAddresses: Address[];
  splitRatios: number[];
  autoApprove: boolean;
};

export type BatchOfferAcceptLocalInputsPlan = Pick<BatchOfferAcceptPlan, 'tokenId'>;

export type BatchOfferRead = {
  creator: Address;
  rootHash: Hex;
  amount: bigint;
  currency: Address;
  expiry: bigint;
  feePercentage?: bigint;
};

type BatchOfferReadTuple = readonly [Address, Hex, bigint, Address, bigint, bigint?];

const zeroAddress = ETH_ADDRESS;
const zeroBytes32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

export function planBatchOfferCreateLocalInputs(
  params: ResolvedCurrencyParam<BatchOfferCreateParams>,
  nowSeconds?: bigint,
): BatchOfferCreateLocalInputsPlan {
  const expiry = toUnixTimestamp(
    requireInput(params.endTime, 'endTime'),
    'endTime',
  );
  if (nowSeconds !== undefined && expiry <= nowSeconds) {
    throw new Error('expiry must be in the future.');
  }

  const price = requireInput(params.price, 'price');

  return {
    root: resolveBatchOfferRoot(params),
    amount: toPositiveWei(price, 'price'),
    expiry,
  };
}

export function planBatchOfferCreate(
  params: ResolvedCurrencyParam<BatchOfferCreateParams>,
  nowSeconds?: bigint,
): BatchOfferCreatePlan {
  return {
    ...planBatchOfferCreateLocalInputs(params, nowSeconds),
    currency: params.currency ?? ETH_ADDRESS,
  };
}

export function planBatchOfferRoot(params: BatchOfferRevokeParams | BatchOfferStatusParams): BatchOfferRootPlan {
  return {
    root: resolveBatchOfferRoot(params),
  };
}

export function planBatchOfferAcceptLocalInputs(
  params: Pick<BatchOfferAcceptParams, 'tokenId'>,
): BatchOfferAcceptLocalInputsPlan {
  return {
    tokenId: toNonNegativeInteger(params.tokenId, 'tokenId'),
  };
}

export function planBatchOfferAccept(
  params: BatchOfferAcceptParams,
  accountAddress: Address,
): BatchOfferAcceptPlan {
  const local = planBatchOfferAcceptLocalInputs(params);
  const root = resolveBatchOfferProofRoot(params);
  const proof = resolveBatchOfferProof(params);

  if (!verifyBatchTokenProof({
    root,
    contractAddress: params.contract,
    tokenId: local.tokenId,
    proof,
  })) {
    throw new Error('Batch offer proof is not valid for the requested token.');
  }

  return {
    creator: params.creator,
    root,
    proof,
    contract: params.contract,
    tokenId: local.tokenId,
    ...planSplitRecipients(params.splitAddresses, params.splitRatios, accountAddress),
    autoApprove: params.autoApprove ?? false,
  };
}

export function shapeBatchOfferStatus(
  offer: BatchOfferRead,
  expected: {
    creator: Address;
    root: Hex;
  },
  nowSeconds: bigint,
): BatchOfferStatus {
  const hasOffer = (
    !isAddressEqual(offer.creator, zeroAddress) &&
    offer.rootHash !== zeroBytes32 &&
    offer.amount > 0n
  );
  const expired = hasOffer && offer.expiry <= nowSeconds;
  const state: BatchOfferStatus['state'] = !hasOffer
    ? 'NONE'
    : expired
      ? 'EXPIRED'
      : 'ACTIVE';

  return {
    creator: hasOffer ? offer.creator : expected.creator,
    root: hasOffer ? offer.rootHash : expected.root,
    amount: offer.amount,
    currency: offer.currency,
    expiry: offer.expiry,
    feePercentage: offer.feePercentage ?? 0n,
    hasOffer,
    expired,
    revoked: hasOffer ? false : null,
    fillable: hasOffer && !expired,
    state,
    isEth: isAddressEqual(offer.currency, ETH_ADDRESS),
  };
}

export function shapeBatchOfferRead(value: BatchOfferReadTuple | BatchOfferRead): BatchOfferRead {
  if ('creator' in value) {
    return value;
  }

  const [creator, rootHash, amount, currency, expiry, feePercentage] = value;
  return {
    creator,
    rootHash,
    amount,
    currency,
    expiry,
    feePercentage,
  };
}

export function resolveBatchOfferRoot(params: {
  root?: Hex;
  artifact?: { root: Hex };
}): Hex {
  if (params.root !== undefined && params.artifact !== undefined) {
    const root = normalizeBytes32(params.root, 'root');
    if (root !== normalizeBytes32(params.artifact.root, 'artifact root')) {
      throw new Error('root does not match artifact root.');
    }
    return root;
  }
  if (params.root !== undefined) {
    return normalizeBytes32(params.root, 'root');
  }
  if (params.artifact !== undefined) {
    return normalizeBytes32(params.artifact.root, 'artifact root');
  }
  throw new Error('Pass a batch token artifact, or pass root as an override.');
}

function resolveBatchOfferProofRoot(params: BatchOfferAcceptParams): Hex {
  if (params.root !== undefined && params.proofArtifact !== undefined) {
    const root = normalizeBytes32(params.root, 'root');
    if (root !== normalizeBytes32(params.proofArtifact.root, 'proof artifact root')) {
      throw new Error('root does not match proof artifact root.');
    }
    return root;
  }
  if (params.root !== undefined) {
    return normalizeBytes32(params.root, 'root');
  }
  if (params.proofArtifact !== undefined) {
    return normalizeBytes32(params.proofArtifact.root, 'proof artifact root');
  }
  throw new Error('Pass a batch token proof artifact, or pass root as an override.');
}

function resolveBatchOfferProof(params: BatchOfferAcceptParams): Hex[] {
  const proof = params.proof ?? params.proofArtifact?.proof;
  if (proof === undefined) {
    throw new Error('Pass a batch token proof artifact, or pass proof as an override.');
  }

  return proof.map((entry, index) => normalizeBytes32(entry, `proof[${index}]`));
}

function planSplitRecipients(
  splitAddresses: Address[] | undefined,
  splitRatios: number[] | undefined,
  accountAddress: Address,
): Pick<BatchOfferAcceptPlan, 'splitAddresses' | 'splitRatios'> {
  const splits = planPayoutSplits(splitAddresses, splitRatios, accountAddress);
  return {
    splitAddresses: splits.addresses,
    splitRatios: splits.ratios,
  };
}
