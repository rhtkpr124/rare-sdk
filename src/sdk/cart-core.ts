/* eslint-disable functional/immutable-data, functional/no-let */
import {
  concatHex, encodeAbiParameters, encodePacked, getAddress, hashTypedData, isAddress, isHex, keccak256,
  toBytes, zeroAddress, type Address, type Hex,
} from 'viem';
import type {
  BuildCartListingRootParams, BuildCartOrderParams, CartFulfillmentAction, CartListing,
  BuildCartRouteParams, CartListingRootArtifact, CartOrderLine, CartPayoutRoute, CartRouteLeg,
  CartPurchaseOrder, CartSignedOrder, CartValidationIssue, CartValidationResult, CartListingRootArtifactEntry,
  CartListingSelection, CartListingAuthorizationBundle,
} from './types/cart.js';

export const cartEip712Name = 'SuperRare Cart';
export const cartEip712Version = '1';
export const cartMerkleMaxProofDepth = 64;
const zeroHash = `0x${'00'.repeat(32)}` as Hex;
const lineType = 'OrderLine(bytes32 sku,bytes32 listingHash,uint8 fulfillmentKind,uint256 quantity,address settlementCurrency,uint256 amount,address paymentRecipient)';
const routeType = 'PayoutRoute(bytes commands,bytes[] inputs,uint256 routerValue)';
const actionType = 'FulfillmentAction(uint256 lineIndex,uint256 quantity,address recipient)';

export type CartChainId = number | bigint;

export function cartDomain(chainId: CartChainId, cart: Address) {
  if ((typeof chainId === 'number' && (!Number.isSafeInteger(chainId) || chainId <= 0)) ||
    (typeof chainId === 'bigint' && chainId <= 0n)) {
    throw new Error('Cart chainId must be a positive bigint or safe integer.');
  }
  return { name: cartEip712Name, version: cartEip712Version, chainId, verifyingContract: cart } as const;
}

export function hashCartListing(listing: CartListing, chainId: CartChainId, cart: Address): Hex {
  return hashTypedData({ domain: cartDomain(chainId, cart), primaryType: 'Listing', types: { Listing: [
    { name: 'listingId', type: 'bytes32' }, { name: 'seller', type: 'address' }, { name: 'sku', type: 'bytes32' },
    { name: 'fulfillmentKind', type: 'uint8' }, { name: 'tokenContract', type: 'address' }, { name: 'tokenId', type: 'uint256' },
    { name: 'settlementCurrency', type: 'address' }, { name: 'minimumUnitPrice', type: 'uint256' },
    { name: 'availableQuantity', type: 'uint256' }, { name: 'paymentRecipient', type: 'address' },
  ] }, message: listing });
}

export function hashCartListingRoot(root: { listingsRoot: Hex; nonce: bigint; deadline: bigint }, chainId: CartChainId, cart: Address): Hex {
  return hashTypedData({ domain: cartDomain(chainId, cart), primaryType: 'ListingRoot', types: { ListingRoot: [
    { name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' },
  ] }, message: root });
}

export function hashCartPurchaseOrder(order: CartPurchaseOrder, chainId: CartChainId, cart: Address): Hex {
  return hashTypedData({ domain: cartDomain(chainId, cart), primaryType: 'PurchaseOrder', types: { PurchaseOrder: [
    { name: 'orderId', type: 'bytes32' }, { name: 'paymentCurrency', type: 'address' }, { name: 'deadline', type: 'uint256' },
    { name: 'paymentAmount', type: 'uint256' }, { name: 'orderLinesHash', type: 'bytes32' },
    { name: 'payoutRouteHash', type: 'bytes32' }, { name: 'fulfillmentActionsHash', type: 'bytes32' },
  ] }, message: order });
}

export const hashCartOrder = hashCartPurchaseOrder;

function typeHash(value: string): Hex { return keccak256(toBytes(value)); }
function hashArray(values: readonly Hex[]): Hex { return keccak256(concatHex(values)); }
function hashBytesArray(values: readonly Hex[]): Hex { return hashArray(values.map((value) => keccak256(value))); }

export function hashCartOrderLines(lines: readonly CartOrderLine[]): Hex {
  return hashArray(lines.map((line) => keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'uint256' },
    { type: 'address' }, { type: 'uint256' }, { type: 'address' },
  ], [typeHash(lineType), line.sku, line.listingHash, line.fulfillmentKind, line.quantity,
    line.settlementCurrency, line.amount, line.paymentRecipient]))));
}

export function hashCartPayoutRoute(route: CartPayoutRoute): Hex {
  return keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' },
  ], [typeHash(routeType), keccak256(route.commands), hashBytesArray(route.inputs), route.routerValue]));
}

export function hashCartFulfillmentActions(actions: readonly CartFulfillmentAction[]): Hex {
  return hashArray(actions.map((action) => keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address' }],
    [typeHash(actionType), action.lineIndex, action.quantity, action.recipient],
  ))));
}

export function deriveCartListingMerkleLeaf(listingDigest: Hex): Hex {
  assertBytes32(listingDigest, 'listingDigest');
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }], [listingDigest]));
}

export function computeCartListingMerkleRoot(leaf: Hex, proof: readonly Hex[]): Hex {
  assertBytes32(leaf, 'leaf');
  if (proof.length > cartMerkleMaxProofDepth) {
    throw new Error(`Cart Listing Merkle proof cannot exceed ${cartMerkleMaxProofDepth} elements.`);
  }
  return proof.reduce((computed, sibling, index) => {
    assertBytes32(sibling, `proof[${index}]`);
    const left = computed.toLowerCase() as Hex;
    const right = sibling.toLowerCase() as Hex;
    return keccak256(concatHex(left <= right ? [left, right] : [right, left]));
  }, leaf.toLowerCase() as Hex);
}

export function verifyCartListingMerkleProof(leaf: Hex, proof: readonly Hex[], expectedRoot: Hex): boolean {
  assertBytes32(expectedRoot, 'expectedRoot');
  return computeCartListingMerkleRoot(leaf, proof) === expectedRoot.toLowerCase();
}

export function buildCartListingRootArtifact(params: BuildCartListingRootParams): CartListingRootArtifact {
  const validation = validateCartListings(params.listings);
  if (!validation.isValid) throw new Error(validation.issues.map((issue) => issue.message).join(' '));
  if (params.deadline <= 0n) throw new Error('deadline must be positive.');
  const seller = getAddress(params.listings[0]!.seller);
  if (params.listings.some((listing) => getAddress(listing.seller) !== seller)) throw new Error('All Listings in a root must have the same seller.');
  const digests = params.listings.map((listing) => hashCartListing(listing, params.chainId, params.cart));
  const leaves = digests.map(deriveCartListingMerkleLeaf);
  const levels = buildMerkleLevels(leaves);
  const listingsRoot = levels.at(-1)![0]!;
  return {
    version: 1, type: 'rare-cart-listing-root', chainId: params.chainId, cart: getAddress(params.cart), seller,
    root: { listingsRoot, nonce: params.nonce.toString(), deadline: params.deadline.toString() },
    entries: params.listings.map((listing, index) => ({
      listing: { ...listing, seller: getAddress(listing.seller), tokenContract: getAddress(listing.tokenContract),
        settlementCurrency: getAddress(listing.settlementCurrency), paymentRecipient: getAddress(listing.paymentRecipient),
        tokenId: listing.tokenId.toString(), minimumUnitPrice: listing.minimumUnitPrice.toString(),
        availableQuantity: listing.availableQuantity.toString() },
      listingDigest: digests[index]!, leaf: leaves[index]!, proof: buildProof(levels, index),
    })),
  };
}

export function parseCartArtifactListing(entry: CartListingRootArtifact['entries'][number]): CartListing {
  return { ...entry.listing, tokenId: BigInt(entry.listing.tokenId), minimumUnitPrice: BigInt(entry.listing.minimumUnitPrice),
    availableQuantity: BigInt(entry.listing.availableQuantity) };
}

export function parseCartListingRootArtifact(content: string): CartListingRootArtifact {
  const parsed: unknown = JSON.parse(content);
  validateCartListingRootArtifact(parsed);
  return parsed;
}

export function validateCartListingRootArtifact(value: unknown): asserts value is CartListingRootArtifact {
  if (typeof value !== 'object' || value === null) throw new Error('Cart Listing Root artifact must be an object.');
  const artifact = value as Partial<CartListingRootArtifact>;
  if (artifact.version !== 1 || artifact.type !== 'rare-cart-listing-root') throw new Error('Unsupported Cart Listing Root artifact version or type.');
  if (!Number.isSafeInteger(artifact.chainId) || artifact.chainId! <= 0) throw new Error('Cart Listing Root artifact chainId must be a positive safe integer.');
  if (!artifact.cart || !isAddress(artifact.cart) || !artifact.seller || !isAddress(artifact.seller)) throw new Error('Cart Listing Root artifact addresses are invalid.');
  if (!artifact.root || !Array.isArray(artifact.entries) || artifact.entries.length === 0) throw new Error('Cart Listing Root artifact must contain a root and entries.');
  if (!isBytes32(artifact.root.listingsRoot) || !isUnsignedIntegerString(artifact.root.nonce) || !isUnsignedIntegerString(artifact.root.deadline)) throw new Error('Cart Listing Root artifact root fields are invalid.');
  if (artifact.signature !== undefined && !isHex(artifact.signature, { strict: true })) throw new Error('Cart Listing Root artifact signature is invalid.');
  const parsedListings = artifact.entries.map((entry, index) => {
    if (!entry || !isBytes32(entry.listingDigest) || !isBytes32(entry.leaf) || !Array.isArray(entry.proof) || !entry.proof.every(isBytes32)) {
      throw new Error(`Cart Listing Root artifact entry ${index} is invalid.`);
    }
    return parseCartArtifactListing(entry);
  });
  const rebuilt = buildCartListingRootArtifact({ listings: parsedListings, chainId: artifact.chainId!, cart: artifact.cart,
    nonce: BigInt(artifact.root.nonce), deadline: BigInt(artifact.root.deadline) });
  if (rebuilt.seller !== getAddress(artifact.seller) || rebuilt.root.listingsRoot !== artifact.root.listingsRoot) throw new Error('Cart Listing Root artifact root does not match its entries.');
  rebuilt.entries.forEach((entry, index) => {
    const supplied = artifact.entries![index]!;
    if (entry.listingDigest !== supplied.listingDigest || entry.leaf !== supplied.leaf ||
      entry.proof.length !== supplied.proof.length || entry.proof.some((proof, proofIndex) => proof !== supplied.proof[proofIndex])) {
      throw new Error(`Cart Listing Root artifact entry ${index} does not match its Merkle witness.`);
    }
  });
}

export function getCartListingArtifactEntry(artifact: CartListingRootArtifact, listingDigest: Hex): CartListingRootArtifactEntry | undefined {
  validateCartListingRootArtifact(artifact);
  return artifact.entries.find((entry) => entry.listingDigest === listingDigest);
}

export function buildCartListingAuthorization(entries: readonly CartListingSelection[]): CartListingAuthorizationBundle {
  if (entries.length === 0) throw new Error('At least one Cart Listing selection is required.');
  const roots: CartListingRootArtifact[] = [];
  const rootIndexes = new Map<string, number>();
  const listings: CartListing[] = [];
  const indexes: bigint[] = [];
  const proofs: Hex[][] = [];
  for (const selected of entries) {
    validateCartListingRootArtifact(selected.artifact);
    if (!selected.artifact.signature) throw new Error('Selected Listing Root artifact is not signed.');
    const key = cartListingRootIdentity(selected.artifact);
    let rootIndex = rootIndexes.get(key);
    if (rootIndex === undefined) { rootIndex = roots.length; roots.push(selected.artifact); rootIndexes.set(key, rootIndex); }
    else if (roots[rootIndex]!.signature !== selected.artifact.signature) throw new Error('Matching Cart Listing Roots contain conflicting signatures.');
    const entry = selected.artifact.entries.find((candidate) => candidate.listingDigest === selected.listingDigest);
    if (!entry) throw new Error(`Listing ${selected.listingDigest} is not present in its root artifact.`);
    listings.push(parseCartArtifactListing(entry)); indexes.push(BigInt(rootIndex)); proofs.push(entry.proof);
  }
  return { listings, authorization: {
    listingRoots: roots.map((artifact) => ({ listingsRoot: artifact.root.listingsRoot, nonce: BigInt(artifact.root.nonce), deadline: BigInt(artifact.root.deadline) })),
    listingRootSignatures: roots.map((artifact) => artifact.signature!), listingRootIndexes: indexes, listingProofs: proofs,
  } };
}
function cartListingRootIdentity(artifact: CartListingRootArtifact): string {
  return [artifact.chainId, artifact.cart, artifact.seller, artifact.root.listingsRoot, artifact.root.nonce, artifact.root.deadline].join(':').toLowerCase();
}
function isBytes32(value: unknown): value is Hex { return typeof value === 'string' && isHex(value, { strict: true }) && value.length === 66; }
function assertBytes32(value: unknown, field: string): asserts value is Hex {
  if (!isBytes32(value)) throw new Error(`${field} must be bytes32.`);
}
function isUnsignedIntegerString(value: unknown): value is string { return typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value); }

export function buildCartOrder(params: BuildCartOrderParams): Omit<CartSignedOrder, 'platformSignature'> {
  const route = params.route ?? { commands: '0x', inputs: [], routerValue: 0n };
  const actions = params.actions ?? [];
  const issues = validateCartOrderInputs(params.lines, actions, params);
  if (issues.length > 0) throw new Error(issues.map((issue) => issue.message).join(' '));
  return { order: { orderId: params.orderId, paymentCurrency: getAddress(params.paymentCurrency), deadline: params.deadline,
    paymentAmount: params.paymentAmount, orderLinesHash: hashCartOrderLines(params.lines), payoutRouteHash: hashCartPayoutRoute(route),
    fulfillmentActionsHash: hashCartFulfillmentActions(actions) }, lines: [...params.lines], route, actions: [...actions] };
}

export function aggregateCartSettlementObligations(lines: readonly CartOrderLine[]): Map<Address, bigint> {
  const totals = new Map<Address, bigint>();
  for (const line of lines) {
    const currency = getAddress(line.settlementCurrency);
    totals.set(currency, (totals.get(currency) ?? 0n) + line.amount);
  }
  return totals;
}

export function applyCartQuoteSpread(estimatedInput: bigint, spreadBps: bigint): bigint {
  if (estimatedInput <= 0n) throw new Error('estimatedInput must be positive.');
  if (spreadBps < 0n || spreadBps >= 10_000n) throw new Error('spreadBps must be between 0 and 9999.');
  return (estimatedInput * (10_000n + spreadBps) + 9_999n) / 10_000n;
}

export function buildCartPayoutRoute(params: BuildCartRouteParams): CartPayoutRoute {
  const routerValue = params.routerValue ?? 0n;
  if (routerValue < 0n) throw new Error('routerValue cannot be negative.');
  if (params.legs.length === 0) {
    if (routerValue !== 0n) throw new Error('routerValue requires at least one Universal Router command.');
    return { commands: '0x', inputs: [], routerValue };
  }
  const mode = params.legs[0]!.mode;
  if (params.legs.some((leg) => leg.mode !== mode)) throw new Error('Every Cart route leg must use the same execution mode.');
  return {
    commands: encodePacked(params.legs.map(() => 'uint8'), params.legs.map(routeCommand)),
    inputs: params.legs.map((leg, index) => encodeCartRouteLeg(leg, params.paymentCurrency, index)),
    routerValue,
  };
}

function routeCommand(leg: CartRouteLeg): number {
  if (leg.protocol === 'v2') return leg.mode === 'exact-input' ? 0x08 : 0x09;
  return leg.mode === 'exact-input' ? 0x00 : 0x01;
}

function encodeCartRouteLeg(leg: CartRouteLeg, paymentCurrency: Address, index: number): Hex {
  if (leg.path.length < 2) throw new Error(`legs[${index}].path must contain at least two currencies.`);
  const path = leg.path.map(getAddress);
  if (path[0] !== getAddress(paymentCurrency)) throw new Error(`legs[${index}].path must start in the payment currency.`);
  const recipient = '0x0000000000000000000000000000000000000001' as Address;
  if (leg.protocol === 'v2') {
    return leg.mode === 'exact-input'
      ? encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'bool' }], [recipient, leg.amountIn, leg.amountOutMinimum, path, true])
      : encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'bool' }], [recipient, leg.amountOut, leg.amountInMaximum, path, true]);
  }
  if (leg.fees.length !== path.length - 1) throw new Error(`legs[${index}].fees must contain one fee per V3 hop.`);
  if (leg.fees.some((fee) => !Number.isInteger(fee) || fee < 0 || fee > 0xffffff)) throw new Error(`legs[${index}].fees contains an invalid uint24 fee.`);
  const encodedPath = encodeV3Path(leg.mode === 'exact-output' ? [...path].reverse() : path, leg.mode === 'exact-output' ? [...leg.fees].reverse() : leg.fees);
  return leg.mode === 'exact-input'
    ? encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bool' }], [recipient, leg.amountIn, leg.amountOutMinimum, encodedPath, true])
    : encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bool' }], [recipient, leg.amountOut, leg.amountInMaximum, encodedPath, true]);
}

function encodeV3Path(path: readonly Address[], fees: readonly number[]): Hex {
  const types: ('address' | 'uint24')[] = [];
  const values: (Address | number)[] = [];
  path.forEach((currency, index) => {
    types.push('address'); values.push(currency);
    const fee = fees[index]; if (fee !== undefined) { types.push('uint24'); values.push(fee); }
  });
  return encodePacked(types, values);
}

export function validateCartListings(listings: readonly CartListing[]): CartValidationResult<readonly CartListing[]> {
  const issues: CartValidationIssue[] = [];
  if (listings.length === 0) issues.push(issue('empty', 'listings', 'listings must include at least one Listing.'));
  listings.forEach((listing, index) => {
    const prefix = `listings[${index}]`;
    for (const [field, value] of [['seller', listing.seller], ['tokenContract', listing.tokenContract], ['settlementCurrency', listing.settlementCurrency], ['paymentRecipient', listing.paymentRecipient]] as const) {
      if (!isAddress(value)) issues.push(issue('invalid_address', `${prefix}.${field}`, `${prefix}.${field} must be an address.`));
    }
    if (!isHex(listing.listingId, { strict: true }) || listing.listingId.length !== 66) issues.push(issue('invalid_bytes32', `${prefix}.listingId`, `${prefix}.listingId must be bytes32.`));
    if (!isHex(listing.sku, { strict: true }) || listing.sku.length !== 66) issues.push(issue('invalid_bytes32', `${prefix}.sku`, `${prefix}.sku must be bytes32.`));
    if (listing.listingId === zeroHash) issues.push(issue('zero', `${prefix}.listingId`, `${prefix}.listingId must be nonzero.`));
    if (listing.sku === zeroHash) issues.push(issue('zero', `${prefix}.sku`, `${prefix}.sku must be nonzero.`));
    if (listing.seller === zeroAddress) issues.push(issue('zero_address', `${prefix}.seller`, `${prefix}.seller must be nonzero.`));
    if (listing.paymentRecipient === zeroAddress) issues.push(issue('zero_address', `${prefix}.paymentRecipient`, `${prefix}.paymentRecipient must be nonzero.`));
    if (listing.minimumUnitPrice <= 0n) issues.push(issue('non_positive', `${prefix}.minimumUnitPrice`, `${prefix}.minimumUnitPrice must be positive.`));
    if (listing.tokenId < 0n || listing.availableQuantity < 0n) issues.push(issue('negative', prefix, `${prefix} integer values cannot be negative.`));
    if (listing.fulfillmentKind === 6) issues.push(issue('invalid_kind', `${prefix}.fulfillmentKind`, 'CURRENCY_SWAP is not valid on a seller Listing.'));
    const onChain = listing.fulfillmentKind >= 2 && listing.fulfillmentKind <= 5;
    if (onChain && listing.tokenContract === zeroAddress) issues.push(issue('missing_token', `${prefix}.tokenContract`, 'On-chain Listings require a token contract.'));
    if (!onChain && (listing.tokenContract !== zeroAddress || listing.tokenId !== 0n)) issues.push(issue('unexpected_token', `${prefix}.tokenContract`, 'Off-chain Listings cannot include NFT fields.'));
    if (listing.fulfillmentKind === 2 && listing.availableQuantity !== 0n && listing.availableQuantity !== 1n) issues.push(issue('invalid_quantity', `${prefix}.availableQuantity`, 'ERC-721 transfer availability must be zero (uncapped) or one.'));
    if (listing.fulfillmentKind === 4 && listing.tokenId !== 0n) issues.push(issue('unexpected_token_id', `${prefix}.tokenId`, 'ERC-721 mint Listings cannot fix a token id.'));
  });
  return issues.length === 0 ? { isValid: true, value: listings } : { isValid: false, issues };
}

function validateCartOrderInputs(lines: readonly CartOrderLine[], actions: readonly CartFulfillmentAction[], params: BuildCartOrderParams): CartValidationIssue[] {
  const issues: CartValidationIssue[] = [];
  if (lines.length === 0 || lines.length > 20) issues.push(issue('invalid_length', 'lines', 'lines must include between 1 and 20 Order Lines.'));
  if (params.orderId === zeroHash) issues.push(issue('zero', 'orderId', 'orderId must be nonzero.'));
  if (params.deadline <= 0n || params.paymentAmount <= 0n) issues.push(issue('non_positive', 'order', 'deadline and paymentAmount must be positive.'));
  if (actions.length > 20) issues.push(issue('invalid_length', 'actions', 'actions cannot contain more than 20 entries.'));
  lines.forEach((line, index) => {
    if (line.quantity <= 0n || line.amount <= 0n) issues.push(issue('non_positive', `lines[${index}]`, `lines[${index}] quantity and amount must be positive.`));
    if (line.sku === zeroHash) issues.push(issue('zero', `lines[${index}].sku`, `lines[${index}].sku must be nonzero.`));
    if (line.paymentRecipient === zeroAddress) issues.push(issue('zero_address', `lines[${index}].paymentRecipient`, `lines[${index}].paymentRecipient must be nonzero.`));
  });
  actions.forEach((action, index) => {
    if (action.lineIndex >= BigInt(lines.length) || action.quantity <= 0n || action.recipient === zeroAddress) issues.push(issue('invalid_action', `actions[${index}]`, `actions[${index}] is invalid.`));
  });
  return issues;
}
function issue(code: string, field: string, message: string): CartValidationIssue { return { code, field, message }; }

function buildMerkleLevels(leaves: readonly Hex[]): Hex[][] {
  const levels: Hex[][] = [[...leaves]];
  while (levels.at(-1)!.length > 1) {
    const current = levels.at(-1)!; const next: Hex[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!; const right = current[i + 1];
      next.push(right === undefined ? left : keccak256(concatHex(left < right ? [left, right] : [right, left])));
    }
    levels.push(next);
  }
  return levels;
}
function buildProof(levels: readonly Hex[][], index: number): Hex[] {
  const proof: Hex[] = []; let cursor = index;
  for (const level of levels.slice(0, -1)) { const sibling = level[cursor ^ 1]; if (sibling) proof.push(sibling); cursor = Math.floor(cursor / 2); }
  return proof;
}
