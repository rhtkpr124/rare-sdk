import { isRecord } from './account-auth-core.js';
import { featureError, requireFeatureString as requireString } from './feature-error.js';
import { favoritePageQuery } from './favorites-core.js';
import { userQuery } from './user-core.js';
import type { UserSelector } from './user-core.js';
import type { components } from '../data-access/schema.js';

export type DropAnnouncement = components['schemas']['DropAnnouncement'];
export type DropType = 'NONE' | 'SINGLE_ARTWORK' | 'EDITION' | 'RELEASE' | 'LIQUID_EDITION';
export type DropMetadataInput = { headline: string; description: string; destinationUrl: string; imageUrl: string };
export type CreateDropInput = { type: DropType; startsAt: string; metadata: DropMetadataInput };
export type UpdateDropInput = { type?: DropType; startsAt?: string; metadata?: Partial<DropMetadataInput> };
export type DropListOptions = {
  from: string; to: string; user?: UserSelector; page?: number; perPage?: number;
  type?: DropType; isCurated?: boolean; isFeatured?: boolean;
  sortBy?: 'STARTS_AT' | 'CREATED_AT' | 'UPDATED_AT'; sortDirection?: 'ASC' | 'DESC';
};
const types: readonly string[] = ['NONE', 'SINGLE_ARTWORK', 'EDITION', 'RELEASE', 'LIQUID_EDITION'];
export function normalizeDropId(value: string): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw featureError('invalid_drop_id');
  return value;
}
function dropType(value: unknown): DropType {
  if (value === 'NONE' || value === 'SINGLE_ARTWORK' || value === 'EDITION' || value === 'RELEASE' || value === 'LIQUID_EDITION') return value;
  throw featureError('invalid_drop_type');
}
function timestamp(value: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw featureError('invalid_drop_time');
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = month === 2 ? (leapYear ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) throw featureError('invalid_drop_time');
  return value;
}
function text(value: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw featureError('invalid_drop_text');
  return value.trim();
}
function httpsUrl(value: string, allowEmpty = false): string {
  if (allowEmpty && value === '') return value;
  if (typeof value !== 'string' || value.length > 2048 || !URL.canParse(value) || new URL(value).protocol !== 'https:') throw featureError('invalid_drop_url');
  return value;
}
export function planDropUpdate(input: UpdateDropInput): UpdateDropInput {
  if (!isRecord(input) || Object.keys(input).some(key => !['type', 'startsAt', 'metadata'].includes(key))) throw featureError('invalid_drop');
  const metadata = input.metadata;
  if (metadata !== undefined && (!isRecord(metadata) || Object.keys(metadata).some(key => !['headline', 'description', 'destinationUrl', 'imageUrl'].includes(key)))) throw featureError('invalid_drop_metadata');
  const plannedMetadata = metadata === undefined ? undefined : {
    ...(metadata.headline === undefined ? {} : { headline: text(metadata.headline, 120) }),
    ...(metadata.description === undefined ? {} : { description: text(metadata.description, 300) }),
    ...(metadata.destinationUrl === undefined ? {} : { destinationUrl: httpsUrl(metadata.destinationUrl, true) }),
    ...(metadata.imageUrl === undefined ? {} : { imageUrl: httpsUrl(metadata.imageUrl) }),
  };
  if (input.type === undefined && input.startsAt === undefined && (plannedMetadata === undefined || Object.keys(plannedMetadata).length === 0)) throw featureError('empty_drop_update');
  return {
    ...(input.type === undefined ? {} : { type: dropType(input.type) }),
    ...(input.startsAt === undefined ? {} : { startsAt: timestamp(input.startsAt) }),
    ...(plannedMetadata === undefined ? {} : { metadata: plannedMetadata }),
  };
}
export function planCreateDrop(input: CreateDropInput): CreateDropInput {
  const plan = planDropUpdate(input);
  if (plan.type === undefined || plan.startsAt === undefined || plan.metadata?.headline === undefined || plan.metadata.description === undefined || plan.metadata.destinationUrl === undefined || plan.metadata.imageUrl === undefined) throw featureError('invalid_drop');
  return { type: plan.type, startsAt: plan.startsAt, metadata: { headline: plan.metadata.headline, description: plan.metadata.description, destinationUrl: plan.metadata.destinationUrl, imageUrl: plan.metadata.imageUrl } };
}
export function dropListQuery(input: DropListOptions) {
  if (!isRecord(input) || Object.keys(input).some(key => !['from', 'to', 'user', 'page', 'perPage', 'type', 'isCurated', 'isFeatured', 'sortBy', 'sortDirection'].includes(key))) throw featureError('invalid_drop_query');
  const from = timestamp(input.from); const to = timestamp(input.to);
  if (Date.parse(to) < Date.parse(from) || Date.parse(to) - Date.parse(from) > 30 * 86400000) throw featureError('invalid_drop_window');
  const page = favoritePageQuery(input);
  if ((page.page - 1) * page.perPage > 10000) throw featureError('invalid_drop_page');
  if (input.type !== undefined && !types.includes(input.type)) throw featureError('invalid_drop_type');
  if ((input.isCurated !== undefined && typeof input.isCurated !== 'boolean') || (input.isFeatured !== undefined && typeof input.isFeatured !== 'boolean') || (input.sortBy !== undefined && !['STARTS_AT', 'CREATED_AT', 'UPDATED_AT'].includes(input.sortBy)) || (input.sortDirection !== undefined && !['ASC', 'DESC'].includes(input.sortDirection))) throw featureError('invalid_drop_query');
  return { from, to, ...page, ...(input.user === undefined ? {} : userQuery(input.user)), ...(input.type === undefined ? {} : { type: input.type }), ...(input.isCurated === undefined ? {} : { isCurated: input.isCurated ? 'true' as const : 'false' as const }), ...(input.isFeatured === undefined ? {} : { isFeatured: input.isFeatured ? 'true' as const : 'false' as const }), ...(input.sortBy === undefined ? {} : { sortBy: input.sortBy }), ...(input.sortDirection === undefined ? {} : { sortDirection: input.sortDirection }) };
}
export function parseDrop(value: unknown): DropAnnouncement {
  if (!isRecord(value) || !isRecord(value.metadata) || typeof value.isCurated !== 'boolean' || typeof value.isFeatured !== 'boolean') throw featureError('invalid_drop_response');
  const metadata = value.metadata;
  if (typeof metadata.destinationUrl !== 'string') throw featureError('invalid_drop_response');
  return {
    id: normalizeDropId(requireString(value.id, 'id')), userId: normalizeDropId(requireString(value.userId, 'userId')),
    creatorAddress: requireString(value.creatorAddress, 'creatorAddress'), type: dropType(value.type), startsAt: timestamp(requireString(value.startsAt, 'startsAt')),
    createdAt: timestamp(requireString(value.createdAt, 'createdAt')), updatedAt: timestamp(requireString(value.updatedAt, 'updatedAt')), isCurated: value.isCurated, isFeatured: value.isFeatured,
    metadata: { headline: requireString(metadata.headline, 'headline'), description: requireString(metadata.description, 'description'), destinationUrl: metadata.destinationUrl, imageObjectKey: requireString(metadata.imageObjectKey, 'imageObjectKey'), ...(metadata.imageUrl === undefined ? {} : { imageUrl: httpsUrl(requireString(metadata.imageUrl, 'imageUrl')) }), ...(metadata.slug === undefined ? {} : { slug: requireString(metadata.slug, 'slug') }) },
  };
}
