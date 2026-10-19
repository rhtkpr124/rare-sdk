import type { RareAccountClient, RareAccountFeatures, RareAccountTransport, RareAccountSessionStore } from './account.js';
import type { RareApi } from '../api.js';
import type { Address, PublicClient, WalletClient } from 'viem';
import type {
  LiquidEdition,
  LiquidEditionSearchParams,
  Collection,
  CollectionSearchParams,
  EventSearchParams,
  ImportErc721Params,
  IpfsUploadResult,
  Nft,
  NftEvent,
  NftMediaEntry,
  NftSearchParams,
  PinMetadataParams,
  SearchPageResponse,
  UserProfile,
  UserSelector,
  UserListOptions,
} from '../api.js';
import type { NftIdentityParams } from '../nft-core.js';
import type { SupportedChain } from '../../contracts/addresses.js';
import type { AuctionNamespace } from './auction.js';
import type { BridgeNamespace } from './bridge.js';
import type { CollectionNamespace } from './collection.js';
import type { CurrencyInfo, CurrencyInput, ResolvedCurrency, ResolvedCurrencyWithDecimals, IntegerInput } from './common.js';
import type { LiquidEditionNamespace } from './liquid.js';
import type { ListingNamespace } from './listing.js';
import type { OfferNamespace } from './offer.js';
import type { SwapNamespace } from './swap.js';
import type { TokenNamespace } from './token.js';
import type { CartNamespace } from './cart.js';
import type { EligibilityNamespace } from './eligibility.js';
import type { PrintsNamespace } from './prints.js';
import type { RareUtilsNamespace } from './utils.js';

/**
 * Configuration for {@link createRareClient}.
 */
export type RareClientConfig = {
  /**
   * Viem public client with an explicit supported chain. The RARE SDK uses this
   * chain for every read and write on the returned client.
   */
  publicClient: PublicClient;
  /**
   * Optional viem wallet client for contract writes and signed flows.
   */
  walletClient?: WalletClient;
  /**
   * Optional account address used by SDK flows that need a default owner or
   * sender when the wallet client does not expose an account.
   */
  account?: Address;
  /**
   * Optional Rare API base URL. Defaults to the production Rare API.
   */
  apiBaseUrl?: string;
  /**
   * Optional fetch implementation for API-backed SDK methods.
   */
  apiFetch?: typeof fetch;
  /** Share an existing account login with protected Cart API operations. Public reads stay anonymous. */
  accountClient?: Pick<RareAccountClient, 'authenticatedFetch'>;
  /**
   * Optional Uniswap Trade API key used when token trades require the hosted
   * Uniswap route.
   */
  uniswapApiKey?: string;
  /**
   * Optional lazy Uniswap Trade API key resolver. Prefer this when the key
   * lives in an external secret manager and should only be read if a hosted
   * Uniswap route is actually needed.
   */
  resolveUniswapApiKey?: () => Promise<string | undefined>;
}

export type RareClientLiquidEditionSearchParams = Omit<LiquidEditionSearchParams, 'chainId'>;

export type RareClientNftSearchParams = Omit<NftSearchParams, 'chainId'>;
export type RareClientCollectionSearchParams = Omit<CollectionSearchParams, 'chainId'>;
export type RareClientEventSearchParams = Omit<EventSearchParams, 'chain' | 'chainId'>;
export type RareClientNftGetParams = Omit<NftIdentityParams, 'chain' | 'chainId'>;

export type RareClientContracts = {
  factory: Address;
  auction: Address;
  rareBridge?: Address;
  sovereignFactory?: Address;
  lazySovereignFactory?: Address;
  rareMinter?: Address;
  lazyBatchMintFactory?: Address;
  batchListing?: Address;
  batchOfferCreator?: Address;
  batchAuctionHouse?: Address;
  marketplaceSettings?: Address;
  erc20ApprovalManager?: Address;
  erc721ApprovalManager?: Address;
  erc1155Marketplace?: Address;
  erc1155ContractFactory?: Address;
  erc1155ApprovalManager?: Address;
  liquidFactory?: Address;
  swapRouter?: Address;
  v4Quoter?: Address;
  cart?: Address;
  cartLens?: Address;
  cartHashes?: Address;
}

export type SearchNamespace = {
  liquidEditions: (params?: RareClientLiquidEditionSearchParams) => Promise<SearchPageResponse<LiquidEdition>>;
  nfts: (params?: RareClientNftSearchParams) => Promise<SearchPageResponse<Nft>>;
  collections: (params?: RareClientCollectionSearchParams) => Promise<SearchPageResponse<Collection>>;
  events: (params: RareClientEventSearchParams) => Promise<SearchPageResponse<NftEvent>>;
}

export type NftNamespace = {
  events: (params: RareClientNftGetParams, options?: Parameters<RareApi['getNftEvents']>[1]) => ReturnType<RareApi['getNftEvents']>;
  favoriteCount: (params: RareClientNftGetParams) => Promise<number>;
  get: (params: RareClientNftGetParams) => Promise<Nft>;
}

export type UserNamespace = {
  get: (address: string | UserSelector) => Promise<UserProfile>;
  resolve: (input: UserSelector) => Promise<UserProfile>;
  followers: (input: UserSelector | string, options?: UserListOptions) => Promise<SearchPageResponse<UserProfile>>;
  following: (input: UserSelector | string, options?: UserListOptions) => Promise<SearchPageResponse<UserProfile>>;
}

export type IpfsNamespace = {
  pinFile: (buffer: Uint8Array, filename: string) => Promise<IpfsUploadResult>;
  pinJson: (value: unknown, filename?: string) => Promise<IpfsUploadResult>;
}

export type MediaNamespace = {
  upload: (buffer: Uint8Array, filename: string) => Promise<NftMediaEntry>;
  pinMetadata: (opts: PinMetadataParams) => Promise<string>;
}

export type ImportNamespace = {
  erc721: (params: ImportErc721Params) => Promise<void>;
}

export type CurrencyNamespace = {
  list: () => CurrencyInfo[];
  resolve: (input: CurrencyInput) => ResolvedCurrency;
  resolveDecimals: (input: CurrencyInput) => Promise<ResolvedCurrencyWithDecimals>;
}

/**
 * Chain-bound RARE SDK surface returned by {@link createRareClient}.
 */
export type RareChainFeatures = {
  /**
   * Supported RARE chain inferred from the viem public client.
   */
  chain: SupportedChain;
  /**
   * Numeric chain ID for {@link chain}.
   */
  chainId: number;
  /**
   * RARE contract addresses available on the client chain.
   */
  contracts: RareClientContracts;
  liquidEdition: LiquidEditionNamespace;
  bridge: BridgeNamespace;
  swap: SwapNamespace;
  auction: AuctionNamespace;
  offer: OfferNamespace;
  listing: ListingNamespace;
  utils: RareUtilsNamespace;
  search: SearchNamespace;
  nft: NftNamespace;
  collection: CollectionNamespace;
  ipfs: IpfsNamespace;
  drops: { list: RareApi['getDrops']; get: RareApi['getDrop'] };
  posts: { list: RareApi['getPosts']; get: RareApi['getPost']; comments: RareApi['getPostComments'] };
  user: UserNamespace;
  media: MediaNamespace;
  import: ImportNamespace;
  token: TokenNamespace;
  currency: CurrencyNamespace;
  cart: CartNamespace;
  eligibility: EligibilityNamespace;
  prints: PrintsNamespace;
}

export type { IntegerInput };


/** Public Rare API methods available without a blockchain RPC client. */
export type RarePublicFeatures = {
  utils: RareUtilsNamespace;
  token: Pick<TokenNamespace, 'getPrice'>;
  search: {
    liquidEditions: RareApi['searchLiquidEditions'];
    nfts: RareApi['searchNfts'];
    collections: RareApi['searchCollections'];
    events: RareApi['searchEvents'];
  };
  nft: {
    get: (params: NftIdentityParams) => Promise<Nft>;
    favoriteCount: (params: NftIdentityParams) => Promise<number>;
    events: (params: NftIdentityParams, options?: Parameters<RareApi['getNftEvents']>[1]) => ReturnType<RareApi['getNftEvents']>;
  };
  collection: { get: RareApi['getCollection']; events: RareApi['getCollectionEvents'] };
  liquidEdition: { get: (params: Omit<NftIdentityParams, 'tokenId'>) => Promise<LiquidEdition> };
  user: UserNamespace;
  drops: { list: RareApi['getDrops']; get: RareApi['getDrop'] };
  posts: { list: RareApi['getPosts']; get: RareApi['getPost']; comments: RareApi['getPostComments'] };
  messaging: { public: RareApi['messaging'] };
  ipfs: IpfsNamespace;
  media: MediaNamespace;
  import: { erc721: RareApi['importErc721'] };
};

export type RareApiClient = RarePublicFeatures & RareAccountClient;
export type RareExternalApiClient = RarePublicFeatures & RareAccountFeatures;
export type RareClient = RareChainFeatures & RareAccountClient & { collection: CollectionNamespace & { events: RareApi['getCollectionEvents'] }; messaging: RareAccountClient['messaging'] & { public: RareApi['messaging'] } };
export type RareExternalClient = RareChainFeatures & RareAccountFeatures & { collection: CollectionNamespace & { events: RareApi['getCollectionEvents'] }; messaging: RareAccountFeatures['messaging'] & { public: RareApi['messaging'] } };

/** API and account operations need no publicClient or blockchain RPC. */
export type RareApiClientConfig = { apiBaseUrl?: string; apiFetch?: typeof fetch; sessionStore?: RareAccountSessionStore; publicClient?: never; walletClient?: never };
export type RareExternalApiClientConfig = Omit<RareApiClientConfig, 'sessionStore'> & { transport: RareAccountTransport };
export type RareManagedClientConfig = RareClientConfig & { sessionStore?: RareAccountSessionStore };
export type RareExternalClientConfig = RareClientConfig & { transport: RareAccountTransport };
