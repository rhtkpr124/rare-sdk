# SuperRare website, SDK and CLI feature parity

Historical planning snapshot. Current SDK construction and authentication are documented in the repository README.

Source snapshot: 2026-09-30. This inventory includes the current open account-auth branches. Coverage describes public high-level SDK methods and registered CLI commands. It does not establish release status or successful live parity testing.

40 distinct capability rows. Screens, entry points and format variants share a row when they implement the same capability. Public reads and authenticated writes stay together, with their access differences shown in the table. The source evidence retains the detailed procedure and route audit.

## How to read the table

- Exposed means the capability has SDK methods or CLI commands. Website format/version parity remains a verification task for contract operations.
- Partial means only part of the website workflow exists. Missing means no intended high-level SDK/CLI workflow was found. Generic HTTP calls, ABIs and internal exports do not count as completion.
- Public means no account session is required for that action. Public reads and authenticated writes are identified separately in mixed rows.
- Message means wallet identity or shipping proof. Transaction means a blockchain signature. Account authentication never grants transaction-signing authority.
- Off-chain indexed reads can display on-chain information. Mixed flows combine private data or server work with ownership/receipt verification.
- Chain operations need the relevant wallet/contract authority. Website pages may additionally require a site session for uploads, creator eligibility or private UI data. Flags and production enablement were not tested.

## Feature matrix

| ID | Capability | Chain | Public | Wallet signature | Account sign-in | SDK today | CLI today |
|---|---|---|---|---|---|---|---|
| C01 | Account sign-in and session lifecycle | Off-chain | Sign-in flow | Message or hosted provider | Session lifecycle | Partial | Partial |
| C02 | Own profile and settings | Off-chain | No; username availability can be public | No | Yes | Partial | Partial |
| C03 | Public profiles and profile tabs | Off-chain indexed reads | Yes | No | No | Partial | Partial |
| C04 | Following users | Off-chain | Public lists/status | No | Writes | Missing | Missing |
| C05 | Artwork favorites | Off-chain | Public favorites; own status private | No | Writes/own status | Missing | Missing |
| C06 | Creator posts | Off-chain | Reads | No | Writes | Missing | Missing |
| C07 | Comments and replies | Off-chain | Reads | No | Writes | Missing | Missing |
| C08 | Post and comment likes | Off-chain | Existing liker helpers require session | No | Writes/liker lists | Missing | Missing |
| C09 | Artwork collaborations | Off-chain | Accepted artwork collaborations | No | Invites/actions/private reads | Missing | Missing |
| C10 | Drop announcements and calendar | Off-chain with eligibility reads | Reads | No | Writes | Missing | Missing |
| C11 | Live chat | Off-chain; chain evidence for system events | Reads | No for text; receipt proof for system event | Writes | Missing | Missing |
| C12 | Notifications and preferences | Off-chain | No | No | Yes | Missing | Missing |
| C13 | Discovery and search | Off-chain indexed/CMS reads | General reads | No | Following filters | Partial | Partial |
| C14 | Platform and following activity | Off-chain indexed reads | General activity | No | Following activity | Partial | Partial |
| C15 | Leaderboards | Off-chain indexed reads | Yes | No | No | Missing | Missing |
| C16 | Editorial and curated content | Off-chain CMS | Yes | No | No | Missing | Missing |
| C17 | Artwork details and metadata refresh | Mixed reads; off-chain refresh | Detail/status reads | No | Metadata refresh | Partial | Partial |
| C18 | Share links and images | Off-chain | Yes | No | No | Hosted/external handoff | Hosted/external handoff |
| C19 | Collection details and profile editing | Off-chain indexed reads/writes | Reads | No | Owner writes | Partial | Partial |
| C20 | External collection import management | Mixed contract validation/indexing | Discovery depends on caller | No | Yes | Partial | Partial |
| C21 | Account dashboard and market inventory | Off-chain indexed reads | No | No | Yes | Partial | Partial |
| C22 | Liquid edition detail and market data | Mixed public reads | Yes | No | No | Partial | Partial |
| C23 | Create collections, artwork and editions | Mixed uploads, mint/deploy and indexing | No for creation | Transaction | Server uploads/publishing | Partial | Partial |
| C24 | Configure and mint releases | Mixed public data and chain writes | Release/proof reads | Transaction | Private creator/upload data | Partial | Partial |
| C25 | Physical artwork details and consent | Mixed off-chain metadata and ownership reads | Safe public fields | Transaction only for underlying mint/buy | Creator updates/private owner details | Partial | Partial |
| C26 | Print purchasing and fulfillment | Mixed shipping, mint and fulfillment | No | Message plus mint transaction | Yes | Missing | Missing |
| C27 | Hosted card purchasing | Mixed hosted provider/chain settlement | Eligible listing information public | Provider-dependent | Hosted checkout session | Partial | Partial |
| C28 | Listings and purchases | On-chain | Status reads | Transaction | No for chain operation | Partial | Partial |
| C29 | Offers | On-chain | Status reads | Transaction | No for chain operation | Partial | Partial |
| C30 | Auctions | On-chain | Status reads | Transaction | No for chain operation | Exposed; parity verification pending | Exposed; parity verification pending |
| C31 | Collection royalties and on-chain metadata | On-chain | Reads | Transaction | No for chain operation | Exposed; parity verification pending | Exposed; parity verification pending |
| C32 | Token trading and swaps | On-chain and quote reads | Quotes | Transaction | No for chain operation | Exposed; parity verification pending | Exposed; parity verification pending |
| C33 | RARE bridging | On-chain | Quotes | Transaction | No for chain operation | Exposed; parity verification pending | Exposed; parity verification pending |
| C34 | NFT transfer and burn | On-chain with index reconciliation | No | Transaction | No for chain operation | Missing | Missing |
| C35 | Wallet payments and spending approvals | On-chain | Public balance/approval reads | Transaction | No for chain operation | Partial | Partial |
| C36 | Wallet linking | Off-chain identity proofs | No | Ownership message | Yes | Missing | Missing |
| C37 | Privileged collection and drop administration | Mixed authenticated policy and contract writes | No | Transaction for contract edits | Explicit authorized role | Missing | Missing |
| C38 | Sales attribution analytics and export | Off-chain/internal tools | Inspected reads have no established guard | No | Policy needs confirmation | Missing | Missing |
| C39 | External links and wallet-provider handoffs | Off-chain/provider | Public external links | Provider-dependent | Provider-dependent | Hosted/external handoff | Partial |
| C40 | Creator inquiries | Off-chain | No | No | Yes if active | Missing | Missing |

## Proposed interfaces

This section is a design proposal, not an implemented or approved API contract. Every capability has an interface disposition below, including explicit reuse and browser handoffs. Excluded or unverified items appear separately. Current SDK/CLI exposure stays in the preceding matrix.

### Ownership and compatibility

Rare API owns account authorization, privacy, product eligibility and off-chain workflows. It reuses existing GraphQL operations and field names. The SDK owns typed calls and wallet transaction orchestration. The CLI wraps those SDK methods. Contract reads and writes continue through the existing RPC clients; this proposal does not add REST endpoints for every blockchain method.

Keep `/auth/v2` as the auth-service passthrough, including existing device authorization, wallet challenge, token and revoke routes. Keep `/v1/me` for private account data and settings. Public posts, comments, drop announcements, NFTs and collections use resource routes under `/v1`, even when their writes require authentication. A collection's off-chain description/banner update is distinct from its on-chain URI or royalty transaction.

Keep existing SDK namespaces and commands. Extend `user.get`, `collection.get`, `search.*`, `account.profile.*` and marketplace methods rather than renaming them. In this table, `rare` means the existing `createRareClient` result and `account` means the existing `createRareAccountClient` result. SDK cells without an `account.` prefix are members of `rare`. New namespaces use the existing website domain names, including `dropAnnouncements`, `collaborations` and `notifications`.

Proposed authenticated resource methods on `rare`, such as `rare.posts.create`, receive an optional authenticated-request provider from `account`. Public methods do not require it. The provider owns refresh and storage locking and binds requests to its configured Rare API origin. It attaches credentials only to that origin. It never provides a blockchain signer. Preserve the existing `RareClientConfig.account` wallet-address option; do not overload it with an account-session object. The unified client receives `sessionStore` for SDK-managed authentication or `transport` for application-managed sessions; no separate account client is needed. Allow construction without an RPC client for API-only operations; methods that require a chain return a typed configuration error. This is an additive follow-up, not a requirement to restructure existing transaction methods now.

Private account methods remain on `account`. Domain actions such as `posts.create` do not get duplicate `account.posts.create` aliases. Resource reads accept explicit target identifiers; mutations derive the acting account from the bearer session. User-supplied author/account IDs cannot substitute for that identity.

### Shared request and response rules

- Preserve existing published response shapes, IDs, field names and pagination. New list routes use `{ items, nextCursor }` with `limit` and opaque `cursor`; document adapters for older list shapes rather than breaking them.
- `{id}` for existing NFT and collection routes retains the existing universal identifier format. Posts, comments, collaboration invitations, uploads and fulfillment orders retain their domain IDs. Chain transaction parameters continue to carry chain and contract/token identity.
- PATCH omits unchanged fields. Clearing fields follows the website's existing representation for each field. Do not introduce generic `clearMetadataKeys`, arbitrary metadata writes or unsupported null semantics.
- New errors use stable codes, HTTP status and optional request ID. Retain existing auth protocol errors. Reads return no private fields by default. Own email is allowed in `/v1/me`; shipping and order data are available only to the authorized buyer or existing permitted role.
- New create workflows that can duplicate posts, uploads, announcements, checkout intents or print orders accept an `Idempotency-Key`. Scope keys to caller and operation, reject changed payload reuse, and define retention per resource. A retried transaction submission must not silently sign a second transaction.
- Upload initiation returns an upload ID and transport instructions. Completion validates ownership, content limits and media type. Use the existing upload transport where possible; do not create a second media store.
- CLI writes accept `--stdin` or `--file` structured bodies. Lists accept `--limit` and `--cursor`; support JSON output and explicit export paths. Existing option names remain valid. Auth credentials and private shipping data must not appear in routine logs.
- Creator, collaborator, holder, feature administrator and contract-owner checks preserve existing product rules. Staff-labelled routes do not inherit permission merely from `/admin`; define the policy before exposing those tools.
- Hosted social sign-in, card payment and wallet-provider UI return a URL plus workflow ID/status where appropriate. SDK and CLI support wait, cancel, expiry and resume. Browser permissions, payment-provider interaction and social composers remain browser actions.

### Capability interfaces

Each capability maps to shared interfaces. Format-specific methods are retained where contracts differ; they do not create separate feature tasks. Browser and privileged capabilities have explicit dispositions.

| ID | Capability | Proposed Rare API | Proposed SDK | Proposed CLI |
|---|---|---|---|---|
| C01 | Account sign-in and session lifecycle | Existing /auth/v2/device/authorization, /wallet/challenge, /token, /revoke; provisioning inside successful login only | account.auth.* | auth login/status/logout |
| C02 | Own profile and settings | GET/PATCH /v1/me; avatar upload initiation/completion; PUT/DELETE /v1/me/masthead; username availability read | account.profile.*; add avatar, social links and masthead support | profile get/update; avatar/masthead/check-username |
| C03 | Public profiles and profile tabs | Keep GET /v1/users/{address}; add username lookup through GET /v1/users?username=; GET /v1/users/{address}/stats; GET /v1/users/{address}/{collection,creations,collections,liquid-editions,activity,collected-artists,collectors}; GET /v1/users/{address}/highlights | user.get/resolve/stats; profile collection, creations, activity and highlights | user get/resolve/stats and profile-tab reads |
| C04 | Following users | GET followers/following and follow status; PUT/DELETE /v1/users/{address}/followers/me | user.follow/unfollow/followers/following | user follow/unfollow/followers/following |
| C05 | Artwork favorites | PUT/DELETE /v1/nfts/{id}/favorites/me; GET /v1/me/favorites/{id}; GET /v1/users/{address}/favorites | nft.favorite/unfavorite; user.favorites | nft favorite/unfavorite; user favorites |
| C06 | Creator posts | GET/POST /v1/posts; GET/PATCH/DELETE /v1/posts/{id}; post-image upload initiation/completion | posts.list/get/create/update/delete/uploadImage | posts list/get/create/update/delete; image upload |
| C07 | Comments and replies | GET/POST /v1/posts/{postId}/comments; GET/DELETE /v1/comments/{commentId}; parentId and mention IDs in create body | posts.comments.list/create; comments.get/delete | posts comments list/create; comments get/delete |
| C08 | Post and comment likes | PUT/DELETE /v1/posts/{postId}/likes/me; PUT/DELETE /v1/comments/{commentId}/likes/me; GET respective /likes | posts.like/unlike/likes; comments.like/unlike/likes | posts/comments like/unlike/likes |
| C09 | Artwork collaborations | /v1/collaborations reads/invite/cancel/accept/decline/visibility; private invitation lists under /v1/me | collaborations.*; account.collaborations.list; nft.collaborations | collaborations list/get/invite/cancel/accept/decline/visibility |
| C10 | Drop announcements and calendar | GET/POST /v1/drop-announcements; GET/PATCH/DELETE /v1/drop-announcements/{id}; image uploads; private creator permission | dropAnnouncements.list/get/create/update/delete/uploadImage | drop-announcements list/get/create/update/delete; image upload |
| C11 | Live chat | GET/POST messages under artwork and announcement resources; verified transaction-message endpoint for artwork rooms | dropAnnouncements.messages.*; nft.messages.* | drop-announcements chat; nft chat |
| C12 | Notifications and preferences | /v1/me/notifications list/unread/read-state; /v1/me/notification-preferences; browser-push subscription lifecycle | account.notifications.* | notifications list/read/read-all/preferences; browser push handoff |
| C13 | Discovery and search | Existing /v1/nfts, /collections, /liquid-editions; add users/unified search and optional homepage aggregate | search.*; discovery.homepage | search nfts/collections/liquid-editions/users/all; discover homepage |
| C14 | Platform and following activity | GET /v1/activity; GET /v1/me/activity/following; retain existing NFT/collection event routes | discovery.activity; account.activity.following; search.events | activity list/following; search events |
| C15 | Leaderboards | GET /v1/leaderboards/{artists,collectors,series}; GET /v1/users?role=artist&sort= | discovery.leaderboards | leaderboards artists/collectors/series |
| C16 | Editorial and curated content | GET /v1/editorials, /exhibitions, /curated-releases, /learning; GET item routes; external static legal/help URLs | content.list/get | content list/get --kind |
| C17 | Artwork details and metadata refresh | Existing /v1/nfts/{id} and events; related/exhibition reads; authenticated metadata refresh; live contract status via RPC | nft.get/related/exhibition/refreshMetadata; marketplace status methods | nft get/related/exhibition/refresh-metadata; marketplace status |
| C18 | Share links and images | GET /v1/drop-announcements/{id}/share-image?format=; canonical URL in resource; Canonical artwork URL in NFT response; GET /v1/nfts/{id}/share-image | nft.shareImage; dropAnnouncements.shareImage; canonical URLs | nft share; drop-announcements share |
| C19 | Collection details and profile editing | Existing /v1/collections/{id}; extend detail subresources; PATCH profile fields; banner upload lifecycle | collection.get/artworks/activity/offers/patrons/mintProgress/updateProfile/uploadBanner | collection get/artworks/activity/offers/patrons/mint-progress; profile update |
| C20 | External collection import management | DELETE /v1/collections/{id}/import, remove only import/index association; Keep POST /v1/collections/import; add GET /v1/me/importable-collections, POST /v1/collections/import/validation; GET /v1/me/artworks?purpose=sell | import.erc721/erc1155/discover/validate/remove | import erc721/erc1155/discover/validate/remove |
| C21 | Account dashboard and market inventory | GET /v1/me/dashboard; GET /v1/me/{offers,auctions,listings,collections}, filters for direction/state | account.dashboard.get; account.offers/auctions/listings/collections.list | dashboard; offer/auction/listing/collection list |
| C22 | Liquid edition detail and market data | Keep /v1/liquid-editions/{id}; GET /prices, /trades, /holders, /render-tokens; RPC reads remain SDK where appropriate; Keep /v1/tokens/price/{symbol}; GET /v1/currencies/rates for website conversion data | liquidEdition.* reads; token.getPrice; currency.rates | liquid-edition status/history/trades/holders/render-tokens; currencies rates |
| C23 | Create collections, artwork and editions | Existing media/metadata/import routes; bundle preparation only if absent; private creator permission; verified creations publish/status; deploy/mint via RPC | Existing collection.deploy/mint/ERC1155, liquidEdition.deploy, media/IPFS; creations.publish/status | Existing deploy/mint/ipfs; create prepare/publish/status |
| C24 | Configure and mint releases | Existing collection/legacy-series/proof/media routes; private release-contract and commission reads; allowlist artifacts where needed; configure/mint via RPC | Existing listing.release and ERC1155 release/allowlist/limits; media bundle and release discovery | Existing listing release and ERC1155 release; creator release discovery/preparation |
| C25 | Physical artwork details and consent | Public /v1/nfts/{id}/physical-metadata; creator updates/uploads; private /v1/me/nfts/{id}/physical-details; accepted consent version on publication/checkout | nft.physical.get/update/uploadMedia; account.physical.get | nft physical get/private/update/media upload |
| C26 | Print purchasing and fulfillment | POST /v1/print-orders/destination-validation; mint through RPC, shipping proof in fulfillment intent; POST /v1/print-orders/intents; POST /v1/print-orders; GET /v1/print-orders/{id}, scoped to caller | printOrders.purchase/get/resume; advanced validation/intent/submit methods | print-orders purchase/status/resume; advanced validate/arm/submit |
| C27 | Hosted card purchasing | Reuse /v1/connect/intents and checkout endpoints; extend eligible listing/mint modes, preserve provider handoff | checkout.create/get/wait | listing buy-card; release mint-card; checkout status/resume |
| C28 | Listings and purchases | Existing indexed NFT/collection and Merkle data; direct wallet RPC for listing/buy operations; no new REST transaction routes | Existing listing.*, batch and ERC1155 methods and parameters | Existing listing commands and options |
| C29 | Offers | Existing indexed offer/Merkle data; direct wallet RPC; no new REST transaction routes | Existing offer.*, batch and ERC1155; createMany only if needed | Existing offer commands; create-many only if needed |
| C30 | Auctions | Existing indexed auction/Merkle data; direct wallet RPC; no new REST transaction routes | Existing auction.* and auction.batch.* | Existing auction commands |
| C31 | Collection royalties and on-chain metadata | Direct wallet RPC; no new REST transaction routes | Existing collection royalty/URI methods and liquidEdition.setRenderContract | Existing collection royalty/metadata and liquid-edition set-render-contract |
| C32 | Token trading and swaps | Existing discovery and quote-provider paths; direct wallet execution | Existing swap.* | Existing swap commands |
| C33 | RARE bridging | Quote/send through existing RPC bridge path | Existing bridge.quote/send | Existing bridge quote/send |
| C34 | NFT transfer and burn | Direct wallet RPC; explicit index refresh only if existing indexing requires it | nft.transfer/burn | nft transfer/burn |
| C35 | Wallet payments and spending approvals | Direct wallet RPC; no REST transaction routes | wallet.send; wallet.approvals.get/set/revoke | wallet send; wallet approvals get/set/revoke |
| C36 | Wallet linking | POST /v1/me/wallets/challenges; POST /v1/me/wallets with ownership proof; GET /v1/me/wallets | account.wallets.challenge/link/list | account wallets link/list |
| C37 | Privileged collection and drop administration | GET /v1/me/permissions; PATCH /v1/admin/drop-announcements/{id}/editorial; collection contract edits via RPC | admin.dropAnnouncements.updateEditorial; account.permissions.get; collection.setCreator/shared royalty methods | admin drop-announcements editorial; admin collection set-creator; auth permissions |
| C38 | Sales attribution analytics and export | Conditional /v1/admin/sales-attribution read routes with explicit access policy; export and local assumptions stay client-side | admin.salesAttribution.*; client export helper | admin sales-attribution query/export |
| C39 | External links and wallet-provider handoffs | No new backend by default; existing canonical links and provider handoffs | links.get and existing wallet/chain configuration | open help/apply/newsletter/legal/buy-crypto; configure |
| C40 | Creator inquiries | Conditional POST /v1/creator-inquiries with kind=digital-curation or physical-partnership, only if confirmed active | Conditional creatorInquiries.create | Conditional create inquiry |

### Complete SDK workflows

Use a small number of complete workflows for actions that require ordering across services. Keep their lower-level operations for advanced callers and recovery, but make the complete workflow the documented default.

- `printOrders.purchase` validates shipping, obtains the required ownership/recipient proof, arms the fulfillment intent, executes the supported mint, verifies the receipt and submits the order. Return the intent/order ID and transaction hash. `printOrders.resume` accepts those identifiers and completes unfinished server work without submitting another mint.
- `creations.publish` completes the existing upload/metadata and verified indexing handoff. Contract deployment or mint remains an explicit wallet operation or a supported orchestration option. Status includes completed stages and the next action; it never treats a submitted transaction as a successful mint.
- `checkout.create/get/wait` handles the hosted payment workflow. Persist the returned checkout ID so the CLI can resume after closing. The payment provider retains payment entry and approval.
- Domain methods use the same authenticated-request provider. Callers do not copy bearer tokens, implement refresh, or translate authentication failures separately for each resource.

Pure validation and request/transaction planning stay separate from HTTP, storage, RPC and browser effects. The CLI contains argument parsing, formatting and process interaction, not a second implementation of profile permissions or purchase sequencing.

### Representative calls

These examples show proposed additions. Existing signatures and request schemas remain authoritative until implementation. Types for post bodies, mentions, images, notification categories and collection profiles should reuse existing domain types rather than introduce parallel names.

```ts
const rare = createRareClient({ apiBaseUrl, sessionStore, publicClient, walletClient });

// Public reads do not require account login.
await rare.posts.list({ author: address, limit: 20, cursor });
await rare.posts.get({ postId });

// The authenticated-request provider supplies the actor's session.
await rare.posts.create({ title, body, images, idempotencyKey });
await rare.posts.comments.create({ postId, body, parentId, mentions });
await rare.user.follow({ address });
await account.notifications.updatePreferences(preferences);
await rare.collection.updateProfile({ id: collectionId, description, banner });

// Existing wallet transaction authority stays independent of account login.
await rare.listing.buy(existingListingBuyParams);
await rare.nft.transfer({ chainId, contract, tokenId, to, quantity });
```

```sh
rare posts list --author 0x... --limit 20 --json
rare posts create --file post.json --json
rare posts comments create --post POST_ID --file comment.json --json
rare user follow --address 0x...
rare notifications preferences update --file preferences.json
rare collection profile update --id COLLECTION_ID --file collection-profile.json
rare nft transfer --chain ethereum --contract 0x... --token-id 123 --to 0x...
```

Proposed server request examples:

```http
POST /v1/posts
Authorization: Bearer <access-token>
Idempotency-Key: <client-generated-key>
Content-Type: application/json

{ "title": "Studio update", "body": "...", "images": [] }
```

```http
PATCH /v1/collections/<collection-id>
Authorization: Bearer <access-token>
Content-Type: application/json

{ "description": "...", "banner": "<validated-upload-url>" }
```

The collection PATCH changes only supplied off-chain profile fields. It does not change token ownership, royalties or on-chain metadata. The server derives the acting account from the session and applies existing owner permissions.

### Decisions retained for implementation

- `/v1/drop-announcements` names the existing calendar/announcement resource. A future mintable drop or release uses its existing collection/release contract model; the announcement API does not become a second minting API.
- Full website parity does not require a new endpoint for every screen. Homepage panels, dashboard aggregates and profile tabs can reuse resource lists or a small aggregate query. Add an aggregate only where pagination, privacy or efficient retrieval requires it.
- Profile/avatar clearing, upload transport, creator-post body representation and notification keys must match existing website schemas. The proposal specifies ownership and routes; implementation must confirm payload details against those schemas.
- Private fulfillment, card checkout and creator publishing need recoverable workflow IDs. Account creation occurs only after a successful lookup explicitly reports absence. Network errors and ambiguous reads remain errors.
- Lens-specific mint/allowlist compatibility, inactive inquiry routes, staff analytics access and unverified fee/redemption actions remain verification tasks. No speculative fee-claim, standalone unrender or general redemption API is proposed.

## Task list

One task per capability. Each includes its supported formats and entry points, rather than separate tasks for each screen. Existing exposure still needs website-parity verification.

- [ ] **C01 Account sign-in and session lifecycle**. Complete wallet/email/social login, refresh, logout and safe first-login provisioning; wallet management remains hosted.
- [ ] **C02 Own profile and settings**. Extend the existing profile contract to all website fields, avatar upload and masthead; reuse existing clearing and validation behavior.
- [ ] **C03 Public profiles and profile tabs**. Complete public profile fields, identity resolution and profile lists with pagination; exclude private email.
- [ ] **C04 Following users**. Add follow management and public lists/status; notification follow-back uses the same follow operation.
- [ ] **C05 Artwork favorites**. Add favorite management and list/status reads.
- [ ] **C06 Creator posts**. Add public reads, owner writes and image uploads as one post capability.
- [ ] **C07 Comments and replies**. Add comments, replies, mentions and deletion with existing permissions.
- [ ] **C08 Post and comment likes**. Add existing like semantics for posts and comments.
- [ ] **C09 Artwork collaborations**. Add the collaboration lifecycle and visibility; preserve participant permissions.
- [ ] **C10 Drop announcements and calendar**. Add announcements, creator permission, uploads and calendar filters; this is distinct from mintable releases.
- [ ] **C11 Live chat**. Use shared chat behavior for announcement and artwork rooms; verify receipts before recording bid/trade messages.
- [ ] **C12 Notifications and preferences**. Add inbox, unread state, preferences and subscription lifecycle; browser permission stays in browser.
- [ ] **C13 Discovery and search**. Match website search, browse filters, sort and pagination; reuse lists for homepage panels where possible.
- [ ] **C14 Platform and following activity**. Add complete platform/following activity using existing event data.
- [ ] **C15 Leaderboards**. Add artist, collector and series rankings and filters.
- [ ] **C16 Editorial and curated content**. Expose editorials, exhibitions, curated releases and learning content with existing content types.
- [ ] **C17 Artwork details and metadata refresh**. Complete detail/context reads and authenticated refresh; distinguish indexed from live chain state.
- [ ] **C18 Share links and images**. Use one share convention for artworks and announcements; social composer stays external.
- [ ] **C19 Collection details and profile editing**. Extend collection details and owner description/banner updates; no new account model.
- [ ] **C20 External collection import management**. Complete import validation, ownership checks, supported formats and removal without burning assets.
- [ ] **C21 Account dashboard and market inventory**. Use complete account queries for stats and market inventory rather than incomplete search projections.
- [ ] **C22 Liquid edition detail and market data**. Complete history, holders, ledger, render inventory and currency conversion reads.
- [ ] **C23 Create collections, artwork and editions**. Cover website formats and media/CSV preparation with existing mint/deploy methods; complete verified publish/index handoff.
- [ ] **C24 Configure and mint releases**. Reuse release mint/configuration methods; verify legacy and Liquid Lens compatibility, proof retrieval and preparation.
- [ ] **C25 Physical artwork details and consent**. Complete physical publishing, private details and versioned consent; reuse underlying mint/buy.
- [ ] **C26 Print purchasing and fulfillment**. Provide one recoverable purchase workflow; never remint when retrying fulfillment.
- [ ] **C27 Hosted card purchasing**. Complete eligible buy/mint modes through hosted checkout and recovery.
- [ ] **C28 Listings and purchases**. Verify format/version/chain parity, buyer restrictions, splits and batch allowlists; preserve existing interfaces.
- [ ] **C29 Offers**. Verify token, collection, multiple-offer and edition semantics; reuse batch methods where equivalent.
- [ ] **C30 Auctions**. Verify reserve, scheduled and batch auction lifecycle across website-supported contracts.
- [ ] **C31 Collection royalties and on-chain metadata**. Verify website contract support without duplicating off-chain profile edits.
- [ ] **C32 Token trading and swaps**. Verify supported token/currency routes, fees, slippage and recipients.
- [ ] **C33 RARE bridging**. Verify website-supported bridge routes and receipt/status behavior.
- [ ] **C34 NFT transfer and burn**. Add token-standard-aware transfer/burn; verify receipts and indexing.
- [ ] **C35 Wallet payments and spending approvals**. Add send/approval management, reuse automatic approval implementation; confirm website revoke UI before claiming parity.
- [ ] **C36 Wallet linking**. Planned requirement: confirm account-linking behavior and add proof-based linking without merging unrelated accounts.
- [ ] **C37 Privileged collection and drop administration**. Retain explicit role and contract permissions; reuse ordinary collection methods.
- [ ] **C38 Sales attribution analytics and export**. Confirm access policy; combine query, filters, export and local commission assumptions into one tool capability.
- [ ] **C39 External links and wallet-provider handoffs**. Use external/hosted destinations; do not build duplicate newsletter, wallet-provider or legal-content systems.
- [ ] **C40 Creator inquiries**. Confirm active product UI before adding digital/physical inquiry endpoints.

## Delivery order and acceptance criteria

1. Finish account settings parity, public profile/user discovery, follows and favorites. Reuse the existing GraphQL/database operations behind Rare API. Keep private account identity and authorization in Rare API.
2. Add posts, images, comments/replies/mentions and likes. Use public resource reads and authenticated writes. Do not infer artist-only rules from a feature name; preserve the actual product policy.
3. Add notification inbox/read state/preferences and collaboration invitation workflows, then drop announcements/chat and creator dashboards.
4. Add collection off-chain editing/import management, creator publishing/media preparation, physical/private metadata and print fulfillment.
5. Close chain gaps and verify all existing transaction formats. Match each website-supported contract/version/chain, currency, amount, recipient, splits, allowlist, approvals and failure/recovery behavior.
6. Decide browser/external and privileged features explicitly. Hosted card checkout and social login can be complete workflows through a supported browser handoff. Developer previews and telemetry are excluded. Registered inquiry endpoints with redirected pages need an active-product decision.

For each product task:

- Reuse the existing domain operation and naming; add a Rare API route only where needed. Public resources belong under resource routes; private account settings belong under /v1/me. Avoid parallel overlapping account implementations.
- Add a typed SDK operation and a thin CLI wrapper with structured output, pagination and usable errors. Mark partial methods complete only after all listed subactions work.
- Run SDK integration tests and CLI end-to-end tests against deployed or disposable real services. These are manually runnable, outside current CI.
- For private writes, verify unauthenticated, expired/revoked and different-account attempts fail without changing state. Verify owner/creator/role restrictions and uploaded-file ownership. Reads must not disclose another account email, shipping address or other private data; own email remains allowed.
- For chain writes, verify receipts and resulting state, wrong chain/owner/allowlist rejection, failed/cancelled transactions, repeat execution and index visibility. Use isolated funded test wallets and reversible data or cleanup.
- Test browser handoffs through completion, cancellation, expiry and recovery. Store no secrets in CLI output.

## Outside the capability backlog

These items remain in the source evidence, but do not inflate the feature checklist:

- Transient watcher count/heartbeat: browser behavior, outside durable capability completeness.
- Lifecycle analytics: internal instrumentation, not a user feature.
- Developer previews/catalog: development tooling, not a product feature.
- Fee claims, standalone render/unrender and general physical redemption: not verified as website actions. Investigate before adding scope.

Consolidation includes notification follow-back under following users, post image uploads under posts, inbox/read-state/preferences under notifications, and format variants under listings, offers, auctions, creation and releases. The CSV's `source_inventory_ids` column maps each capability to the original audit rows, so source coverage remains traceable.

## Coverage limits and source evidence

This is an exhaustive source audit baseline, not a claim that every registered endpoint is active in production. Feature flags, permissions and conditional UI affect availability. The following evidence separates user actions from backend-only procedures, aliases, privileged controls and development pages.

- [Website actions, exact procedures, caller references and route ledger](feature-inventory-evidence/website.md)
- [SDK namespace definitions, complete registered CLI commands and lower-level export audit](feature-inventory-evidence/sdk-cli.md)
- [Physical fulfillment, Lens, wallet-provider and privileged action evidence](feature-inventory-evidence/edge-features.md)
- [Page/HTTP/tRPC file source index](superrare-feature-source-index.csv)
- [Capability matrix, proposed interfaces and task CSV](superrare-feature-parity.csv)

Source roots and revisions:

- Website: /Users/keeganead/.codex/worktrees/fc3b/superrare-monorepo, bd7d02105d32d20e9cc7b0af1bd4a961c081eac5.
- SDK: /Users/keeganead/.codex/worktrees/bdb5/rare-sdk, 69f0aac690a0d8e2c34f5740cfe2158ee0d9e810.
- CLI: /Users/keeganead/.codex/worktrees/d46f/rare-cli, a69a66bb8a5c580bb30736762f1ea7ed78c96221.

The evidence uses S/ for services/superrare-com/src/ and T/ for its app/api/trpc/[trpc]/ directory. Paths are relative to the source roots above.

### Matrix row sources

| ID | Website sources | Scope |
|---|---|---|
| C01 | S/services/auth/{post-auth-challenge,post-login,refresh,post-logout}.ts; S/config/stateful-auth-wagmi-adapter.ts; S/components/header/user-menu.tsx; S/components/auth/embedded-profile-bootstrap.tsx:EmbeddedProfileBootstrap; S/components/header/user-menu.tsx:418; S/app/settings/components/wallet-mismatch-dialog.tsx | Product |
| C02 | S/app/settings/components/settings-form.tsx:SettingsForm; T/user-settings/update-user/trpc.router.ts:updateUser; S/app/settings/schema.ts:settingsFormSchema; S/app/settings/actions/{is-username-valid,get-user-with-username,get-existing-username-by-address,find-available-auto-username}.ts; S/app/settings/hooks/use-ens-name.ts; S/app/settings/hooks/use-avatar-upload.ts; S/app/api/next/upload-avatar/route.ts; S/app/settings/schema.ts:settingsFormSchema; S/app/settings/utils/build-settings-metadata.ts; S/components/artwork-actions/hooks/use-masthead.ts:useMasthead; T/user-settings/update-user/trpc.router.ts:updateUser | Product |
| C03 | T/profile/get-user-details/trpc.router.ts; T/profile/get-user-stats/trpc.router.ts; S/app/profile/[username]/page.tsx; T/profile/{get-collection,get-creations,get-user-contracts,get-creator-collections,get-liquid-edition-balances,get-liquid-edition-creations,get-activity,get-user-collected-artists,get-user-collectors}/trpc.router.ts; S/app/profile/[username]/highlights/actions.ts:getHighlightsForArtist; S/app/profile/[username]/highlights/page.tsx | Product |
| C04 | T/profile/follow-user/trpc.router.ts:followUser; T/profile/{get-user-followers,get-user-followings,check-is-following}/trpc.router.ts; S/components/notifications/notification-follow-back-button.tsx | Product |
| C05 | T/artwork/{add-favorite,remove-favorite,get-favorite-status}/trpc.router.ts; T/profile/get-favorites/trpc.router.ts | Product |
| C06 | S/app/posts/[postId]/page.tsx; S/app/profile/[username]/posts/page.tsx; T/creator-posts/{list-posts,get-post}/trpc.router.ts; T/creator-posts/{create-post,update-post,delete-post}/trpc.router.ts; S/app/profile/[username]/posts/{new,[postId]/edit}/page.tsx; S/app/api/next/upload-post-image/route.ts | Product |
| C07 | T/creator-posts/{list-comments,get-comment,create-comment,delete-comment}/trpc.router.ts | Product |
| C08 | T/creator-posts/{list-likes,set-like,set-comment-like}/trpc.router.ts; T/creator-posts/utils/require-creator-post-like-viewer.ts | Product |
| C09 | T/collaboration/{invite,cancel-invite}/trpc.router.ts; S/app/profile/[username]/collaborations/page.tsx; T/collaboration/{accept,decline,set-profile-visibility}/trpc.router.ts; T/collaboration/{get-by-id,get-for-collaborator,get-for-inviter,get-pending-invite-for-nft,get-accepted-for-nft}/trpc.router.ts | Product |
| C10 | S/app/drop-calendar/page.tsx; S/app/profile/[username]/drops/page.tsx; T/drop-announcements/{feed,list,archive,get-by-creator,get-by-id}/trpc.router.ts; S/app/[username]/drop/[slug]/page.tsx; S/components/drop-announcements/announcement-actions.tsx; S/app/announce-drop/page.tsx; S/app/announce-drop/schema.ts; T/drop-announcements/{save,remove,get-mine,creator-permission}/trpc.router.ts; S/server/drop-announcements/assert-artist.ts:assertAnnouncementArtist; S/app/api/next/drop-announcement-image/route.ts | Product |
| C11 | T/drop-announcements/chat/trpc.router.ts:dropChatRouter; S/components/drop-announcements/drop-chat.tsx; T/artwork/auction-chat/trpc.router.ts:auctionChatRouter.{getMessages,sendMessage}; T/artwork/auction-chat/trpc.router.ts:auctionChatRouter.{addAuctionBidMessage,addLiquidTradeMessage} | Product |
| C12 | S/app/notifications/page.tsx; S/components/notifications/notification-nav-link.tsx; T/notifications/trpc.router.ts:notificationsRouter.{dropdown,list,unreadCount}; T/notifications/trpc.router.ts:notificationsRouter.{markRead,markAllRead}; T/notifications/trpc.router.ts:notificationsRouter.{preferences,updatePreferences}; S/components/notification-settings/notification-settings.tsx; T/notifications/{register-browser-push,unregister-browser-push}/trpc.router.ts; S/components/notification-settings/browser-push-setting.tsx; S/components/notifications/browser-push-listener.tsx | Product |
| C13 | T/homepage/*/trpc.router.ts; S/app/page.tsx; T/explore/{search,search-nfts,search-all-results,search-curated-results,search-following-all-results}/trpc.router.ts; S/app/explore/{all,digital-one-of-ones,editions,liquid-editions,physical-artworks,auctions,sales,private-sales,collections}/page.tsx; T/explore/collections/trpc.router.ts; T/editions/list-standard/trpc.router.ts | Product |
| C14 | T/explore/activity/trpc.router.ts:activity.{query,following}; S/app/explore/activity/page.tsx | Product |
| C15 | S/app/explore/artists/{page,all/page}.tsx; T/leaderboards/{artistRankings,trendingArtists,trendingCollectors,trendingSeries}/trpc.router.ts | Product |
| C16 | S/app/curation/**/page.tsx; S/app/{curated-releases,releases,superrare-101,events/superrare-objkt-digital-art-festival}/page.tsx | Product |
| C17 | S/app/artwork/[chain]/[address]/[id]/page.tsx; T/artwork/{get-adp-data,get-live-nft,get-nft-events,get-auction-state,get-related-artworks,get-artist-artworks,get-prismic-exhibition}/trpc.router.ts; T/artwork/refresh-metadata/trpc.router.ts:refreshMetadataMutation; S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes | Product |
| C18 | S/components/drop-announcements/drop-share-dialog.tsx; S/components/drop-announcements/download-drop-share-image.ts; S/app/api/next/drop-share-image/[id]/route.tsx; S/app/artwork/[chain]/[address]/[id]/token-share-dialog.tsx; S/ui/share-actions.tsx; S/components/transaction-modal/{adp-purchase-success-share,mint-success-share,share-artwork-picker}.tsx | Product |
| C19 | S/app/collection/[collectionId]/page.tsx; T/collection/*/trpc.router.ts; S/app/collection/[collectionId]/edit-collection/actions.tsx:updateCollectionDetails | Product |
| C20 | S/app/collection/[collectionId]/actions/remove-collection.ts:removeCollection; S/app/sell/import/page.tsx; T/sell/{discover-external-collections,validate-external-collection,import-external-collection,get-owned-artworks}/trpc.router.ts | Product |
| C21 | S/app/dashboard/page.tsx; T/dashboard/*/trpc.router.ts | Product |
| C22 | S/app/liquid-editions/[chainId]/[contractAddress]/page.tsx; T/liquid-editions/*/trpc.router.ts; T/currency/currency.ts | Product |
| C23 | S/app/create/{artwork,edition,liquid-edition,release,collections/mint}/page.tsx; T/create/*/trpc.router.ts; S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes; T/series/series.ts; S/app/api/next/metadata-bundle/route.ts | Product |
| C24 | S/app/create/release/setup/page.tsx; S/app/api/next/{allowlist,metadata-prepare,metadata-bundle}/route.ts; T/create/{get-release-contracts,get-my-collection,get-my-collections,get-gallery-commission}/trpc.router.ts; S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes; S/app/liquid-editions/[chainId]/[contractAddress]/manage-liquid-lens-allowlist-dialog.tsx; S/app/liquid-editions/[chainId]/[contractAddress]/liquid-lens-mint-panel.tsx; T/series/series.ts | Product |
| C25 | T/artwork/{start-phygital-media-upload,finalize-phygital-media-upload,publish-phygital-metadata}/trpc.router.ts; T/artwork/assert-phygital-creator-access.ts; T/artwork/{get-published-phygital-metadata,get-published-phygital-metadata-for-owner}/trpc.router.ts; S/app/artwork/[chain]/[address]/[id]/phygital-gallery.tsx; S/components/transaction-modal/buy-content.tsx; S/app/create/artwork/form.tsx | Product |
| C26 | S/components/transaction-modal/erc1155-direct-sale-mint/print-release/erc1155-print-direct-sale-mint.tsx; T/artwork/validate-print-destination/trpc.router.ts; T/artwork/{arm-print-fulfillment-intent,submit-print-order,get-print-order-status}/trpc.router.ts | Product |
| C27 | T/coinflow/*/trpc.router.ts; S/components/transaction-modal/coinflow-{bazaar-card-purchase,mint-card-purchase,erc1155-direct-sale-card-purchase}.tsx | Product |
| C28 | S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes | Product |
| C29 | S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes | Product |
| C30 | S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes | Product |
| C31 | S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes | Product |
| C32 | S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes | Product |
| C33 | S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes | Product |
| C34 | S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes | Product |
| C35 | S/components/transaction-modal/; S/web/stores/transaction.ts:ActionTypes | Product |
| C36 | Original auth scope; no verified website linking control | Product |
| C37 | T/drop-announcements/{editorial-permission,update-editorial}/trpc.router.ts; S/app/admin/collections/page.tsx; S/app/create/collections/page.tsx; S/actions/collections/is-authorized-collection-admin.ts; S/app/admin/collections/hooks/use-set-creator.ts | Privileged |
| C38 | S/app/admin/sales-attribution/page.tsx; T/sales-attribution/*/trpc.router.ts; S/app/admin/sales-attribution/ | Privileged |
| C39 | S/app/(homepage)/subscribe.tsx:Subscribe; S/components/footer/index.tsx; S/components/header/user-menu.tsx; S/components/header/user-menu.tsx; S/config/stateful-auth-wagmi-adapter.ts | Product |
| C40 | T/create/{digital-curation-inquiry,physical-partnership-inquiry}/trpc.router.ts | Product |
