import type { Address } from 'viem';
import type { Collection } from '../api.js';
import type { IntegerInput, TransactionResult } from './common.js';
import type {
  DeployErc1155Params,
  DeployErc1155Result,
  Erc1155CollectionNamespace,
} from './erc1155.js';

export type DeployErc721Params = {
  name: string;
  symbol: string;
  maxTokens?: IntegerInput;
}

export type DeployErc721Result = {
  contract: Address;
} & TransactionResult

export type DeployLazyBatchMintParams = {
  name: string;
  symbol: string;
  maxTokens?: IntegerInput;
}

export type DeployLazyBatchMintResult = {
  contract: Address;
} & TransactionResult

export type DeployLazyErc721Params = {
  name: string;
  symbol: string;
  maxTokens: IntegerInput;
  variant?: LazyErc721DeploymentVariant;
}

export type LazyErc721DeploymentVariant =
  | 'standard'
  | 'royalty-guard'
  | 'deadman-royalty-guard';

export type DeployLazyErc721Result = {
  contract: Address;
  factory: Address;
  variant: LazyErc721DeploymentVariant;
  nextStep: string;
} & TransactionResult

export type CollectionMintBatchParams = {
  contract: Address;
  baseUri: string;
  amount: IntegerInput;
}

export type CollectionMintBatchResult = {
  contract: Address;
  baseUri: string;
  tokenCount: bigint;
  fromTokenId: bigint;
  toTokenId: bigint;
  owner: Address;
} & TransactionResult

export type CollectionPrepareLazyMintParams = {
  contract: Address;
  baseUri: string;
  amount: IntegerInput;
  minter?: Address;
}

export type CollectionPrepareLazyMintResult = {
  contract: Address;
  baseUri: string;
  tokenCount: bigint;
  fromTokenId?: bigint;
  toTokenId?: bigint;
  minter?: Address;
} & TransactionResult

export type CollectionTokenCreatorParams = {
  contract: Address;
  tokenId: IntegerInput;
}

export type CollectionTokenCreatorResult = {
  contract: Address;
  tokenId: bigint;
  creator: Address;
}

export type CollectionRoyaltyInfoParams = {
  contract: Address;
  tokenId: IntegerInput;
  price?: bigint;
}

export type CollectionRoyaltyInfoResult = {
  contract: Address;
  tokenId: bigint;
  salePrice: bigint;
  receiver: Address;
  royaltyAmount: bigint;
  defaultReceiver?: Address;
  defaultPercentage?: bigint;
}

export type CollectionStatusParams = {
  contract: Address;
  tokenId?: IntegerInput;
  price?: bigint;
}

export type CollectionStatusResult = {
  contract: Address;
  name?: string;
  symbol?: string;
  owner?: Address;
  totalSupply?: bigint;
  maxTokens?: bigint;
  disabled?: boolean;
  tokenUrisLocked?: boolean;
  batchCount?: bigint;
  defaultReceiver?: Address;
  defaultPercentage?: bigint;
  interfaces?: {
    erc165?: boolean;
    erc721?: boolean;
    erc721Metadata?: boolean;
    erc2981?: boolean;
  };
  mintConfig?: {
    tokenCount: bigint;
    baseUri: string;
    lockedMetadata: boolean;
  };
  token?: {
    tokenId: bigint;
    owner?: Address;
    tokenUri?: string;
    creator?: Address;
    royalty?: {
      salePrice: bigint;
      receiver: Address;
      amount: bigint;
    };
  };
}

export type CollectionSetDefaultRoyaltyReceiverParams = {
  contract: Address;
  receiver: Address;
}

export type CollectionSetDefaultRoyaltyReceiverResult = {
  contract: Address;
  receiver: Address;
} & TransactionResult

export type CollectionSetDefaultRoyaltyPercentageParams = {
  contract: Address;
  percentage: IntegerInput;
}

export type CollectionSetDefaultRoyaltyPercentageResult = {
  contract: Address;
  percentage: number;
} & TransactionResult

export type CollectionSetTokenRoyaltyReceiverParams = {
  contract: Address;
  tokenId: IntegerInput;
  receiver: Address;
}

export type CollectionSetTokenRoyaltyReceiverResult = {
  contract: Address;
  tokenId: bigint;
  receiver: Address;
} & TransactionResult

export type CollectionMintConfigParams = {
  contract: Address;
}

export type CollectionMintConfigResult = {
  contract: Address;
  tokenCount?: bigint;
  baseUri?: string;
  lockedMetadata?: boolean;
}

export type CollectionUpdateBaseUriParams = {
  contract: Address;
  baseUri: string;
}

export type CollectionUpdateBaseUriResult = {
  contract: Address;
  baseUri: string;
} & TransactionResult

export type CollectionUpdateTokenUriParams = {
  contract: Address;
  tokenId: IntegerInput;
  tokenUri: string;
}

export type CollectionUpdateTokenUriResult = {
  contract: Address;
  tokenId: bigint;
  tokenUri: string;
} & TransactionResult

export type CollectionLockBaseUriParams = {
  contract: Address;
}

export type CollectionLockBaseUriResult = {
  contract: Address;
  baseUri: string;
} & TransactionResult

export type CollectionMintParams = {
  contract: Address;
  tokenUri: string;
  to?: Address;
  royaltyReceiver?: Address;
}

export type CollectionMintResult = {
  tokenId: bigint;
} & TransactionResult

export type CollectionDeployNamespace = {
  erc721: (params: DeployErc721Params) => Promise<DeployErc721Result>;
  erc1155: (params: DeployErc1155Params) => Promise<DeployErc1155Result>;
  lazyErc721: (params: DeployLazyErc721Params) => Promise<DeployLazyErc721Result>;
  lazyBatchMint: (params: DeployLazyBatchMintParams) => Promise<DeployLazyBatchMintResult>;
}

export type CollectionNamespace = {
  get: (id: string) => Promise<Collection>;
  status: (params: CollectionStatusParams) => Promise<CollectionStatusResult>;
  deploy: CollectionDeployNamespace;
  erc1155: Erc1155CollectionNamespace;
  mint: (params: CollectionMintParams) => Promise<CollectionMintResult>;
  mintBatch: (params: CollectionMintBatchParams) => Promise<CollectionMintBatchResult>;
  prepareLazyMint: (params: CollectionPrepareLazyMintParams) => Promise<CollectionPrepareLazyMintResult>;
  getTokenCreator: (params: CollectionTokenCreatorParams) => Promise<CollectionTokenCreatorResult>;
  royalty: {
    status: (params: CollectionRoyaltyInfoParams) => Promise<CollectionRoyaltyInfoResult>;
  };
  metadata: {
    status: (params: CollectionMintConfigParams) => Promise<CollectionMintConfigResult>;
  };
  setDefaultRoyaltyReceiver: (params: CollectionSetDefaultRoyaltyReceiverParams) => Promise<CollectionSetDefaultRoyaltyReceiverResult>;
  setDefaultRoyaltyPercentage: (params: CollectionSetDefaultRoyaltyPercentageParams) => Promise<CollectionSetDefaultRoyaltyPercentageResult>;
  setTokenRoyaltyReceiver: (params: CollectionSetTokenRoyaltyReceiverParams) => Promise<CollectionSetTokenRoyaltyReceiverResult>;
  updateBaseUri: (params: CollectionUpdateBaseUriParams) => Promise<CollectionUpdateBaseUriResult>;
  updateTokenUri: (params: CollectionUpdateTokenUriParams) => Promise<CollectionUpdateTokenUriResult>;
  lockBaseUri: (params: CollectionLockBaseUriParams) => Promise<CollectionLockBaseUriResult>;
}
