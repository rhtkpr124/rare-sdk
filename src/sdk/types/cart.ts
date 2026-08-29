import type { Account, Address, Hash, Hex, TransactionReceipt } from 'viem';
import type {
  CartApiListingRoot, CartApiNamespace, CartApiPreparedPurchase, CartCheckoutIntent,
  CartCheckoutPreparation, CartListingIntent,
} from './cart-api.js';

export const cartFulfillmentKinds = {
  none: 0,
  offChain: 1,
  erc721Transfer: 2,
  erc1155Transfer: 3,
  erc721MintTo: 4,
  erc1155MintTo: 5,
  currencySwap: 6,
} as const;
export type CartFulfillmentKind = (typeof cartFulfillmentKinds)[keyof typeof cartFulfillmentKinds];
export type CartSellerFulfillmentKind =
  | typeof cartFulfillmentKinds.erc721Transfer
  | typeof cartFulfillmentKinds.erc1155Transfer
  | typeof cartFulfillmentKinds.erc721MintTo
  | typeof cartFulfillmentKinds.erc1155MintTo;

export type CartListing = {
  listingSalt: Hex; seller: Address; sku: Hex; fulfillmentKind: CartFulfillmentKind;
  tokenContract: Address; tokenId: bigint; settlementCurrency: Address;
  minimumUnitPrice: bigint; availableQuantity: bigint; paymentRecipient: Address;
};
export type CartListingInput = Omit<CartListing, 'listingSalt'> & { listingSalt?: Hex };
export type CartListingRoot = { listingsRoot: Hex; nonce: bigint; deadline: bigint };
export type CartOrderLine = {
  sku: Hex; listingDigest: Hex; fulfillmentKind: CartFulfillmentKind; quantity: bigint;
  settlementCurrency: Address; amount: bigint; paymentRecipient: Address;
};
export type CartPayoutRoute = { commands: Hex; inputs: Hex[]; routerValue: bigint };
export type CartRouteLeg =
  | { protocol: 'v2'; mode: 'exact-output'; path: Address[]; amountOut: bigint; amountInMaximum: bigint }
  | { protocol: 'v2'; mode: 'exact-input'; path: Address[]; amountIn: bigint; amountOutMinimum: bigint }
  | { protocol: 'v3'; mode: 'exact-output'; path: Address[]; fees: number[]; amountOut: bigint; amountInMaximum: bigint }
  | { protocol: 'v3'; mode: 'exact-input'; path: Address[]; fees: number[]; amountIn: bigint; amountOutMinimum: bigint };
export type BuildCartRouteParams = { paymentCurrency: Address; legs: CartRouteLeg[]; routerValue?: bigint };
export type CartFulfillmentAction = { lineIndex: bigint; quantity: bigint; recipient: Address };
export type CartPurchaseOrder = {
  orderId: Hex; paymentCurrency: Address; deadline: bigint; paymentAmount: bigint;
  orderLinesHash: Hex; payoutRouteHash: Hex; fulfillmentActionsHash: Hex;
};
export type CartListingRootArtifactEntry = {
  listing: Omit<CartListing, 'tokenId' | 'minimumUnitPrice' | 'availableQuantity'> & {
    tokenId: string; minimumUnitPrice: string; availableQuantity: string;
  };
  listingDigest: Hex; leaf: Hex; proof: Hex[];
};
export type CartListingRootArtifact = {
  version: 1; type: 'rare-cart-listing-root'; chainId: number; cart: Address; seller: Address;
  root: { listingsRoot: Hex; nonce: string; deadline: string };
  entries: CartListingRootArtifactEntry[]; signature?: Hex;
};
export type CartListingSelection = { artifact: CartListingRootArtifact; listingDigest: Hex };
export type CartListingAuthorizationBundle = {
  listings: CartListing[];
  authorization: CartListingPurchaseAuthorization;
};
export type CartListingPurchaseAuthorization = {
  listingRoots: CartListingRoot[]; listingRootSignatures: Hex[];
  listingRootIndexes: bigint[]; listingProofs: Hex[][];
};
export type CartSignedOrder = {
  order: CartPurchaseOrder; lines: CartOrderLine[]; route: CartPayoutRoute;
  actions: CartFulfillmentAction[]; platformSignature: Hex;
};
export type CartTypedDataSigner = {
  address: Account['address'];
  signTypedData: NonNullable<Account['signTypedData']>;
};

export type BuildCartListingRootParams = {
  listings: CartListing[]; chainId: number; cart: Address; nonce: bigint; deadline: bigint;
};
export type BuildCartListingRootInput = Omit<BuildCartListingRootParams, 'listings'> & {
  listings: CartListingInput[];
};
export type BuildCartOrderParams = {
  orderId: Hex; paymentCurrency: Address; deadline: bigint; paymentAmount: bigint;
  lines: CartOrderLine[]; route?: CartPayoutRoute; actions?: CartFulfillmentAction[];
};
export type CartCheckoutParams = CartSignedOrder & {
  listings: CartListing[]; authorization: CartListingPurchaseAuthorization; autoApprove?: boolean;
};
export type CartCheckoutResult = {
  txHash: Hash; receipt: TransactionReceipt; approvalTxHash?: Hash; orderId: Hex; payer: Address;
  paymentCurrency: Address; paymentAmount: bigint; lineCount: number; actionCount: number;
};
export type CartPurchaseParams = { preparation: CartCheckoutPreparation; autoApprove?: boolean };
export type CartPurchaseResult = CartCheckoutResult & {
  preparation: CartCheckoutPreparation;
  preparedPurchase: CartApiPreparedPurchase;
};
export type CartListingPreparation = {
  intent: CartListingIntent;
  artifact: CartListingRootArtifact;
  requiredApprovals: Address[];
};
export type CartListingPublishParams = { preparation: CartListingPreparation; autoApprove?: boolean };
export type CartListingPublishResult = {
  preparation: CartListingPreparation;
  signedArtifact: CartListingRootArtifact & { signature: Hex };
  publishedRoot: CartApiListingRoot;
  approvalTxHashes: Hash[];
  approvalReceipts: TransactionReceipt[];
};
export type CartValidationIssue = { code: string; field: string; message: string };
export type CartValidationResult<T> = { isValid: true; value: T } | { isValid: false; issues: CartValidationIssue[] };

export type CartNamespace = {
  api: CartApiNamespace;
  catalog: {
    products: CartApiNamespace['catalog']['products'];
    variants: CartApiNamespace['catalog']['variants'];
  };
  approval: {
    status: (tokenContract: Address, owner: Address) => Promise<boolean>;
    approve: (tokenContract: Address) => Promise<{ txHash?: Hash; receipt?: TransactionReceipt }>;
    revoke: (tokenContract: Address) => Promise<{ txHash?: Hash; receipt?: TransactionReceipt }>;
  };
  listing: {
    prepare: (intent: CartListingIntent) => Promise<CartListingPreparation>;
    publish: (params: CartListingPublishParams) => Promise<CartListingPublishResult>;
    search: CartApiNamespace['listing']['search'];
    get: CartApiNamespace['listing']['get'];
    cancel: (listingDigest: Hex) => Promise<{ txHash: Hash; receipt: TransactionReceipt }>;
    cancelRoot: (rootDigest: Hex) => Promise<{ txHash: Hash; receipt: TransactionReceipt }>;
    invalidateNonce: () => Promise<{ txHash: Hash; receipt: TransactionReceipt }>;
  };
  checkout: {
    prepare: (intent: CartCheckoutIntent) => Promise<CartCheckoutPreparation>;
    purchase: (params: CartPurchaseParams) => Promise<CartPurchaseResult>;
  };
};
