const listing = [
  { name: 'listingId', type: 'bytes32' }, { name: 'seller', type: 'address' },
  { name: 'sku', type: 'bytes32' }, { name: 'fulfillmentKind', type: 'uint8' },
  { name: 'tokenContract', type: 'address' }, { name: 'tokenId', type: 'uint256' },
  { name: 'settlementCurrency', type: 'address' }, { name: 'minimumUnitPrice', type: 'uint256' },
  { name: 'availableQuantity', type: 'uint256' }, { name: 'paymentRecipient', type: 'address' },
] as const;
const line = [
  { name: 'sku', type: 'bytes32' }, { name: 'listingHash', type: 'bytes32' },
  { name: 'fulfillmentKind', type: 'uint8' }, { name: 'quantity', type: 'uint256' },
  { name: 'settlementCurrency', type: 'address' }, { name: 'amount', type: 'uint256' },
  { name: 'paymentRecipient', type: 'address' },
] as const;
const order = [
  { name: 'orderId', type: 'bytes32' }, { name: 'paymentCurrency', type: 'address' },
  { name: 'deadline', type: 'uint256' }, { name: 'paymentAmount', type: 'uint256' },
  { name: 'orderLinesHash', type: 'bytes32' }, { name: 'payoutRouteHash', type: 'bytes32' },
  { name: 'fulfillmentActionsHash', type: 'bytes32' },
] as const;
const root = [
  { name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
] as const;
const route = [
  { name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' },
  { name: 'routerValue', type: 'uint256' },
] as const;
const action = [
  { name: 'lineIndex', type: 'uint256' }, { name: 'quantity', type: 'uint256' },
  { name: 'recipient', type: 'address' },
] as const;

export const cartAbi = [
  { type: 'function', name: 'initialize', stateMutability: 'nonpayable', inputs: [
    { name: 'owner_', type: 'address' }, { name: 'platformSigner_', type: 'address' },
    { name: 'universalRouter_', type: 'address' }, { name: 'permit2_', type: 'address' }, { name: 'weth_', type: 'address' },
  ], outputs: [] },
  { type: 'function', name: 'DOMAIN_SEPARATOR', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'routePolicy', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'proxiableUUID', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'platformSigner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'universalRouter', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'permit2', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'weth', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'protocolRecipient', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'listingNonces', stateMutability: 'view', inputs: [{ name: 'seller', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'filledQuantity', stateMutability: 'view', inputs: [{ name: 'listingDigest', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'executedOrderIds', stateMutability: 'view', inputs: [{ name: 'orderId', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'cancelledListings', stateMutability: 'view', inputs: [{ name: 'seller', type: 'address' }, { name: 'listingDigest', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'cancelledListingRoots', stateMutability: 'view', inputs: [{ name: 'seller', type: 'address' }, { name: 'rootDigest', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'cancelListing', stateMutability: 'nonpayable', inputs: [{ name: 'listingDigest', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'cancelListingRoot', stateMutability: 'nonpayable', inputs: [{ name: 'rootDigest', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'invalidateListingNonce', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'setPlatformSigner', stateMutability: 'nonpayable', inputs: [{ name: 'newSigner', type: 'address' }], outputs: [] },
  { type: 'function', name: 'setPaused', stateMutability: 'nonpayable', inputs: [{ name: 'paused', type: 'bool' }], outputs: [] },
  { type: 'function', name: 'setProtocolRecipient', stateMutability: 'nonpayable', inputs: [{ name: 'recipient', type: 'address' }], outputs: [] },
  { type: 'function', name: 'transferOwnership', stateMutability: 'nonpayable', inputs: [{ name: 'newOwner', type: 'address' }], outputs: [] },
  { type: 'function', name: 'renounceOwnership', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'upgradeTo', stateMutability: 'nonpayable', inputs: [{ name: 'newImplementation', type: 'address' }], outputs: [] },
  { type: 'function', name: 'upgradeToAndCall', stateMutability: 'payable', inputs: [
    { name: 'newImplementation', type: 'address' }, { name: 'data', type: 'bytes' },
  ], outputs: [] },
  { type: 'function', name: 'executePurchase', stateMutability: 'payable', inputs: [
    { name: 'order', type: 'tuple', components: order }, { name: 'lines', type: 'tuple[]', components: line },
    { name: 'listings', type: 'tuple[]', components: listing },
    { name: 'authorization', type: 'tuple', components: [
      { name: 'listingRoots', type: 'tuple[]', components: root }, { name: 'listingRootSignatures', type: 'bytes[]' },
      { name: 'listingRootIndexes', type: 'uint256[]' }, { name: 'listingProofs', type: 'bytes32[][]' },
    ] }, { name: 'route', type: 'tuple', components: route }, { name: 'actions', type: 'tuple[]', components: action },
    { name: 'platformSignature', type: 'bytes' },
  ], outputs: [] },
  { type: 'event', name: 'PlatformSignerUpdated', anonymous: false, inputs: [
    { name: 'oldSigner', type: 'address', indexed: true }, { name: 'newSigner', type: 'address', indexed: true },
  ] },
  { type: 'event', name: 'ContractPausedUpdated', anonymous: false, inputs: [{ name: 'paused', type: 'bool', indexed: false }] },
  { type: 'event', name: 'ProtocolRecipientUpdated', anonymous: false, inputs: [
    { name: 'oldRecipient', type: 'address', indexed: true }, { name: 'newRecipient', type: 'address', indexed: true },
  ] },
  { type: 'event', name: 'OwnershipTransferred', anonymous: false, inputs: [
    { name: 'previousOwner', type: 'address', indexed: true }, { name: 'newOwner', type: 'address', indexed: true },
  ] },
  { type: 'event', name: 'Upgraded', anonymous: false, inputs: [
    { name: 'implementation', type: 'address', indexed: true },
  ] },
  { type: 'event', name: 'ListingRootCancelled', anonymous: false, inputs: [
    { name: 'seller', type: 'address', indexed: true }, { name: 'rootDigest', type: 'bytes32', indexed: true },
  ] },
  { type: 'event', name: 'ListingCancelled', anonymous: false, inputs: [
    { name: 'seller', type: 'address', indexed: true }, { name: 'listingDigest', type: 'bytes32', indexed: true },
  ] },
  { type: 'event', name: 'ListingNonceInvalidated', anonymous: false, inputs: [
    { name: 'seller', type: 'address', indexed: true }, { name: 'nonce', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'PurchaseExecuted', anonymous: false, inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true }, { name: 'payer', type: 'address', indexed: true },
    { name: 'paymentCurrency', type: 'address', indexed: true }, { name: 'paymentAmount', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'ProtocolSpreadCaptured', anonymous: false, inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true }, { name: 'currency', type: 'address', indexed: true },
    { name: 'recipient', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false },
  ] },
  { type: 'event', name: 'OrderLineSettled', anonymous: false, inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true }, { name: 'lineIndex', type: 'uint256', indexed: true },
    { name: 'sku', type: 'bytes32', indexed: true }, { name: 'listingHash', type: 'bytes32', indexed: false },
    { name: 'quantity', type: 'uint256', indexed: false }, { name: 'settlementCurrency', type: 'address', indexed: false },
    { name: 'amount', type: 'uint256', indexed: false }, { name: 'paymentRecipient', type: 'address', indexed: false },
    { name: 'fulfillmentKind', type: 'uint8', indexed: false },
  ] },
  { type: 'event', name: 'FulfillmentActionExecuted', anonymous: false, inputs: [
    { name: 'orderId', type: 'bytes32', indexed: true }, { name: 'lineIndex', type: 'uint256', indexed: true },
    { name: 'actionIndex', type: 'uint256', indexed: true }, { name: 'fulfillmentKind', type: 'uint8', indexed: false },
    { name: 'target', type: 'address', indexed: false }, { name: 'recipient', type: 'address', indexed: false },
    { name: 'quantity', type: 'uint256', indexed: false }, { name: 'tokenId', type: 'uint256', indexed: false },
    { name: 'unitIndex', type: 'uint256', indexed: false },
  ] },
  { type: 'error', name: 'OrderLineFailed', inputs: [{ name: 'lineIndex', type: 'uint256' }, { name: 'stage', type: 'uint8' }, { name: 'reason', type: 'bytes' }] },
  { type: 'error', name: 'FulfillmentActionFailed', inputs: [{ name: 'lineIndex', type: 'uint256' }, { name: 'actionIndex', type: 'uint256' }, { name: 'reason', type: 'bytes' }] },
  { type: 'error', name: 'AlreadyExecuted', inputs: [{ name: 'orderId', type: 'bytes32' }] },
  { type: 'error', name: 'InvalidSignature', inputs: [{ name: 'signer', type: 'address' }, { name: 'digest', type: 'bytes32' }] },
  { type: 'error', name: 'ContractPaused', inputs: [] },
  { type: 'error', name: 'DeadlineExpired', inputs: [{ name: 'deadline', type: 'uint256' }, { name: 'timestamp', type: 'uint256' }] },
  { type: 'error', name: 'DuplicateListingHash', inputs: [{ name: 'listingHash', type: 'bytes32' }] },
  { type: 'error', name: 'ExtraListing', inputs: [{ name: 'listingIndex', type: 'uint256' }] },
  { type: 'error', name: 'InvalidArrayLength', inputs: [] },
  { type: 'error', name: 'InvalidFulfillmentAction', inputs: [{ name: 'actionIndex', type: 'uint256' }] },
  { type: 'error', name: 'InvalidFulfillmentResult', inputs: [{ name: 'lineIndex', type: 'uint256' }, { name: 'actionIndex', type: 'uint256' }, { name: 'result', type: 'bytes' }] },
  { type: 'error', name: 'InvalidFulfillmentActionsHash', inputs: [] },
  { type: 'error', name: 'InvalidListing', inputs: [] },
  { type: 'error', name: 'InvalidListingNonce', inputs: [{ name: 'expected', type: 'uint256' }, { name: 'actual', type: 'uint256' }] },
  { type: 'error', name: 'InvalidListingRoot', inputs: [] },
  { type: 'error', name: 'CancelledListingRoot', inputs: [{ name: 'rootDigest', type: 'bytes32' }] },
  { type: 'error', name: 'CancelledListing', inputs: [{ name: 'listingDigest', type: 'bytes32' }] },
  { type: 'error', name: 'InvalidMerkleProof', inputs: [{ name: 'root', type: 'bytes32' }, { name: 'leaf', type: 'bytes32' }] },
  { type: 'error', name: 'MerkleProofTooDeep', inputs: [{ name: 'listingIndex', type: 'uint256' }, { name: 'depth', type: 'uint256' }] },
  { type: 'error', name: 'InvalidRootIndex', inputs: [{ name: 'index', type: 'uint256' }] },
  { type: 'error', name: 'InvalidOrderId', inputs: [] },
  { type: 'error', name: 'InvalidOrderLinesHash', inputs: [] },
  { type: 'error', name: 'InvalidPayoutRouteHash', inputs: [] },
  { type: 'error', name: 'AllowanceNotCleared', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }] },
  { type: 'error', name: 'PreexistingAllowance', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }] },
  { type: 'error', name: 'PreexistingBalanceConsumed', inputs: [{ name: 'token', type: 'address' }, { name: 'baseline', type: 'uint256' }, { name: 'current', type: 'uint256' }] },
  { type: 'error', name: 'UnexpectedCartBalance', inputs: [{ name: 'token', type: 'address' }, { name: 'baseline', type: 'uint256' }, { name: 'current', type: 'uint256' }] },
  { type: 'error', name: 'ListingNotFound', inputs: [{ name: 'listingHash', type: 'bytes32' }] },
  { type: 'error', name: 'ListingQuantityExceeded', inputs: [{ name: 'listingDigest', type: 'bytes32' }, { name: 'available', type: 'uint256' }, { name: 'requested', type: 'uint256' }] },
  { type: 'error', name: 'ListingTermsMismatch', inputs: [{ name: 'lineIndex', type: 'uint256' }] },
  { type: 'error', name: 'MaxFulfillmentOperationsExceeded', inputs: [] },
  { type: 'error', name: 'NativeValueMismatch', inputs: [] },
  { type: 'error', name: 'RouteValueWithoutCommands', inputs: [] },
  { type: 'error', name: 'RouteTooManyCommands', inputs: [{ name: 'count', type: 'uint256' }] },
  { type: 'error', name: 'RouteTooManyInputs', inputs: [{ name: 'count', type: 'uint256' }] },
] as const;
