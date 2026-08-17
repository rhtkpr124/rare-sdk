import type { Address, Hash } from 'viem';
import type { AmountInput, CurrencyInput, IntegerInput, TimestampInput, TransactionResult } from './common.js';
import type { BatchTokenListArtifact } from '../batch-core.js';

export type BatchListingTokenEntry = {
  contract: Address;
  tokenId: IntegerInput;
}

export type BatchListingRootArtifact = {
  root: `0x${string}`;
  currency: Address;
  amount: string;
  splitAddresses: Address[];
  splitRatios: number[];
  tokens: { contract: Address; tokenId: string }[];
  allowList?: { root: `0x${string}`; addresses: Address[]; endTimestamp?: string };
}

export type BatchListingProofArtifact = {
  root: `0x${string}`;
  contract: Address;
  tokenId: string;
  proof: `0x${string}`[];
  allowListProof?: `0x${string}`[];
  allowListAddress?: Address;
}

export type UtilsMerkleTokenEntry = BatchListingTokenEntry;
export type UtilsMerkleRootArtifact = BatchListingRootArtifact;
export type UtilsMerkleProofArtifact = BatchListingProofArtifact;

export type UtilsMerkleProofParams = {
  artifact: UtilsMerkleRootArtifact;
  contract: Address;
  tokenId: IntegerInput;
  buyer?: Address;
}

export type BatchListingCreateParams = {
  artifact: BatchTokenListArtifact;
  price: AmountInput;
  currency?: CurrencyInput;
  splitAddresses?: Address[];
  splitRatios?: number[];
  autoApprove?: boolean;
}

export type BatchListingCreateResult = {
  root: `0x${string}`;
  approvalTxHashes?: Hash[];
} & TransactionResult

export type BatchListingCancelParams = {
  root?: `0x${string}`;
  artifact?: BatchListingRootArtifact;
  contract?: Address;
  tokenId?: IntegerInput;
}

export type BatchListingCancelResult = {
  root: `0x${string}`;
} & TransactionResult

export type BatchListingBuyParams = {
  proofArtifact?: BatchListingProofArtifact;
  root?: `0x${string}`;
  contract?: Address;
  tokenId?: IntegerInput;
  creator: Address;
  currency: CurrencyInput;
  price: AmountInput;
  autoApprove?: boolean;
}

export type BatchListingBuyResult = TransactionResult & {
  approvalTxHash?: Hash;
}

export type BatchListingSetAllowListParams = {
  root?: `0x${string}`;
  artifact?: BatchListingRootArtifact;
  contract?: Address;
  tokenId?: IntegerInput;
  allowListRoot?: `0x${string}`;
  endTime?: TimestampInput;
}

export type BatchListingSetAllowListResult = {
  root: `0x${string}`;
  allowListRoot: `0x${string}`;
  endTime: bigint;
} & TransactionResult

export type BatchListingStatusParams = {
  root?: `0x${string}`;
  creator: Address;
  contract?: Address;
  tokenId?: IntegerInput;
  proof?: `0x${string}`[];
}

export type BatchListingStatus = {
  root: `0x${string}`;
  seller: Address;
  currencyAddress: Address;
  amount: bigint;
  splitRecipients: Address[];
  splitRatios: number[];
  nonce: bigint;
  isEth: boolean;
  hasListing: boolean;
  allowList?: { root: `0x${string}`; endTimestamp: bigint };
  tokenInRoot?: boolean;
  tokenNonce?: bigint;
}

export type BatchListingNamespace = {
  create: (params: BatchListingCreateParams) => Promise<BatchListingCreateResult>;
  cancel: (params: BatchListingCancelParams) => Promise<BatchListingCancelResult>;
  buy: (params: BatchListingBuyParams) => Promise<BatchListingBuyResult>;
  setAllowlist: (params: BatchListingSetAllowListParams) => Promise<BatchListingSetAllowListResult>;
  status: (params: BatchListingStatusParams) => Promise<BatchListingStatus>;
}
