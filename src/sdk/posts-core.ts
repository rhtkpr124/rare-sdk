import { isRecord } from './account-auth-core.js';
import { featureError, requireFeatureString as requireString } from './feature-error.js';
import { favoritePageQuery } from './favorites-core.js';
import type { SearchPageResponse } from './api.js';
import type { components } from '../data-access/schema.js';

export type CreatorPost = components['schemas']['CreatorPost'];
export type CreatorPostComment = components['schemas']['CreatorPostComment'];
export type PostCommentListOptions = { page?: number; perPage?: number; parentCommentId?: string; afterCommentId?: string };
export type CreatorPostCommentPage = SearchPageResponse<CreatorPostComment> & { nextCursor: string | null };
export type CreatePostInput = { title: string; body: string; imageUrls?: string[] };
export function normalizePostId(value: string): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw featureError('invalid_post_id');
  return value;
}
export function planCreatePost(input: CreatePostInput): CreatePostInput {
  if (!isRecord(input) || Object.keys(input).some(key => !['title', 'body', 'imageUrls'].includes(key))) throw featureError('invalid_post');
  const title = postText(input.title, 120);
  const body = postText(input.body, 5000);
  if (input.imageUrls === undefined) return { title, body };
  if (!Array.isArray(input.imageUrls) || input.imageUrls.length > 5 || input.imageUrls.some(url => typeof url !== 'string' || !URL.canParse(url) || !['https:', 'http:'].includes(new URL(url).protocol))) throw featureError('invalid_post_images');
  return { title, body, imageUrls: [...input.imageUrls] };
}
export function postText(value: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw featureError('invalid_post_text');
  return value.trim();
}
export function planPostComment(body: string, parentCommentId?: string): { body: string; parentCommentId?: string } {
  return { body: postText(body, 1000), ...(parentCommentId === undefined ? {} : { parentCommentId: normalizePostId(parentCommentId) }) };
}
export function postCommentQuery(options: PostCommentListOptions = {}): { page: number; perPage: number; parentCommentId?: string; afterCommentId?: string } {
  const pagination = favoritePageQuery(options);
  if ((options.afterCommentId !== undefined && options.parentCommentId === undefined) || (options.parentCommentId !== undefined && pagination.page !== 1)) throw featureError('invalid_reply_pagination');
  return { ...pagination, ...(options.parentCommentId === undefined ? {} : { parentCommentId: normalizePostId(options.parentCommentId) }), ...(options.afterCommentId === undefined ? {} : { afterCommentId: normalizePostId(options.afterCommentId) }) };
}
export function parsePost(value: unknown): CreatorPost {
  if (!isRecord(value) || !Array.isArray(value.imageUrls) || !value.imageUrls.every(url => typeof url === 'string')) throw featureError('invalid_post_response');
  return {
    id: normalizePostId(requireString(value.id, 'id')), creatorUserId: normalizePostId(requireString(value.creatorUserId, 'creatorUserId')),
    title: requireString(value.title, 'title'), body: requireString(value.body, 'body'), imageUrls: value.imageUrls,
    commentCount: count(value.commentCount), likeCount: count(value.likeCount),
    publishedAt: requireString(value.publishedAt, 'publishedAt'), createdAt: requireString(value.createdAt, 'createdAt'), updatedAt: requireString(value.updatedAt, 'updatedAt'),
  };
}
export function parsePostComment(value: unknown): CreatorPostComment {
  if (!isRecord(value)) throw featureError('invalid_post_response');
  return {
    id: normalizePostId(requireString(value.id, 'id')), postId: normalizePostId(requireString(value.postId, 'postId')), authorUserId: normalizePostId(requireString(value.authorUserId, 'authorUserId')),
    parentCommentId: value.parentCommentId === undefined || value.parentCommentId === null ? null : normalizePostId(requireString(value.parentCommentId, 'parentCommentId')), replyCount: count(value.replyCount ?? 0),
    body: requireString(value.body, 'body'), createdAt: requireString(value.createdAt, 'createdAt'), updatedAt: requireString(value.updatedAt, 'updatedAt'),
  };
}
export function parsePostData<T>(value: unknown, parse: (value: unknown) => T): T {
  if (!isRecord(value)) throw featureError('invalid_post_response');
  return parse(value.data);
}
export function parsePostPage<T>(value: unknown, parse: (value: unknown) => T): SearchPageResponse<T> {
  if (!isRecord(value) || !Array.isArray(value.data) || !isRecord(value.pagination)) throw featureError('invalid_post_response');
  const pagination = value.pagination;
  const { page, perPage } = favoritePageQuery({ page: count(pagination.page), perPage: count(pagination.perPage) });
  return { data: value.data.map(parse), pagination: { page, perPage, totalCount: count(pagination.totalCount), totalPages: count(pagination.totalPages) } };
}
export function parsePostCommentPage(value: unknown): CreatorPostCommentPage {
  if (!isRecord(value)) throw featureError('invalid_post_response');
  return { ...parsePostPage(value, parsePostComment), nextCursor: value.nextCursor === undefined || value.nextCursor === null ? null : normalizePostId(requireString(value.nextCursor, 'nextCursor')) };
}
export function parsePostDeleted(value: unknown): void {
  if (!isRecord(value) || !isRecord(value.data) || value.data.deleted !== true) throw featureError('invalid_post_response');
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw featureError('invalid_post_response');
  return value;
}
