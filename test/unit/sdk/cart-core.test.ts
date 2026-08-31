import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, encodePacked, zeroAddress, type Address, type Hex } from 'viem';
import {
  aggregateCartSettlementObligations,
  applyCartQuoteSpread,
  buildCartListingAuthorization,
  buildCartListingRootArtifact,
  buildCartOrder,
  buildCartPayoutRoute,
  buildCartVariantSearchQuery,
  getCartListingArtifactEntry,
  parseCartListingRootArtifact,
  validateCartListings,
  validateCartCheckoutIntent,
  validateCartCheckoutPreparationForPurchase,
  validateCartListingIntent,
  validateCartListingRootArtifact,
  validateCartSettledOrderLines,
} from '../../../src/sdk/cart-core.js';
import { cartFulfillmentKinds, type CartFulfillmentAction, type CartListing, type CartOrderLine } from '../../../src/sdk/types/cart.js';
import {
  buildCartEip712Domain,
  computeCartListingMerkleRoot,
  deriveCartListingMerkleLeaf,
  hashCartFulfillmentActions,
  hashCartListing,
  hashCartListingRoot,
  hashCartOrderLines,
  hashCartPayoutRoute,
  hashCartPurchaseOrder,
  verifyCartListingMerkleProof,
} from '../../../src/sdk/public-utils.js';

const seller = '0x1000000000000000000000000000000000000000' as Address;
const cart = '0x2000000000000000000000000000000000000000' as Address;
const bytes32 = (character: string): Hex => `0x${character.repeat(64)}` as Hex;

const listings: CartListing[] = [
  {
    listingSalt: bytes32('1'), seller, sku: bytes32('a'), fulfillmentKind: cartFulfillmentKinds.erc721Transfer,
    tokenContract: cart, tokenId: 1n, settlementCurrency: zeroAddress, minimumUnitPrice: 100n,
    availableQuantity: 1n, paymentRecipient: seller,
  },
  {
    listingSalt: bytes32('2'), seller, sku: bytes32('b'), fulfillmentKind: cartFulfillmentKinds.erc1155Transfer,
    tokenContract: cart, tokenId: 2n, settlementCurrency: zeroAddress, minimumUnitPrice: 200n,
    availableQuantity: 5n, paymentRecipient: seller,
  },
];

describe('Cart functional core', () => {
  it('rejects invalid checkout intent before calling Rare API', () => {
    expect(validateCartCheckoutIntent({ paymentCurrency: zeroAddress, items: [
      { listingDigest: bytes32('1'), quantity: 1n, recipient: seller },
    ] }).isValid).toBe(true);
    const invalid = validateCartCheckoutIntent({ paymentCurrency: 'invalid' as Address, items: [
      { listingDigest: '0x12', quantity: 0n, recipient: 'invalid' as Address },
    ] });
    expect(invalid.isValid).toBe(false);
    if (!invalid.isValid) expect(invalid.issues.map((issue) => issue.code)).toEqual([
      'invalid_address', 'invalid_digest', 'non_positive', 'invalid_address',
    ]);
  });

  it('rejects stale or client-mismatched checkout preparations before side effects', () => {
    const preparation = {
      schemaVersion: 1 as const,
      chainId: 11_155_111n,
      cartAddress: cart,
      preparedAt: '2026-08-28T12:00:00.000Z',
      expiresAt: '2026-08-28T12:05:00.000Z',
      intent: { paymentCurrency: zeroAddress, items: [{ listingDigest: bytes32('1'), quantity: 1n }] },
      paymentAmount: 100n,
      fees: [],
      settlements: [{ currency: zeroAddress, amount: 100n }],
      lines: [],
      route: { commands: '0x' as Hex, inputs: [], routerValue: 0n },
    };
    expect(validateCartCheckoutPreparationForPurchase(preparation, {
      chainId: 11_155_111n,
      cart,
      nowMs: Date.parse('2026-08-28T12:04:00.000Z'),
    }).isValid).toBe(true);
    const invalid = validateCartCheckoutPreparationForPurchase(
      { ...preparation, chainId: 1n, paymentAmount: 0n },
      { chainId: 11_155_111n, cart, nowMs: Date.parse('2026-08-28T12:06:00.000Z') },
    );
    expect(invalid.isValid).toBe(false);
    if (!invalid.isValid) expect(invalid.issues.map((issue) => issue.code)).toEqual(['chain_mismatch', 'expired', 'non_positive']);
  });

  it('validates seller-facing Listing intent without contract fulfillment fields', () => {
    expect(validateCartListingIntent({ seller, deadline: 2_000_000_000n, listings: [{
      sku: bytes32('a'), settlementCurrency: zeroAddress, unitPrice: 100n, quantity: 1n,
    }] }).isValid).toBe(true);
    const invalid = validateCartListingIntent({ seller: 'invalid' as Address, deadline: 0n, listings: [{
      sku: '0x12', settlementCurrency: 'invalid' as Address, unitPrice: 0n, quantity: 0n,
      paymentRecipient: 'invalid' as Address,
    }] });
    expect(invalid.isValid).toBe(false);
    if (!invalid.isValid) expect(invalid.issues.map((issue) => issue.code)).toEqual([
      'invalid_address', 'non_positive', 'invalid_sku', 'invalid_address', 'non_positive', 'non_positive', 'invalid_address',
    ]);
  });

  it('builds a portable deterministic Listing Root artifact', () => {
    const artifact = buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n });
    expect(artifact.root.listingsRoot).toBe('0xe7ab7ad2e552ad627517bb3634d3b3e495d80ec4de7ceb8e71a8ff62ace98407');
    expect(artifact.entries.map((entry) => entry.listingDigest)).toEqual([
      '0x5b1fcc50cfdf1c82f125cdc711571ae25c2760caf4c8d4deb044bd00ecec573b',
      '0xac69cee5bdae6f6665059d753b76c42767398ba4f023885588cb039e250d3fe2',
    ]);
    expect(() => JSON.stringify(artifact)).not.toThrow();
  });

  it('exposes contract-compatible Cart protocol hash golden vectors', () => {
    const artifact = buildCartListingRootArtifact({ listings: [listings[0]!], chainId: 11_155_111, cart, nonce: 3n,
      deadline: 2_000_000_000n });
    const root = { listingsRoot: artifact.root.listingsRoot, nonce: 3n, deadline: 2_000_000_000n };
    const built = buildCartOrder({
      orderId: bytes32('c'), paymentCurrency: zeroAddress, deadline: 2_000_000_000n, paymentAmount: 500n,
      lines: [{ sku: bytes32('a'), listingDigest: artifact.entries[0]!.listingDigest,
        fulfillmentKind: cartFulfillmentKinds.erc721Transfer, quantity: 1n, settlementCurrency: zeroAddress,
        amount: 100n, paymentRecipient: seller }],
      actions: [{ lineIndex: 0n, quantity: 1n, recipient: seller }],
    });

    expect(buildCartEip712Domain(11_155_111n, cart)).toEqual({
      name: 'SuperRare Cart', version: '1', chainId: 11_155_111n, verifyingContract: cart,
    });
    expect(hashCartListing(listings[0]!, 11_155_111n, cart)).toBe('0x5b1fcc50cfdf1c82f125cdc711571ae25c2760caf4c8d4deb044bd00ecec573b');
    expect(hashCartListingRoot(root, 11_155_111n, cart)).toBe('0x0356c7e93ad05e14d3bf8ca115268a3c7c76195c6222ad645f59db9a62241c1a');
    expect(hashCartOrderLines(built.lines)).toBe('0x3fd44e1685e62ae0ef5c62474446f14e4cee25f5b644db9be4d9d9900c4c49bc');
    expect(hashCartPayoutRoute(built.route)).toBe('0x04b77f7126f5c2a130c79484a3ea1355bf8fb7d35f3773078d4ddd88a6d5d46a');
    expect(hashCartFulfillmentActions(built.actions)).toBe('0xba849680009431518c33bc2af2eb9cdc70aab55365b8e33eac1c35eb3223b1ff');
    expect(hashCartPurchaseOrder(built.order, 11_155_111n, cart)).toBe('0x73cb0031f87092f39d3bf3cc33fb713d50adc8136f724ef06ebd0ad6d2cec166');
  });

  it('produces identical hashes for equivalent safe number and bigint chain IDs', () => {
    const artifact = buildCartListingRootArtifact({ listings: [listings[0]!], chainId: 11_155_111, cart, nonce: 3n,
      deadline: 2_000_000_000n });
    const root = { listingsRoot: artifact.root.listingsRoot, nonce: 3n, deadline: 2_000_000_000n };
    const built = buildCartOrder({ orderId: bytes32('c'), paymentCurrency: zeroAddress, deadline: 2_000_000_000n,
      paymentAmount: 1n, lines: [{ sku: bytes32('a'), listingDigest: artifact.entries[0]!.listingDigest,
        fulfillmentKind: cartFulfillmentKinds.erc721Transfer, quantity: 1n, settlementCurrency: zeroAddress,
        amount: 1n, paymentRecipient: seller }] });
    expect(hashCartListing(listings[0]!, 11_155_111, cart)).toBe(hashCartListing(listings[0]!, 11_155_111n, cart));
    expect(hashCartListingRoot(root, 11_155_111, cart)).toBe(hashCartListingRoot(root, 11_155_111n, cart));
    expect(hashCartPurchaseOrder(built.order, 11_155_111, cart)).toBe(hashCartPurchaseOrder(built.order, 11_155_111n, cart));
    expect(hashCartListing(listings[0]!, 2n ** 100n, cart)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(() => hashCartListing(listings[0]!, Number.MAX_SAFE_INTEGER + 1, cart)).toThrow('safe integer');
  });

  it('derives and verifies sorted-pair Cart Listing Merkle witnesses', () => {
    const artifact = buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n });
    artifact.entries.forEach((entry) => {
      expect(deriveCartListingMerkleLeaf(entry.listingDigest)).toBe(entry.leaf);
      expect(computeCartListingMerkleRoot(entry.leaf, entry.proof)).toBe(artifact.root.listingsRoot);
      expect(verifyCartListingMerkleProof(entry.leaf, entry.proof, artifact.root.listingsRoot)).toBe(true);
    });
    const singleton = buildCartListingRootArtifact({ listings: [listings[0]!], chainId: 11_155_111, cart, nonce: 3n,
      deadline: 2_000_000_000n });
    expect(computeCartListingMerkleRoot(singleton.entries[0]!.leaf, [])).toBe(singleton.root.listingsRoot);
    expect(verifyCartListingMerkleProof(artifact.entries[0]!.leaf, artifact.entries[0]!.proof, bytes32('f'))).toBe(false);
    expect(() => computeCartListingMerkleRoot(artifact.entries[0]!.leaf, Array.from({ length: 65 }, () => bytes32('f'))))
      .toThrow('cannot exceed 64');
  });

  it('carries an unpaired node and verifies proofs for odd-sized roots', () => {
    const oddArtifact = buildCartListingRootArtifact({
      listings: [...listings, { ...listings[1]!, listingSalt: bytes32('3'), sku: bytes32('c'), tokenId: 3n }],
      chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n,
    });

    expect(oddArtifact.entries).toHaveLength(3);
    for (const entry of oddArtifact.entries) {
      expect(verifyCartListingMerkleProof(entry.leaf, entry.proof, oddArtifact.root.listingsRoot)).toBe(true);
    }
    expect(oddArtifact.entries[2]!.proof).toHaveLength(1);
  });

  it('assembles deduplicated seller authorization witnesses', () => {
    const artifact = { ...buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n }), signature: '0x1234' as Hex };
    const result = buildCartListingAuthorization(artifact.entries.map((entry) => ({ artifact, listingDigest: entry.listingDigest })));
    expect(result.listings).toEqual(listings);
    expect(result.authorization.listingRoots).toHaveLength(1);
    expect(result.authorization.listingRootIndexes).toEqual([0n, 0n]);
  });

  it('round-trips and validates a portable signed batch artifact', () => {
    const artifact = { ...buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n,
      deadline: 2_000_000_000n }), signature: '0x1234' as Hex };
    const parsed = parseCartListingRootArtifact(JSON.stringify(artifact));
    expect(parsed).toEqual(artifact);
    expect(getCartListingArtifactEntry(parsed, artifact.entries[1]!.listingDigest)).toEqual(artifact.entries[1]);
    expect(getCartListingArtifactEntry(parsed, bytes32('f'))).toBeUndefined();
  });

  it('deduplicates equal roots after independent JSON deserialization', () => {
    const artifact = { ...buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n,
      deadline: 2_000_000_000n }), signature: '0x1234' as Hex };
    const first = parseCartListingRootArtifact(JSON.stringify(artifact));
    const second = parseCartListingRootArtifact(JSON.stringify(artifact));
    const result = buildCartListingAuthorization([
      { artifact: first, listingDigest: first.entries[0]!.listingDigest },
      { artifact: second, listingDigest: second.entries[1]!.listingDigest },
    ]);
    expect(result.authorization.listingRoots).toHaveLength(1);
    expect(result.authorization.listingRootIndexes).toEqual([0n, 0n]);
  });

  it('combines selections from multiple independently signed roots', () => {
    const first = { ...buildCartListingRootArtifact({ listings: [listings[0]!], chainId: 11_155_111, cart, nonce: 3n,
      deadline: 2_000_000_000n }), signature: '0x1234' as Hex };
    const second = { ...buildCartListingRootArtifact({ listings: [listings[1]!], chainId: 11_155_111, cart, nonce: 3n,
      deadline: 2_000_000_000n }), signature: '0x5678' as Hex };
    const result = buildCartListingAuthorization([
      { artifact: first, listingDigest: first.entries[0]!.listingDigest },
      { artifact: second, listingDigest: second.entries[0]!.listingDigest },
    ]);
    expect(result.authorization.listingRoots).toHaveLength(2);
    expect(result.authorization.listingRootIndexes).toEqual([0n, 1n]);
    expect(result.authorization.listingProofs).toEqual([[], []]);
  });

  it('rejects corrupt serialized roots and witnesses', () => {
    const artifact = buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n });
    expect(() => validateCartListingRootArtifact({ ...artifact, root: { ...artifact.root, listingsRoot: bytes32('f') } }))
      .toThrow('root does not match');
    expect(() => validateCartListingRootArtifact({ ...artifact, entries: [
      { ...artifact.entries[0]!, proof: [bytes32('f')] }, artifact.entries[1]!,
    ] })).toThrow('Merkle witness');
  });

  it('hashes the complete immutable Purchase Order payload', () => {
    const artifact = buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n });
    const built = buildCartOrder({
      orderId: bytes32('c'), paymentCurrency: zeroAddress, deadline: 2_000_000_000n, paymentAmount: 500n,
      lines: [{ sku: bytes32('a'), listingDigest: artifact.entries[0]!.listingDigest,
        fulfillmentKind: cartFulfillmentKinds.erc721Transfer, quantity: 1n, settlementCurrency: zeroAddress,
        amount: 100n, paymentRecipient: seller }],
      actions: [{ lineIndex: 0n, quantity: 1n, recipient: seller }],
    });
    expect(built.order.orderLinesHash).toBe('0x3fd44e1685e62ae0ef5c62474446f14e4cee25f5b644db9be4d9d9900c4c49bc');
    expect(built.order.payoutRouteHash).toBe('0x04b77f7126f5c2a130c79484a3ea1355bf8fb7d35f3773078d4ddd88a6d5d46a');
    expect(built.order.fulfillmentActionsHash).toBe('0xba849680009431518c33bc2af2eb9cdc70aab55365b8e33eac1c35eb3223b1ff');
  });

  it('aggregates settlement obligations and rounds fixed quote spread upward', () => {
    const lines = [
      { sku: bytes32('a'), listingDigest: bytes32('0'), fulfillmentKind: cartFulfillmentKinds.none,
        quantity: 1n, settlementCurrency: zeroAddress, amount: 100n, paymentRecipient: seller },
      { sku: bytes32('b'), listingDigest: bytes32('0'), fulfillmentKind: cartFulfillmentKinds.none,
        quantity: 1n, settlementCurrency: zeroAddress, amount: 25n, paymentRecipient: seller },
    ];
    expect(aggregateCartSettlementObligations(lines).get(zeroAddress)).toBe(125n);
    expect(applyCartQuoteSpread(101n, 50n)).toBe(102n);
  });

  it('validates every seller and adjustment payout against its settled receipt event', () => {
    const royaltyRecipient = '0x3000000000000000000000000000000000000000' as Address;
    const protocolRecipient = '0x4000000000000000000000000000000000000000' as Address;
    const lines: CartOrderLine[] = [
      { sku: bytes32('a'), listingDigest: bytes32('1'), fulfillmentKind: cartFulfillmentKinds.erc721Transfer,
        quantity: 1n, settlementCurrency: zeroAddress, amount: 850n, paymentRecipient: seller },
      { sku: bytes32('a'), listingDigest: bytes32('1'), fulfillmentKind: cartFulfillmentKinds.none,
        quantity: 1n, settlementCurrency: zeroAddress, amount: 100n, paymentRecipient: royaltyRecipient },
      { sku: bytes32('a'), listingDigest: bytes32('1'), fulfillmentKind: cartFulfillmentKinds.none,
        quantity: 1n, settlementCurrency: zeroAddress, amount: 30n, paymentRecipient: protocolRecipient },
    ];
    const settled = lines.map((line, lineIndex) => ({ ...line, lineIndex: BigInt(lineIndex) }));

    expect(validateCartSettledOrderLines(lines, settled)).toEqual({ isValid: true, value: settled });
    expect(validateCartSettledOrderLines(lines, settled.map((line) =>
      line.lineIndex === 1n ? { ...line, amount: 99n } : line)).isValid).toBe(false);
    expect(validateCartSettledOrderLines(lines, settled.map((line) =>
      line.lineIndex === 1n ? { ...line, paymentRecipient: protocolRecipient } : line)).isValid).toBe(false);
  });

  it('rejects missing, duplicate, and out-of-range settled Order Line indexes', () => {
    const lines: CartOrderLine[] = [
      { sku: bytes32('a'), listingDigest: bytes32('1'), fulfillmentKind: cartFulfillmentKinds.erc721Transfer,
        quantity: 1n, settlementCurrency: zeroAddress, amount: 850n, paymentRecipient: seller },
      { sku: bytes32('a'), listingDigest: bytes32('1'), fulfillmentKind: cartFulfillmentKinds.none,
        quantity: 1n, settlementCurrency: zeroAddress, amount: 100n, paymentRecipient: cart },
    ];
    const first = { ...lines[0]!, lineIndex: 0n };

    expect(validateCartSettledOrderLines(lines, [first]).isValid).toBe(false);
    expect(validateCartSettledOrderLines(lines, [first, { ...lines[1]!, lineIndex: 0n }]).isValid).toBe(false);
    expect(validateCartSettledOrderLines(lines, [first, { ...lines[1]!, lineIndex: 2n }]).isValid).toBe(false);
  });

  it('encodes an order-wide exact-output route using Cart policy sentinels', () => {
    const output = '0x3000000000000000000000000000000000000000' as Address;
    const route = buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { protocol: 'v2', mode: 'exact-output', path: [seller, output], amountOut: 7n, amountInMaximum: 11n },
    ] });
    expect(route.commands).toBe('0x09');
    expect(route.routerValue).toBe(0n);
    expect(decodeAbiParameters([
      { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'bool' },
    ], route.inputs[0]!)).toEqual([
      '0x0000000000000000000000000000000000000001', 7n, 11n, [seller, output], true,
    ]);
  });

  it('encodes V2/V3 exact-input and exact-output route variants', () => {
    const output = '0x3000000000000000000000000000000000000000' as Address;
    const middle = '0x4000000000000000000000000000000000000000' as Address;
    const v2Input = buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { protocol: 'v2', mode: 'exact-input', path: [seller, output], amountIn: 11n, amountOutMinimum: 7n },
    ] });
    expect(v2Input.commands).toBe('0x08');
    expect(decodeAbiParameters([
      { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'bool' },
    ], v2Input.inputs[0]!)).toEqual([
      '0x0000000000000000000000000000000000000001', 11n, 7n, [seller, output], true,
    ]);
    const v2Output = buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { protocol: 'v2', mode: 'exact-output', path: [seller, output], amountOut: 7n, amountInMaximum: 11n },
    ] });
    expect(v2Output.commands).toBe('0x09');
    expect(decodeAbiParameters([
      { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'address[]' }, { type: 'bool' },
    ], v2Output.inputs[0]!)).toEqual([
      '0x0000000000000000000000000000000000000001', 7n, 11n, [seller, output], true,
    ]);

    const v3Input = buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { protocol: 'v3', mode: 'exact-input', path: [seller, middle, output], fees: [500, 3000], amountIn: 11n, amountOutMinimum: 7n },
    ] });
    expect(v3Input.commands).toBe('0x00');
    const v3InputValues = decodeAbiParameters([
      { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bool' },
    ], v3Input.inputs[0]!);
    expect(v3InputValues[0]).toBe('0x0000000000000000000000000000000000000001');
    expect(v3InputValues[1]).toBe(11n);
    expect(v3InputValues[2]).toBe(7n);
    expect(v3InputValues[3]).toBe(encodePacked(
      ['address', 'uint24', 'address', 'uint24', 'address'], [seller, 500, middle, 3000, output],
    ));
    expect(v3InputValues[4]).toBe(true);

    const v3Output = buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { protocol: 'v3', mode: 'exact-output', path: [seller, middle, output], fees: [500, 3000], amountOut: 7n, amountInMaximum: 11n },
    ] });
    expect(v3Output.commands).toBe('0x01');
    const v3OutputValues = decodeAbiParameters([
      { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bool' },
    ], v3Output.inputs[0]!);
    expect(v3OutputValues[0]).toBe('0x0000000000000000000000000000000000000001');
    expect(v3OutputValues[1]).toBe(7n);
    expect(v3OutputValues[2]).toBe(11n);
    expect(v3OutputValues[3]).toBe(encodePacked(
      ['address', 'uint24', 'address', 'uint24', 'address'], [output, 3000, middle, 500, seller],
    ));
    expect(v3OutputValues[4]).toBe(true);

    const split = buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { protocol: 'v2', mode: 'exact-input', path: [seller, output], amountIn: 5n, amountOutMinimum: 3n },
      { protocol: 'v2', mode: 'exact-input', path: [seller, middle], amountIn: 6n, amountOutMinimum: 4n },
    ] });
    expect(split.commands).toBe('0x0808');
    expect(split.inputs).toHaveLength(2);
  });

  it('rejects invalid route combinations and paths', () => {
    const output = '0x3000000000000000000000000000000000000000' as Address;
    const v3 = { protocol: 'v3' as const, mode: 'exact-input' as const, path: [seller, output], fees: [500], amountIn: 1n, amountOutMinimum: 1n };
    expect(() => buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      v3, { ...v3, mode: 'exact-output', amountOut: 1n, amountInMaximum: 1n },
    ] })).toThrow('same execution mode');
    expect(() => buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { ...v3, path: [output, seller] },
    ] })).toThrow('start in the payment currency');
    expect(() => buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { ...v3, path: [seller] },
    ] })).toThrow('at least two currencies');
    expect(() => buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { ...v3, fees: [] },
    ] })).toThrow('one fee per V3 hop');
    expect(() => buildCartPayoutRoute({ paymentCurrency: seller, legs: [
      { ...v3, fees: [0x1000000] },
    ] })).toThrow('invalid uint24 fee');
    expect(() => buildCartPayoutRoute({ paymentCurrency: seller, legs: [], routerValue: 1n }))
      .toThrow('requires at least one');
    expect(() => buildCartPayoutRoute({ paymentCurrency: seller, legs: [v3], routerValue: -1n }))
      .toThrow('cannot be negative');
  });

  it('rejects invalid authorization selections and conflicting signatures', () => {
    const artifact = buildCartListingRootArtifact({ listings, chainId: 11_155_111, cart, nonce: 3n, deadline: 2_000_000_000n });
    expect(() => buildCartListingAuthorization([])).toThrow('At least one');
    expect(() => buildCartListingAuthorization([{ artifact, listingDigest: artifact.entries[0]!.listingDigest }]))
      .toThrow('not signed');
    const signed = { ...artifact, signature: '0x1234' as Hex };
    expect(() => buildCartListingAuthorization([{ artifact: signed, listingDigest: bytes32('f') }]))
      .toThrow('not present');
    const conflicting = { ...signed, signature: '0x5678' as Hex };
    expect(() => buildCartListingAuthorization([
      { artifact: signed, listingDigest: signed.entries[0]!.listingDigest },
      { artifact: conflicting, listingDigest: conflicting.entries[1]!.listingDigest },
    ])).toThrow('conflicting signatures');
  });

  it('covers Listing and order validation boundaries', () => {
    expect(validateCartListings([]).isValid).toBe(false);
    expect(validateCartListings([{ ...listings[0]!, fulfillmentKind: cartFulfillmentKinds.offChain,
      tokenContract: zeroAddress, tokenId: 0n }]).isValid).toBe(true);
    expect(validateCartListings([{ ...listings[0]!, availableQuantity: 2n }]).isValid).toBe(false);
    expect(validateCartListings([{ ...listings[0]!, fulfillmentKind: cartFulfillmentKinds.erc721MintTo, tokenId: 1n }]).isValid).toBe(false);
    expect(validateCartListings([{ ...listings[0]!, fulfillmentKind: cartFulfillmentKinds.offChain,
      tokenContract: cart, tokenId: 1n }]).isValid).toBe(false);

    const line = { sku: bytes32('a'), listingDigest: bytes32('1'), fulfillmentKind: cartFulfillmentKinds.erc721Transfer,
      quantity: 1n, settlementCurrency: zeroAddress, amount: 1n, paymentRecipient: seller };
    const build = (lines: CartOrderLine[] = [line], actions: CartFulfillmentAction[] = []) => buildCartOrder({
      orderId: bytes32('c'), paymentCurrency: zeroAddress, deadline: 2_000_000_000n, paymentAmount: 1n, lines, actions,
    });
    expect(() => build([])).toThrow('between 1 and 20');
    expect(() => build(Array.from({ length: 21 }, () => line))).toThrow('between 1 and 20');
    expect(() => build([line], Array.from({ length: 21 }, () => ({ lineIndex: 0n, quantity: 1n, recipient: seller }))))
      .toThrow('more than 20');
    expect(() => build([{ ...line, amount: 0n }])).toThrow('quantity and amount must be positive');
    expect(() => build([line], [{ lineIndex: 1n, quantity: 1n, recipient: seller }])).toThrow('is invalid');
  });

  it('rejects seller Listings that use the platform-only currency swap kind', () => {
    expect(() => buildCartListingRootArtifact({ listings: [{ ...listings[0]!, fulfillmentKind: cartFulfillmentKinds.currencySwap }],
      chainId: 11_155_111, cart, nonce: 0n, deadline: 1n })).toThrow('CURRENCY_SWAP');
  });

  it('maps ergonomic NFT variant filters to the Rare API wire query', () => {
    expect(buildCartVariantSearchQuery({
      query: 'RarePass',
      nft: { contract: seller.toLowerCase() as Address, tokenId: '7' },
      page: 2,
    }, 11_155_111)).toEqual({
      query: 'RarePass',
      chainId: '11155111',
      nftContract: seller,
      nftTokenId: '7',
      page: 2,
    });
    expect(() => buildCartVariantSearchQuery({ sku: bytes32('a'), nft: { contract: seller, tokenId: 1n } }, 1))
      .toThrow('either sku or nft');
    expect(() => buildCartVariantSearchQuery({ nft: { contract: seller, tokenId: -1n } }, 1))
      .toThrow('greater than or equal to 0');
  });
});
