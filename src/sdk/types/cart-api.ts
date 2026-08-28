import type { Address, Hex } from 'viem';
import type {
  CartFulfillmentKind,
  CartListing,
  CartListingAuthorizationBundle,
  CartSignedOrder,
  CartListingRootArtifact,
} from './cart.js';

export type CartApiCatalogMetadata = Record<string, unknown>;

export type CartApiProduct = {
  id: string;
  slug: string | null;
  metadata: CartApiCatalogMetadata;
  createdAt: string;
  updatedAt: string;
};

export type CartApiSku = {
  id: string;
  sku: Hex;
  identityFingerprint: Hex;
  metadata: CartApiCatalogMetadata;
  createdAt: string;
  updatedAt: string;
};

export type CartApiProductSku = {
  id: string;
  productId: string;
  sku: Hex;
  position: number;
  isHidden: boolean;
  metadata: CartApiCatalogMetadata;
  createdAt: string;
  updatedAt: string;
};

export type CartApiPage<T> = {
  data: T[];
  hasNextPage: boolean;
};

export type CartApiListing = {
  chainId: string;
  cartAddress: Address;
  listingDigest: Hex;
  listing: {
    listingSalt: Hex;
    seller: Address;
    sku: Hex;
    fulfillmentKind: CartFulfillmentKind;
    tokenContract: Address;
    tokenId: string;
    settlementCurrency: Address;
    minimumUnitPrice: string;
    availableQuantity: string;
    paymentRecipient: Address;
  };
  displayUnitPrice: string;
  invalidatedAt: string | null;
  authorized: boolean;
  metadata: CartApiCatalogMetadata;
};

export type CartApiListingRoot = {
  chainId: string;
  cart: Address;
  seller: Address;
  root: {
    listingsRoot: Hex;
    nonce: string;
    deadline: string;
  };
  signature: Hex;
  listingCount: number;
};

export type CartApiListingSearchParams = {
  q?: string;
  sku?: Hex;
  seller?: Address;
  fulfillmentKind?: CartFulfillmentKind;
  settlementCurrency?: Address;
  productId?: string;
  sortBy?: 'newest' | 'oldest' | 'priceAsc' | 'priceDesc' | 'deadlineAsc';
  page?: number;
  perPage?: number;
};

export type CartApiListingSearchResult = {
  data: Array<{
    id: Hex;
    listingDigest: Hex;
    chainId: string;
    cartAddress: Address;
    seller: Address;
    listingSalt: Hex;
    sku: Hex;
    fulfillmentKind: string;
    tokenContract?: Address | null;
    tokenId?: string | null;
    settlementCurrency: Address;
    settlementCurrencySymbol?: string | null;
    settlementCurrencyDecimals?: number;
    paymentRecipient?: Address | null;
    minimumUnitPrice: string;
    displayUnitPrice: string;
    displayUnitPriceUsdAmount: number | null;
    availableQuantity: string;
    observedFilledQuantity: string | null;
    observedRemainingQuantity: string | null;
    rootDeadline: number | null;
    invalidatedAt: number | null;
    authorizationState: string;
    observedCancellation: boolean | null;
    observedAt: number | null;
    createdAt: number;
    updatedAt: number;
    projectedAt: number;
    priceUsdUpdatedAt: number | null;
    skuMetadata: CartApiCatalogMetadata;
    productPresentations: Array<{
      productId: string;
      productSlug: string | null;
      position: number;
      productMetadata: CartApiCatalogMetadata;
      productSkuMetadata: CartApiCatalogMetadata;
    }>;
    productIds: string[];
    productSlugs: string[];
    productTitles: string[];
    productDescriptions: string[];
    productTags: string[];
  }>;
  pagination: {
    page: number;
    perPage: number;
    totalCount: number;
    totalPages: number;
  };
};

export type CartApiListingCreateParams = {
  seller: Address;
  sku: Hex;
  fulfillmentKind: CartFulfillmentKind;
  tokenContract?: Address;
  tokenId?: bigint;
  settlementCurrency: Address;
  availableQuantity: bigint;
  paymentRecipient?: Address;
  displayUnitPrice: bigint;
};

export type CartApiProductCreateParams = {
  slug?: string | null;
  metadata: CartApiCatalogMetadata;
};

export type CartApiSkuCreateParams = {
  metadata: CartApiCatalogMetadata;
};

export type CartApiProductSkuCreateParams = {
  sku: Hex;
  position: number;
  isHidden?: boolean;
  metadata: CartApiCatalogMetadata;
};

export type CartApiCartDraftItem = {
  listingDigest: Hex;
  quantity: bigint;
  recipient?: Address;
};

export type CartApiPrepareOrderParams = {
  paymentCurrency: Address;
  items: readonly CartApiCartDraftItem[];
  idempotencyKey?: string;
};

export type CartApiPreparedPurchaseWire = {
  schemaVersion: 1;
  chainId: string;
  cartAddress: Address;
  idempotencyKey: string;
  preparedAt: string;
  executePurchase: {
    order: {
      orderId: Hex;
      paymentCurrency: Address;
      deadline: string;
      paymentAmount: string;
      orderLinesHash: Hex;
      payoutRouteHash: Hex;
      fulfillmentActionsHash: Hex;
    };
    lines: Array<{
      sku: Hex;
      listingDigest: Hex;
      fulfillmentKind: number;
      quantity: string;
      settlementCurrency: Address;
      amount: string;
      paymentRecipient: Address;
    }>;
    listings: Array<{
      listingSalt: Hex;
      seller: Address;
      sku: Hex;
      fulfillmentKind: number;
      tokenContract: Address;
      tokenId: string;
      settlementCurrency: Address;
      minimumUnitPrice: string;
      availableQuantity: string;
      paymentRecipient: Address;
    }>;
    authorization: {
      listingRoots: Array<{ listingsRoot: Hex; nonce: string; deadline: string }>;
      listingRootSignatures: Hex[];
      listingRootIndexes: string[];
      listingProofs: Hex[][];
    };
    route: { commands: Hex; inputs: Hex[]; routerValue: string };
    actions: Array<{ lineIndex: string; quantity: string; recipient: Address }>;
    platformSignature: Hex;
  };
};

export type CartApiPreparedPurchase = {
  schemaVersion: 1;
  chainId: bigint;
  cartAddress: Address;
  idempotencyKey: string;
  preparedAt: string;
  executePurchase: CartSignedOrder & {
    listings: CartListing[];
    authorization: CartListingAuthorizationBundle['authorization'];
  };
};

export type CartApiNamespace = {
  catalog: {
    products: {
      create: (params: CartApiProductCreateParams) => Promise<CartApiProduct>;
      list: (params?: { page?: number; perPage?: number }) => Promise<CartApiPage<CartApiProduct>>;
      get: (id: string) => Promise<CartApiProduct>;
    };
    skus: {
      create: (params: CartApiSkuCreateParams) => Promise<CartApiSku>;
      list: (params?: { page?: number; perPage?: number }) => Promise<CartApiPage<CartApiSku>>;
      get: (sku: Hex) => Promise<CartApiSku>;
      attach: (productId: string, params: CartApiProductSkuCreateParams) => Promise<CartApiProductSku>;
    };
  };
  listing: {
    create: (params: CartApiListingCreateParams) => Promise<CartApiListing>;
    search: (params?: CartApiListingSearchParams) => Promise<CartApiListingSearchResult>;
    get: (listingDigest: Hex) => Promise<CartApiListing>;
    invalidate: (listingDigest: Hex, invalidatedAt?: string | null) => Promise<CartApiListing>;
    ingestRoot: (artifact: CartListingRootArtifact & { signature: Hex }) => Promise<CartApiListingRoot>;
  };
  checkout: {
    prepareOrder: (params: CartApiPrepareOrderParams) => Promise<CartApiPreparedPurchase>;
  };
};

export type CartListingRootArtifactWire = {
  version: 1;
  type: 'rare-cart-listing-root';
  chainId: string;
  cart: Address;
  seller: Address;
  root: { listingsRoot: Hex; nonce: string; deadline: string };
  entries: Array<{
    listing: {
      listingSalt: Hex;
      seller: Address;
      sku: Hex;
      fulfillmentKind: number;
      tokenContract: Address;
      tokenId: string;
      settlementCurrency: Address;
      minimumUnitPrice: string;
      availableQuantity: string;
      paymentRecipient: Address;
    };
    listingDigest: Hex;
    leaf: Hex;
    proof: Hex[];
  }>;
  signature: Hex;
};
