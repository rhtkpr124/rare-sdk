# Build SuperRare cart features through the SDK

This handoff is for implementing Cart commerce, eligibility, and print tooling in
`superrare-com`. Use the Rare SDK for client behavior and Rare API for backend
policy. Do not introduce new cart requests through `gql-api`, direct database
access, or direct Typesense access.

## Author and publish one or many prints

Scalar operations take the same object as a batch item's `input`: `options.configure({ dropId, input })`, `listings.publish({ preparation, signedArtifact })`, and `listings.submitSigned({ preparationId, artifact })`. Omit `signedArtifact` for a fresh signature; retain it after a failed publication to retry without another wallet request.

Print authoring supports the same methods for one item or a batch. Pass an array
of `{ key, input }` items to `rare.prints.drops.create`, `options.configure`,
`listings.prepare`, `listings.publish`, or `listings.submitSigned`. Configuration
inputs contain `{ dropId, input }`; signed-submission inputs contain
`{ preparationId, artifact }`; publication inputs contain `{ preparation, signedArtifact? }`.

Batch results retain input order and include an `inputDigest` binding the saved
result to its inputs. Results use `{ key, inputDigest, status: 'fulfilled', value }` or
`{ key, inputDigest, status: 'rejected', error, signedArtifact? }`. Preserve these results and
pass `{ previousResults }` when retrying the same batch. The SDK skips successful
items and processes the rest sequentially. Do not change the input associated
with a saved key. Generate and retain each draft's `idempotencyKey` and each
Listing's `listingSalt` before making requests. The SDK never replaces them.

If publication fails after signing, retain the rejected result's `signedArtifact`
and supply it with that item's `preparation` on retry. This retries publication
without another signature. Single-item callers can catch `PrintPublicationError`
and retry `listings.publish({ preparation, signedArtifact: error.signedArtifact })`.

Use `rare.cart.listing.search({ eligibility: 'eligible' })` for an authenticated
catalog of open Listings and gated Listings the account can purchase. The server
revalidates eligibility during checkout. No separate print campaign API is needed.

The claims and print interfaces require the corresponding backend migrations,
endpoints, and pipeline workers. Their presence in SDK source does not establish
that a particular Rare API deployment supports them.

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

## Configure one authenticated client

Supply the application's existing viem clients and one session store:

```typescript
const rare = createRareClient({ publicClient, walletClient, apiBaseUrl, sessionStore });
```

Account and protected Cart methods share this client's login and renewal lock.
Wallet connection alone does not authenticate an account. Account identity and
transaction-signing wallets remain separate. For application-owned sessions,
configure `transport` on the same constructor instead of `sessionStore`.
Authenticated fetch wiring stays internal; consumers call typed SDK methods.
See [Account integration](auth/integration.md) for authentication behavior.

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
`rare.cart.listing.invalidate`.

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
the recipient explicitly. Physical delivery applies to print items in a mixed checkout. NFT and swap items keep their own fulfillment behavior.

1. Call `rare.cart.checkout.prepare(intent)` for an unsigned preview.
2. Display its payment amount, settlement details, fees, and expiration.
3. After approval, call `rare.cart.checkout.purchase({ preparation, autoApprove })`.
4. Use the returned receipt and Order ID to reconcile confirmation and subsequent
   fulfillment status.

Use `rare.cart.checkout.authorize(preparation)` when you need a signed Order
without submitting payment. It preserves the reviewed quote and reserves any
required claims. The `purchase` method performs authorization before execution.
Use `rare.cart.checkout.execute` to execute an existing signed payload without
issuing another authorization.

For a saved unsigned attempt, `authorize` also accepts its original delivery
draft with `idempotencyKey`, or `{ preparationReference }` for a cached quote.
These recovery inputs return the signed terms for review without making a
payment. Preserve the original identity and validate those terms against the
saved buyer approval before calling `execute`.

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

Use `rare.cart.purchaseEligibility` for the authenticated creator's rules and the buyer's
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

Create a rule with `rules.create`, retrieve the creator's rules with `rules.list`,
and disable a rule with `rules.disable`. Disabling stops new grants and new
checkout authorizations; it cannot revoke an already-signed Order. Rule
definitions are not editable through this interface.

Use `effectiveFrom` and `definition.claimExpiresAt` for activation and claim
expiration. Omit `effectiveFrom` to include historical events when they are
reindexed, or supply an explicit event cutoff. Rule creation does not schedule
a historical backfill. For current-holder rules, explicit `source.tokenIds`
support initialization from existing holder evidence. Replayed transfer events
reconcile the current on-chain holder rather than the historical recipient.
All three rules support ERC-721 and ERC-1155 sources, with one right per
qualifying copy. Purchase rights stay with the purchaser. Holder transfers move
unused rights first, without recreating consumed rights. Issuance and initial
holder snapshots each support at most 100 rights per operation. Larger operations
fail atomically, not partially. This is not a lifetime wallet limit.

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

For an existing Listing, use `listingRequirements.set` or
`listingRequirements.clear`, passing its chain, Cart address, and Listing digest.
These operations affect future authorizations, not existing signed Orders.
Listings without a requirement remain open. See
[Eligibility client](eligibility.md) for the complete method list.

## Display buyer claims without enforcing them in the browser

Call `rare.cart.purchaseEligibility.claims.list({ sku, page, perPage })` to retrieve the signed-in
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
It is independent of eligibility and NFT purchases. The API verifies the source
artwork belongs to the creator. Use `rare.prints.releases.list({ universalTokenId })`
to find its published prints.

For a collection, repeat the existing authoring operations for each approved file
and source token. Keep shared defaults and unfinished resource IDs in your UI's
draft state. Create eligibility rules with collection scope and explicit token-to-SKU
targets. There is no bulk setup helper or campaign requirement.

Use `rare.cart.catalog.products.create`, `getMine`, and `archive`, and
`rare.cart.catalog.variants.add` for creator-owned catalog resources such as a
separately purchasable NFT variants. Pass `{ idempotencyKey }` as the second argument to Product
creation. Variant creation is not automatically retried; after an ambiguous
response, inspect `getMine` before issuing another mutation.

Use the authenticated `rare.prints` methods rather than component-local Rare API
requests. Keep platform fee rules, provider credentials, and administrative
configuration out of creator controls.

1. Load paper and size choices with `rare.prints.products.list()`. Read one product with `rare.prints.products.get(id, { signal })`. Both reads are public. Products include provider recommended print-area dimensions, automatic orientation, and `fileRequirements` for accepted content types and maximum bytes. Send the selected product ID in the existing `specificationId` draft field.
2. Upload the master with
   `rare.upload(file, filename, { access: 'private' })`.
3. Upload display photos through the same uploader with `access: 'public'`.
4. Create the draft with `rare.prints.drops.create`. Supply an explicit `chainId`
   and the required `print` details. Use `print.productionUploadKey` from the
   private result, `print.images` from public upload URLs, and a supported
   `print.specificationId`. Every print requires its own production file.
5. Call `rare.prints.options.configure(dropId, { displayPriceUsdCents })` for
   the artwork price. This does not call Prodigi. Current print Listings settle in USDC;
   This does not restrict the buyer's supported payment currencies.
6. Prepare the frozen terms with `rare.prints.listings.prepare`, then call
   `rare.prints.listings.publish(preparation)`.
   Set `eligibilityRuleId` here to publish a claim-gated Listing atomically.
   The rule must belong to the creator and target this print option's SKU.
   Set `maxQuantityPerCheckout` to the maximum copies in one purchase.
   It defaults to `"1"` and accepts positive integer strings up to `"1000"`.
   `availableQuantity` remains the total edition supply, not the checkout limit.
   One UI action can await both signing and publication, then redirect to the
   public print page.

Production and shipping are buyer-funded checkout charges, added on top of the
artwork price. Rare API quotes the configured Prodigi product for the selected
copies and shipping country at checkout. The signed order freezes these costs;
its fee allocations retain each item and charge purpose for receipts and refunds.
Listing preparation and availability do not request provider quotes or deduct
production from seller proceeds. Display the server-provided `breakdown.production`
and `breakdown.shipping` alongside the artwork price and checkout fee.

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
`rare.prints.drops.update` for names, descriptions, tags, display photos, and
production-file replacement. Upload the new master privately, then call
`rare.prints.drops.update(dropId, { productionUploadKey: replacement.key })`.
This works after pricing and publication without replacing the drop, SKU, or
listing. Newly authorized orders use the updated master; existing authorized or
paid Orders retain their original fulfillment snapshots. Specification changes
still require an unconfigured draft, or a replacement drop and SKU. Price changes
require freshly prepared and signed Listing terms.

### Compose NFTs and physical prints

A print is a physical variant. Configure its price through
`rare.prints.options.configure`, then prepare and publish its print listing.
Print preparation always uses off-chain fulfillment; it does not mint an NFT.

If the creator also offers an NFT, publish its ordinary NFT variant and listing
separately. Group related variants under the Product and add either or both
listing digests to the same `rare.cart.checkout.prepare` call. Include delivery
information when the Cart contains physical items. Each item retains its own
price, quantity, authorization and fulfillment.

`print.sourceUniversalTokenId` links the print to its source artwork for
attribution and discovery. It does not bundle or mint that NFT. Eligibility is
independent: set `eligibilityRuleId` during print listing preparation when the
print requires a claim.

Use `quantity` on the generic Cart draft item for multiple copies of one print.
Read each public print option's `maxQuantityPerCheckout` and `eligibilityRuleId`
to present quantity controls and eligibility. Rare API enforces the limit again
before signing. Changing quantity requires a new checkout idempotency key and
a fresh quote. Claims are reserved per copy, not once per Order. Delivery carts can include physical prints, NFT transfers, and swaps.

Use `rare.prints.drops.get/activity` for public detail and activity reads, and
`rare.prints.releases.list({ universalTokenId })` for linked-artwork discovery.

## Reuse account shipping and generic checkout

Use the same `rare` client that exposes `profile.get/update`:

- `shippingAddresses.list()` retrieves the private address book.
- `shippingAddresses.save({ id, label, details, makeDefault })` creates or updates
  a stable address UUID and can select the default.
- `shippingAddresses.delete(id)` removes an entry.

Saving requires explicit user consent. Passing delivery details to checkout does
not save them. Load the default saved address into an editable summary and offer
a change action. Use `rare.profile.get()` to prefill contact email when
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

Read `rare.cart.orders.get(orderId)` for payment status and `fulfillments`.
Each fulfillment includes `orderLineIndex`, status, and nullable `providerOrderId`.
`COMPLETED` means provider acceptance, not shipment or delivery. Poll this read
when useful; it does not initiate work.

After an interrupted signed checkout, call
`rare.cart.checkout.recover(idempotencyKey)`. It returns the original payload
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

Pass the original preparation to `rare.cart.checkout.authorize` or `purchase`.
The SDK retains the delivery details and idempotency key needed to finalize it.
Do not generate a new key because a request timed out or the buyer retries.
If the finalized total increases, the SDK rejects execution and requires a fresh
review rather than silently raising the spending cap.

For cards, call `rare.cart.checkout.coinflow` with the delivery draft and an
idempotency key. It returns the provider session and prepared Cart Order for the
card UI. Card checkout requires USDC as its payment currency. Keep card setup
and crypto execution under one checkout UI, and do not expose provider session
credentials in logs.

## Read Cart orders and display fulfillment progress

Use `rare.cart.orders.list({ page, perPage })` for `{ data, pagination }` pages,
and `rare.cart.orders.get(cartOrderId)` for one account-owned Cart
Order. History includes NFT-only, swap-only, print, and mixed orders.
Order reads do not require a blockchain RPC connection. The identifier is the Cart Order's bytes32 ID, not an internal fulfillment
UUID or provider Order ID. These methods do not include legacy NFT purchase
history and do not return private postal snapshots.

Keep payment state separate from each line's fulfillment state. Fulfillment
`SUBMITTED` means the provider accepted the order. Later provider reads can move
physical items to `IN_PRODUCTION`, `PARTIALLY_SHIPPED`, `SHIPPED`, or `CANCELLED`.
A paid physical order remains `CONFIRMED` when shipped. Prodigi's `Complete`
means all shipments were dispatched, not delivered; do not relabel it fulfilled.

Each fulfillment has an optional nullable `progress` object. It includes
`stage`, `productionStatus`, `providerUpdatedAt`, `checkedAt`, safe issue codes,
and a `shipments` array. Each shipment includes its carrier, tracking number,
HTTPS tracking URL and dispatch time when available. Display each parcel
separately and offer its tracking link so the buyer can verify delivery.
Tracking can be absent for an untracked service. Null progress means the first
provider refresh is pending, not that payment or submission failed.

Workers schedule provider refreshes every five minutes while processing and
thirty minutes after dispatch, with bounded batches, leases and retries. They
stop after cancellation or a ninety-day observation window. Order reads return
stored state; they never make the buyer wait for a provider request. Tracking
is account-private and is not projected into public catalog or activity data.
No additional carrier service is needed; carrier-confirmed delivery is not
provided by this integration.

Persist enough account-scoped recovery state to reconnect a confirmed payment
to its Cart Order. Poll stored backend status with the application's query
library. Backend workers own submission, retries, and reconciliation, so closing
the page must not be the mechanism that loses or releases an Order. Do not claim
provider confirmation from the transaction receipt alone, or ask the buyer to
pay again while fulfillment is pending.

## Extend missing SDK capabilities instead of bypassing them

The account shipping, print authoring, delivery checkout, card session, and
fulfillment Order methods above now exist. The Cart catalog supports the creator
operations listed above, but does not provide saved carts or every Product edit.
Mixed physical/non-physical carts and provider shipment tracking use these same interfaces. Carrier-confirmed delivery is not available.

For each missing capability, inspect the generated Rare API contract first.
If the endpoint exists, add a typed SDK method using the existing transport and
error handling. If it does not exist, add it in the owning backend layer before
wiring the frontend. Preserve the user's task scope when proposing those changes.

Add a named, typed SDK method for missing authenticated capabilities. Reuse
the internal account transport rather than exposing a raw authenticated request
function or asking consumers to read session credentials.
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
configuration, source-linked discovery, separate NFT and print Cart items, atomic gated
publication, quantity limits, multi-copy and multi-print delivery quotes,
idempotent signed Order preparation, recovery, and per-line account Order reads.
The CLI suite covers its corresponding
commands through delivery preview and signed Order preparation. Neither suite
pays or submits a physical Order. A separate funded sandbox fulfillment run is required to prove provider
submission and the private signed download end to end.

At handoff, report the SDK revision, API deployment, chain, test commands and
results, and any endpoint still missing from the SDK or backend.

## Use consistent list and mutation results

Paginated reads accept `page` and `perPage`, starting at page 1. Responses
contain `data` and `pagination` with `page`, `perPage`, `totalCount`,
and `totalPages`. This applies to Cart catalog searches, purchase eligibility
rules and claims, order history, creator print lists, and notifications. Print
activity also includes its creator alongside `data` and `pagination`.
Messaging history and synchronization positions retain their messaging semantics.

`rare.shippingAddresses.save(input)` returns the saved address.
`rare.shippingAddresses.delete(id)` returns nothing. Read the address book with
`list()` when you need the remaining entries or updated defaults.

Narrow notification payloads by `notification.category` before reading category
fields. The SDK validates the category and payload against schemas generated
from the backend notification model.

The CLI exposes catalog authoring under `rare cart catalog products` and
`rare cart catalog variants`. Manage purchase rights through
`rare cart purchase-eligibility rules`, `claims`, and `listing-requirements`.
Use `--page` and `--per-page` for paginated commands.
