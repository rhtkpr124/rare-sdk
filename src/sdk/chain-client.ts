import { getContractAddresses, chainIds } from '../contracts/addresses.js';
import type { Address } from 'viem';
import { createRareApi } from './api.js';
import type { RareClientConfig, RareChainFeatures as RareClient } from './types/client.js';
import { resolveChainFromPublicClient } from './wallet-shell.js';
import { createDeployNamespace } from './deploy.js';
import { createCollectionMint } from './mint.js';
import { createAuctionNamespace } from './auction.js';
import { createOfferNamespace } from './offer.js';
import { createListingNamespace } from './listing.js';
import { createBatchListingNamespace } from './batch-listing.js';
import { createBatchAuctionNamespace } from './batch-auction.js';
import { createBatchOfferNamespace } from './batch-offer.js';
import { createTokenNamespace } from './token.js';
import { createCurrencyNamespace } from './currency.js';
import { createLiquidNamespace } from './liquid.js';
import { createBridgeNamespace } from './bridge.js';
import { createSwapNamespace } from './swap.js';
import { createReleaseNamespace } from './release.js';
import { createCollectionNamespace } from './collection.js';
import { createUtilsNamespace } from './utils.js';
import { buildNftUniversalTokenId } from './nft-core.js';
import {
  createErc1155CollectionNamespace,
  createErc1155DeployNamespace,
  createErc1155ListingNamespace,
  createErc1155OfferNamespace,
} from './erc1155.js';
import { createWalletClientWithCallsFallback } from './transaction-fallback-shell.js';

export type * from './types/client.js';

/**
 * Creates a chain-bound RARE SDK client from viem clients.
 *
 * The returned client derives its RARE network from `config.publicClient.chain`.
 * Read-only namespaces such as `search`, `nft`, `collection.get`, `token`,
 * and `currency` only require a public client. Write flows such as minting,
 * listings, offers, auctions, imports, releases, and swaps require a wallet
 * client and may also use `config.account` when the viem wallet client does
 * not expose one directly.
 *
 * Create a separate RareClient for each chain you want to read or write. SDK
 * methods intentionally reject per-call `chain` or `chainId` overrides when
 * the client already knows its chain.
 *
 * See the generated [SDK Client Methods](/sdk/client-methods) page for the
 * flat list of callable `rare.*` methods exposed by the returned client.
 *
 * @example
 * ```ts
 * import { createPublicClient, createWalletClient, http } from 'viem';
 * import { privateKeyToAccount } from 'viem/accounts';
 * import { sepolia } from 'viem/chains';
 * import { createRareClient } from '@rareprotocol/rare-sdk';
 *
 * const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
 * const publicClient = createPublicClient({
 *   chain: sepolia,
 *   transport: http(process.env.RPC_URL),
 * });
 * const walletClient = createWalletClient({
 *   account,
 *   chain: sepolia,
 *   transport: http(process.env.RPC_URL),
 * });
 *
 * const rare = createRareClient({ publicClient, walletClient });
 *
 * const nfts = await rare.search.nfts({ query: 'portrait', perPage: 10 });
 * const token = await rare.nft.get({
 *   contract: '0x...',
 *   tokenId: '1',
 * });
 * ```
 */
export function createChainClient(config: RareClientConfig, api = createRareApi({ baseUrl: config.apiBaseUrl, fetch: config.apiFetch })): RareClient {
  const { publicClient } = config;
  const runtimeConfig: RareClientConfig = config.walletClient === undefined
    ? config
    : {
        ...config,
        walletClient: createWalletClientWithCallsFallback(publicClient, config.walletClient),
      };
  const chain = resolveChainFromPublicClient(publicClient);
  const chainId = chainIds[chain];
  const addresses = getContractAddresses(chain);
  const release = createReleaseNamespace(publicClient, runtimeConfig, chain, addresses);
  const collectionDeploy = {
    ...createDeployNamespace(publicClient, runtimeConfig, addresses),
    ...createErc1155DeployNamespace(publicClient, runtimeConfig, chain, addresses),
  };
  const collectionMint = createCollectionMint(publicClient, runtimeConfig);
  const erc1155Collection = createErc1155CollectionNamespace(publicClient, runtimeConfig);
  const batchListingAddresses = {
    get batchListing(): Address {
      if (!addresses.batchListing) {
        throw new Error(
          `Batch listing marketplace is not deployed on "${chain}". Available on: mainnet, sepolia.`,
        );
      }
      return addresses.batchListing;
    },
    get marketplaceSettings(): Address {
      if (!addresses.marketplaceSettings) {
        throw new Error(
          `Marketplace settings is not configured for batch listings on "${chain}". Available on: mainnet, sepolia.`,
        );
      }
      return addresses.marketplaceSettings;
    },
    get erc20ApprovalManager(): Address {
      if (!addresses.erc20ApprovalManager) {
        throw new Error(
          `ERC20 approval manager is not deployed on "${chain}". Available on: mainnet, sepolia.`,
        );
      }
      return addresses.erc20ApprovalManager;
    },
    get erc721ApprovalManager(): Address {
      if (!addresses.erc721ApprovalManager) {
        throw new Error(
          `ERC721 approval manager is not deployed on "${chain}". Available on: mainnet, sepolia.`,
        );
      }
      return addresses.erc721ApprovalManager;
    },
    chain,
    chainId,
  };
  const auction = {
    ...createAuctionNamespace(publicClient, runtimeConfig, chain, addresses),
    batch: createBatchAuctionNamespace(publicClient, runtimeConfig, chain),
  };
  const offer = {
    ...createOfferNamespace(publicClient, runtimeConfig, chain, addresses),
    erc1155: createErc1155OfferNamespace(publicClient, runtimeConfig, chain, addresses),
    batch: createBatchOfferNamespace(publicClient, runtimeConfig, chain),
  };
  const listing = {
    ...createListingNamespace(publicClient, runtimeConfig, chain, addresses),
    erc1155: createErc1155ListingNamespace(publicClient, runtimeConfig, chain, addresses),
    release,
    batch: createBatchListingNamespace(publicClient, runtimeConfig, batchListingAddresses),
  };

  return {
    chain,
    chainId,
    contracts: {
      factory: addresses.factory,
      auction: addresses.auction,
      rareBridge: addresses.rareBridge,
      sovereignFactory: addresses.sovereignFactory,
      lazySovereignFactory: addresses.lazySovereignFactory,
      rareMinter: addresses.rareMinter,
      lazyBatchMintFactory: addresses.lazyBatchMintFactory,
      batchListing: addresses.batchListing,
      batchOfferCreator: addresses.batchOfferCreator,
      batchAuctionHouse: addresses.batchAuctionHouse,
      marketplaceSettings: addresses.marketplaceSettings,
      erc20ApprovalManager: addresses.erc20ApprovalManager,
      erc721ApprovalManager: addresses.erc721ApprovalManager,
      erc1155Marketplace: addresses.erc1155Marketplace,
      erc1155ContractFactory: addresses.erc1155ContractFactory,
      erc1155ApprovalManager: addresses.erc1155ApprovalManager,
      liquidFactory: addresses.liquidFactory,
      swapRouter: addresses.swapRouter,
      v4Quoter: addresses.v4Quoter,
    },
    liquidEdition: createLiquidNamespace(runtimeConfig, chain, addresses),
    bridge: createBridgeNamespace(publicClient, runtimeConfig, chain),
    swap: createSwapNamespace(runtimeConfig, chain, chainId, addresses),
    auction,
    offer,
    listing,
    utils: createUtilsNamespace(),
    token: createTokenNamespace(publicClient, chain),
    currency: createCurrencyNamespace(publicClient, chain),
    search: {
      async liquidEditions(params = {}): ReturnType<RareClient['search']['liquidEditions']> {
        assertNoClientChainOverride(params, 'rare.search.liquidEditions', chain);
        return api.searchLiquidEditions({ ...params, chainId });
      },
      async nfts(params = {}): ReturnType<RareClient['search']['nfts']> {
        assertNoClientChainOverride(params, 'rare.search.nfts', chain);
        const requestParams = { ...params, chainId };
        return api.searchNfts(requestParams);
      },

      async collections(params = {}): ReturnType<RareClient['search']['collections']> {
        assertNoClientChainOverride(params, 'rare.search.collections', chain);
        const requestParams = { ...params, chainId };
        return api.searchCollections(requestParams);
      },
      async events(params): ReturnType<RareClient['search']['events']> {
        assertNoClientChainOverride(params, 'rare.search.events', chain);
        const requestParams = params.collectionId !== undefined
          ? params
          : { ...params, chainId };
        return api.searchEvents(requestParams);
      },
    },
    nft: {
      async events(params, options) {
        assertNoClientChainOverride(params, 'rare.nft.events', chain);
        return api.getNftEvents(buildNftUniversalTokenId({ ...params, chainId }), options);
      },
      async favoriteCount(params) {
        assertNoClientChainOverride(params, 'rare.nft.favoriteCount', chain);
        return api.getNftFavoriteCount(buildNftUniversalTokenId({ ...params, chainId }));
      },
      async get(params): ReturnType<RareClient['nft']['get']> {
        assertNoClientChainOverride(params, 'rare.nft.get', chain);
        return api.getNft(buildNftUniversalTokenId({ ...params, chainId }));
      },
    },
    collection: createCollectionNamespace(
      publicClient,
      runtimeConfig,
      chain,
      {
        async get(id) {
          return api.getCollection(id);
        },
      },
      collectionDeploy,
      erc1155Collection,
      collectionMint,
    ),
    ipfs: {
      async pinFile(buffer, filename): ReturnType<RareClient['ipfs']['pinFile']> {
        return api.pinFile(buffer, filename);
      },

      async pinJson(value, filename): ReturnType<RareClient['ipfs']['pinJson']> {
        return api.pinJson(value, filename);
      },
    },
    drops: { list: api.getDrops, get: api.getDrop },
    posts: { list: api.getPosts, get: api.getPost, comments: api.getPostComments },
    user: {
      followers: { list: (input, options) => api.getUserFollowers(input, options) },
      following: { list: (input, options) => api.getUserFollowing(input, options) },
      async get(address): ReturnType<RareClient['user']['get']> {
        return api.getUser(address);
      },
    },
    media: {
      async upload(buffer, filename): ReturnType<RareClient['media']['upload']> {
        return api.uploadMedia(buffer, filename);
      },

      async pinMetadata(opts): ReturnType<RareClient['media']['pinMetadata']> {
        return api.pinMetadata(opts);
      },
    },
    import: {
      async erc721(params): ReturnType<RareClient['import']['erc721']> {
        const owner = params.owner ?? config.account ?? config.walletClient?.account?.address;
        if (!owner) {
          throw new Error('No owner available for import. Pass params.owner or provide config.account/walletClient with an account.');
        }

        await api.importErc721({
          chainId,
          contract: params.contract,
          owner,
        });
      },
    },
  };
}

function assertNoClientChainOverride(
  params: unknown,
  method: string,
  chain: string,
): void {
  if (!isRecord(params)) return;
  if (!Object.prototype.hasOwnProperty.call(params, 'chain') && !Object.prototype.hasOwnProperty.call(params, 'chainId')) {
    return;
  }

  throw new Error(
    `${method} uses the RareClient chain (${chain}). ` +
      'Create another RareClient with a different publicClient to use another chain.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
