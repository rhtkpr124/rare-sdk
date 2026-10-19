# Eligibility client

`rare.eligibility` uses the `accountClient` session supplied to `createRareClient`. Rules belong to the authenticated creator. Claims belong to the authenticated buyer. Neither operation accepts an account ID override.

The namespace exposes these methods:

- `createRule({ definition, effectiveFrom? })`
- `listRules({ take?, skip? })`
- `disableRule(ruleId)`
- `listClaims({ take?, skip?, sku?, ruleId? })`
- `setListingRequirement({ chainId, cartAddress, listingDigest, ruleId })`
- `clearListingRequirement({ chainId, cartAddress, listingDigest })`

Rule definitions contain a `kind`, a source collection, and SKU targets:

```typescript
const rule = await rare.eligibility.createRule({
	definition: {
		kind: 'PRIMARY_SALE',
		source: { chainId: '11155111', tokenContract: collectionAddress },
		targets: [{ sku: printSku }],
	},
});
await rare.eligibility.setListingRequirement({
	chainId: String(rare.chainId),
	cartAddress,
	listingDigest,
	ruleId: rule.id,
});
```

`PRIMARY_SALE` grants eligibility for qualifying primary purchases. `EVERY_SALE` grants eligibility for each qualifying sale. `CURRENT_HOLDER` follows the unspent NFT entitlement through ownership changes. Optional `source.tokenIds` restricts the source tokens. An optional target `tokenId` maps a source token to a particular SKU. `claimExpiresAt` limits claim validity.

Listings are open unless they explicitly require a rule. Checkout reserves and consumes claims on the server. Clients cannot release a signed Order reservation or mark a claim consumed.

For a new gated Listing, pass `eligibilityRuleId` in `rare.cart.listing.prepare` and publish that preparation. Publication attaches the rule in the same database transaction as the Listing. Publishing an open Listing and attaching a requirement afterward cannot revoke Orders signed during that gap.

For `CURRENT_HOLDER`, supply explicit `source.tokenIds` to initialize claims for existing holders at a confirmed block. Collection-wide rules without token IDs apply to future events only. Historical purchase backfills are not included.

The deployed integration suite is `test/e2e-live/sdk/eligibility.test.ts`. It creates its own collection and SKUs through the existing creator fixture. Run it only against a test deployment with the eligibility migrations and endpoints installed:

```sh
npm run test:integration:eligibility
```

The suite requires the same dedicated account, API, and Sepolia RPC configuration as the Cart integration tests. A missing deployment or credentials fails the selected suite rather than silently skipping it.

The lifecycle case also requires a distinct registered buyer in `E2E_BUYER_PRIVATE_KEYS`. It uses the built SDK, creates three NFTs and creator-owned SKUs, and purchases a source NFT through Cart. It waits for an `AVAILABLE` claim, checks `RESERVED` status and Order reuse across retry keys, then executes a gated reward purchase and waits for `CONSUMED`. A second reward remains in stock, and checkout must reject it because no unspent claim remains. The rule is scoped to the source token so reward purchases cannot issue replacement claims.

These are live Sepolia writes. Each purchase has a test budget of 0.001 ETH before network gas. The creator rule is disabled and account sessions are revoked during cleanup. Missing eligibility endpoints fail before collection deployment.
