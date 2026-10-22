# SDK and CLI exposure inventory

Historical planning snapshot. Current SDK construction and authentication are documented in the repository README.
Snapshot: 2026-09-30. Read-only source inspection of current working trees. SDK 69f0aac690a0d8e2c34f5740cfe2158ee0d9e810; CLI a69a66bb8a5c580bb30736762f1ea7ed78c96221. No deployed behavior or live API verified.
Source roots: SDK `/Users/keeganead/.codex/worktrees/bdb5/rare-sdk`, CLI `/Users/keeganead/.codex/worktrees/d46f/rare-cli`, website `/Users/keeganead/.codex/worktrees/fc3b/superrare-monorepo/services/superrare-com`. All paths below relative to these roots.
## Exposure boundaries
SDK package.json exposes root/client, contracts, utils, data-access and wildcard subpaths including sdk modules, contract ABIs, liquid and swap modules. The supported product surface is `createRareClient` (`src/sdk/client.ts`, `src/sdk/types/client.ts`) plus separate `createRareAccountClient` (`src/sdk/account-client.ts`, `src/sdk/types/account.ts`). A callable exported internal core or ABI is lower-level capability, not a ready user action. Account authentication and transaction signer are independent. SDK root exports include session-store factory and typed errors.
The low-level `createApiClient` in `src/data-access/client.ts` exposes typed OpenAPI GET/POST etc. Calling arbitrary endpoints is partial capability and must not be counted as completed high-level workflow. Root/client does not expose every API helper; wildcard `api` does expose named helper functions.
## Exhaustive high-level namespace definitions
The following source blocks enumerate all callable namespace methods, including reads, local proof utilities, and writes. Namespace placement: collection.deploy/erc1155, listing.release, listing.erc1155.release, listing.batch, offer.erc1155/batch, auction.batch, utils.tree/merkle.
### AuctionMarketplaceNamespace — `src/sdk/types/auction.ts`
```ts
export type AuctionMarketplaceNamespace = {
  create: (params: AuctionCreateParams) => Promise<AuctionCreateResult>;
  bid: (params: AuctionBidParams) => Promise<AuctionBidResult>;
  settle: (params: AuctionSettleParams) => Promise<TransactionResult>;
  cancel: (params: AuctionCancelParams) => Promise<TransactionResult>;
  status: (params: AuctionStatusParams) => Promise<AuctionStatus>;
}
```
### AuctionNamespace — `src/sdk/types/auction.ts`
```ts
export type AuctionNamespace = AuctionMarketplaceNamespace & {
  batch: BatchAuctionNamespace;
}
```
### BatchAuctionNamespace — `src/sdk/types/batch-auction.ts`
```ts
export type BatchAuctionNamespace = {
  create: (params: BatchAuctionCreateParams) => Promise<BatchAuctionCreateResult>;
  cancel: (params: BatchAuctionCancelParams) => Promise<BatchAuctionCancelResult>;
  roots: (params?: BatchAuctionRootsParams) => Promise<Hex[]>;
  bid: (params: BatchAuctionBidParams) => Promise<BatchAuctionBidResult>;
  settle: (params: BatchAuctionSettleParams) => Promise<BatchAuctionSettleResult>;
  status: (params: BatchAuctionStatusParams) => Promise<BatchAuctionStatus>;
}
```
### BatchListingNamespace — `src/sdk/types/batch-listing.ts`
```ts
export type BatchListingNamespace = {
  create: (params: BatchListingCreateParams) => Promise<BatchListingCreateResult>;
  cancel: (params: BatchListingCancelParams) => Promise<BatchListingCancelResult>;
  buy: (params: BatchListingBuyParams) => Promise<BatchListingBuyResult>;
  setAllowlist: (params: BatchListingSetAllowListParams) => Promise<BatchListingSetAllowListResult>;
  status: (params: BatchListingStatusParams) => Promise<BatchListingStatus>;
}
```
### BatchOfferNamespace — `src/sdk/types/batch-offer.ts`
```ts
export type BatchOfferNamespace = {
  create: (params: BatchOfferCreateParams) => Promise<BatchOfferCreateResult>;
  revoke: (params: BatchOfferRevokeParams) => Promise<BatchOfferRevokeResult>;
  accept: (params: BatchOfferAcceptParams) => Promise<BatchOfferAcceptResult>;
  status: (params: BatchOfferStatusParams) => Promise<BatchOfferStatus>;
}
```
### BridgeNamespace — `src/sdk/types/bridge.ts`
```ts
export type BridgeNamespace = {
  quote: (params: BridgeParams) => Promise<BridgeQuote>;
  send: (params: BridgeSendParams) => Promise<BridgeResult>;
}
```
### SearchNamespace — `src/sdk/types/client.ts`
```ts
export type SearchNamespace = {
  liquidEditions: (params?: RareClientLiquidEditionSearchParams) => Promise<SearchPageResponse<LiquidEdition>>;
  nfts: (params?: RareClientNftSearchParams) => Promise<SearchPageResponse<Nft>>;
  collections: (params?: RareClientCollectionSearchParams) => Promise<SearchPageResponse<Collection>>;
  events: (params: RareClientEventSearchParams) => Promise<SearchPageResponse<NftEvent>>;
}
```
### NftNamespace — `src/sdk/types/client.ts`
```ts
export type NftNamespace = {
  get: (params: RareClientNftGetParams) => Promise<Nft>;
}
```
### UserNamespace — `src/sdk/types/client.ts`
```ts
export type UserNamespace = {
  get: (address: string) => Promise<UserProfile>;
}
```
### IpfsNamespace — `src/sdk/types/client.ts`
```ts
export type IpfsNamespace = {
  pinFile: (buffer: Uint8Array, filename: string) => Promise<IpfsUploadResult>;
  pinJson: (value: unknown, filename?: string) => Promise<IpfsUploadResult>;
}
```
### MediaNamespace — `src/sdk/types/client.ts`
```ts
export type MediaNamespace = {
  upload: (buffer: Uint8Array, filename: string) => Promise<NftMediaEntry>;
  pinMetadata: (opts: PinMetadataParams) => Promise<string>;
}
```
### ImportNamespace — `src/sdk/types/client.ts`
```ts
export type ImportNamespace = {
  erc721: (params: ImportErc721Params) => Promise<void>;
}
```
### CurrencyNamespace — `src/sdk/types/client.ts`
```ts
export type CurrencyNamespace = {
  list: () => CurrencyInfo[];
  resolve: (input: CurrencyInput) => ResolvedCurrency;
  resolveDecimals: (input: CurrencyInput) => Promise<ResolvedCurrencyWithDecimals>;
}
```
### CollectionDeployNamespace — `src/sdk/types/collection.ts`
```ts
export type CollectionDeployNamespace = {
  erc721: (params: DeployErc721Params) => Promise<DeployErc721Result>;
  erc1155: (params: DeployErc1155Params) => Promise<DeployErc1155Result>;
  lazyErc721: (params: DeployLazyErc721Params) => Promise<DeployLazyErc721Result>;
  lazyBatchMint: (params: DeployLazyBatchMintParams) => Promise<DeployLazyBatchMintResult>;
}
```
### CollectionNamespace — `src/sdk/types/collection.ts`
```ts
export type CollectionNamespace = {
  get: (id: string) => Promise<Collection>;
  status: (params: CollectionStatusParams) => Promise<CollectionStatusResult>;
  deploy: CollectionDeployNamespace;
  erc1155: Erc1155CollectionNamespace;
  mint: (params: CollectionMintParams) => Promise<CollectionMintResult>;
  mintBatch: (params: CollectionMintBatchParams) => Promise<CollectionMintBatchResult>;
  prepareLazyMint: (params: CollectionPrepareLazyMintParams) => Promise<CollectionPrepareLazyMintResult>;
  getTokenCreator: (params: CollectionTokenCreatorParams) => Promise<CollectionTokenCreatorResult>;
  royalty: {
    status: (params: CollectionRoyaltyInfoParams) => Promise<CollectionRoyaltyInfoResult>;
  };
  metadata: {
    status: (params: CollectionMintConfigParams) => Promise<CollectionMintConfigResult>;
  };
  setDefaultRoyaltyReceiver: (params: CollectionSetDefaultRoyaltyReceiverParams) => Promise<CollectionSetDefaultRoyaltyReceiverResult>;
  setDefaultRoyaltyPercentage: (params: CollectionSetDefaultRoyaltyPercentageParams) => Promise<CollectionSetDefaultRoyaltyPercentageResult>;
  setTokenRoyaltyReceiver: (params: CollectionSetTokenRoyaltyReceiverParams) => Promise<CollectionSetTokenRoyaltyReceiverResult>;
  updateBaseUri: (params: CollectionUpdateBaseUriParams) => Promise<CollectionUpdateBaseUriResult>;
  updateTokenUri: (params: CollectionUpdateTokenUriParams) => Promise<CollectionUpdateTokenUriResult>;
  lockBaseUri: (params: CollectionLockBaseUriParams) => Promise<CollectionLockBaseUriResult>;
}
```
### Erc1155ReleaseNamespace — `src/sdk/types/erc1155.ts`
```ts
export type Erc1155ReleaseNamespace = {
  allowlist: {
    getConfig: (params: { contract: Address; tokenId: IntegerInput }) => Promise<Erc1155ReleaseAllowlistConfig>;
    setConfig: (params: Erc1155ReleaseSetAllowlistConfigParams) => Promise<Erc1155ReleaseSetAllowlistConfigResult>;
    setConfigBatch: (params: Erc1155ReleaseSetAllowlistConfigBatchParams) => Promise<Erc1155ReleaseSetAllowlistConfigBatchResult>;
    clear: (params: { contract: Address; tokenId: IntegerInput }) => Promise<Erc1155ReleaseSetAllowlistConfigResult>;
    build: (params: { input: string; format: 'csv' | 'json' }) => ReleaseAllowlistArtifact;
    parse: (params: { input: string }) => ReleaseAllowlistArtifact;
    proof: (params: { artifact: ReleaseAllowlistArtifact; address: Address }) => ReleaseAllowlistWalletProof | null;
  };
  limits: {
    getMint: (params: { contract: Address; tokenId: IntegerInput }) => Promise<Erc1155ReleaseLimitConfig>;
    setMint: (params: Erc1155ReleaseSetLimitParams) => Promise<Erc1155ReleaseSetLimitResult>;
    setMintBatch: (params: Erc1155ReleaseSetLimitBatchParams) => Promise<Erc1155ReleaseSetLimitBatchResult>;
    getTx: (params: { contract: Address; tokenId: IntegerInput }) => Promise<Erc1155ReleaseLimitConfig>;
    setTx: (params: Erc1155ReleaseSetLimitParams) => Promise<Erc1155ReleaseSetLimitResult>;
    setTxBatch: (params: Erc1155ReleaseSetLimitBatchParams) => Promise<Erc1155ReleaseSetLimitBatchResult>;
  };
  configure: (params: Erc1155ReleaseConfigureParams) => Promise<Erc1155ReleaseConfigureResult>;
  configureBatch: (params: Erc1155ReleaseConfigureBatchParams) => Promise<Erc1155ReleaseConfigureBatchResult>;
  cancel: (params: Erc1155ReleaseCancelParams) => Promise<Erc1155ReleaseCancelResult>;
  mint: (params: Erc1155ReleaseMintParams) => Promise<Erc1155ReleaseMintResult>;
  status: (params: Erc1155ReleaseStatusParams) => Promise<Erc1155ReleaseStatus>;
}
```
### Erc1155ListingNamespace — `src/sdk/types/erc1155.ts`
```ts
export type Erc1155ListingNamespace = {
  release: Erc1155ReleaseNamespace;
  create: (params: Erc1155ListingCreateParams) => Promise<Erc1155ListingCreateResult>;
  createBatch: (params: Erc1155ListingCreateBatchParams) => Promise<Erc1155ListingCreateBatchResult>;
  cancel: (params: Erc1155ListingCancelParams) => Promise<TransactionResult>;
  buy: (params: Erc1155ListingBuyParams) => Promise<Erc1155ListingBuyResult>;
  checkout: (params: Erc1155CheckoutParams) => Promise<Erc1155CheckoutResult>;
  status: (params: Erc1155ListingStatusParams) => Promise<Erc1155ListingStatus>;
}
```
### Erc1155OfferNamespace — `src/sdk/types/erc1155.ts`
```ts
export type Erc1155OfferNamespace = {
  create: (params: Erc1155OfferCreateParams) => Promise<Erc1155OfferCreateResult>;
  cancel: (params: Erc1155OfferCancelParams) => Promise<TransactionResult>;
  accept: (params: Erc1155OfferAcceptParams) => Promise<Erc1155OfferAcceptResult>;
  status: (params: Erc1155OfferStatusParams) => Promise<Erc1155OfferStatus>;
}
```
### Erc1155CollectionNamespace — `src/sdk/types/erc1155.ts`
```ts
export type Erc1155CollectionNamespace = {
  createToken: (params: Erc1155CollectionCreateTokenParams) => Promise<Erc1155CollectionCreateTokenResult>;
  mint: (params: Erc1155CollectionMintParams) => Promise<Erc1155CollectionMintResult>;
  mintBatch: (params: Erc1155CollectionMintBatchParams) => Promise<Erc1155CollectionMintBatchResult>;
  setMinterApproval: (params: Erc1155CollectionSetMinterApprovalParams) => Promise<Erc1155CollectionSetMinterApprovalResult>;
  updateTokenUri: (params: Erc1155CollectionUpdateTokenUriParams) => Promise<Erc1155CollectionUpdateTokenUriResult>;
  disable: (params: Erc1155CollectionDisableParams) => Promise<Erc1155CollectionDisableResult>;
  status: (params: Erc1155CollectionStatusParams) => Promise<Erc1155CollectionStatus>;
}
```
### LiquidEditionNamespace — `src/sdk/types/liquid.ts`
```ts
export type LiquidEditionNamespace = {
  /** Indexed public discovery data for an edition on the client chain. */
  get: (params: { contract: Address }) => Promise<LiquidEdition>;
  getFactoryConfig: () => Promise<LiquidFactoryConfig>;
  generatePresetCurves: (params: GeneratePresetCurvesParams) => Promise<GeneratePresetCurvesResult>;
  validateCurves: (params: ValidateLiquidCurvesParams) => Promise<LiquidCurvePreview>;
  deploy: {
    multiCurve: (params: DeployLiquidEditionParams) => Promise<DeployLiquidEditionResult>;
  };
  getTokenUri: (params: { contract: Address }) => Promise<string>;
  getRenderContract: (params: { contract: Address }) => Promise<Address>;
  setRenderContract: (params: SetLiquidEditionRenderContractParams) => Promise<SetLiquidEditionRenderContractResult>;
  getPoolInfo: (params: { contract: Address }) => Promise<LiquidEditionPoolInfo>;
  getMarketState: (params: { contract: Address }) => Promise<LiquidEditionMarketState>;
  getCurrentPrice: (params: { contract: Address }) => Promise<LiquidEditionCurrentPrice>;
  status: (params: { contract: Address }) => Promise<LiquidEditionTelemetry>;
}
```
### ListingMarketplaceNamespace — `src/sdk/types/listing.ts`
```ts
export type ListingMarketplaceNamespace = {
  create: (params: ListingCreateParams) => Promise<ListingCreateResult>;
  cancel: (params: ListingCancelParams) => Promise<TransactionResult>;
  buy: (params: ListingBuyParams) => Promise<ListingBuyResult>;
  status: (params: ListingStatusParams) => Promise<ListingStatus>;
}
```
### ListingNamespace — `src/sdk/types/listing.ts`
```ts
export type ListingNamespace = ListingMarketplaceNamespace & {
  erc1155: Erc1155ListingNamespace;
  release: ReleaseNamespace;
  batch: BatchListingNamespace;
}
```
### OfferMarketplaceNamespace — `src/sdk/types/offer.ts`
```ts
export type OfferMarketplaceNamespace = {
  create: (params: OfferCreateParams) => Promise<OfferCreateResult>;
  cancel: (params: OfferCancelParams) => Promise<TransactionResult>;
  accept: (params: OfferAcceptParams) => Promise<OfferAcceptResult>;
  status: (params: OfferStatusParams) => Promise<OfferStatus>;
}
```
### OfferNamespace — `src/sdk/types/offer.ts`
```ts
export type OfferNamespace = OfferMarketplaceNamespace & {
  erc1155: Erc1155OfferNamespace;
  batch: BatchOfferNamespace;
}
```
### ReleaseAllowlistNamespace — `src/sdk/types/release.ts`
```ts
export type ReleaseAllowlistNamespace = {
  build: (params: { input: string; format: ReleaseAllowlistInputFormat }) => ReleaseAllowlistArtifact;
  parse: (params: { input: string }) => ReleaseAllowlistArtifact;
  proof: (params: { artifact: ReleaseAllowlistArtifact; address: Address }) => ReleaseAllowlistWalletProof | null;
  getConfig: (params: { contract: Address }) => Promise<ReleaseAllowlistConfig>;
  setConfig: (params: ReleaseSetAllowlistConfigParams) => Promise<ReleaseSetAllowlistConfigResult>;
  clear: (params: { contract: Address }) => Promise<ReleaseSetAllowlistConfigResult>;
}
```
### ReleaseLimitsNamespace — `src/sdk/types/release.ts`
```ts
export type ReleaseLimitsNamespace = {
  getMint: (params: { contract: Address }) => Promise<ReleaseLimitConfig>;
  setMint: (params: ReleaseSetLimitParams) => Promise<ReleaseSetLimitResult>;
  getTx: (params: { contract: Address }) => Promise<ReleaseLimitConfig>;
  setTx: (params: ReleaseSetLimitParams) => Promise<ReleaseSetLimitResult>;
}
```
### ReleaseNamespace — `src/sdk/types/release.ts`
```ts
export type ReleaseNamespace = {
  allowlist: ReleaseAllowlistNamespace;
  limits: ReleaseLimitsNamespace;
  configure: (params: ReleaseConfigureParams) => Promise<ReleaseConfigureResult>;
  mint: (params: ReleaseMintDirectSaleParams) => Promise<ReleaseMintDirectSaleResult>;
  status: (params: ReleaseStatusParams) => Promise<ReleaseStatus>;
}
```
### SwapNamespace — `src/sdk/types/swap.ts`
```ts
export type SwapNamespace = {
  buy: (params: RouterBuyParams) => Promise<TransactionResult>;
  sell: (params: RouterSellParams) => Promise<TransactionResult>;
  swapTokens: (params: RouterSwapTokensParams) => Promise<TransactionResult>;
  quoteBuyToken: (params: TokenTradeQuoteParams) => Promise<TokenTradeQuote>;
  buyToken: (params: BuyTokenParams) => Promise<TokenTradeResult>;
  quoteSellToken: (params: TokenTradeQuoteParams) => Promise<TokenTradeQuote>;
  sellToken: (params: SellTokenParams) => Promise<TokenTradeResult>;
  quoteBuyRare: (params: BuyRareParams) => Promise<BuyRareQuote>;
  buyRare: (params: BuyRareParams) => Promise<BuyRareResult>;
}
```
### TokenNamespace — `src/sdk/types/token.ts`
```ts
export type TokenNamespace = {
  status: (params: { contract: Address; tokenId?: IntegerInput }) => Promise<TokenStatus>;
  getPrice: (symbol: string) => Promise<{ symbol: string; priceUsd: number; decimals: number; chainId: number; address: string }>;
}
```
### UtilsNamespace — `src/sdk/types/utils.ts`
```ts
export type UtilsNamespace = {
  tree: {
    build: (params: BuildUtilsTreeParams) => UtilsTreeArtifact;
    proof: (params: UtilsTreeProofParams) => UtilsTreeProofArtifact;
    verify: (params: UtilsTreeProofVerifyParams) => boolean;
  };
  merkle: {
    proof: (params: UtilsMerkleProofParams) => UtilsMerkleProofArtifact;
  };
}
```
### Account — `src/sdk/types/account.ts`
```ts
export type RareAccountClient = {
  auth: {
    startDeviceAuthorization: (options?: RareAuthRequestOptions) => Promise<RareDeviceAuthorization>;
    pollDeviceAuthorization: (authorization: RareDeviceAuthorization, options?: RareAuthRequestOptions) => Promise<RareDevicePollResult>;
    waitForDeviceAuthorization: (authorization: RareDeviceAuthorization, options?: RareAuthRequestOptions) => Promise<RareAccountSession>;
    loginWithWallet: (options: RareWalletLoginOptions & RareAuthRequestOptions) => Promise<RareAccountSession>;
    getSession: () => Promise<RareAccountSession | null>;
    refresh: (options?: RareAuthRequestOptions) => Promise<RareAccountSession>;
    logout: (options?: RareAuthRequestOptions) => Promise<void>;
    clearSession: () => Promise<void>;
  };
  profile: {
    get: (options?: RareAuthRequestOptions) => Promise<RareAccountProfile>;
    update: (patch: RareAccountProfilePatch, options?: RareAuthRequestOptions) => Promise<RareAccountProfile>;
  };
};

```
## SDK helper/subpath exposure
`src/sdk/public-utils.ts`: buildUtilsTree, getUtilsTreeProof, verifyUtilsTreeProof, buildUtilsMerkleProof are public local artifact helpers.
`src/sdk/api.ts` exports createRareApi, uploadMedia, pinFile, pinJson, pinMetadata, importErc721, searchNfts, searchCollections, searchEvents, getNft, getNftEvents, getCollection, getCollectionEvents, getUser, getTokenPrice, searchLiquidEditions, getLiquidEdition. Event helpers and all API paths are not separate transaction actions.
`src/data-access/schema.d.ts` typed API routes:
- `/v1/liquid-editions`
- `/v1/liquid-editions/{id}`
- `/v1/nfts`
- `/v1/nfts/{universalTokenId}`
- `/v1/nfts/{universalTokenId}/events`
- `/v1/nfts/metadata`
- `/v1/nfts/metadata/media/uploads`
- `/v1/nfts/metadata/media/uploads/complete`
- `/v1/nfts/metadata/media/generate`
- `/v1/collections`
- `/v1/collections/{id}`
- `/v1/collections/{id}/events`
- `/v1/collections/import`
- `/v1/users/{address}`
- `/v1/tokens/price/{symbol}`
- `/v1/merkle-roots/nfts`
- `/v1/merkle-roots/addresses`
- `/v1/merkle-roots/nfts/proof`
- `/v1/merkle-roots/addresses/proof`
- `/v1/connect/intents`
- `/v1/connect/intents/{intentId}`
- `/v1/connect/intents/{intentId}/execution`
- `/v1/connect/intents/{intentId}/execution-session`
- `/v1/connect/auth/hosted-login`
- `/v1/connect/auth/exchange`
- `/v1/connect/auth/claim`
- `/v1/connect/session`
- `/v1/connect/users/me`
- `/v1/connect/checkout/{sessionId}`
- `/v1/connect/intents/{intentId}/checkout/coinflow/buy`
- `/v1/connect/intents/{intentId}/checkout/coinflow/mint`
## CLI registered action inventory
Root registration is `src/program.ts:createRareProgram`. Registered groups: configure, auction, status, wallet, search, import, offer, listing, nft, collection, currencies, liquid-edition, bridge, swap, user, utils, ipfs, mcp, auth, profile. Standalone source files mint/deploy/release/batch/erc1155 are nested factories, not additional root commands.
| CLI path | SDK high-level correspondence / scope | Source |
|---|---|---|
| `auction create/bid/settle/cancel/status` | auction.*; create reserve or scheduled | `src/commands/auction.ts` |
| `auction list` | API NFT search/account projection, not exhaustive auction database | `src/commands/account-market-list.ts` |
| `auction batch create/cancel/bid/settle/status` | auction.batch.*; SDK roots has no explicit CLI action | `src/commands/batch.ts` |
| `offer create/cancel/accept/status` | offer.* | `src/commands/offer.ts` |
| `offer list` | API account projection; maker/taker scope | `src/commands/account-market-list.ts` |
| `offer batch create/revoke/accept/status` | offer.batch.* | `src/commands/batch.ts` |
| `offer erc1155 create/accept/cancel/status` | offer.erc1155.* | `src/commands/erc1155.ts` |
| `listing create/cancel/buy/status` | listing.* | `src/commands/listing.ts` |
| `listing list` | active token listings on held NFTs; not all owned collection/batch listings | `src/commands/account-market-list.ts` |
| `listing buy-card` | hosted browser Coinflow checkout for eligible public USDC token listing; not SDK native card settlement | `src/commands/listing.ts` |
| `listing batch create/cancel/buy/set-allowlist/status` | listing.batch.* | `src/commands/batch.ts` |
| `listing erc1155 create/create-batch/buy/checkout/cancel/status` | listing.erc1155.*; checkout is multi-item flow | `src/commands/erc1155.ts` |
| `listing release configure/mint/status` | listing.release.* | `src/commands/release.ts` |
| `listing release allowlist build/proof/set/clear` | local artifact + contract config; SDK parse/getConfig exposed through read/status | `src/commands/release.ts` |
| `listing release limits set-mint/set-tx` | release.limits.*; getMint/getTx included in status | `src/commands/release.ts` |
| `listing erc1155 release configure/configure-batch/cancel/mint/status` | listing.erc1155.release.* | `src/commands/erc1155.ts` |
| `listing erc1155 release allowlist build/proof/set/set-batch/clear` | ERC1155 release allowlist | `src/commands/erc1155.ts` |
| `listing erc1155 release limits set-mint/set-mint-batch/set-tx/set-tx-batch/get-mint/get-tx` | ERC1155 release limits | `src/commands/erc1155.ts` |
| `collection get/status/list` | API collection + chain state; list owned by account | `src/commands/collection.ts; account-market-list.ts` |
| `collection deploy erc721/lazy-erc721/lazy-batch-mint/erc1155` | collection.deploy.* | `src/commands/collection.ts; deploy.ts; erc1155.ts` |
| `collection mint/mint-batch/prepare-lazy-mint/creator` | collection.mint/mintBatch/prepareLazyMint/getTokenCreator | `src/commands/collection.ts; mint.ts` |
| `collection royalty status/set-default-receiver/set-default-percentage/set-token-receiver` | collection.royalty.status + royalty writes | `src/commands/collection.ts` |
| `collection metadata status/update-base-uri/update-token-uri/lock-base-uri` | collection.metadata.status + metadata writes | `src/commands/collection.ts` |
| `collection erc1155 create-token/mint/mint-batch/metadata update-token-uri/disable/minter set/status` | collection.erc1155.* | `src/commands/erc1155.ts` |
| `liquid-edition deploy multicurve/status/token-uri/set-render-contract` | liquidEdition.*; status includes pool/current price; preset curve generation and validation in deploy workflow | `src/commands/liquid-edition.ts; deploy.ts` |
| `bridge quote/send` | bridge.*; CCIP crosschain RARE | `src/commands/bridge.ts` |
| `swap tokens/buy-token/sell-token/buy-rare` | swap.swapTokens/buyToken/sellToken/buyRare; quoting via flags/workflow rather than quote commands; raw router buy/sell not separately named | `src/commands/swap.ts` |
| `search nfts/collections/events` | search.*; no registered liquid-edition search subcommand in search.ts | `src/commands/search.ts` |
| `nft get` | nft.get | `src/commands/nft.ts` |
| `user get` | user.get public profile | `src/commands/user.ts` |
| `status` | token.status | `src/commands/status.ts` |
| `currencies` | currency.list | `src/commands/currencies.ts` |
| `import erc721` | import.erc721 | `src/commands/import.ts` |
| `ipfs pin-file/pin-json` | ipfs.* | `src/commands/ipfs.ts` |
| `utils tree build/proof/verify; utils merkle proof` | utils.* local artifacts | `src/commands/utils.ts; batch.ts` |
| `wallet generate/address` | CLI wallet setup; no SDK wallet namespace | `src/commands/wallet.ts` |
| `configure; configure delete` | CLI configuration | `src/commands/configure.ts` |
| `mcp serve` | CLI MCP transport exposing command-related tools; no product transaction itself | `src/commands/mcp.ts` |
| `auth login/status/logout` | separate account.auth.*; device/wallet, poll/resume/no-wait, verify and local-only flags | `src/commands/auth.ts` |
| `profile get/update --stdin` | account.profile.*; patch username/fullName/bio/avatar only | `src/commands/profile.ts` |
## Website transaction comparison and backlog cautions
Website source `src/web/stores/transaction.ts:ActionTypes` registers buy, bid, offer, price, auction, transfer, removePrice, cancelAuction, acceptOffer, settleAuction, removeOffer, send, mint, multiOffer, series-offer, erc1155-direct-sale-mint, mint-release, burn (also unsupported sentinel). Transaction modal routing is `src/components/transaction-modal/transaction-modal.tsx`. These are UI action names, not proof of complete API parity.
| Website action | SDK / CLI assessment |
|---|---|
| buy/price/removePrice | Token listing buy/create/cancel exists, plus batch and ERC1155 variants. Must map each website contract/version, currency, allowlist and recipient semantics individually. |
| bid/auction/cancelAuction/settleAuction | reserve + scheduled token auction exists; batch reserve exists. Legacy/V1 parity is not established by namespace existence. |
| offer/acceptOffer/removeOffer | Token, ERC1155 and batch paths exist; series-offer/multiOffer may map to batch proofs only after verifying exact website semantics. |
| transfer/send/burn | No corresponding `RareClient` method or registered CLI command. ABI/viem primitives are not a finished public SDK workflow. |
| mint/mint-release/ERC1155 direct-sale mint | collection mint and release mint exist; card mint + print fulfillment/shipping are separate website flows absent in high-level SDK/CLI. |
| card buy | CLI buy-card opens hosted checkout; partial handoff, not terminal or SDK settlement parity. |
| share/social/follow/likes/comments/curation/email/wallet management | No high-level SDK/CLI action; account profile update only covers username/fullName/bio/avatar. Public user.get is not own-account profile access. |
Website print workflow evidence: `src/components/transaction-modal/erc1155-direct-sale-mint/print-release/erc1155-print-direct-sale-mint.tsx`, `build-recipient-details-signature.ts`, `create-print-fulfillment-intent-id.ts`. Website card mint evidence: `src/components/transaction-modal/coinflow-mint-card-purchase.tsx`; card buy `coinflow-card-purchase.tsx`.
## Limits / unknowns
Static exposure inventory does not prove successful deployment, permissions, frontend discoverability, or feature flags. SDK availability differs by chain: client.ts guards batch marketplace addresses and contracts/addresses.ts is authority for deployment matrix. SDK/CLI trees may include unpublished/uncommitted current-branch work. Reads can be indexed, paginated, stale or filtered; account market lists are search projections, not a complete account activity ledger. Public exports via wildcard include low-level core functions; this artifact exhaustively enumerates the intended client/account actions and registered CLI factories, not every exported ABI constant/internal utility. Website transaction action semantics and legacy marketplace/version behavior require a separate detailed mapper audit.

## Wildcard module export audit appendix

These exported callable symbols are reachable through the package wildcard module paths subject to build output. They include implementation factories, validation, transaction shells and pure core helpers. They are deliberately not promoted to completed website actions. This appendix avoids hiding public subpath exposure behind the high-level inventory. Re-export-only symbol lists and contract ABI constants are excluded.

| Module | Exported callable/value symbols |
|---|---|
| `src/sdk/account-auth-core.ts` | `normalizeAuthBaseUrl`, `joinAuthPath`, `isRecord`, `requireString`, `requirePositiveNumber`, `parseAuthErrorCode` |
| `src/sdk/account-client.ts` | `createRareAccountClient` |
| `src/sdk/account-profile-core.ts` | `parseAccountProfile`, `validateAccountProfilePatch` |
| `src/sdk/account-session-store.ts` | `parseAccountSession`, `createMemoryAccountSessionStore` |
| `src/sdk/amounts-core.ts` | `toInteger`, `toSafeIntegerNumber`, `stringifyAmountInput`, `toNonNegativeInteger`, `toPositiveInteger`, `toWei`, `toNonNegativeWei`, `toPositiveWei` |
| `src/sdk/api-core.ts` | `inferMimeType`, `normalizeFilename`, `parseDimensions`, `buildMediaUploadPlan`, `buildIpfsUploadPlan`, `buildIpfsJsonUploadPayload`, `buildGeneratedMediaEntry`, `buildPinMetadataBody`, `buildImportErc721Body`, `buildNftSearchQuery`, `buildCollectionSearchQuery` |
| `src/sdk/api.ts` | `createRareApi`, `uploadMedia`, `pinFile`, `pinJson`, `pinMetadata`, `importErc721`, `searchNfts`, `searchCollections`, `searchEvents`, `getNft`, `getNftEvents`, `getCollection`, `getCollectionEvents`, `getUser`, `getTokenPrice`, `searchLiquidEditions`, `getLiquidEdition` |
| `src/sdk/approvals-shell.ts` | `runWithApprovalSideEffectAlert`, `approvalAbi`, `waitForApproval`, `approveNftContractIfNeeded` |
| `src/sdk/auction.ts` | `createAuctionNamespace` |
| `src/sdk/batch-auction-core.ts` | `planBatchAuctionCreateLocalInputs`, `planBatchAuctionCreate`, `planBatchAuctionRoot`, `planBatchAuctionBidLocalInputs`, `planBatchAuctionBid`, `planBatchAuctionToken`, `planBatchAuctionStatus`, `shapeBatchAuctionStatus`, `shapeBatchAuctionDetailsRead`, `shapeBatchAuctionCurrentBidRead`, `shapeBatchAuctionMerkleConfigRead`, `addMarketplaceFee`, `resolveBatchAuctionRoot` |
| `src/sdk/batch-auction.ts` | `createBatchAuctionNamespace` |
| `src/sdk/batch-core.ts` | `buildBatchTokenTreeArtifact`, `parseBatchTokenList`, `parseBatchTokenListArtifact`, `parseBatchTokenListArtifactOrBuild`, `getBatchTokenProof`, `verifyBatchTokenProof`, `parseBatchTokenProofArtifact`, `parseBatchTokenProofInput`, `validateBatchTokenProofInputMatchesTarget`, `hashBatchToken`, `normalizeBytes32`, `normalizeTokenId` |
| `src/sdk/batch-listing-core.ts` | `uniqueAddresses`, `parseBatchListingCreateRootArtifactInput`, `planBatchListingCreateArtifact`, `planBatchListingRootRegistration`, `planBatchListingRootRegistrationLocalInputs`, `shouldResolveBatchListingAllowListProof`, `validateBatchListingBuyProofPolicy`, `shapeBatchListingStatus` |
| `src/sdk/batch-listing.ts` | `createBatchListingNamespace` |
| `src/sdk/batch-offer-core.ts` | `planBatchOfferCreateLocalInputs`, `planBatchOfferCreate`, `planBatchOfferRoot`, `planBatchOfferAcceptLocalInputs`, `planBatchOfferAccept`, `shapeBatchOfferStatus`, `shapeBatchOfferRead`, `resolveBatchOfferRoot` |
| `src/sdk/batch-offer.ts` | `createBatchOfferNamespace` |
| `src/sdk/bridge-core.ts` | `validateBridgeRoute`, `getBridgeInfo`, `encodeBridgeDistribution`, `buildBridgeSendArgs`, `buildCcipExplorerUrl` |
| `src/sdk/bridge.ts` | `createBridgeNamespace` |
| `src/sdk/client.ts` | `createRareClient` |
| `src/sdk/collection-core.ts` | `sovereignCollectionContractTypes`, `lazySovereignCollectionContractTypes`, `defaultRoyaltyInfoSalePrice`, `normalizeSovereignCollectionContractType`, `normalizeLazySovereignCollectionContractType`, `planCreateSovereignCollection`, `buildCreateSovereignCollectionWrite`, `planCreateLazySovereignCollection`, `buildCreateLazySovereignCollectionWrite`, `planCollectionMintBatch`, `planCollectionPrepareLazyMint`, `buildCollectionMintBatchWrite`, `buildCollectionPrepareLazyMintWrite`, `planCollectionMinterApproval`, `buildCollectionMinterApprovalWrite`, `shapeCollectionPrepareMintEvent`, `planCollectionToken`, `planCollectionRoyaltyInfo`, `planCollectionReceiver`, `planCollectionTokenReceiver`, `planCollectionRoyaltyPercentage`, `buildCollectionRoyaltyPercentageWrite`, `planCollectionBaseUri`, `planCollectionTokenUri`, `planCollectionContract` |
| `src/sdk/collection.ts` | `createCollectionNamespace` |
| `src/sdk/currency.ts` | `createCurrencyNamespace`, `resolveCurrencyForSdk`, `resolveCurrencyWithDecimalsForSdk` |
| `src/sdk/deploy.ts` | `createDeployNamespace` |
| `src/sdk/erc1155-core.ts` | `zeroBytes32`, `zeroBytes4`, `erc1155CheckoutItemKinds`, `erc1155CheckoutFailureStages`, `planErc1155CollectionCreateToken`, `planErc1155CollectionMint`, `planErc1155CollectionMintBatch`, `planErc1155CollectionSetMinterApproval`, `planErc1155CollectionUpdateTokenUri`, `planErc1155CollectionStatus`, `planErc1155ListingCreate`, `planErc1155ListingCreateBatch`, `planErc1155ListingCancel`, `planErc1155ListingBuy`, `planErc1155ListingStatus`, `planErc1155OfferCreate`, `planErc1155OfferCancel`, `planErc1155OfferAccept`, `planErc1155ReleaseConfigure`, `planErc1155ReleaseConfigureBatch`, `planErc1155ReleaseCancel`, `planErc1155ReleaseMint`, `planErc1155CheckoutInput`, `planErc1155CheckoutResolved`, `groupErc1155CheckoutPayments`, `planErc1155ReleaseAllowlistConfig`, `planErc1155ReleaseAllowlistConfigBatch`, `planErc1155ReleaseClearAllowlistConfig`, `planErc1155ReleaseLimitConfig`, `planErc1155ReleaseLimitConfigBatch`, `shapeErc1155CollectionStatus`, `shapeErc1155ListingStatus`, `shapeErc1155OfferStatus`, `shapeErc1155ReleaseAllowlistConfig`, `shapeErc1155ReleaseLimitConfig`, `shapeErc1155ReleaseStatus`, `shapeErc1155CheckoutResult`, `shapeErc1155CheckoutExecution`, `validateErc1155CheckoutLogs`, `totalPrice`, `providedSplits` |
| `src/sdk/erc1155.ts` | `createErc1155DeployNamespace`, `createErc1155CollectionNamespace`, `createErc1155ListingNamespace`, `createErc1155OfferNamespace` |
| `src/sdk/event-search-core.ts` | `resolveEventSearchTarget`, `buildCollectionId` |
| `src/sdk/liquid-discovery-core.ts` | `buildLiquidEditionSearchQuery`, `buildLiquidEditionId` |
| `src/sdk/liquid.ts` | `createLiquidNamespace` |
| `src/sdk/listing.ts` | `createListingNamespace` |
| `src/sdk/marketplace-core.ts` | `planListingCreateLocalInputs`, `planListingCreate`, `planListingCancel`, `planListingBuyLocalInputs`, `planListingBuy`, `planListingStatus`, `shapeListingStatus`, `planOfferCreateLocalInputs`, `planOfferCreate`, `planOfferCancel`, `planOfferAcceptLocalInputs`, `planOfferAccept`, `planOfferStatus`, `shapeOfferStatus`, `planSplits`, `planProvidedSplits`, `planAuctionCreateLocalInputs`, `planAuctionCreate`, `planAuctionBidLocalInputs`, `planAuctionBid`, `planAuctionTokenAction`, `shapeAuctionStatus`, `shapeAuctionBidRead` |
| `src/sdk/merkle-api.ts` | `generateApiNftMerkleRoot`, `generateApiAddressMerkleRoot`, `resolveApiNftMerkleProof`, `resolveApiNftMerkleProofFromRoots`, `isApiNftMerkleProofResolutionError`, `resolveApiAddressMerkleProof` |
| `src/sdk/merkle-core.ts` | `ZERO_ROOT`, `getTokenProof`, `getAddressProof`, `buildMerkleProofArtifact`, `validateRootArtifact`, `validateProofArtifact` |
| `src/sdk/merkle-file.ts` | `loadMerkleRootArtifact`, `loadMerkleProofArtifact`, `writeMerkleArtifact` |
| `src/sdk/mint-core.ts` | `isMintMetadataOptionsError`, `parseMintAttribute`, `planMintTokenUri`, `buildMintPinMetadataParams` |
| `src/sdk/mint.ts` | `createCollectionMint` |
| `src/sdk/nft-core.ts` | `buildNftUniversalTokenId` |
| `src/sdk/offer.ts` | `createOfferNamespace` |
| `src/sdk/payments-shell.ts` | `marketplaceSettingsAbi`, `getTokenDecimals`, `getKnownCurrencyDecimals`, `resolveCurrencyDecimals`, `toCurrencyAmount`, `toTokenAmount`, `ensureTokenAllowance`, `preparePayment`, `preparePaymentForSpender`, `preparePaymentAmountForSpender`, `calculateMarketplacePaymentAmount`, `calculateMarketplacePaymentAmountFromSettings` |
| `src/sdk/public-utils.ts` | `buildUtilsTree`, `getUtilsTreeProof`, `verifyUtilsTreeProof`, `buildUtilsMerkleProof` |
| `src/sdk/release-core.ts` | `ZERO_BYTES32`, `RELEASE_ALLOWLIST_ARTIFACT_KIND`, `requireRareMinterAddress`, `assertReleaseContractOwner`, `normalizeReleaseTimestamp`, `normalizeReleaseStartTime`, `normalizeReleasePrice`, `resolveReleaseSplits`, `planReleaseConfigure`, `planReleaseAllowlistConfig`, `planReleaseClearAllowlistConfig`, `planReleaseLimitConfig`, `planReleaseDirectSaleMint`, `normalizeReleaseAllowlistProof`, `buildReleaseAllowlistArtifactFromInput`, `parseReleaseAllowlistArtifactJson`, `parseReleaseAllowlistArtifact`, `parseReleaseAllowlistCsv`, `parseReleaseAllowlistJson`, `buildReleaseAllowlistArtifact`, `getReleaseAllowlistProof`, `verifyReleaseAllowlistProof`, `preflightReleaseDirectSaleMint`, `isReleaseAllowlistActive`, `shapeReleaseMintTokenRange`, `shapeReleaseAllowlistConfig`, `shapeReleaseLimitConfig`, `assertReleaseAllowlistConfigMatches`, `assertReleaseLimitMatches`, `shapeReleaseStatus` |
| `src/sdk/release.ts` | `createReleaseNamespace` |
| `src/sdk/splits-core.ts` | `MAX_PAYOUT_SPLIT_RECIPIENTS`, `planPayoutSplits`, `planProvidedPayoutSplits` |
| `src/sdk/swap.ts` | `createSwapNamespace` |
| `src/sdk/token.ts` | `createTokenNamespace` |
| `src/sdk/transaction-fallback-core.ts` | `isCaipChainIdConversionError`, `getCallsTransactionHash`, `resolveTransactionData` |
| `src/sdk/transaction-fallback-shell.ts` | `executeWithCallsFallback`, `createWalletClientWithCallsFallback` |
| `src/sdk/transaction-receipt.ts` | `waitForSuccessfulTransactionReceipt` |
| `src/sdk/utils.ts` | `createUtilsNamespace` |
| `src/sdk/validation-core.ts` | `requireInput`, `toUnixTimestamp`, `requireConfiguredAddress`, `validateRouterPayload` |
| `src/sdk/validation.ts` | `parseAddress`, `parseOptionalAddress`, `isHexString`, `parseHexString`, `isPrivateKeyString`, `parsePrivateKey` |
| `src/sdk/wallet-shell.ts` | `resolveChainFromPublicClient`, `requireWallet`, `resolveDeadline`, `getConfiguredAccountAddress`, `parsePreparedBigInt`, `sendPreparedTransaction` |
| `src/data-access/base-url.ts` | `DEFAULT_RARE_API_BASE_URL`, `resolveRareApiBaseUrl` |
| `src/data-access/client.ts` | `createApiClient` |
| `src/liquid/curve-config.ts` | `tickToRarePerToken`, `tickToTokenPriceUsd`, `parseCurveConfig`, `validateCurves`, `generatePresetCurves`, `buildCurvePreview`, `getCurvePresetDefinition` |
| `src/liquid/factory-config-core.ts` | `deriveLiquidFactoryConfig`, `parseLiquidTokenSupplyAmount`, `withLiquidFactoryMaxTotalSupply`, `resolveLiquidFactoryConfigForSupply` |
| `src/liquid/factory-config.ts` | `fetchLiquidFactoryConfig` |
| `src/swap/build-route.ts` | `sortCurrencies`, `buildV4SwapStep`, `buildExactInputSingleRoute`, `buildCanonicalTokenBuyRoute`, `buildCanonicalTokenSellRoute` |
| `src/swap/known-pools.ts` | `getCanonicalRareEthPoolKey`, `getCanonicalUsdcEthPoolKey`, `getRareAddress`, `getUsdcAddress`, `getWrappedEthAddress`, `getKnownCanonicalEthPoolKey`, `getKnownCanonicalPoolSource`, `getV4Quoter` |
| `src/swap/liquid-edition.ts` | `getLiquidEditionPoolKey` |
| `src/swap/pool-core.ts` | `normalizeAddress`, `inferBaseCurrencyAddress` |
| `src/swap/quoter.ts` | `quoteExactInputSingle`, `quoteRoute` |
| `src/swap/route-encoding.ts` | `encodeRoute`, `encodeBuyRareRoute` |
| `src/swap/trade-core.ts` | `resolveSlippageBps`, `planTokenTradeLocalInputs`, `computeMinAmountOut`, `computeSlippageBpsFromAmounts`, `buildCanonicalEthTradeRoute`, `buildLiquidRouterTradeQuote`, `getQuotedRecipientAmount`, `assertSupportedUniswapRouting`, `assertRecipientSupportedForUniswapFallback`, `assertRequestedMinAmountOut`, `assertRequotedMinAmountOut`, `buildUniswapTradeQuote`, `buildBuyRareQuoteFromTokenQuote` |
| `src/swap/uniswap-api.ts` | `requestUniswapQuote`, `requestUniswapApproval`, `requestUniswapSwap` |
