# Build SuperRare cart features through the SDK

This handoff is for implementing cart commerce and eligibility in
`superrare-com`. Use the Rare SDK for client behavior and Rare API for backend
policy. Do not introduce new cart requests through `gql-api`, direct database
access, or direct Typesense access.

The claims interface in this PR requires the corresponding backend migrations,
endpoints, and pipeline workers. Its presence in SDK source does not establish
that a particular Rare API deployment supports it.

## Check the application and deployment versions

Before changing the frontend, inspect its dependency pins and installed exports.
The existing application has used published `@rareprotocol/rare-sdk` alongside
a separately git-pinned `@rareprotocol/cart-sdk` alias. Do not assume either
installed version includes the authenticated Cart and eligibility interfaces.

Use an SDK revision containing this PR and its Cart dependencies. Record the
tested SDK revision, Rare API deployment, chain, and configured Cart address.
Do not upgrade unrelated SDK consumers or remove the compatibility alias as
an incidental change.

Check the public interfaces in these files rather than importing SDK internals:

- [`src/sdk/types/client.ts`](../src/sdk/types/client.ts)
- [`src/sdk/types/cart.ts`](../src/sdk/types/cart.ts)
- [`src/sdk/types/cart-api.ts`](../src/sdk/types/cart-api.ts)
- [`src/sdk/types/eligibility.ts`](../src/sdk/types/eligibility.ts)

## Share account authentication with the chain client

Use the application's existing viem public and wallet clients. Supply the same
Rare API base URL to its account and chain clients:

```typescript
const accountClient = createRareAccountClient({ apiBaseUrl, sessionStore });
const rare = createRareClient({
	publicClient,
	walletClient,
	apiBaseUrl,
	accountClient,
});
```

Both constructors are public SDK exports. Reuse the existing session store
instead of prompting for a second login. Wallet connection alone does not
authenticate an account. Account identity and the wallet used for transaction
signatures are separate inputs.

`accountClient.authenticatedFetch` supplies protected API requests with account
credentials and handles session renewal. It is restricted to its configured
API authority and does not automatically replay mutations. See
[Account integration](auth/integration.md) for the authentication contract.

For an existing first-party cookie session, retain a thin server-side adapter
where necessary. The SDK also accepts `apiFetch` for existing cookie-based
integrations. Do not expose HttpOnly cookies or service credentials to browser
code, and do not silently substitute one authentication mode for another.

Keep SDK instances and private query caches scoped to the account, chain, and
environment. Do not share account-bound clients between server requests.
Clear private caches when an account or wallet changes. A tRPC adapter may
forward requests, but it must not become another eligibility or fee engine.

## Build discovery, seller, and buyer flows

Use `rare.cart.catalog.products.search/get` and
`rare.cart.catalog.variants.search` for public Product and SKU discovery.
Use `rare.cart.listing.search/get` for seller-authorized offers. Check each
response's pagination rather than treating the first page as complete inventory.

Keep Product presentation, SKU identity, and Listing terms separate. NFT
attachment is optional. Do not make creator variant creation depend on an
indexed NFT record.

For sellers, call `rare.cart.listing.prepare` to resolve terms and build a root
artifact, then `rare.cart.listing.publish` to sign and publish it. Use
`rare.cart.approval` for collection approval status and changes. The SDK exposes
Listing cancellation, root cancellation, and nonce invalidation under
`rare.cart.listing`; backend invalidation is a separate policy operation under
`rare.cart.api.listing.invalidate`.

For buyers:

1. Call `rare.cart.checkout.prepare(intent)` for an unsigned preview.
2. Display its payment amount, settlement details, fees, and expiration.
3. After approval, call `rare.cart.checkout.purchase({ preparation, autoApprove })`.
4. Use the returned receipt and Order ID to reconcile confirmation and subsequent
   fulfillment status.

Despite its name, `rare.cart.checkout.prepare` produces an unsigned preview.
The lower-level `rare.cart.api.checkout.prepare(preparationReference)` obtains
the executable signed Order. The high-level `purchase` method performs that
finalization before execution. `rare.cart.checkout.execute` executes an existing
signed payload; it does not issue another authorization.

Reuse SDK approval, simulation, execution, and receipt verification. Do not
rebuild Cart calldata, Merkle proofs, or transaction verification in React.
`autoApprove` defaults to false. Choose approval behavior deliberately.

## Keep checkout economics on the backend

Use Rare API results for production costs, shipping, commissions, checkout fees,
and payment routing. Preserve currency addresses and decimals. Use `bigint` for
SDK amounts and the defined wire serializers when crossing HTTP boundaries.
Never add raw amounts denominated in different currencies.

Listing settlement currency and buyer payment currency are independent.
Display the signed Order's `paymentAmount` as the amount authorized for Cart
execution. Do not substitute a wallet balance or recompute settlement locally.
If final authorization exceeds the spending cap the buyer reviewed, require
renewed approval before execution.

Zero-price Listings are valid. Fixed or per-unit charges can still make the
checkout total nonzero. Do not add a positive-price validation that prevents
free fulfillment.

Keep saved shipping details and fulfillment estimates separate from the payment
route. Changing payment currency may require another payment quote, but it is
not itself a reason to re-request an unchanged production or shipping quote.

## Add creator eligibility controls

Use `rare.eligibility` for the authenticated creator's rules and the buyer's
claims. No method accepts an account ID override. The supported rule types are:

- `PRIMARY_SALE`: a qualifying primary purchase grants a right that the purchaser
  retains after transferring the NFT.
- `EVERY_SALE`: each qualifying purchase grants a new right. Replaying the same
  source event does not grant another one.
- `CURRENT_HOLDER`: the unspent NFT-backed right follows ownership. Consuming
  the right prevents later transfers from regenerating it.

The rule's source identifies a chain and collection, optionally restricted to
token IDs. Targets identify permitted SKUs. A target's optional `tokenId` maps a
source NFT to its corresponding SKU. Several targets can share one claim, so
the buyer can choose one SKU without receiving a separate right for each choice.

Create a rule with `createRule`, retrieve the creator's rules with `listRules`,
and disable a rule with `disableRule`. Disabling stops new grants and new
checkout authorizations; it cannot revoke an already-signed Order. Rule
definitions are not editable through this interface.

Use `effectiveFrom` and `definition.claimExpiresAt` for activation and claim
expiration. Historical purchase backfills are not part of this interface. For
current-holder rules, explicit `source.tokenIds` support initialization from
existing holder evidence at a confirmed block. A collection-wide rule without
token IDs applies to future events. Verify the backend's supported NFT event
adapters; do not assume ERC-1155 per-copy eligibility is supported.

### Publish a gated Listing without an open interval

Create the rule before publication and include its ID in the Listing intent:

```typescript
const rule = await rare.eligibility.createRule({
	definition: {
		kind: 'CURRENT_HOLDER',
		source: {
			chainId: String(rare.chainId),
			tokenContract: sourceCollectionAddress,
			tokenIds: ['42'],
		},
		targets: [{ sku: printSku, tokenId: '42' }],
	},
});

const preparation = await rare.cart.listing.prepare({
	seller: sellerAddress,
	listings: [{ sku: printSku, unitPrice, settlementCurrency, quantity: 1n }],
	deadline,
	eligibilityRuleId: rule.id,
});

await rare.cart.listing.publish({ preparation, autoApprove: false });
```

The amounts, addresses, and deadline above come from the creator's validated
configuration. Publication attaches the requirement atomically with the
Listing. Do not publish an open Listing and attach its gate afterward: an
Order signed during that interval would remain executable.

For an existing Listing, use `setListingRequirement` or
`clearListingRequirement`, passing its chain, Cart address, and Listing digest.
These operations affect future authorizations, not existing signed Orders.
Listings without a requirement remain open. See
[Eligibility client](eligibility.md) for the complete method list.

## Display buyer claims without enforcing them in the browser

Call `rare.eligibility.listClaims({ sku, take, skip })` to retrieve the signed-in
account's rights. Its statuses are `AVAILABLE`, `RESERVED`, `CONSUMED`, and
`REVOKED`. There is no separate `EXPIRED` status in the current SDK model.
Use `expiresAt` and the backend response rather than inventing another state.

An available SKU-scoped claim is useful display information, not permission to
execute any Listing for that SKU. The Listing must accept the relevant rule,
and the backend checks rule state, identity, quantity, expiration, and any
holder evidence before signing. Do not claim eligibility is guaranteed merely
because a matching claim appears in the cache.

Do not add browser mutations to grant, reserve, release, or consume claims.
The normal checkout flow owns these transitions:

- Unsigned previews do not reserve claims.
- Signed Order preparation reserves each required purchase unit with the durable
  Order. The reservation is account-bound and correlated by its `orderId`.
- Successful indexed Cart execution consumes the reserved rights, independently
  of whether the browser receives the transaction result.
- Wallet rejection, a reverted transaction, or an expired routing quote does
  not authorize the browser to release a signed Order reservation.
- After the signed Order expires, backend reconciliation releases the rights
  only after verifying non-execution on the chain.

Keep the active preparation reference, signed payload when available, and any
transaction hash for recovery. A signed Order can succeed once and can remain
retryable after failure. Do not respond to an ambiguous wallet or network error
by silently starting another purchase. A changed payment currency or recipient
can conflict with an existing reservation until its authorization safely expires.

For holder rules, a transfer during an active reservation does not give the new
holder a second spendable right. Show a pending or unavailable state until the
backend resolves the existing Order. Claim expiration and routing quote
expiration are different deadlines.

## Extend missing SDK capabilities instead of bypassing them

The high-level Cart catalog interface is read-oriented. Do not assume it also
exposes Product mutations, saved carts, shipping addresses, print configuration,
card payment sessions, or provider fulfillment status.

For each missing capability, inspect the generated Rare API contract first.
If the endpoint exists, add a typed SDK method using the existing transport and
error handling. If it does not exist, add it in the owning backend layer before
wiring the frontend. Preserve the user's task scope when proposing those changes.

`createApiClient` from `@rareprotocol/rare-sdk/data-access` is the public typed
lower-level transport. It can use `accountClient.authenticatedFetch`. Prefer a
named reusable SDK method when the operation is needed by several consumers.
Do not import private SDK modules or replace a missing method with another
component-local request client.

Payment confirmation is not fulfillment confirmation. Poll the backend's
fulfillment state for a provider order ID and confirmed processing. Do not
infer that a print order was submitted from `PurchaseExecuted` alone, and do
not ask the buyer to pay again because fulfillment is delayed.

## Verify the complete client flow

Test public discovery, authenticated mutations, account switching, gated Listing
publication, and the absence of private-data cache leaks. Exercise these checkout
cases against a compatible backend:

- An eligible buyer can purchase; an ineligible buyer is rejected before signing.
- A consumed claim cannot authorize another purchase, including after source-log
  replay or NFT transfer.
- Retrying the same checkout cannot create a second executable claim Order.
- Changed checkout terms cannot bypass an active reservation.
- Wallet rejection, transaction failure, expired previews, and uncertain results
  produce recoverable UI states rather than a second payment.
- Free Listings, fixed fees, multiple settlement currencies, and payment-currency
  changes preserve backend-calculated amounts.
- A successful purchase and delayed provider fulfillment remain distinct states.

Run application typechecking, lint, and browser flow checks. Run the SDK's
relevant checks after changing its interface. The dedicated live eligibility
suite is `npm run test:integration:eligibility`; it needs a test deployment with
the new backend and the dedicated test account and RPC configuration. Do not run
funded write tests against production or report a source-only check as live
integration coverage.

At handoff, report the SDK revision, API deployment, chain, test commands and
results, and any endpoint still missing from the SDK or backend.
