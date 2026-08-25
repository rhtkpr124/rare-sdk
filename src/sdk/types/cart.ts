import type { Account, Address, Hash, Hex, TransactionReceipt } from 'viem';
import type { CartApiNamespace } from './cart-api.js';

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

export type CartListing = {
  listingId: Hex; seller: Address; sku: Hex; fulfillmentKind: CartFulfillmentKind;
  tokenContract: Address; tokenId: bigint; settlementCurrency: Address;
  minimumUnitPrice: bigint; availableQuantity: bigint; paymentRecipient: Address;
};
export type CartListingRoot = { listingsRoot: Hex; nonce: bigint; deadline: bigint };
export type CartOrderLine = {
  sku: Hex; listingHash: Hex; fulfillmentKind: CartFulfillmentKind; quantity: bigint;
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
export type BuildCartOrderParams = {
  orderId: Hex; paymentCurrency: Address; deadline: bigint; paymentAmount: bigint;
  lines: CartOrderLine[]; route?: CartPayoutRoute; actions?: CartFulfillmentAction[];
};
export type CartCheckoutParams = CartSignedOrder & {
  listings: CartListing[]; authorization: CartListingPurchaseAuthorization; autoApprove?: boolean;
};
export type CartCheckoutResult = {
  txHash: Hash; receipt: TransactionReceipt; orderId: Hex; payer: Address;
  paymentCurrency: Address; paymentAmount: bigint; lineCount: number; actionCount: number;
};
export type CartCheckoutPreparation = {
  ready: boolean; cart: Address; lens?: Address; lensResult?: { valid: boolean; code: number; index: bigint; subject: Hex; reason: Hex };
  listingLensResults?: readonly { valid: boolean; code: number; index: bigint; subject: Hex; reason: Hex }[];
  requiredPayment: bigint; currentAllowance: bigint | null; approvalRequired: boolean; simulation: 'passed' | 'blocked-by-approval';
};
export type CartValidationIssue = { code: string; field: string; message: string };
export type CartValidationResult<T> = { isValid: true; value: T } | { isValid: false; issues: CartValidationIssue[] };

export type CartNamespace = {
  api: CartApiNamespace;
  listing: {
    buildRoot: (params: BuildCartListingRootParams) => CartListingRootArtifact;
    signRoot: (artifact: CartListingRootArtifact, signer: CartTypedDataSigner) => Promise<CartListingRootArtifact>;
    parseArtifact: (content: string) => CartListingRootArtifact;
    validateArtifact: (artifact: unknown) => asserts artifact is CartListingRootArtifact;
    getEntry: (artifact: CartListingRootArtifact, listingDigest: Hex) => CartListingRootArtifactEntry | undefined;
    buildAuthorization: (selections: readonly CartListingSelection[]) => CartListingAuthorizationBundle;
    cancel: (listingDigest: Hex) => Promise<{ txHash: Hash; receipt: TransactionReceipt }>;
    cancelRoot: (rootDigest: Hex) => Promise<{ txHash: Hash; receipt: TransactionReceipt }>;
    invalidateNonce: () => Promise<{ txHash: Hash; receipt: TransactionReceipt }>;
    approvalStatus: (tokenContract: Address, owner: Address) => Promise<boolean>;
    approve: (tokenContract: Address) => Promise<{ txHash?: Hash }>;
  };
  order: {
    build: (params: BuildCartOrderParams) => Omit<CartSignedOrder, 'platformSignature'>;
    sign: (params: Omit<CartSignedOrder, 'platformSignature'>, signer: CartTypedDataSigner) => Promise<CartSignedOrder>;
  };
  checkout: {
    prepare: (params: CartCheckoutParams) => Promise<CartCheckoutPreparation>;
    execute: (params: CartCheckoutParams) => Promise<CartCheckoutResult>;
  };
};
