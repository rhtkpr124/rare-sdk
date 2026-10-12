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

## Usage

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

Subpath exports mirror the ones previously published by the CLI package:

| Import | Contents |
| --- | --- |
| `@rareprotocol/rare-sdk` (or `./client`) | `createRareClient` + SDK namespaces |
| `@rareprotocol/rare-sdk/contracts` | contract addresses + ABIs per chain |
| `@rareprotocol/rare-sdk/utils` | public helpers |

## Regenerating the Rare API types

Generate endpoint and response types from the production Rare API:

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

For all-chain discovery, use the standalone API client and omit `chainId`:

```ts
import { createRareApi } from '@rareprotocol/rare-sdk/api';

const api = createRareApi();
const editions = await api.searchLiquidEditions({ query: 'generative' });
const edition = await api.getLiquidEdition('1-0x1234567890123456789012345678901234567890');
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
`createRareClient`, or `baseUrl` on `createRareApi`, to use another deployment.

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

`createRareAccountClient` exposes account operations without an RPC connection or
transaction wallet. All requests use one public API base URL. Rare API forwards
`/auth/v2` login, device, refresh and revocation requests to the existing auth
service; profile requests use `/v1/me`. Legacy SuperRare/Connect cookies and tokens
are not accepted by this client.

Login verifies wallet ownership and stores credentials. It does not create a SuperRare account. Profile operations require an existing account and return `account_required` when signup is needed. Wallet signing operations remain independent of account login.

```ts
import { createRareAccountClient } from '@rareprotocol/rare-sdk';

const account = createRareAccountClient(); // https://api.superrare.com
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
const account = createRareAccountClient({
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
can select a different origin outside a browser. Auth must allow that origin in
its existing `SIWE_ALLOWED_ORIGINS` configuration; browser callers cannot override
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

Sessions default to instance-local memory. Persist them by supplying a
`RareAccountSessionStore`. `withLock` must serialize **all** operations across
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
public `user.get` or `user.resolve` methods. Empty email is rejected. Empty avatar
or `masthead_universal_token_id` strings remove those fields. Bios allow 180 characters.
Account and wallet ownership are not editable through profile updates.

```ts
await account.profile.update({
  email: 'artist@example.com',
  profile: { bio: 'Artist and collector', website: 'https://example.com' },
});
await account.profile.uploadAvatar(imageBytes, 'avatar.png');
await account.profile.update({ profile: { avatar: '', masthead_universal_token_id: '' } });
await rare.user.resolve({ username: 'artist' });
```

Shared application uploads accept any file type up to 20 MiB. `access` selects the public or private bucket and defaults to `public` for compatibility. Public results contain `{ access, key, url, contentType, size }`. Private results contain `{ access, key, contentType, size }`, without a URL:

```ts
const attachment = await account.uploads.upload(bytes, 'document.pdf', { access: 'private', contentType: 'application/pdf' });
```

The associated feature owns authorization for private files. This uploader does not issue download URLs or grant access based on possession of a key. Store the `access` and `key` reference with the feature.

Public upload example:

```ts
const asset = await account.uploads.upload(bytes, 'cover.png', { contentType: 'image/png', access: 'public' });
// asset: { access: 'public', key, url, contentType, size }
await account.profile.update({ profile: { avatar: asset.url } });
```

The uploader uses `POST /v1/uploads`, stores files by SHA-256, and does not edit
profiles or other features. Identical bytes return the same stored object.
Browser callers may pass a `Blob` or `File`; its content type is used by default.
Byte arrays default to `application/octet-stream` unless `contentType` is supplied.
The original URL serves files as attachments. Clients own image transformations
and can apply their own Imgix source or other image service.

Run `npm run test:integration:uploads` manually against a deployed dev API with
`RARE_ACCOUNT_TEST_API_URL` and `RARE_ACCOUNT_TEST_PRIVATE_KEY` configured. This
suite uses real storage and requires authenticated `gcloud` access on
`superrare-dev` to delete its unique test objects from both upload buckets.
It verifies concurrent deduplication, first-writer metadata, public byte-for-byte
downloads, avatar attachment and clearing, unchanged unrelated profile fields,
and HTTP rejection of anonymous, forged, empty, oversized and unexpected-field
requests. Object hashes are registered before requests so cleanup also runs after
an ambiguous upload failure. It also verifies private references, anonymous download
denial, separate bucket storage, and private cache metadata. The dev API must use
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
await rare.user.resolve({ userId: 123 });
await rare.user.followers({ username: 'artist' }, { page: 1, perPage: 20 });
await rare.user.following({ address: '0x...' });
await account.following.follow({ userId: 123 });
await account.following.unfollow({ username: 'artist' });
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
await account.favorites.add(id);
await account.favorites.has(id); // boolean
await account.favorites.list({ page: 1, perPage: 20 });
await account.favorites.remove(id);
await rare.nft.favoriteCount({ contract: '0xb932a70a57673d89f4acffbe830e8ed7f75fb9e0', tokenId: 12345 });
```

`account.favorites.add`, `remove`, and `has` also accept `{ chainId, contract, tokenId }`.
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

After authenticating with `createRareAccountClient`, use the account's identity for writes:

```ts
const post = await account.posts.create({ title: 'Studio update', body: '**New work**', imageUrls: [] });
const comment = await account.posts.comment(post.id, 'Looking forward to this.');
await account.postFavorites.add(post.id);
const favorites = await account.postFavorites.list({ page: 1, perPage: 20 });
const favorited = await account.postFavorites.has(post.id);
await account.postFavorites.remove(post.id);
await account.posts.deleteComment(post.id, comment.id);
await account.posts.delete(post.id);
```

Image URLs can come from `account.uploads.upload`; posts do not add another uploader.
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
const image = await account.uploads.upload(bytes, 'cover.png', { contentType: 'image/png' });
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
