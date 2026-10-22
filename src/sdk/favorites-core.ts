import { isAddress } from 'viem';
import { isRecord } from './account-auth-core.js';
import { featureError, requireFeatureString as requireString } from './feature-error.js';
import { buildNftUniversalTokenId, type NftIdentityParams } from './nft-core.js';
import type { SearchPageResponse } from './api.js';

export type ArtworkFavorite = {
  universalTokenId: string; chainId: string; contractAddress: string; tokenId: string;
  createdAt: string; metadata: { name: string | null };
};
export type FavoriteArtworkInput = string | NftIdentityParams;
export type FavoritesListOptions = { page?: number; perPage?: number };

export function normalizeFavoriteId(input: FavoriteArtworkInput): string {
  const value = typeof input === 'string' ? input : buildNftUniversalTokenId(input);
  const parts = value.split('-');
  const [chainId, contractAddress, tokenId] = parts;
  if (parts.length !== 3 || chainId === undefined || !/^[0-9]+$/.test(chainId) ||
      !Number.isSafeInteger(Number(chainId)) || Number(chainId) <= 0 ||
      contractAddress === undefined || !isAddress(contractAddress, { strict: false }) ||
      tokenId === undefined || !/^[0-9]+$/.test(tokenId) || BigInt(tokenId) >= 2n ** 256n) {
    throw featureError('invalid_artwork');
  }
  return `${Number(chainId)}-${contractAddress.toLowerCase()}-${BigInt(tokenId)}`;
}
export function favoritePageQuery(options: FavoritesListOptions = {}): { page: number; perPage: number } {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 20;
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100 || (page - 1) * perPage > 2147483647) throw featureError('invalid_pagination');
  return { page, perPage };
}
const nonnegativeInteger = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw featureError('invalid_favorite_response');
  return value;
};
export function parseFavoriteStatus(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.data) || typeof value.data.favorited !== 'boolean') throw featureError('invalid_favorite_response');
  return value.data.favorited;
}
export function parseFavoritesPage(value: unknown): SearchPageResponse<ArtworkFavorite> {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.pagination)) throw featureError('invalid_favorite_response');
  const data = value.data.map((row: unknown): ArtworkFavorite => {
    if (!isRecord(row) || !isRecord(row.metadata) || (row.metadata.name !== null && typeof row.metadata.name !== 'string')) throw featureError('invalid_favorite_response');
    return {
      universalTokenId: normalizeFavoriteId(requireString(row.universalTokenId, 'universalTokenId')),
      chainId: requireString(row.chainId, 'chainId'), contractAddress: requireString(row.contractAddress, 'contractAddress'),
      tokenId: requireString(row.tokenId, 'tokenId'), createdAt: requireString(row.createdAt, 'createdAt'), metadata: { name: row.metadata.name },
    };
  });
  const pagination = value.pagination;
  const page = nonnegativeInteger(pagination.page);
  const perPage = nonnegativeInteger(pagination.perPage);
  favoritePageQuery({ page, perPage });
  return { data, pagination: { page, perPage, totalCount: nonnegativeInteger(pagination.totalCount), totalPages: nonnegativeInteger(pagination.totalPages) } };
}
