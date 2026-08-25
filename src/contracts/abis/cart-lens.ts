const validationResult = [
  { name: 'valid', type: 'bool' }, { name: 'code', type: 'uint8' }, { name: 'index', type: 'uint256' },
  { name: 'subject', type: 'bytes32' }, { name: 'reason', type: 'bytes' },
] as const;
const listing = [
  { name: 'listingId', type: 'bytes32' }, { name: 'seller', type: 'address' },
  { name: 'sku', type: 'bytes32' }, { name: 'fulfillmentKind', type: 'uint8' },
  { name: 'tokenContract', type: 'address' }, { name: 'tokenId', type: 'uint256' },
  { name: 'settlementCurrency', type: 'address' }, { name: 'minimumUnitPrice', type: 'uint256' },
  { name: 'availableQuantity', type: 'uint256' }, { name: 'paymentRecipient', type: 'address' },
] as const;
const root = [
  { name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
] as const;

export const cartLensAbi = [
  { type: 'function', name: 'listingStatus', stateMutability: 'view', inputs: [
    { name: 'cart', type: 'address' }, { name: 'listing', type: 'tuple', components: listing },
    { name: 'root', type: 'tuple', components: root },
  ], outputs: [{ name: 'status', type: 'tuple', components: [
    { name: 'currentNonce', type: 'uint256' }, { name: 'filledQuantity', type: 'uint256' },
    { name: 'remainingQuantity', type: 'uint256' }, { name: 'uncapped', type: 'bool' },
    { name: 'nonceValid', type: 'bool' }, { name: 'deadlineValid', type: 'bool' },
    { name: 'cancelled', type: 'bool' }, { name: 'active', type: 'bool' },
  ] }] },
  { type: 'function', name: 'validatePurchaseEnvelope', stateMutability: 'view', inputs: [
    { name: 'cart', type: 'address' },
    { name: 'order', type: 'tuple', components: [
      { name: 'orderId', type: 'bytes32' }, { name: 'paymentCurrency', type: 'address' },
      { name: 'deadline', type: 'uint256' }, { name: 'paymentAmount', type: 'uint256' },
      { name: 'orderLinesHash', type: 'bytes32' }, { name: 'payoutRouteHash', type: 'bytes32' },
      { name: 'fulfillmentActionsHash', type: 'bytes32' },
    ] },
    { name: 'lines', type: 'tuple[]', components: [
      { name: 'sku', type: 'bytes32' }, { name: 'listingHash', type: 'bytes32' },
      { name: 'fulfillmentKind', type: 'uint8' }, { name: 'quantity', type: 'uint256' },
      { name: 'settlementCurrency', type: 'address' }, { name: 'amount', type: 'uint256' },
      { name: 'paymentRecipient', type: 'address' },
    ] },
    { name: 'route', type: 'tuple', components: [
      { name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'routerValue', type: 'uint256' },
    ] },
    { name: 'actions', type: 'tuple[]', components: [{ name: 'lineIndex', type: 'uint256' }, { name: 'quantity', type: 'uint256' }, { name: 'recipient', type: 'address' }] },
    { name: 'platformSignature', type: 'bytes' },
  ], outputs: [{ name: 'result', type: 'tuple', components: validationResult }] },
  { type: 'function', name: 'validateListing', stateMutability: 'view', inputs: [
    { name: 'cart', type: 'address' }, { name: 'listing', type: 'tuple', components: listing },
    { name: 'root', type: 'tuple', components: root }, { name: 'rootSignature', type: 'bytes' },
    { name: 'proof', type: 'bytes32[]' }, { name: 'requestedQuantity', type: 'uint256' },
  ], outputs: [{ name: 'result', type: 'tuple', components: validationResult }] },
  { type: 'function', name: 'previewRoute', stateMutability: 'view', inputs: [
    { name: 'cart', type: 'address' },
    { name: 'route', type: 'tuple', components: [
      { name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'routerValue', type: 'uint256' },
    ] },
  ], outputs: [{ name: 'preview', type: 'tuple', components: [
    { name: 'valid', type: 'bool' }, { name: 'code', type: 'uint8' }, { name: 'reason', type: 'bytes' },
  ] }] },
] as const;
