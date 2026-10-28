# Purchase eligibility

`rare.cart.purchaseEligibility` uses the unified client's authenticated session. Rules belong to the authenticated creator. Claims belong to the authenticated buyer. Neither operation accepts an account ID override.

The namespace exposes these methods:

- `rules.create({ definition, effectiveFrom? })`
- `rules.list({ page?, perPage? })`
- `rules.disable(ruleId)`
- `claims.list({ page?, perPage?, sku?, ruleId? })`
- `listingRequirements.set({ chainId, cartAddress, listingDigest, ruleId })`
- `listingRequirements.clear({ chainId, cartAddress, listingDigest })`

Rule definitions contain a `kind`, a source collection, and SKU targets:

```typescript
const rule = await rare.cart.purchaseEligibility.rules.create({
	definition: {
		kind: 'PRIMARY_SALE',
		source: { chainId: '11155111', tokenContract: collectionAddress },
		targets: [{ sku: printSku }],
	},
});
await rare.cart.purchaseEligibility.listingRequirements.set({
	chainId: String(rare.chainId),
	cartAddress,
	listingDigest,
	ruleId: rule.id,
});
```

All rule kinds support ERC-721 and ERC-1155 sources. The API detects the token standard. `PRIMARY_SALE` grants one right per copy purchased in a qualifying primary sale. `EVERY_SALE` grants one right per copy purchased in each qualifying sale. These purchase rights remain with the buyer after a transfer.

`CURRENT_HOLDER` moves unused rights first when tokens transfer. For five copies with two consumed rights, transferring two copies moves two unused rights. Transferring those copies back does not recreate consumed rights. Optional `source.tokenIds` restricts the source tokens. An optional target `tokenId` maps a source token to a particular SKU. `claimExpiresAt` limits claim validity.

Issuance supports at most 100 rights per source event. Initial holder snapshots also support at most 100 rights. An operation that exceeds the limit fails atomically rather than issuing partial rights. A wallet can hold rights from multiple events, so 100 is not a lifetime wallet limit.

Listings are open unless they explicitly require a rule. Checkout reserves and consumes claims on the server. Clients cannot release a signed Order reservation or mark a claim consumed.

For a new gated Listing, pass `eligibilityRuleId` in `rare.cart.listing.prepare` and publish that preparation. Publication attaches the rule in the same database transaction as the Listing. Publishing an open Listing and attaching a requirement afterward cannot revoke Orders signed during that gap.

For `CURRENT_HOLDER`, supply explicit `source.tokenIds` to initialize claims for existing holders at a confirmed block. Collection-wide rules without token IDs apply to future events only. Historical purchase backfills are not included.

The deployed integration suites are `test/e2e-live/sdk/eligibility.test.ts` and `test/e2e-live/sdk/eligibility-standards.test.ts`. They create their own collections and SKUs. Run them only against a test deployment with the eligibility migrations and endpoints installed:

```sh
npm run test:integration:eligibility
```

The suite requires the same dedicated account, API, and Sepolia RPC configuration as the Cart integration tests. A missing deployment or credentials fails the selected suite rather than silently skipping it.

The lifecycle case also requires a distinct registered buyer in `E2E_BUYER_PRIVATE_KEYS`. It uses the built SDK, creates three NFTs and creator-owned SKUs, and purchases a source NFT through Cart. It waits for an `AVAILABLE` claim, checks `RESERVED` status and Order reuse across retry keys, then executes a gated reward purchase and waits for `CONSUMED`. A second reward remains in stock, and checkout must reject it because no unspent claim remains. The rule is scoped to the source token so reward purchases cannot issue replacement claims.

These are live Sepolia writes. Each purchase has a test budget of 0.001 ETH before network gas. The creator rule is disabled and account sessions are revoked during cleanup. Missing eligibility endpoints fail before collection deployment.

The standards suite covers all three rules for both standards. It buys five edition copies, consumes two rights through an on-chain reward Listing, and transfers unused rights between accounts. It also checks that a later sale grants new rights only for `EVERY_SALE`.
