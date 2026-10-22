import { createUtilsNamespace } from './utils.js';
import { getAddress } from 'viem';
import { resolveRareApiBaseUrl } from '../data-access/base-url.js';
import { RareAuthError } from './account-auth-core.js';
import { createPublicApiTransport } from './api-transport.js';
import { createRareApi, type RareApi } from './api.js';
import { createAccountClient } from './account-operations.js';
import { createChainClient } from './chain-client.js';
import { buildNftUniversalTokenId, resolveIdentityChainId } from './nft-core.js';
import type { RareApiClient, RareApiClientConfig, RareClient, RareExternalApiClient, RareExternalApiClientConfig, RareExternalClient, RareExternalClientConfig, RareManagedClientConfig, RarePublicFeatures } from './types/client.js';

export type * from './types/client.js';

/**
 * Creates one SDK client for public reads and authenticated account features.
 * Add a viem publicClient to enable chain-bound reads and blockchain operations,
 * and a walletClient for transactions. No blockchain RPC is needed for account
 * authentication, profiles, messaging or other off-chain features.
 *
 * An optional API transport delegates authentication to the application. That
 * client has no auth lifecycle methods; the application owns login and refresh.
 */
export function createRareClient(config: RareExternalClientConfig): RareExternalClient;
export function createRareClient(config: RareManagedClientConfig): RareClient;
export function createRareClient(config: RareExternalApiClientConfig): RareExternalApiClient;
export function createRareClient(config?: RareApiClientConfig): RareApiClient;
export function createRareClient(config: RareManagedClientConfig | RareExternalClientConfig | RareApiClientConfig | RareExternalApiClientConfig = {}): RareClient | RareExternalClient | RareApiClient | RareExternalApiClient {
  if ('authBaseUrl' in config) throw new RareAuthError('auth_url_not_supported');
  const apiBaseUrl = resolveRareApiBaseUrl(config.apiBaseUrl);
  if (config.walletClient !== undefined && config.publicClient === undefined) throw new Error('A publicClient is required when supplying walletClient.');
  const apiFetch = config.apiFetch;
  const publicApiFetch = 'transport' in config ? createPublicApiTransport(apiBaseUrl, config.transport, apiFetch) : apiFetch;
  const api = createRareApi({ baseUrl: apiBaseUrl, fetch: publicApiFetch });
  const account = 'transport' in config
    ? createAccountClient({ transport: config.transport, fetch: apiFetch })
    : createAccountClient({ apiBaseUrl, sessionStore: config.sessionStore, fetch: apiFetch });
  const publicFeatures = createPublicFeatures(api);
  const features = {
    ...publicFeatures,
    ...account,
    user: { ...publicFeatures.user, following: { ...publicFeatures.user.following, ...account.user.following } },
    drops: { ...publicFeatures.drops, ...account.drops },
    posts: { ...publicFeatures.posts, ...account.posts },
    messaging: { ...account.messaging, public: {
      ...api.messaging,
      send: account.messaging.public.send,
      history: (roomId: string, input?: Parameters<typeof account.messaging.public.history>[1], options?: Parameters<typeof account.messaging.public.history>[2]) => options?.authenticated === true
        ? account.messaging.public.history(roomId, input, options)
        : api.messaging.history(roomId, input, options),
    } },
  };
  if (config.publicClient === undefined) return features;

  const accountClient = config.accountClient ?? ('authenticatedFetch' in account ? account : undefined);
  const chain = createChainClient({ ...config, apiBaseUrl, apiFetch: publicApiFetch, accountClient }, api);
  return { ...features, ...chain, token: { ...chain.token, getPrice: api.getTokenPrice }, collection: { ...chain.collection, events: api.getCollectionEvents }, user: features.user, drops: features.drops, posts: features.posts, messaging: features.messaging };

}

function createPublicFeatures(api: RareApi): RarePublicFeatures {
  return {
    utils: createUtilsNamespace(),
    token: { getPrice: api.getTokenPrice },
    search: { liquidEditions: api.searchLiquidEditions, nfts: api.searchNfts, collections: api.searchCollections, events: api.searchEvents },
    nft: {
      get: params => api.getNft(buildNftUniversalTokenId(params)),
      favoriteCount: params => api.getNftFavoriteCount(buildNftUniversalTokenId(params)),
      events: (params, options) => api.getNftEvents(buildNftUniversalTokenId(params), options),
    },
    collection: { get: api.getCollection, events: api.getCollectionEvents },
    liquidEdition: { get: params => api.getLiquidEdition(`${resolveIdentityChainId(params)}-${getAddress(params.contract)}`) },
    user: { get: api.getUser, followers: { list: api.getUserFollowers }, following: { list: api.getUserFollowing } },
    drops: { list: api.getDrops, get: api.getDrop },
    posts: { list: api.getPosts, get: api.getPost, comments: api.getPostComments },
    messaging: { public: api.messaging },
    ipfs: { pinFile: api.pinFile, pinJson: api.pinJson },
    media: { upload: api.uploadMedia, pinMetadata: api.pinMetadata },
    import: { erc721: api.importErc721 },
  };
}
