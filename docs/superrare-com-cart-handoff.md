# Build SuperRare cart features through the SDK

This handoff is for implementing Cart commerce, eligibility, and print tooling in
`superrare-com`. Use the Rare SDK for client behavior and Rare API for backend
policy. Do not introduce new cart requests through `gql-api`, direct database
access, or direct Typesense access.

The claims and print interfaces require the corresponding backend migrations,
endpoints, and pipeline workers. Their presence in SDK source does not establish
that a particular Rare API deployment supports them.

## Current handoff status

Verification on October 19, 2026 used SDK revision `fff36d7` from
[SDK PR #24](https://github.com/superrare/rare-sdk/pull/24), based on the
[claims SDK PR #23](https://github.com/superrare/rare-sdk/pull/23).
[CLI PR #140](https://github.com/superrare/rare-cli/pull/140) pins that SDK revision
and sits above CLI claims PR #139. Later documentation-only commits do not change
the tested SDK behavior.

The owning monorepo changes are split across persistence
[#1975](https://github.com/superrare/superrare-monorepo/pull/1975), creator and
checkout APIs [#1976](https://github.com/superrare/superrare-monorepo/pull/1976),
and fulfillment [#1978](https://github.com/superrare/superrare-monorepo/pull/1978).
PR #1978 remains the backend deployment tip. The frontend migration is not part
of those changes.

The last SDK and CLI live runs targeted the
[Sepolia feature API](https://rare-api-367a-25x4ysoo5a-ue.a.run.app/). Account
authentication and uploads succeeded, but `POST /v1/prints/drops` returned HTTP
400 for the new `productionUploadKey` contract. Rebuild the backend before
rerunning the full print flow. No checkout payment or physical provider order
was submitted by those runs.

Default verification passed 532 SDK tests, 206 CLI tests, and 1,497 Rare API tests.
The SDK retained 14 existing skips, and the CLI retained three. Real PostgreSQL,
GCS, and Redis checks passed for ownership, private uploads, immutable snapshots,
and configuration conflicts. The additional signed-download test could not sign
with local user ADC. Development runtime signing permissions were verified;
no IAM changes were needed. Actual deployed signed-download verification remains
pending the rebuild.

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
- [`src/sdk/types/prints.ts`](../src/sdk/types/prints.ts)
- [`src/sdk/types/shipping-addresses.ts`](../src/sdk/types/shipping-addresses.ts)
- [`src/sdk/types/orders.ts`](../src/sdk/types/orders.ts)

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
Use `rare.cart.listing.search/get` for seller-authorized Listings. Check each
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

Checkout intents use typed `items`. Listing purchases use
`{ kind: 'listing', listingDigest, quantity, recipient }`. Token swaps use
`{ kind: 'swap', mode: 'exact-output', outputCurrency, outputAmount, recipient }`
or `{ kind: 'swap', mode: 'exact-input', outputCurrency, inputAmount, recipient }`.
Amounts are base-unit `bigint` values; input budgets use the payment currency's
decimals, while output amounts use the output token's decimals. Swap-only and
mixed Listing/swap orders share the same preparation and purchase methods.
Both modes produce fixed signed payment and output amounts. Execution movement
changes protocol spread rather than reducing the promised output. A connected
wallet supplies a missing swap recipient; wallet-independent callers must pass
the recipient explicitly. Physical-delivery checkout still supports print
Listing items only.

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
expiration. Omit `effectiveFrom` to include historical events when they are
reindexed, or supply an explicit event cutoff. Rule creation does not schedule
a historical backfill. For current-holder rules, explicit `source.tokenIds`
support initialization from existing holder evidence. Replayed transfer events
reconcile the current on-chain holder rather than the historical recipient.
Verify the backend's supported NFT event
adapters; do not assume ERC-1155 per-copy eligibility is supported.

### Publish a gated Listing without an open interval

Create the rule before publication and include its ID in the Listing intent:

```typescript
const rule = await rare.cart.purchaseEligibility.rules.create({
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

Call `rare.cart.purchaseEligibility.claims.list({ sku, take, skip })` to retrieve the signed-in
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

## Build the print creator flow

For an NFT-linked physical print, set `print.sourceUniversalTokenId` when creating
the standalone drop. This is attribution, not an instruction to transfer the NFT.
It is independent of eligibility and receipt minting. The API verifies the source
artwork belongs to the creator. Use `rare.prints.releases.list({ universalTokenId })`
to find its published prints.

For a collection, repeat the existing authoring operations for each approved file
and source token. Keep shared defaults and unfinished resource IDs in your UI's
draft state. Create eligibility rules with collection scope and explicit token-to-SKU
targets. There is no bulk setup helper or campaign requirement.

Use `rare.cart.catalog.products.create`, `getMine`, and `archive`, and
`rare.cart.catalog.variants.add` for creator-owned catalog resources such as a
shared receipt SKU. Pass `{ idempotencyKey }` as the second argument to Product
creation. Variant creation is not automatically retried; after an ambiguous
response, inspect `getMine` before issuing another mutation.

Use the authenticated `rare.prints` methods rather than component-local Rare API
requests. Keep platform fee rules, provider credentials, and administrative
configuration out of creator controls.

1. Load paper and size choices with `rare.prints.specifications.list()`.
2. Upload the master with
   `accountClient.uploads.upload(file, filename, { access: 'private' })`.
3. Upload display photos through the same uploader with `access: 'public'`.
4. Create the standalone draft with `rare.prints.drops.create`. Supply
   `print.productionUploadKey` from the private result and `print.images` from
   public upload URLs. Do not supply `productionImageUri` for a new standalone
   print.
5. Call `rare.prints.options.configure(dropId, { displayPriceUsdCents })` for
   pricing and the production estimate. Current print Listings settle in USDC;
   this does not restrict the buyer's supported payment currencies.
6. Prepare the frozen terms with `rare.prints.listings.prepare`, then call
   `rare.prints.listings.signAndPublish(preparation, { autoApprove: false })`.
   Set `eligibilityRuleId` here to publish a claim-gated Listing atomically.
   The rule must belong to the creator and target this print option's SKU.
   Set `maxQuantityPerCheckout` to the maximum copies in one purchase.
   It defaults to `"1"` and accepts positive integer strings up to `"1000"`.
   ERC-721 transfer fulfillment requires a limit of `"1"`.
   `availableQuantity` remains the total edition supply, not the checkout limit.
   One UI action can await both signing and publication, then redirect to the
   public print page.

The standard upload limit is 250 MiB. Print attachment accepts JPEG and PNG
uploads. New drafts and photo edits accept at most four supplemental photos;
historical drops with eight photos remain readable. Display only public
supplemental media through Imgix transformations. Do not put a private master
reference or a signed provider download URL into a public image component.

Rare API verifies durable upload ownership and freezes the production object
generation. After payment is indexed and fulfillment is leased, it generates a
six-day download URL for Prodigi. Retries retain the provider idempotency key
and obtain a fresh URL. Neither the frontend nor the SDK creates these URLs.

Use `rare.prints.drops.listMine/getMine` for creator management and
`rare.prints.drops.update` for names, descriptions, tags, and display photos.
Production file and specification edits are allowed only before pricing is
configured. Later physical changes require a replacement drop and SKU. Price
changes require freshly prepared and signed Listing terms. Existing paid Orders
keep their original fulfillment snapshots.

### Include an ERC-1155 receipt with a print

Configure the receipt through the regular print option API. No campaign is
required. `receipt.sku` references an existing creator-owned ERC-1155 variant
on the print's settlement chain. Different print variants can share that receipt
variant while keeping their own print SKUs and production files.

```typescript
const option = await rare.prints.options.configure(dropId, {
	displayPriceUsdCents: '2500',
	receipt: { sku: receiptSku },
});

const preparation = await rare.prints.listings.prepare({
	optionId: option.id,
	seller: sellerAddress,
	listingSalt,
	deadline,
	availableQuantity: '100',
	maxQuantityPerCheckout: '2',
});

await rare.prints.listings.signAndPublish(preparation);
```

The API derives ERC-1155 mint fulfillment. Do not pass `fulfillmentKind` for
this flow. Existing explicit fulfillment kinds remain supported when they match
the configured option. Eligibility is independent: include `eligibilityRuleId`
in listing preparation when the print requires a claim.

The selected seller must be the receipt token's creator, and the supported Rare
ERC-1155 contract must authorize Cart as a minter before listing preparation.
Use `rare.collection.erc1155.setMinterApproval` to grant that permission. A defined
token can be used before any copies have been minted. NFT indexing is not required.

Each purchased print mints one receipt token to the Cart item's recipient. A
quantity of two produces two physical copies and two receipt units. The token
is included in the print price, not purchased through a separate free listing.

Omit `receipt` during a price update to preserve its configuration. Set
`receipt: null` to remove it for future listing preparations. Prepare and sign
fresh listing terms after a change. Previously prepared listings and paid orders
retain their frozen receipt and physical fulfillment configuration.

Public print options expose their frozen `receipt` configuration, or `null`
when absent. The SDK verifies that a receipt snapshot matches the signed listing's
chain, mint kind, token contract, and token ID before requesting a signature.

Use `quantity` on the generic Cart draft item for multiple copies of one print.
Read each public print option's `maxQuantityPerCheckout` and `eligibilityRuleId`
to present quantity controls and eligibility. Rare API enforces the limit again
before signing. Changing quantity requires a new checkout idempotency key and
a fresh quote. Claims are reserved per copy, not once per Order. Delivery carts
still support one Listing at a time.

NFT transfer fulfillments can require collection approval. Handle
`NftApprovalRequiredError` with explicit consent before retrying
`signAndPublish` with `autoApprove: true`. Preserve any returned `approvalTxHash`.
An `ApprovalSideEffectError` means the approval may remain active even though
the later signature or publication failed.

Use `rare.prints.drops.get/activity` for public detail and activity reads, and
`rare.prints.releases.list({ universalTokenId })` for linked-artwork discovery.
The older NFT-linked print-release implementation remains separate.

## Reuse account shipping and generic checkout

Use the same `accountClient` that exposes `profile.get/update`:

- `shippingAddresses.list()` retrieves the private address book.
- `shippingAddresses.save({ id, label, details, makeDefault })` creates or updates
  a stable address UUID and can select the default.
- `shippingAddresses.delete(id)` removes an entry.

Saving requires explicit user consent. Passing delivery details to checkout does
not save them. Load the default saved address into an editable summary and offer
a change action. Use `accountClient.profile.get()` to prefill contact email when
available; never expose that private email through public profile data.

Prints use `rare.cart.checkout`, not a separate print payment engine. Add either
`delivery: { savedAddressId }` or `delivery: { recipientDetails }` to the usual
intent. Delivery supports one print with its configured copy limit, or up to five
distinct prints with one copy each. The Listings must use the same Cart and a
compatible fulfillment settlement currency and recipient. Mixed physical and
non-physical items, explicit swap items, and multiple destination addresses are
not supported in this delivery adapter.

Each print has a separate fulfillment record and provider order. Shipping quotes
are summed; they do not promise consolidated shipping. Pipelines owns submission
and retries. Do not resubmit a physical order from the SDK or frontend.

Read `accountClient.orders.get(orderId)` for payment status and `fulfillments`.
Each fulfillment includes `orderLineIndex`, status, and nullable `providerOrderId`.
`COMPLETED` means provider acceptance, not shipment or delivery. Poll this read
when useful; it does not initiate work.

After an interrupted signed checkout, call
`rare.cart.api.checkout.recover(idempotencyKey)`. It returns the original payload
only to the account and wallet that prepared it. `UNKNOWN` is not permission to
assume payment failed. Never silently replace an unresolved signed Order.

Call `rare.cart.checkout.prepare(intent)` to get the unsigned preview. Display
its `breakdown.displayPrice`, `shipping`, `networkFee`, and `total` when present.
The current print breakdown is computed from settlement lines and the configured
print price. Do not treat it as a converted breakdown in the buyer's payment
currency. Current print Listings settle in USDC; format the breakdown separately
from the signed Order's payment amount. Do not assume `breakdown.total` equals
`paymentAmount` for ETH or RARE payment. An explicitly currency-tagged or
converted breakdown needs backend support before displaying those components
in the selected payment currency.

Retain the complete preparation, including its `idempotencyKey` and delivery intent, for
`rare.cart.checkout.purchase({ preparation, autoApprove })` and recovery.

The lower-level `rare.cart.api.checkout.prepare` accepts the full delivery draft
and its original idempotency key. A delivery preview reference alone cannot
finalize checkout because previews do not cache postal data. Do not generate a
new idempotency key merely because a request timed out or the buyer retries.
If the finalized total increases, the SDK rejects execution and requires a fresh
review rather than silently raising the spending cap.

For cards, call `rare.cart.checkout.coinflow` with the delivery draft and an
idempotency key. It returns the provider session and prepared Cart Order for the
card UI. Card checkout requires USDC as its payment currency. Keep card setup
and crypto execution under one checkout UI, and do not expose provider session
credentials in logs.

## Recover Orders and display fulfillment progress

Use `accountClient.orders.list({ after, take })` for `{ data, nextCursor }` pages,
and `accountClient.orders.get(cartOrderId)` for one account-owned fulfillment
Order. The identifier is the Cart Order's bytes32 ID, not an internal fulfillment
UUID or provider Order ID. These methods do not include legacy NFT purchase
history and do not return private postal snapshots.

Keep payment state separate from each line's fulfillment state. Fulfillment
`COMPLETED` means the provider accepted the Order; it does not mean shipped or
delivered. Shipment tracking is not implemented by these methods.

Persist enough account-scoped recovery state to reconnect a confirmed payment
to its Cart Order. Poll stored backend status with the application's query
library. Backend workers own submission, retries, and reconciliation, so closing
the page must not be the mechanism that loses or releases an Order. Do not claim
provider confirmation from the transaction receipt alone, or ask the buyer to
pay again while fulfillment is pending.

## Extend missing SDK capabilities instead of bypassing them

The account shipping, print authoring, delivery checkout, card session, and
fulfillment Order methods above now exist. The high-level Cart catalog interface
remains read-oriented; do not assume it exposes Product mutations or saved carts.
Mixed delivery carts and shipment tracking remain unsupported.

For each missing capability, inspect the generated Rare API contract first.
If the endpoint exists, add a typed SDK method using the existing transport and
error handling. If it does not exist, add it in the owning backend layer before
wiring the frontend. Preserve the user's task scope when proposing those changes.

`createApiClient` from `@rareprotocol/rare-sdk/data-access` is the public typed
lower-level transport. It can use `accountClient.authenticatedFetch`. Prefer a
named reusable SDK method when the operation is needed by several consumers.
Do not import private SDK modules or replace a missing method with another
component-local request client.

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

For the new print methods, run `npm run test:integration:prints` in this repo and
`npm run test:prints:e2e` in rare-cli against the same compatible feature API.
Set `RARE_ACCOUNT_TEST_API_URL` explicitly for the SDK and `RARE_API_BASE_URL`
explicitly for the CLI. Use registered dedicated test accounts and Sepolia RPC
configuration. Do not rely on an environment file's default deployment.

The SDK print suite covers address storage, private/public uploads, creator edits,
configuration, atomic gated publication, quantity limits, multi-copy delivery
quotes, idempotent signed Order
preparation, and account Order reads. The CLI suite covers its corresponding
commands through delivery preview and signed Order preparation. Neither suite
pays or submits a physical Order. A separate funded sandbox fulfillment run is required to prove provider
submission and the private signed download end to end.

At handoff, report the SDK revision, API deployment, chain, test commands and
results, and any endpoint still missing from the SDK or backend.
