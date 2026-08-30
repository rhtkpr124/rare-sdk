import type { Address, Hex } from 'viem';
import type { IntegerInput } from './common.js';
import type {
  CartFulfillmentKind,
  CartSellerFulfillmentKind,
  CartListing,
  CartListingAuthorizationBundle,
  CartOrderLine,
  CartPayoutRoute,
  CartSignedOrder,
  CartListingRootArtifact,
} from './cart.js';

export type CartApiCatalogMetadata = Record<string, unknown>;

export type CartApiProduct = {
  id: string;
  userId: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  slug: string | null;
  metadata: CartApiCatalogMetadata;
  variants: CartApiProductVariant[];
  createdAt: string;
  updatedAt: string;
};

export type CartApiProductVariant = {
  id: string;
  productId: string;
  sku: Hex;
  universalTokenId: string | null;
  position: number;
  isHidden: boolean;
  metadata: CartApiCatalogMetadata;
};

export type CartCatalogVariant = {
  id: string;
  productId: string;
  sku: Hex;
  universalTokenId: string | null;
  position: number;
  metadata: CartApiCatalogMetadata;
  product: {
    id: string;
    creatorUserId: string;
    slug: string | null;
    metadata: CartApiCatalogMetadata;
  };
};

export type CartProductSearchParams = {
  query?: string;
  id?: string;
  slug?: string;
  creatorUserId?: string;
  page?: number;
  perPage?: number;
};

export type CartVariantSearchParams = {
  query?: string;
  sku?: Hex;
  nft?: { contract: Address; tokenId: IntegerInput };
  productId?: string;
  creatorUserId?: string;
  ownerUserId?: string;
  page?: number;
  perPage?: number;
};

export type CartProductSearchResult = CartApiPage<CartApiProduct>;
export type CartVariantSearchResult = CartApiPage<CartCatalogVariant>;

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

type CartListingIntentTerms = {
  fulfillmentKind?: CartSellerFulfillmentKind;
  settlementCurrency: Address;
  unitPrice: bigint;
  quantity: bigint;
  paymentRecipient?: Address;
};

export type CartListingIntentItem = CartListingIntentTerms & (
  | { sku: Hex; nft?: never }
  | { sku?: never; nft: { contract: Address; tokenId: bigint } }
);

export type CartListingIntent = {
  seller: Address;
  listings: readonly CartListingIntentItem[];
  deadline: bigint;
};

export type CartListingPreviewWire = {
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
};

export type CartCheckoutIntentItem = {
  listingDigest: Hex;
  quantity: bigint;
  recipient?: Address;
};

export type CartCheckoutIntent = {
  paymentCurrency: Address;
  items: readonly CartCheckoutIntentItem[];
};

export type CartCheckoutFee = { label: string; currency: Address; amount: bigint };
export type CartCheckoutSettlement = { currency: Address; amount: bigint };
export type CartCheckoutQuoteEvidence = {
  source: string;
  quotedInput: bigint;
  maximumInput: bigint;
  quotedAt: string;
  expiresAt: string;
  summary: string;
};

export type CartCheckoutPreparation = {
  schemaVersion: 1;
  chainId: bigint;
  cartAddress: Address;
  preparedAt: string;
  expiresAt: string;
  intent: CartCheckoutIntent;
  paymentAmount: bigint;
  fees: CartCheckoutFee[];
  settlements: CartCheckoutSettlement[];
  lines: CartOrderLine[];
  route: CartPayoutRoute;
  quoteEvidence?: CartCheckoutQuoteEvidence;
};

export type CartApiPreparedPurchaseWire = {
  schemaVersion: 1;
  chainId: string;
  cartAddress: Address;
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
  preparedAt: string;
  executePurchase: CartSignedOrder & {
    listings: CartListing[];
    authorization: CartListingAuthorizationBundle['authorization'];
  };
};

export type CartApiNamespace = {
  catalog: {
    products: {
      search: (params?: CartProductSearchParams) => Promise<CartProductSearchResult>;
      get: (id: string) => Promise<CartApiProduct>;
    };
    variants: {
      search: (params?: CartVariantSearchParams) => Promise<CartVariantSearchResult>;
    };
  };
  listing: {
    preview: (intent: CartListingIntent) => Promise<CartListing[]>;
    search: (params?: CartApiListingSearchParams) => Promise<CartApiListingSearchResult>;
    get: (listingDigest: Hex) => Promise<CartApiListing>;
    invalidate: (listingDigest: Hex, invalidatedAt?: string | null) => Promise<CartApiListing>;
    publish: (artifact: CartListingRootArtifact & { signature: Hex }) => Promise<CartApiListingRoot>;
  };
  checkout: {
    preview: (intent: CartCheckoutIntent) => Promise<CartCheckoutPreparation>;
    prepare: (intent: CartCheckoutIntent) => Promise<CartApiPreparedPurchase>;
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
