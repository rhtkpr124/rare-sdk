import type { Address, Hash, Hex } from 'viem';
import type { AmountInput, CurrencyInput, IntegerInput, TimestampInput, TransactionResult } from './common.js';

export type ReleaseConfigureParams = {
  contract: Address;
  currency?: CurrencyInput;
  price: AmountInput;
  startTime?: TimestampInput;
  maxMints: IntegerInput;
  splitAddresses?: Address[];
  splitRatios?: number[];
  autoApprove?: boolean;
}

export type ReleaseConfigureResult = {
  rareMinter: Address;
  contract: Address;
  currencyAddress: Address;
  price: bigint;
  startTime: bigint;
  maxMints: bigint;
  splitRecipients: Address[];
  splitRatios: number[];
  approvalTxHash?: Hash;
} & TransactionResult

export type ReleaseMintDirectSaleParams = {
  contract: Address;
  quantity?: IntegerInput;
  currency?: CurrencyInput;
  price?: AmountInput;
  proof?: readonly Hash[];
  autoApprove?: boolean;
}

export type ReleaseMintDirectSaleResult = {
  rareMinter: Address;
  contract: Address;
  buyer: Address;
  recipient: Address;
  quantity: number;
  currencyAddress: Address;
  price: bigint;
  totalPrice: bigint;
  requiredPayment: bigint;
  approvalTxHash?: Hash;
  allowlistRequired: boolean;
  tokenIdStart: bigint;
  tokenIdEnd: bigint;
  tokenIds: bigint[];
} & TransactionResult

export type ReleaseAllowlistInputFormat = 'csv' | 'json';

export type ReleaseAllowlistWalletProof = {
  address: Address;
  leaf: Hex;
  proof: Hex[];
}

export type ReleaseAllowlistArtifact = {
  kind: 'rare-release-allowlist-v1';
  version: 1;
  leafEncoding: 'keccak256(address)';
  tree: 'sorted-addresses-sort-pairs';
  root: Hex;
  wallets: ReleaseAllowlistWalletProof[];
}

export type ReleaseAllowlistConfig = {
  rareMinter: Address;
  contract: Address;
  root: Hash;
  endTimestamp: bigint;
  active: boolean;
  now: bigint;
}

export type ReleaseLimitConfig = {
  rareMinter: Address;
  contract: Address;
  limit: bigint;
  enabled: boolean;
}

export type ReleaseSetAllowlistConfigParams = {
  contract: Address;
  root?: Hash;
  artifact?: ReleaseAllowlistArtifact;
  endTime: TimestampInput;
}

export type ReleaseSetAllowlistConfigResult = {
  config: ReleaseAllowlistConfig;
} & TransactionResult

export type ReleaseSetLimitParams = {
  contract: Address;
  limit: IntegerInput;
}

export type ReleaseSetLimitResult = {
  config: ReleaseLimitConfig;
} & TransactionResult

export type ReleaseStatusParams = {
  contract: Address;
  account?: Address;
}

export type ReleaseStatus = {
  rareMinter: Address;
  contract: Address;
  configured: boolean;
  seller: Address;
  currencyAddress: Address;
  currencyDecimals: number | null;
  price: bigint;
  startTime: bigint;
  maxMints: bigint;
  splitRecipients: Address[];
  splitRatios: number[];
  allowlistRoot: `0x${string}`;
  allowlistEndTimestamp: bigint;
  allowlistActive: boolean;
  requiresAllowlist: boolean;
  mintLimit: bigint;
  txLimit: bigint;
  account: Address | null;
  accountMints: bigint | null;
  accountTxs: bigint | null;
  totalSupply: bigint | null;
  maxSupply: bigint | null;
  remainingSupply: bigint | null;
  soldOut: boolean | null;
  started: boolean;
  currentlyMintable: boolean;
  isEth: boolean;
  now: bigint;
}

export type ReleaseAllowlistNamespace = {
  build: (params: { input: string; format: ReleaseAllowlistInputFormat }) => ReleaseAllowlistArtifact;
  parse: (params: { input: string }) => ReleaseAllowlistArtifact;
  proof: (params: { artifact: ReleaseAllowlistArtifact; address: Address }) => ReleaseAllowlistWalletProof | null;
  getConfig: (params: { contract: Address }) => Promise<ReleaseAllowlistConfig>;
  setConfig: (params: ReleaseSetAllowlistConfigParams) => Promise<ReleaseSetAllowlistConfigResult>;
  clear: (params: { contract: Address }) => Promise<ReleaseSetAllowlistConfigResult>;
}

export type ReleaseLimitsNamespace = {
  getMint: (params: { contract: Address }) => Promise<ReleaseLimitConfig>;
  setMint: (params: ReleaseSetLimitParams) => Promise<ReleaseSetLimitResult>;
  getTx: (params: { contract: Address }) => Promise<ReleaseLimitConfig>;
  setTx: (params: ReleaseSetLimitParams) => Promise<ReleaseSetLimitResult>;
}

export type ReleaseNamespace = {
  allowlist: ReleaseAllowlistNamespace;
  limits: ReleaseLimitsNamespace;
  configure: (params: ReleaseConfigureParams) => Promise<ReleaseConfigureResult>;
  mint: (params: ReleaseMintDirectSaleParams) => Promise<ReleaseMintDirectSaleResult>;
  status: (params: ReleaseStatusParams) => Promise<ReleaseStatus>;
}
