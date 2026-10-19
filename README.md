# @rareprotocol/rare-sdk

SuperRare / Rare Protocol TypeScript SDK: marketplace listings, offers,
auctions, minting, releases, bridging, liquid editions, and a typed client for
the public Rare API.

Extracted from [`@rareprotocol/rare-cli`](https://github.com/superrare/rare-cli)
so applications can consume the SDK without the CLI (and without its
CLI-only dependencies).

## Install

```bash
npm install @rareprotocol/rare-sdk viem
```

The SDK supports Node.js 22 and newer. It publishes ESM and CommonJS builds;
browser applications may use the ESM entry points when their bundler provides
the wallet, RPC, and file capabilities required by the methods they call.

## Client configuration

`createRareClient` accepts a viem public client for reads and simulation. Add a
wallet client for write operations. Use `apiBaseUrl` for non-production Rare
API access and `uniswapApiKey` only for hosted Uniswap routing.

## Usage

Start with one client for public reads and account features. No RPC connection is needed:

```ts
import { createRareClient } from '@rareprotocol/rare-sdk';

const rare = createRareClient();
const artworks = await rare.search.nfts({ query: 'portrait', chainId: 1 });
const artwork = await rare.nft.get({ chainId: 1, contract: '0x...', tokenId: '1' });
// After wallet or device login, the same client exposes profile, messaging,
// uploads, follows, favorites, posts, drops and notifications.
```

Add viem clients for chain-bound reads and blockchain transactions:

```ts
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { createRareClient } from '@rareprotocol/rare-sdk';

const publicClient = createPublicClient({ chain: mainnet, transport: http() });
const rare = createRareClient({ publicClient });

const status = await rare.listing.status({
  contract: '0x…',
  tokenId: '1',
  target: '0x0000000000000000000000000000000000000000',
});
```

Features are grouped by intent under `rare.listing`, `rare.offer`,
`rare.auction`, `rare.collection`, `rare.liquidEdition`, `rare.bridge`,
`rare.swap`, `rare.search`, `rare.nft`, `rare.token`, and `rare.utils`.
Batch listings and release configuration are available through
`rare.listing.batch` and `rare.listing.release`; ERC-1155 collection,
listing, and offer behavior is nested under its corresponding intent namespace.

See [Eligibility client](docs/eligibility.md) for creator rules, SKU claims, and Listing requirements.
For frontend implementation, use [Build SuperRare cart features through the SDK](docs/superrare-com-cart-handoff.md).

Cart commerce is grouped under `rare.cart.catalog`, `rare.cart.listing`, and
`rare.cart.checkout`. Sellers select a Rare API-generated SKU from the public
catalogue, prepare and publish Listings, and buyers prepare and purchase a
fixed quote. The payer is always the transaction sender and may be a collector,
processor, or another third party.
Each Listing carries a client-generated `listingSalt`; its complete EIP-712
`listingDigest` is the immutable public identity referenced by Order Lines,
Merkle artifacts, cancellation, fill state, and order-book APIs.

Protected Cart requests reuse the unified client's account authentication. Use
your existing session store without changing the transaction signing wallet.

```ts
const rare = createRareClient({ publicClient, walletClient, apiBaseUrl, sessionStore });
```

Listing preparation, publication, invalidation, and signed checkout preparation
send the account's bearer token. Public catalog reads, Listing reads, and checkout
quotes remain anonymous. Authenticated requests stay internal to the SDK and
share the unified client's session and renewal lock. They refuse other API
origins or base paths, omit cookies, follow no redirects, and do not replay a
mutation after a failure. For application-owned sessions,
pass `transport` instead. The application owns authentication and session renewal.

```ts
const variants = await rare.cart.catalog.variants.search({
  nft: { contract: collectionAddress, tokenId },
});
const sku = variants.data[0]!.sku;

// Listing preparation resolves SKU fulfillment through Rare API, reads the
// current seller nonce, and builds an unsigned, non-durable batch artifact.
const listingPreparation = await rare.cart.listing.prepare({
  seller: sellerAddress,
  listings: [{ sku, unitPrice, settlementCurrency, quantity }],
  deadline,
});
const published = await rare.cart.listing.publish({
  preparation: listingPreparation,
  autoApprove: true,
});

// Rare API can also request a wallet-independent route for exact settlement
// obligations. Exact-output is the default; exact-input remains available for
// compatible Universal Router execution plans.
const routingQuote = await rare.cart.routing.quote({
  paymentCurrency,
  obligations: settlementObligations,
  mode: 'exact-output',
});
rare.cart.routing.assertFresh(routingQuote);

// Preparation is wallet-independent and creates no signature, approval,
// persistence, or transaction.
const preparation = await rare.cart.checkout.prepare({
  paymentCurrency,
  items: [{ kind: 'listing', listingDigest, quantity: 1n, recipient: buyerAddress }],
});

// Purchase revalidates, obtains the platform-signed immutable order, performs
// preflight, optionally approves, executes, and verifies the receipt.
const purchase = await rare.cart.checkout.purchase({ preparation, autoApprove: true });

// Listing-less swaps use the same quote, signing, and purchase flow.
// exact-input fixes the spending budget; exact-output fixes the tokens received.
const swap = await rare.cart.checkout.prepare({ paymentCurrency,
  items: [{ kind: 'swap', mode: 'exact-input', outputCurrency,
    inputAmount: 1_000_000n, recipient: buyerAddress }],
});
// Both quote directions produce fixed signed input and output amounts.
// Execution movement changes protocol spread, not the promised token output.
const swapPurchase = await rare.cart.checkout.purchase({ preparation: swap, autoApprove: true });
```

`autoApprove` defaults to `false`. Cart collects the exact platform-signed
`paymentAmount`; settlement recipients receive their exact signed Order Line
amounts, while favorable routing variance is protocol spread. The signed route
also carries the exact native `routerValue` forwarded to Universal Router.
Pure portable Listing Root, authorization, order, route, hashing, and Merkle
builders are available from `@rareprotocol/rare-sdk/utils` for advanced use.
Cart routing uses the client-level `uniswapApiKey` (or
`resolveUniswapApiKey`) and requires no wallet, account, approval, or write.
It asks Uniswap for the protected quote and compiled `/swap` transaction,
extracts the opaque Universal Router program, and validates only the Cart
command-family policy and transaction envelope. Universal Router remains the
authority for paths, pools, recipients, payer flags, exact-input/output
semantics, refunds, and internal V4 actions. Existing Liquid Editions routing
continues to use its established SDK flow.
The result contains JSON-safe exact settlements, expected and protected input
amounts, expiration, and normalized quote evidence. Once the platform accepts
and signs the route, execution never requotes or substitutes it.
Methods return structured results and reject on RPC, API, wallet, or validation
failure.

Sellers can later remove the collection-wide authorization with
`rare.cart.approval.revoke(collectionAddress)`.

Backend integrations can use the same `utils` entry point for Cart protocol
hashing and verification: `buildCartEip712Domain`, `hashCartListing`,
`hashCartListingRoot`, `hashCartPurchaseOrder`, `hashCartOrderLines`,
`hashCartPayoutRoute`, `hashCartFulfillmentActions`,
`deriveCartListingMerkleLeaf`, `computeCartListingMerkleRoot`, and
`verifyCartListingMerkleProof`. Chain-bound helpers accept safe numeric chain
IDs or bigint chain IDs without numeric coercion.

The package intentionally exposes only these supported entry points:

| Import | Contents |
| --- | --- |
| `@rareprotocol/rare-sdk` (or `./client`) | `createRareClient` + SDK namespaces |
| `@rareprotocol/rare-sdk/contracts` | contract addresses + ABIs per chain |
| `@rareprotocol/rare-sdk/utils` | public helpers |
| `@rareprotocol/rare-sdk/data-access` | typed Rare API client and errors |

Implementation modules, including planners, shell helpers, individual ABI
files, and data-access internals, are private. Consumers should use only the
documented root, `client`, `contracts`, `utils`, and `data-access` entry points.

Catchable approval errors, including `MinterApprovalRequiredError`, are exported
from the root package and `@rareprotocol/rare-sdk/client`.

### Transaction approvals

Write methods do not send ERC-20 allowance, NFT operator, or collection minter
approval transactions unless the caller explicitly passes `autoApprove: true`.
When an approval is required, the default behavior is to reject with the
corresponding exported `PaymentApprovalRequiredError`,
`NftApprovalRequiredError`, or `MinterApprovalRequiredError`. This lets an
application obtain user consent before retrying:

```ts
try {
  await rare.listing.create(params);
} catch (error) {
  if (error instanceof NftApprovalRequiredError) {
    // Ask the user for consent, then retry intentionally.
    await rare.listing.create({ ...params, autoApprove: true });
  }
}
```

Callers that intentionally want the previous one-call behavior can pass
`autoApprove: true` on approval-capable writes, including swap token sells and
liquid-edition deployment with initial RARE liquidity.

### Lazy ERC-721 deployment variants

`rare.collection.deploy.lazyErc721` exposes the implementation choice as
`variant`: `standard`, `royalty-guard`, or `deadman-royalty-guard`. The former
public `contractType` field and its `lazy-*` values are not accepted.

```ts
await rare.collection.deploy.lazyErc721({
  name: 'Release Collection',
  symbol: 'REL',
  maxTokens: 1000,
  variant: 'royalty-guard',
});
```

### Crypto values use bigint base units

Public SDK prices, payment amounts, swap inputs, liquid-edition supplies, and
royalty sale prices accept `bigint` base units only. Convert user-facing
decimal values before calling the SDK; for example, use viem's `parseEther` or
`parseUnits` with the selected ERC-20 currency's decimals.

```ts
import { parseEther, parseUnits } from 'viem';

await rare.listing.create({
  contract: '0x…',
  tokenId: 1n,
  price: parseEther('0.5'),
});

await rare.offer.create({
  contract: '0x…',
  tokenId: 1n,
  currency: 'usdc',
  price: parseUnits('12.50', 6),
});
```

Serialized batch-listing artifacts retain string amounts because JSON cannot
represent bigint values; live SDK method inputs are bigint-only.

### Batch marketplace creation

Batch listing, auction, and offer creation use the same token-tree artifact
produced by `rare.utils.tree.build`. Marketplace terms stay in the method
parameters instead of being embedded in a listing-specific registration
artifact:

```ts
await rare.listing.batch.create({
  artifact: tokenTreeArtifact,
  price: parseEther('0.012'),
  currency: 'eth',
  splitAddresses,
  splitRatios,
});
```

The previous mixed batch-listing root artifact is not accepted by the V2
create method. Portable token-tree artifacts remain reusable across listing,
auction, and offer creation.

Liquid-edition curve configuration helpers are available both as standalone
utilities and on a configured client:

```ts
import { getCurvePresetDefinition, parseCurveConfig } from '@rareprotocol/rare-sdk/utils';

const preset = getCurvePresetDefinition('medium-demand');
const segments = parseCurveConfig(curveJson, '1000000', 60);

const samePreset = rare.utils.liquidCurve.getPresetDefinition('medium-demand');
const sameSegments = rare.utils.liquidCurve.parseConfig({
  value: curveJson,
  totalCurveSupplyTokens: '1000000',
  tickSpacing: 60,
});
```

## Regenerating the Rare API types

The generator reads `RARE_API_BASE_URL` from the process environment, then from
a local `.env`, and otherwise uses `https://api.superrare.com`. Values are parsed
as data rather than evaluated by a shell.

```bash
npm run generate:types
```

Commit the regenerated schema with SDK changes that use the updated contract.
API changes must be deployed to production before merging the corresponding SDK
support.

## Liquid edition discovery

```ts
// Uses the chain configured on rare, just like rare.search.nfts().
const editions = await rare.search.liquidEditions({
  query: 'generative',
  holderAddress: '0x1234567890123456789012345678901234567890',
  sortBy: 'priceAsc',
  priceMax: 100, // Inclusive USD bound
  perPage: 20,
});
const edition = await rare.liquidEdition.get({
  contract: '0x1234567890123456789012345678901234567890',
});
```

Search returns `{ data: LiquidEdition[], pagination }`; `get` returns the
unwrapped `LiquidEdition`. Full-text search uses `query` (sent as `q`), matching
NFT search. All API filters are supported: contract, creator and holder addresses,
approved creator and current price flags, display-price currency, inclusive USD
price bounds, media type, tags (match any), sort order, and pagination. Defaults
are page 1, 20 results (maximum 100), and `newest` sorting. Sort options are
`newest`, `oldest`, `priceAsc`, `priceDesc`, `holderCountAsc`, and `holderCountDesc`. Search text is limited
to 500 characters and tags to 50 entries. `IMAGE` includes GIFs.

For all-chain discovery, use the same factory without a `publicClient` and omit `chainId`:

```ts
import { createRareClient } from '@rareprotocol/rare-sdk';

const api = createRareClient();
const editions = await api.search.liquidEditions({ query: 'generative' });
const edition = await api.liquidEdition.get({ chainId: 1, contract: '0x1234567890123456789012345678901234567890' });
```

Only public editions are returned. Holder filtering uses positive indexed collector
balances, excluding system and self-holdings; responses do not contain holder
arrays or exact wallet balances. Indexed discovery may lag on-chain state; use
`rare.liquidEdition.status({ contract })` for on-chain telemetry.

Price bounds and price sorting exclude editions without a current price and
cannot be combined with `hasCurrentPrice: false`. API validation errors (`400`),
missing editions (`404`), and unavailable discovery (`503`) propagate as
`RareApiError` from `@rareprotocol/rare-sdk/data-access`, retaining `status` and
`path`. The SDK uses the production Rare API by default. Set `apiBaseUrl` on
`createRareClient` to use another deployment. The existing `RARE_API_BASE_URL` environment override takes precedence and applies to both public and authenticated requests.

## Live integration tests

```bash
npm run test:integration
```

This opt-in, read-only suite targets
`https://rare-api-devmainnet-784573620320.us-east1.run.app` using two known public
Sepolia editions: **LQE 9/21** (`0x1a9e355ba82542ef9d0654347026a63b09e53b26`)
and **Liquid Lens HTML Example** (`0xeedad60508165cffebb8f8b71a68bea3cc6ad235`).
It checks both detail interfaces, response fields and GIF/HTML media, combined
search filters, match-any tags, pagination, mismatched creator exclusion, and
real `400`/`404` errors. It does not assert changing prices, supply, or balances.

Normal `npm test` skips live tests. Requests time out after 20 seconds, and API
outages or missing fixtures fail the live suite rather than silently skipping it.
Override the deployment with `RARE_API_INTEGRATION_URL`; that deployment must
contain the same fixtures. If these editions are intentionally changed or removed,
update the explicit fixtures in `test/integration/liquid-edition-discovery.test.ts`.

Liquid discovery tests follow functional core / imperative shell boundaries:
`test/liquid-discovery-core.test.ts` unit-tests pure query mapping and edition
identity construction without mocks. `test/integration/liquid-edition-discovery.test.ts`
tests the HTTP shell against the live rare-api; no responses are mocked. A `503`
is treated as an integration failure, not simulated by the suite.

## Account authentication (new authority)

`createRareClient` exposes account operations without an RPC connection or
transaction wallet. All requests use one public API base URL. Rare API forwards
`/auth/v2` login, device, refresh and revocation requests to the existing auth
service; profile requests use `/v1/me`. Legacy SuperRare/Connect cookies and tokens
are not accepted by this client.

Login verifies wallet ownership and stores credentials. It does not create a SuperRare account. Profile operations require an existing account and return `account_required` when signup is needed. Wallet signing operations remain independent of account login.

```ts
import { createRareClient } from '@rareprotocol/rare-sdk';

const account = createRareClient(); // https://api.superrare.com
const authorization = await account.auth.startDeviceAuthorization();
// Display authorization.verificationUri and authorization.userCode, or open
// authorization.verificationUriComplete in a browser using your application's UI.
await account.auth.waitForDeviceAuthorization(authorization);
const profile = await account.profile.get();
await account.profile.update({ profile: { bio: 'Artist and collector' } });
await account.auth.logout();
```

For the development environment, set only the API base:

```ts
const account = createRareClient({
  apiBaseUrl: 'https://rare-api-devmainnet-784573620320.us-east1.run.app',
});
```

Auth is always derived as `<apiBaseUrl>/auth/v2`; there is no separate auth URL
option. A feature deployment can supply its own API base with the same routes.
Stored sessions are bound to the selected API base and require fresh login when
that base changes.

For direct wallet login, supply a signer; no transaction is submitted:

```ts
await account.auth.loginWithWallet({
  address: walletAccount.address,
  chainId: 1,
  signMessage: (message) => walletAccount.signMessage({ message }),
});
```

SIWE uses the browser page's origin when signing in a browser, or the selected
API origin for non-browser callers such as the CLI. An optional `signingOrigin`
can select a different origin outside a browser. Valid third-party HTTPS origins
do not require registration in the new Auth flow; browser callers cannot override
their page's origin. Hosted device approval signs for Connect's browser origin.

Browser-approved login supports the hosted application's wallet, social, and email
options. Social providers and cross-origin account continuity require deployment
configuration and verification; the SDK itself does not hold social credentials.

The account integration suite calls a deployed non-production Rare API and Auth
with a dedicated test wallet. It verifies wallet login, account reuse, profile
updates, token refresh and revocation through real HTTP services. It writes a
stable profile marker on that test account. This suite is manual and separate
from `npm test`. It also checks forged signatures and bearer tokens, wallet and
refresh replay, cross-account selectors, privileged writes, and public email
privacy. Adversarial accounts use fresh unfunded wallets; sessions are revoked
afterward. The public privacy fixture is an existing indexed dev profile and
must return 200, so a missing profile cannot silently pass the privacy check:

```bash
export RARE_ACCOUNT_TEST_API_URL=https://your-feature-rare-api.example
export RARE_ACCOUNT_TEST_PRIVATE_KEY=... # dedicated, unfunded test wallet
npm run test:integration:account
```

The controlled HTTP account tests in `test/contract/` exercise protocol edge
cases without claiming service integration. The local disposable-stack driver
in `test/cross-repo/` remains available for backend diagnosis.

Managed browser sessions persist by default in origin-local storage, scoped to the
configured API. Reloading or creating another client resumes that session. Native
Web Locks serialize refresh and session changes across same-origin tabs. Logout
and a newer login invalidate pending login completion in other clients. Storage
or locking failures are explicit errors, never a silent memory fallback.

Persisted bearer credentials are readable by same-origin JavaScript. The adapter
does not protect against XSS. Applications with server-managed cookie sessions
should use the application-owned transport below, which creates no SDK session.

Node clients use memory by default; the CLI provides protected persistent storage.
To explicitly opt out of browser persistence:

```ts
const rare = createRareClient({ sessionStore: createMemoryAccountSessionStore() });
```

Custom persistence can implement `RareAccountSessionStore`. `withLock` must serialize **all** operations across
clients/processes sharing a store; reads happen after lock acquisition and writes
must finish durably before resolving. Scope the store by normalized auth base,
API base, and client ID. Store values can be credentials or a nonsecret logout
tombstone (`RareStoredAccountSession`); retain the latter to prevent an old login
from resurrecting a session after another process logs out. Use `auth.getSession()`
for local status; it returns `null` for a logged-out store. It is not a server
validation call and its non-null result contains secrets—never print it wholesale.

The SDK proactively refreshes near-expired credentials under that lock. It durably
marks `refreshBlocked: true` before sending the refresh and clears the marker only
after saving the replacement credentials. An ambiguous refresh failure raises
`RareAuthError` with `code: 'reauthentication_required'`; it never automatically
replays a potentially consumed refresh token. The remaining credential can be used
for explicit logout. A completely unavailable store may require local recovery
before reuse. Logout revokes remotely before replacing credentials with a tombstone;
on network failure credentials remain for retry. `auth.clearSession()` removes
local credentials without claiming server revocation. Explicit successful login
replaces the local session; an older server session is not automatically revoked.

For resumable device flows, persist `RareDeviceAuthorization` securely and call
`auth.pollDeviceAuthorization(state)`. Pending, slow-down and transport-retry results return updated
`authorization` state, including `nextPollAt` and `interval`; save it before the next
invocation. Serialize access to a pending request separately from session storage.
An `authorized` result has already been saved to the session store. The built-in
wait method handles polling but does not persist intermediate device state.
Device codes and token responses must not appear in logs, URLs, or command arguments.

Network methods accept `{ signal }` for cancellation and use a 30-second request
timeout. Device waits also stop at grant expiry. Only HTTPS endpoints (or loopback
HTTP for development) are accepted, and credential requests do not follow redirects.
Profile writes are never automatically replayed. Omitted patch fields preserve data;
profile patch values must be strings. You can update your private email and the
profile's website, Twitter/X, Discord, Instagram, YouTube and pinned artwork fields.
The existing website metadata names are preserved. Email is never returned by
public `user.get` methods. Empty email is rejected. Empty avatar
or `mastheadUniversalTokenId` strings remove those fields. Bios allow 180 characters.
Account and wallet ownership are not editable through profile updates.

```ts
await account.profile.update({
  email: 'artist@example.com',
  profile: { bio: 'Artist and collector', website: 'https://example.com' },
});
await account.profile.uploadAvatar(imageBytes, 'avatar.png');
await account.profile.update({ profile: { avatar: '', mastheadUniversalTokenId: '' } });
await rare.user.get({ username: 'artist' });
```

Shared application uploads accept any file type up to 250 MiB. `access` selects the public or private bucket and defaults to `public` for compatibility. Public results contain `{ access, key, url, contentType, size }`. Private results contain `{ access, key, contentType, size }`, without a URL:

```ts
const attachment = await account.upload(bytes, 'document.pdf', { access: 'private', contentType: 'application/pdf' });
```

The associated feature owns authorization for private files. This uploader does not issue download URLs or grant access based on possession of a key. Store the `access` and `key` reference with the feature.

Public upload example:

```ts
const asset = await account.upload(bytes, 'cover.png', { contentType: 'image/png', access: 'public' });
// asset: { access: 'public', key, url, contentType, size }
await account.profile.update({ profile: { avatar: asset.url } });
```

The uploader authorizes through `POST /v1/uploads`, transfers 8 MiB chunks directly
to a GCS resumable session URL, then finalizes through
`POST /v1/uploads/{id}/complete`. Rare API verifies size and content type, streams
the stored generation through SHA-256, and publishes or deduplicates the asset.
Upload capabilities stay private, and account tokens are never sent to GCS.
Uploading does not edit profiles or other features. Identical bytes return the same stored object.
Browser callers may pass a `Blob` or `File`; its content type is used by default.
Byte arrays default to `application/octet-stream` unless `contentType` is supplied.
The original URL serves files as attachments. Clients own image transformations
and can apply their own Imgix source or other image service.

Run `npm run test:integration:uploads` manually against a deployed dev API with
`RARE_ACCOUNT_TEST_API_URL`, `RARE_ACCOUNT_TEST_PRIVATE_KEY`, and
`RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY` configured. This
suite uses real storage and requires authenticated `gcloud` access on
`superrare-dev` to delete its unique test objects from both upload buckets.
It verifies concurrent deduplication, first-writer metadata, public byte-for-byte
downloads, avatar attachment and clearing, unchanged unrelated profile fields,
and HTTP rejection of anonymous, forged, empty, oversized and unexpected-field
requests. Object hashes are registered before requests so cleanup also runs after
an ambiguous upload failure. It also verifies private references, anonymous download
denial, separate bucket storage, private cache metadata, a 33 MiB multi-chunk upload,
private staging, unfinished-upload rejection, and account-bound repeat finalization. The dev API must use
`rare-api-public-upload-dev` and `rare-api-private-upload-dev`. It is not a CI job.

Avatar uploads accept PNG, JPEG or GIF, up to 5 MiB. The upload method saves the
returned URL to your profile. If the upload succeeds but saving fails,
`AvatarProfileUpdateError.avatar` contains the URL to retry with `profile.update`
without repeating the upload. The CLI supports `profile update --bio "hackin"`
and other field flags, plus `--stdin` or `--file` for structured patches.

Existing `createRareClient` wallet transactions and public reads are unchanged.
An account session does not delegate transaction-signing authority.

Deployed account integration tests require two existing, distinct test accounts, supplied through `RARE_ACCOUNT_TEST_PRIVATE_KEY` and `RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY`. The fresh-wallet test generates its own wallet and expects login to leave it without an account.

The account suite additionally verifies username changes and conflicts, all profile
form fields, partial-update preservation, masthead pinning to a real indexed
artwork, clearing optional profile fields, and server-side invalid-field rejection.
Use disposable profiles: the suite changes their email and profile metadata and
restores the username, but does not restore every original field. Avatar uploads
are verified separately by `test:integration:uploads`, which restores the original
avatar and deletes its objects. Browser email/social login still requires a manual
Reown check; CLI device E2E covers the real Connect approval HTTP protocol.

### Public profiles and follows

User reads accept exactly one explicit selector. The existing address argument remains supported.

```ts
await rare.user.get('0x...');
await rare.user.get({ username: 'artist' });
await rare.user.get({ userId: 123 });
await rare.user.followers.list({ username: 'artist' }, { page: 1, perPage: 20 });
await rare.user.following.list({ address: '0x...' });
await account.user.following.add({ userId: 123 });
await account.user.following.delete({ username: 'artist' });
```

Profile and follower/following reads are public and omit email. Following or
unfollowing requires an existing account session. The server derives the acting
user from that session; the selector identifies the target user. Follow writes
use the existing `createUserFollow` mutation, which creates a relationship only
if missing. Repeated or concurrent follows create one relationship. The SDK does
not automatically retry writes.

Run `npm run test:integration:follows` manually against a deployed non-production
API and GQL API containing these changes. Set `RARE_ACCOUNT_TEST_API_URL`,
`RARE_ACCOUNT_TEST_PRIVATE_KEY`, and `RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY` to
two distinct disposable accounts with no existing follow relationship. The suite
checks selector equivalence, public pagination/email privacy, concurrent and
repeated follow/unfollow,
unauthorized writes and self-follow rejection, then removes its relationship and
revokes its sessions. It runs outside CI.

### Artwork favorites

Favorites require an existing account and a saved account session. Counts are public.

```ts
const id = '1-0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0-12345';
await account.artworkFavorites.add(id);
await account.artworkFavorites.has(id); // boolean
await account.artworkFavorites.list({ page: 1, perPage: 20 });
await account.artworkFavorites.remove(id);
await rare.nft.favoriteCount({ contract: '0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0', tokenId: 12345 });
```

`account.artworkFavorites.add`, `remove`, and `has` also accept `{ chainId, contract, tokenId }`.
Lists contain artwork identifiers, the favorite creation time, and `metadata.name`, with standard page metadata.
The API derives the acting account from its session. It provides no public favorite list or list of people who favorited an artwork.
Repeated adds and removals preserve the requested state. These methods do not authorize blockchain transactions.

Run `npm run test:integration:favorites` against a deployed non-production API. Set `RARE_ACCOUNT_TEST_API_URL`,
`RARE_ACCOUNT_TEST_PRIVATE_KEY`, `RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY`, and `RARE_ACCOUNT_TEST_ARTWORK_ID`.
Use two existing disposable accounts and a dedicated artwork that neither account already favorites.
The suite tests privacy, account isolation, concurrent additions, pagination, public counts, and cleanup. It runs outside CI and fails on missing fixtures.

### Creator posts

Public reads need no sign-in. Resolve a user's posts by username, address, or user ID:

```ts
const posts = await rare.posts.list({ username: 'creator' }, { page: 1, perPage: 20 });
const post = await rare.posts.get('123'); // Includes public likeCount.
const comments = await rare.posts.comments('123', { page: 1, perPage: 20 });
```

After authenticating with `createRareClient`, use the account's identity for writes:

```ts
const post = await account.posts.create({ title: 'Studio update', body: '**New work**', imageUrls: [] });
const comment = await account.posts.comment(post.id, { body: 'Looking forward to this.' });
await account.postFavorites.add(post.id);
const favorites = await account.postFavorites.list({ page: 1, perPage: 20 });
const favorited = await account.postFavorites.has(post.id);
await account.postFavorites.remove(post.id);
await account.posts.deleteComment(post.id, comment.id);
await account.posts.delete(post.id);
```

Image URLs can come from `account.upload`; posts do not add another uploader.
Only your favorite list is accessible. Deletion through this API is limited to your own content.

Run deployed-service integration coverage manually with `npm run test:integration:posts`.
Set `RARE_ACCOUNT_TEST_API_URL` to a non-production HTTPS API origin and
`RARE_ACCOUNT_TEST_PRIVATE_KEY` / `RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY` to two distinct,
unfunded test wallets with existing SuperRare accounts. The suite creates and deletes its own
posts and comments, and revokes its sessions. It does not run in CI.

### Drop announcements and calendar

```ts
const calendar = await rare.drops.list({ from, to, user: { username: 'artist' } });
const announcement = await rare.drops.get('42');
const image = await account.upload(bytes, 'cover.png', { contentType: 'image/png' });
const drop = await account.drops.create({
  type: 'NONE', startsAt,
  metadata: { headline: 'New work', description: 'A new release', destinationUrl: '', imageUrl: image.url },
});
await account.drops.update(drop.id, { metadata: { headline: 'Updated title' } });
await account.drops.delete(drop.id);
```

Calendar and detail reads are public. Calendar windows are at most 30 days; user selectors accept username, address or numeric user ID. New launch times must fall within the next 30 days. Updates preserve omitted fields. Announcement images use the shared uploader and must be PNG, JPEG, GIF or WebP.

Creation and updates require an existing account and preserve the website's artist rule: mainnet requires SuperRare artist approval, while Sepolia and Base Sepolia retain its testnet exception. Deletion only requires ownership.

Run `npm run test:integration:drops` manually after deploying the new routes. Set `RARE_ACCOUNT_TEST_API_URL`, `RARE_ACCOUNT_TEST_PRIVATE_KEY` and `RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY` to a non-production HTTPS API origin and two distinct dedicated wallets with existing accounts. The first wallet must not be an approved mainnet artist. Successful mutations authenticate on Sepolia; a separate mainnet login tests artist rejection. The suite performs real uploads and deletes its announcements afterward. Missing prerequisites fail the suite. It does not run in CI.

## Durable messaging

Messaging uses the same account session and refresh lifecycle as profile operations.
Call `createRareClient`, sign in, then use `account.messaging`:

```ts
const room = await account.messaging.createRoom({
  type: 'group', title: 'Studio chat', description: '', guidelines: '',
  clientOperationId: crypto.randomUUID(), inviteeUserIds: ['42'],
});
const input = {
  clientMessageId: crypto.randomUUID(), body: 'Hello!',
  attachmentIds: [], mentionUserIds: [],
};
const message = await account.messaging.send(room.id, input);
const history = await account.messaging.history(room.id);
const changes = await account.messaging.changes(room.id, history.changeCursor);
await account.messaging.command(room.id, { action: 'preferences', notification: 'mentions' });
await account.messaging.messageCommand(room.id, message.id, { action: 'delete' });
```

Message edits use `messageCommand(room.id, message.id, { action: 'edit', body: 'Updated text' })`. The `version` field is optional. Supply the version from a previously read message when you want stale edits rejected; otherwise the latest successful edit wins.

Keep `clientOperationId` and `clientMessageId` stable when explicitly retrying the
same operation. The SDK does not automatically retry ambiguous mutations. Account IDs,
message sequences, and pagination cursors stay strings.

The namespace exposes `session`, `inbox`, `people`, `createDirect`, `createRoom`,
`history`, `changes`, `participants`, `send`, `command`, `messageCommand`, `blocks`,
`block`, `unblock`, `preview`, `attachImage`, and `readImage`. Commands use the
existing API actions for membership, lifecycle, notification preferences, read
markers, editing, deletion, reactions, pins, and reporting. Input and response types
are exported from the SDK and derive from the Rare API OpenAPI contract.

Messaging images use the shared uploader, then attach the completed private upload:

```ts
const upload = await rare.upload(bytes, 'image.png', {
  access: 'private', contentType: 'image/png',
});
const attachment = await rare.messaging.attachImage(room.id, upload.uploadId, {
  width: 100, height: 100, attachmentId: crypto.randomUUID(),
});
await rare.messaging.send(room.id, {
  clientMessageId: crypto.randomUUID(), body: 'Image', attachmentIds: [attachment.id],
});
```

Reuse `attachmentId` for retries. Attaching a completed upload must happen within
its 24-hour upload authorization window. Once attached, access is governed durably
by messaging membership and message visibility. One upload can back multiple
attachments without copying the file. `readImage(attachment.id)` returns an
authenticated `Blob`, never a public storage URL. The website's existing upload
route remains supported; this SDK uses only the shared upload transfer.

Run `npm run test:integration:messaging` manually against a deployment with account
bearer support. Set `RARE_ACCOUNT_TEST_API_URL` to a non-production HTTPS origin.
Set `RARE_ACCOUNT_TEST_PRIVATE_KEY`, `RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY`, and
`RARE_ACCOUNT_TEST_THIRD_PRIVATE_KEY` to three distinct existing dedicated accounts.
If `RARE_API_BASE_URL` is set, it must match the test origin. The first/second account
pair is reserved for declined direct requests; do not accept that pair's request
or follow the first account from the second. The first/third pair is used for an
accepted direct conversation. Blocking is restored afterward. Public messages and
transient direct replies are deleted. Request seed messages remain for repeatable
runs, and new groups are closed with their durable history retained.
Set `RARE_MESSAGING_TEST_PRIVATE_BUCKET` to the deployment's private messaging
bucket and authenticate `gcloud` for `superrare-dev` so attachment fixtures can be
removed. These tests verify private bytes through authenticated downloads and
verify revocation after bans and message deletion. They are excluded from the
standard test command and do not run in CI.

Public auction, liquid-edition, and drop rooms use the same durable conversation
system. Anonymous callers can resolve a room and read its history without joining:

```ts
import { createRareClient } from '@rareprotocol/rare-sdk';
const api = createRareClient({ apiBaseUrl: 'https://api.superrare.com' });
const room = await api.messaging.public.resolveRoom({ type: 'auction', id: auctionId });
const page = await api.messaging.public.history(room.id, { limit: 50 });
const sent = await account.messaging.public.send(room.id, {
  clientMessageId: crypto.randomUUID(), body: 'Great artwork!', mentionUserIds: [],
});
```

Sending the first successful message joins the room. Reads do not subscribe the
caller. Public history returns user messages and trusted system messages, distinguished
by `type`. The SDK provides no method for writing system messages. Existing private
conversation IDs remain inaccessible through the public history endpoint.

Run `npm run test:integration:messaging:public` separately with the same account/API
variables plus `RARE_MESSAGING_TEST_PUBLIC_CONTEXTS`, a JSON array containing one
existing context of each type: `auction` with `id`, `liquid-edition` with `chainId`
and `contractAddress`, and `drop-announcement` with `id`. Use dedicated fixture rooms
where the test account is not already subscribed. The suite deletes its messages
and leaves each room afterward. Set `RARE_MESSAGING_TEST_PIPELINES_DIR` to the
monorepo's `services/pipelines` directory and `RARE_MESSAGING_TEST_DATABASE_URL`
to the matching non-production deployment database connection. System fixtures
invoke the production Pipelines writer directly; no internal HTTP producer key is used. Public delivery tests
verify delivery for all three room types, default subscriptions in a new room, mentions-only and muted
preferences, and actual app-inbox delivery. A positive control confirms that the
worker is running during muted-delivery checks. System-message fixtures use a new
temporary drop room, then verify anonymous thread reads, producer retry deduplication,
one notification per event, and rejection of user writes/edits/deletes. The SDK does
not expose a system-message write endpoint. Deleting the fixture drop leaves its
unadvertised durable system history; tests do not put synthetic events into an
existing auction or liquid-edition history.

For public history, `nextCursor` is the last sequence in a truncated page. While
polling forward, request `history(room.id, { after, limit: 100 })`, drain every
`nextCursor` page, then advance to the final page's `room.latestSequence`. Private
conversation change cursors are a separate sequence and must not be used for
public history.

## Notification inbox

After signing in, use `account.notifications` to read delivered app notifications:

```ts
const page = await account.notifications.list({ page: 1, perPage: 20 });
const next = page.pagination.page < page.pagination.totalPages
  ? await account.notifications.list({ page: page.pagination.page + 1, perPage: 20 })
  : null;
const unreadCount = await account.notifications.unreadCount();
const notification = page.data[0];
if (notification) await account.notifications.markRead(notification.id);
// Explicitly acknowledge every delivered inbox entry:
await account.notifications.markAllRead();
```

Entries contain `id`, `category`, `notificationId`, `payload`, `readAt`, and
`createdAt`. IDs are strings. Internal provider and delivery metadata are excluded.
The inbox returns individual deliveries, including messaging notifications.
Marking an entry read does not mark its conversation messages read. Use the
messaging `read` command for conversation read state.

Run `npm run test:integration:notifications` manually against a non-production API
with the notification routes and the deployed Pipelines messaging worker. Supply
`RARE_ACCOUNT_TEST_API_URL`, `RARE_ACCOUNT_TEST_PRIVATE_KEY`, and
`RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY` for two existing accounts. The test sends
real messages and waits for worker-created deliveries. It does not seed delivery
rows or invoke the worker itself, and it fails when prerequisites are missing.

Random NFT discovery uses the existing search method and supports existing filters:

```ts
await rare.search.nfts({ sortBy: 'random', perPage: 1 });
await rare.search.nfts({ sortBy: 'random', creatorAddress: '0x...', perPage: 5 });
```

Each request uses native Typesense random ordering. Random pages do not form a
stable traversal; use another sort order when paging through a complete result set.
Run the public live integration with
`RARE_ACCOUNT_TEST_API_URL=https://your-feature-api npm run test:integration:nfts`.

## Application-owned authentication transport

Applications with an existing server-managed session can configure one API transport.
Feature methods keep the same request and response types. This client has no `auth`
methods and never acquires or refreshes an SDK bearer session.

```ts
const account = createRareClient({
  transport: (path, init) => fetch(`/api/rare${path}`, {
    ...init,
    credentials: 'same-origin',
    redirect: 'error',
  }),
});
const inbox = await account.messaging.inbox();
```

The transport receives API-relative paths such as `/v1/messaging/conversations`,
request headers/body, and an abort signal combining the caller's cancellation with
an SDK deadline. The application owns authentication, logout, refresh and account
switching, including clearing account-specific caches. Its server proxy must
validate cookie-authenticated writes against CSRF and forward credentials only to
its configured Rare API. Do not put session cookies or internal keys in browser
JavaScript. Authenticated API errors retain the SDK's normal error handling.

Signed storage uploads bypass this API transport and use the optional `apiFetch`
implementation with `credentials: 'omit'`, without authentication headers.
Without a transport, `createRareClient` retains its existing bearer-token
login, session storage and refresh behavior.

Third-party browser applications use that default bearer client independently of
SuperRare's website cookies. Direct wallet login binds SIWE to `window.location.origin`;
non-browser applications may supply `signingOrigin`. Valid third-party HTTPS origins
do not require manual registration in the new Auth flow. Hosted Connect login is
available through `account.auth.startDeviceAuthorization()` and supports its
wallet/email/social login choices. Every application receives its own approved
session. Manually run `npm run test:integration:account` against a deployment with
the arbitrary-origin Auth update to verify independent third-party sessions and
origin-mismatch rejection. These HTTP tests do not substitute for browser CORS checks.

Run real-browser authentication checks manually with
`npm run test:integration:account:browser` after `npx playwright install chromium`.
They use the same existing test wallet and deployed API variables as the account
suite. Chromium performs the actual cross-origin fetches and preflights; only the
empty third-party application document is supplied by the test. Auth/API responses
are never intercepted. The suite checks unregistered origins, independent bearer
sessions, hosted authorization initiation, SIWE tampering, origin mismatch, replay
and actual challenge expiration. The expiration case takes about five minutes.

For a disposable real Auth service backed by Redis, set
`RARE_ACCOUNT_BROWSER_API_URL=http://127.0.0.1:<port>`. This mode serves genuine
loopback application pages and checks Auth's complete browser/session behavior;
account profile reads still require the deployed Rare API and run in HTTPS mode.
No browser CORS or address-space security settings are disabled.


`createRareApi` remains available as a lower-level
HTTP adapter, but is not needed to combine public reads and authenticated writes.
The resource namespaces combine both: `rare.posts.list/get/comments` are public,
while `rare.posts.create/comment/delete/deleteComment` use account authentication;
`rare.drops.list/get` are public, while `create/update/delete` authenticate.
Anonymous chat resolution and history live under `rare.messaging.public`.
Without a configured chain, NFT identity lookups require `chain` or `chainId`.
Configured chain clients retain their existing chain-bound lookup signatures.


`apiFetch` is the unified client's optional fetch implementation. With an
application-owned `transport`, API requests go through the transport and only
signed storage transfers use `apiFetch`. Without a transport, `apiFetch` handles
API requests and storage transfers. There is no caller-configurable `clientId`;
the SDK supplies its fixed protocol identifier internally.

Public and authenticated application failures use `RareApiError`, with `code`,
`status`, `path`, and optional field `details`. `RareAuthError` is reserved for
login, session storage, refresh and revocation failures.


Run `npm run test:integration:account:browser:sessions` to verify default browser
storage with two existing test wallets. Set `RARE_ACCOUNT_TEST_PRIVATE_KEY`,
`RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY` and the non-production API URL as above.
The suite bundles the complete SDK into Chromium and verifies reloads, cross-tab
refresh/logout/account switching, and stale-login protection. Disposable local
Auth mode verifies authentication and storage; successful profile reads require
a deployed Rare API with the arbitrary-origin Auth update.

### Request controls

New API-backed methods keep operation data separate from request controls. For example, `rare.notifications.list({ page: 1, perPage: 20 }, { signal })` and `rare.posts.comment(postId, { body, parentCommentId }, { signal })`. Methods with no operation input accept request controls directly, such as `rare.profile.get({ signal })`. Public messaging reads remain anonymous by default; use `rare.messaging.public.history(roomId, { limit: 20 }, { authenticated: true, signal })` for viewer-specific visibility. Upload metadata stays in the third argument; cancellation controls go in the fourth: `rare.upload(file, filename, { access: 'private' }, { signal })`.
## Reference documentation

Generate API reference Markdown directly from the public SDK source:

```bash
npm run docs:build
```

The generated reference is written to `docs/reference/`.

## Print authoring and delivery checkout

`rare.prints` exposes creator-owned drops, supported specifications, production
quotes, frozen Listing preparations, and public print reads. It uses Rare API
directly. Pass the authenticated account client to `createRareClient`.

Upload print masters with `accountClient.uploads.upload(file, filename, { access:
'private' })`. Pass the returned `key` as `print.productionUploadKey` when creating
a standalone drop. Upload supplemental display images with public access and use
their URLs in `print.images`. The SDK does not publish master download URLs.

Prepare seller terms with `rare.prints.listings.prepare`, then call
`rare.prints.listings.signAndPublish(preparation)` to sign and publish the frozen
terms. This helper checks the chain, configured Cart contract, seller, and Listing
digest before requesting the wallet signature.
NFT transfer fulfillments require Cart collection approval. A missing approval
raises `NftApprovalRequiredError` before the signature request. Pass
`{ autoApprove: true }` as the second argument to explicitly authorize the existing
Cart approval flow. The SDK verifies NFT ownership first and returns
`approvalTxHash` when it submits an approval. If signing or publication fails after
approval, `ApprovalSideEffectError` identifies the approval that remains active.

Use `rare.prints.drops.update` for presentation edits. Production file and
specification changes are allowed only before pricing is configured. Later
physical changes require a new drop and SKU so existing signed terms stay intact.

Purchases use `rare.cart.checkout`. Add `delivery: { savedAddressId }` or
`delivery: { recipientDetails }` to the usual checkout intent. The returned
preparation includes an idempotency key and an optional price breakdown. Retain
that preparation for retries. `purchase({ preparation })` submits the delivery
draft through generic Cart checkout. `rare.cart.checkout.coinflow` prepares a card
session without a separate print payment flow.

Saving an address is a separate, explicit operation. Use
`accountClient.shippingAddresses.list`, `save`, and `delete`. Checkout does not
implicitly save delivery details. `save` accepts an address UUID and `makeDefault`
to create or replace an entry and select the default.

`accountClient.orders.list` returns `{ data, nextCursor }` for account-owned
fulfillment Orders. `orders.get(cartOrderId)` returns payment and fulfillment
status without private address data. A fulfillment status of `COMPLETED` means
the provider accepted the order, not that the item shipped or arrived. These
methods do not include legacy NFT purchase history.

Run `npm run test:integration:prints` against a non-production feature deployment.
The test requires `RARE_ACCOUNT_TEST_API_URL` or `RARE_API_BASE_URL`, plus a registered
test account in `RARE_ACCOUNT_TEST_PRIVATE_KEY` or `E2E_SELLER_PRIVATE_KEYS`. It saves
and removes a fixture address, uploads reusable images, publishes and archives a
test Listing, and quotes delivery. It prepares an idempotent unpaid Cart order
but does not send a payment or submit a physical order.

The focused commerce OpenAPI types come from the backend source document. Regenerate
them with `npm run generate:commerce-types -- /path/to/openapi.json`. Keep these
types separate from the existing generated discovery types to avoid unrelated
schema changes while the API migration is in progress.

## Development and releases

Use Node 22 or newer and install the lockfile with `npm ci`. Before opening a
pull request or preparing a release, run:

```bash
npm run typecheck
npm run lint
npm test
npm run docs:build
npm run package:check
```
