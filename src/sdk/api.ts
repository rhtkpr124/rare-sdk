import { createPublicMessagingClient } from './public-messaging-client.js';
import type { PublicMessagingClient } from './types/messaging.js';
import { dropListQuery, normalizeDropId, parseDrop, type DropAnnouncement, type DropListOptions } from './drops-core.js';
import { favoritePageQuery } from './favorites-core.js';
import { normalizePostId, parsePostData, parsePost, parsePostCommentPage, postCommentQuery, parsePostPage, type CreatorPost, type CreatorPostCommentPage, type PostCommentListOptions } from './posts-core.js';
import { normalizeFavoriteId } from './favorites-core.js';
import { userQuery, type UserSelector, type UserListOptions } from './user-core.js';
export type { UserSelector, UserListOptions } from './user-core.js';
import type { LiquidEdition } from '../data-access/liquid-editions.js';
import { buildLiquidEditionSearchQuery, type LiquidEditionSearchParams } from './liquid-discovery-core.js';
import { createApiClient, type ApiClient } from '../data-access/index.js';
import type { components, paths } from '../data-access/schema.js';
import { resolveEventSearchTarget, type EventSearchTargetParams } from './event-search-core.js';
import {
  buildCollectionSearchQuery,
  buildGeneratedMediaEntry,
  buildImportErc721Body,
  buildIpfsJsonUploadPayload,
  buildIpfsUploadPlan,
  buildMediaUploadPlan,
  buildNftSearchQuery,
  buildPinMetadataBody,
  type CollectionSearchParams,
  type ImportErc721Params,
  type IpfsUploadPlan,
  type ImportErc721RequestParams,
  type MultipartUploadPart,
  type NftAttribute,
  type NftMediaEntry,
  type NftSearchParams,
  type PinMetadataParams,
} from './api-core.js';

export type { LiquidEdition, LiquidEditionMediaItem } from '../data-access/liquid-editions.js';

export type { LiquidEditionSearchParams } from './liquid-discovery-core.js';

export type RareApiOptions = {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
};

export type RareApi = {
  messaging: PublicMessagingClient;
  getDrops: (options: DropListOptions) => Promise<SearchPageResponse<DropAnnouncement>>;
  getDrop: (dropId: string) => Promise<DropAnnouncement>;
  getPosts: (user: UserSelector | string, options?: UserListOptions) => Promise<SearchPageResponse<CreatorPost>>;
  getPost: (postId: string) => Promise<CreatorPost>;
  getPostComments: (postId: string, options?: PostCommentListOptions) => Promise<CreatorPostCommentPage>;
  searchLiquidEditions: (params?: LiquidEditionSearchParams) => Promise<SearchPageResponse<LiquidEdition>>;
  getLiquidEdition: (id: string) => Promise<LiquidEdition>;
  pinFile: (buffer: Uint8Array, filename: string) => Promise<IpfsUploadResult>;
  pinJson: (value: unknown, filename?: string) => Promise<IpfsUploadResult>;
  uploadMedia: (buffer: Uint8Array, filename: string) => Promise<NftMediaEntry>;
  pinMetadata: (opts: PinMetadataParams) => Promise<string>;
  importErc721: (opts: ImportErc721RequestParams) => Promise<void>;
  searchNfts: (params?: NftSearchParams) => Promise<SearchPageResponse<Nft>>;
  searchCollections: (params?: CollectionSearchParams) => Promise<SearchPageResponse<Collection>>;
  searchEvents: (params: EventSearchParams) => Promise<SearchPageResponse<NftEvent>>;
  getNft: (universalTokenId: string) => Promise<Nft>;
  getNftFavoriteCount: (universalTokenId: string) => Promise<number>;
  getNftEvents: (universalTokenId: string, opts?: NftEventOptions) => Promise<SearchPageResponse<NftEvent>>;
  getCollection: (id: string) => Promise<Collection>;
  getCollectionEvents: (id: string, opts?: CollectionEventOptions) => Promise<SearchPageResponse<NftEvent>>;
  getUser: (address: string | UserSelector) => Promise<UserProfile>;
  resolveUser: (input: UserSelector) => Promise<UserProfile>;
  getUserFollowers: (input: UserSelector | string, options?: UserListOptions) => Promise<SearchPageResponse<UserProfile>>;
  getUserFollowing: (input: UserSelector | string, options?: UserListOptions) => Promise<SearchPageResponse<UserProfile>>;
  getTokenPrice: (symbol: string) => Promise<{ symbol: string; priceUsd: number; decimals: number; chainId: number; address: string }>;
};

// --- Re-exported types from OpenAPI schema ---

export type Nft = components['schemas']['Nft'];
export type Collection = components['schemas']['Collection'];
export type NftEvent = components['schemas']['NftEvent'];
export type UserProfile = components['schemas']['UserProfile'];
export type Pagination = components['schemas']['Pagination'];
export type IpfsUploadResult = components['schemas']['IpfsUploadResponse'];
export type {
  CollectionSearchParams,
  ImportErc721Params,
  NftAttribute,
  NftMediaEntry,
  NftSearchParams,
  PinMetadataParams,
};

export type SearchPageResponse<T> = {
  data: T[];
  pagination: Pagination;
};

type NftEventQuery = NonNullable<paths['/v1/nfts/{universalTokenId}/events']['get']['parameters']['query']>;
type CollectionEventQuery = NonNullable<paths['/v1/collections/{id}/events']['get']['parameters']['query']>;
type NftEventType = NonNullable<NftEventQuery['eventType']>[number];
type CollectionEventType = NonNullable<CollectionEventQuery['eventType']>[number];
export type NftEventOptions = { page?: number; perPage?: number; eventType?: NftEventType | NftEventType[]; sortBy?: NftEventQuery['sortBy'] };
export type CollectionEventOptions = { page?: number; perPage?: number; eventType?: CollectionEventType | CollectionEventType[]; sortBy?: CollectionEventQuery['sortBy'] };
export type EventSearchParams = EventSearchTargetParams & NftEventOptions;

// --- Multipart upload (uses presigned URLs directly, not via openapi-fetch) ---

async function uploadParts(
  fileBuffer: Uint8Array,
  partSize: number,
  presignedUrls: string[],
  fetchImpl: typeof globalThis.fetch,
): Promise<MultipartUploadPart[]> {
  return Promise.all(presignedUrls.map(async (presignedUrl, index): Promise<MultipartUploadPart> => {
    const start = index * partSize;
    const end = start + partSize;
    const partBuffer = fileBuffer.subarray(start, end);

    const response = await fetchImpl(presignedUrl, {
      method: 'PUT',
      body: new Uint8Array(partBuffer),
    });

    if (response.status !== 200 && response.status !== 204) {
      throw new Error(`Part ${index + 1} upload failed with status ${response.status}`);
    }

    const etag = response.headers.get('etag');
    if (!etag) {
      throw new Error(`Missing etag header for part ${index + 1}`);
    }

    return { ETag: etag, PartNumber: index + 1 };
  }));
}

// --- Public API functions ---

export function createRareApi(options: RareApiOptions = {}): RareApi {
  const client = createApiClient(options.baseUrl, options.fetch);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  const resolveUser = async (input: UserSelector): Promise<UserProfile> => {
    const { data } = await client.GET('/v1/users', { params: { query: userQuery(input) } });
    if (!data) throw new Error('User not found.');
    return data.data;
  };
  return {
    messaging: createPublicMessagingClient(client),
    async getDrops(options) { const { data } = await client.GET('/v1/drops', { params: { query: dropListQuery(options) } }); return parsePostPage(data, parseDrop); },
    async getDrop(dropId) { const id = normalizeDropId(dropId); const { data } = await client.GET('/v1/drops/{dropId}', { params: { path: { dropId: id } } }); return parsePostData(data, parseDrop); },
    async getPosts(input, options) { const { data } = await client.GET('/v1/posts', { params: { query: userQuery(input, favoritePageQuery(options)) } }); return parsePostPage(data, parsePost); },
    async getPost(postId) { const id = normalizePostId(postId); const { data } = await client.GET('/v1/posts/{postId}', { params: { path: { postId: id } } }); return parsePostData(data, parsePost); },
    async getPostComments(postId, options) { const id = normalizePostId(postId); const { data } = await client.GET('/v1/posts/{postId}/comments', { params: { path: { postId: id }, query: postCommentQuery(options) } }); return parsePostCommentPage(data); },
    pinFile: async (buffer, filename) => pinFileWithClient(client, fetchImpl, buffer, filename),
    pinJson: async (value, filename) => pinJsonWithClient(client, fetchImpl, value, filename),
    uploadMedia: async (buffer, filename) => uploadMediaWithClient(client, fetchImpl, buffer, filename),
    pinMetadata: async (opts) => pinMetadataWithClient(client, opts),
    importErc721: async (opts) => importErc721WithClient(client, opts),
    searchLiquidEditions: async (params = {}) => searchLiquidEditionsWithClient(client, params),
    getLiquidEdition: async (id) => getLiquidEditionWithClient(client, id),
    searchNfts: async (params = {}) => searchNftsWithClient(client, params),
    searchCollections: async (params = {}) => searchCollectionsWithClient(client, params),
    searchEvents: async (params) => searchEventsWithClient(client, params),
    getNftFavoriteCount: async (universalTokenId) => {
      const id = normalizeFavoriteId(universalTokenId);
      const { data } = await client.GET('/v1/nfts/{universalTokenId}/favorites/count', { params: { path: { universalTokenId: id } } });
      if (!data) throw new Error('Invalid favorite count response.');
      return data.data.count;
    },
    getNft: async (universalTokenId) => getNftWithClient(client, universalTokenId),
    getNftEvents: async (universalTokenId, opts) => getNftEventsWithClient(client, universalTokenId, opts),
    getCollection: async (id) => getCollectionWithClient(client, id),
    getCollectionEvents: async (id, opts) => getCollectionEventsWithClient(client, id, opts),
    getUser: async (input) => typeof input === 'string' ? getUserWithClient(client, userQuery(input).address ?? input) : resolveUser(input),
    resolveUser,
    getUserFollowers: async (input, options) => {
      const { data } = await client.GET('/v1/users/followers', { params: { query: userQuery(input, options) } });
      if (!data) throw new Error('Invalid followers response.');
      return data;
    },
    getUserFollowing: async (input, options) => {
      const { data } = await client.GET('/v1/users/following', { params: { query: userQuery(input, options) } });
      if (!data) throw new Error('Invalid following response.');
      return data;
    },
    getTokenPrice: async (symbol) => getTokenPriceWithClient(client, symbol),
  };
}

function createDefaultRareApi(): ReturnType<typeof createRareApi> {
  return createRareApi();
}

export async function uploadMedia(buffer: Uint8Array, filename: string): Promise<NftMediaEntry> {
  return createDefaultRareApi().uploadMedia(buffer, filename);
}

export async function pinFile(buffer: Uint8Array, filename: string): Promise<IpfsUploadResult> {
  return createDefaultRareApi().pinFile(buffer, filename);
}

export async function pinJson(value: unknown, filename?: string): Promise<IpfsUploadResult> {
  return createDefaultRareApi().pinJson(value, filename);
}

async function pinFileWithClient(
  client: ApiClient,
  fetchImpl: typeof globalThis.fetch,
  buffer: Uint8Array,
  filename: string,
): Promise<IpfsUploadResult> {
  return completeIpfsUploadWithClient(client, fetchImpl, buffer, buildIpfsUploadPlan(buffer, filename));
}

async function pinJsonWithClient(
  client: ApiClient,
  fetchImpl: typeof globalThis.fetch,
  value: unknown,
  filename?: string,
): Promise<IpfsUploadResult> {
  const payload = buildIpfsJsonUploadPayload(value, filename);
  return completeIpfsUploadWithClient(client, fetchImpl, payload.buffer, buildIpfsUploadPlan(payload.buffer, payload.filename));
}

async function uploadMediaWithClient(
  client: ApiClient,
  fetchImpl: typeof globalThis.fetch,
  buffer: Uint8Array,
  filename: string,
): Promise<NftMediaEntry> {
  const upload = buildMediaUploadPlan(buffer, filename);
  const complete = await completeIpfsUploadWithClient(client, fetchImpl, buffer, upload);

  const { data: generated } = await client.POST('/v1/nfts/metadata/media/generate', {
    body: { uri: complete.ipfsUrl, mimeType: upload.mimeType },
  });
  if (!generated) throw new Error('Failed to generate media metadata');

  return buildGeneratedMediaEntry(generated.media, upload.fileSize);
}

async function completeIpfsUploadWithClient(
  client: ApiClient,
  fetchImpl: typeof globalThis.fetch,
  buffer: Uint8Array,
  upload: IpfsUploadPlan,
): Promise<IpfsUploadResult> {
  const { data: init } = await client.POST('/v1/nfts/metadata/media/uploads', {
    body: { fileSize: upload.fileSize, filename: upload.filename },
  });
  if (!init) throw new Error('Failed to initiate IPFS upload');

  const parts = await uploadParts(buffer, init.partSize, init.presignedUrls, fetchImpl);

  const { data: complete } = await client.POST('/v1/nfts/metadata/media/uploads/complete', {
    body: {
      key: init.key,
      uploadId: init.uploadId,
      bucket: init.bucket,
      parts,
    },
  });
  if (!complete) throw new Error('Failed to complete IPFS upload');

  return complete;
}

export async function pinMetadata(opts: PinMetadataParams): Promise<string> {
  return createDefaultRareApi().pinMetadata(opts);
}

async function pinMetadataWithClient(client: ApiClient, opts: PinMetadataParams): Promise<string> {
  const { data: result } = await client.POST('/v1/nfts/metadata', {
    body: buildPinMetadataBody(opts),
  });
  if (!result) throw new Error('Failed to pin metadata');

  return result.ipfsUrl;
}

export async function importErc721(opts: ImportErc721RequestParams): Promise<void> {
  return createDefaultRareApi().importErc721(opts);
}

async function importErc721WithClient(client: ApiClient, opts: ImportErc721RequestParams): Promise<void> {
  const { data: result } = await client.POST('/v1/collections/import', {
    body: buildImportErc721Body(opts),
  });
  if (!result) throw new Error('Failed to import ERC-721 collection');
}

export async function searchNfts(params: NftSearchParams = {}): Promise<SearchPageResponse<Nft>> {
  return createDefaultRareApi().searchNfts(params);
}

async function searchNftsWithClient(client: ApiClient, params: NftSearchParams = {}): Promise<SearchPageResponse<Nft>> {
  const { data } = await client.GET('/v1/nfts', {
    params: {
      query: buildNftSearchQuery(params),
    },
  });
  if (!data) throw new Error('Failed to search NFTs');

  return data;
}

export async function searchCollections(params: CollectionSearchParams = {}): Promise<SearchPageResponse<Collection>> {
  return createDefaultRareApi().searchCollections(params);
}

export async function searchEvents(params: EventSearchParams): Promise<SearchPageResponse<NftEvent>> {
  return createDefaultRareApi().searchEvents(params);
}

async function searchCollectionsWithClient(
  client: ApiClient,
  params: CollectionSearchParams = {},
): Promise<SearchPageResponse<Collection>> {
  const { data } = await client.GET('/v1/collections', {
    params: {
      query: buildCollectionSearchQuery(params),
    },
  });
  if (!data) throw new Error('Failed to search collections');

  return data;
}

async function searchEventsWithClient(
  client: ApiClient,
  params: EventSearchParams,
): Promise<SearchPageResponse<NftEvent>> {
  const target = resolveEventSearchTarget(params);
  const opts: NftEventOptions = {
    page: params.page,
    perPage: params.perPage,
    eventType: params.eventType,
    sortBy: params.sortBy,
  };

  if (target.kind === 'nft') {
    return getNftEventsWithClient(client, target.universalTokenId, opts);
  }

  return getCollectionEventsWithClient(client, target.collectionId, opts);
}

export async function getNft(universalTokenId: string): Promise<Nft> {
  return createDefaultRareApi().getNft(universalTokenId);
}

async function getNftWithClient(client: ApiClient, universalTokenId: string): Promise<Nft> {
  const { data } = await client.GET('/v1/nfts/{universalTokenId}', {
    params: { path: { universalTokenId } },
  });
  if (!data) throw new Error(`NFT not found: ${universalTokenId}`);

  return data.data;
}

export async function getNftEvents(
  universalTokenId: string,
  opts?: NftEventOptions,
): Promise<SearchPageResponse<NftEvent>> {
  return createDefaultRareApi().getNftEvents(universalTokenId, opts);
}

async function getNftEventsWithClient(
  client: ApiClient,
  universalTokenId: string,
  opts?: NftEventOptions,
): Promise<SearchPageResponse<NftEvent>> {
  const { data } = await client.GET('/v1/nfts/{universalTokenId}/events', {
    params: {
      path: { universalTokenId },
      query: {
        page: opts?.page,
        perPage: opts?.perPage,
        eventType: normalizeNftEventType(opts?.eventType),
        sortBy: opts?.sortBy,
      },
    },
  });
  if (!data) throw new Error(`Failed to get events for NFT: ${universalTokenId}`);

  return data;
}

export async function getCollection(id: string): Promise<Collection> {
  return createDefaultRareApi().getCollection(id);
}

async function getCollectionWithClient(client: ApiClient, id: string): Promise<Collection> {
  const { data } = await client.GET('/v1/collections/{id}', {
    params: { path: { id } },
  });
  if (!data) throw new Error(`Collection not found: ${id}`);

  return data.data;
}

export async function getCollectionEvents(
  id: string,
  opts?: CollectionEventOptions,
): Promise<SearchPageResponse<NftEvent>> {
  return createDefaultRareApi().getCollectionEvents(id, opts);
}

async function getCollectionEventsWithClient(
  client: ApiClient,
  id: string,
  opts?: CollectionEventOptions,
): Promise<SearchPageResponse<NftEvent>> {
  const { data } = await client.GET('/v1/collections/{id}/events', {
    params: {
      path: { id },
      query: {
        page: opts?.page,
        perPage: opts?.perPage,
        eventType: normalizeCollectionEventType(opts?.eventType),
        sortBy: opts?.sortBy,
      },
    },
  });
  if (!data) throw new Error(`Failed to get events for collection: ${id}`);

  return data;
}

function normalizeNftEventType(
  eventType: NftEventOptions['eventType'] | undefined,
): NftEventQuery['eventType'] | undefined {
  if (eventType === undefined) {
    return undefined;
  }
  return Array.isArray(eventType) ? eventType : [eventType];
}

function normalizeCollectionEventType(
  eventType: CollectionEventOptions['eventType'] | undefined,
): CollectionEventQuery['eventType'] | undefined {
  if (eventType === undefined) {
    return undefined;
  }
  return Array.isArray(eventType) ? eventType : [eventType];
}

export async function getUser(address: string | UserSelector): Promise<UserProfile> {
  return createDefaultRareApi().getUser(address);
}

async function getUserWithClient(client: ApiClient, address: string): Promise<UserProfile> {
  const { data } = await client.GET('/v1/users/{address}', {
    params: { path: { address } },
  });
  if (!data) throw new Error(`User not found: ${address}`);

  return data.data;
}

export async function getTokenPrice(symbol: string): Promise<{ symbol: string; priceUsd: number; decimals: number; chainId: number; address: string }> {
  return createDefaultRareApi().getTokenPrice(symbol);
}

async function getTokenPriceWithClient(
  client: ApiClient,
  symbol: string,
): Promise<{ symbol: string; priceUsd: number; decimals: number; chainId: number; address: string }> {
  const { data } = await client.GET('/v1/tokens/price/{symbol}', {
    params: { path: { symbol } },
  });
  if (!data) throw new Error(`Token price not found: ${symbol}`);

  return data.data;
}

export async function searchLiquidEditions(params: LiquidEditionSearchParams = {}): Promise<SearchPageResponse<LiquidEdition>> {
  return createDefaultRareApi().searchLiquidEditions(params);
}

async function searchLiquidEditionsWithClient(
  client: ApiClient,
  params: LiquidEditionSearchParams,
): Promise<SearchPageResponse<LiquidEdition>> {
  const { data } = await client.GET('/v1/liquid-editions', {
    params: { query: buildLiquidEditionSearchQuery(params) },
  });
  if (!data) throw new Error('Failed to search liquid editions');
  return data;
}

/** Fetch indexed discovery data by chainId-contractAddress. */
export async function getLiquidEdition(id: string): Promise<LiquidEdition> {
  return createDefaultRareApi().getLiquidEdition(id);
}

async function getLiquidEditionWithClient(client: ApiClient, id: string): Promise<LiquidEdition> {
  const { data } = await client.GET('/v1/liquid-editions/{id}', {
    params: { path: { id } },
  });
  if (!data) throw new Error(`Failed to get liquid edition: ${id}`);
  return data.data;
}
