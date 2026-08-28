const listing = [
  { name: 'listingSalt', type: 'bytes32' }, { name: 'seller', type: 'address' },
  { name: 'sku', type: 'bytes32' }, { name: 'fulfillmentKind', type: 'uint8' },
  { name: 'tokenContract', type: 'address' }, { name: 'tokenId', type: 'uint256' },
  { name: 'settlementCurrency', type: 'address' }, { name: 'minimumUnitPrice', type: 'uint256' },
  { name: 'availableQuantity', type: 'uint256' }, { name: 'paymentRecipient', type: 'address' },
] as const;
const root = [
  { name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
] as const;
const order = [
  { name: 'orderId', type: 'bytes32' }, { name: 'paymentCurrency', type: 'address' },
  { name: 'deadline', type: 'uint256' }, { name: 'paymentAmount', type: 'uint256' },
  { name: 'orderLinesHash', type: 'bytes32' }, { name: 'payoutRouteHash', type: 'bytes32' },
  { name: 'fulfillmentActionsHash', type: 'bytes32' },
] as const;
const line = [
  { name: 'sku', type: 'bytes32' }, { name: 'listingDigest', type: 'bytes32' },
  { name: 'fulfillmentKind', type: 'uint8' }, { name: 'quantity', type: 'uint256' },
  { name: 'settlementCurrency', type: 'address' }, { name: 'amount', type: 'uint256' },
  { name: 'paymentRecipient', type: 'address' },
] as const;
const route = [
  { name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' },
  { name: 'routerValue', type: 'uint256' },
] as const;
const action = [
  { name: 'lineIndex', type: 'uint256' }, { name: 'quantity', type: 'uint256' },
  { name: 'recipient', type: 'address' },
] as const;

export const cartHashesAbi = [
  { type: 'function', name: 'hashListing', stateMutability: 'pure', inputs: [
    { name: 'domainSeparator', type: 'bytes32' }, { name: 'listing', type: 'tuple', components: listing },
  ], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hashListingRoot', stateMutability: 'pure', inputs: [
    { name: 'domainSeparator', type: 'bytes32' }, { name: 'root', type: 'tuple', components: root },
  ], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hashListingLeaf', stateMutability: 'pure', inputs: [
    { name: 'listingDigest', type: 'bytes32' },
  ], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hashOrder', stateMutability: 'pure', inputs: [
    { name: 'domainSeparator', type: 'bytes32' }, { name: 'order', type: 'tuple', components: order },
  ], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hashOrderLines', stateMutability: 'pure', inputs: [
    { name: 'lines', type: 'tuple[]', components: line },
  ], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hashPayoutRoute', stateMutability: 'pure', inputs: [
    { name: 'route', type: 'tuple', components: route },
  ], outputs: [{ type: 'bytes32' }] },
  { type: 'function', name: 'hashFulfillmentActions', stateMutability: 'pure', inputs: [
    { name: 'actions', type: 'tuple[]', components: action },
  ], outputs: [{ type: 'bytes32' }] },
] as const;
