import { createNotificationsClient } from './notifications-client.js';
import { createMessagingClient } from './messaging-client.js';
import { normalizeDropId, planCreateDrop, planDropUpdate, parseDrop } from './drops-core.js';
import { normalizePostId, planCreatePost, planPostComment, parsePost, parsePostComment, parsePostData, parsePostPage, parsePostDeleted } from './posts-core.js';
import { normalizeFavoriteId, favoritePageQuery, parseFavoritesPage, parseFavoriteStatus, type FavoriteArtworkInput } from './favorites-core.js';
import { userQuery, type UserSelector } from './user-core.js';
import { planUpload, parseUpload, parseUploadSession, uploadedOffset } from './upload-core.js';
import { isRecord } from './account-auth-core.js';
import { RareApiError } from '../data-access/errors.js';
import { featureError, featureResponse } from './feature-error.js';
import { AvatarProfileUpdateError, parseAccountProfile, planAvatarUpload, profilePatchBody, validateAccountProfilePatch } from './account-profile-core.js';
import type { RareAccountFeatures, RareAuthRequestOptions, RareUpload, RarePublicUpload, RarePrivateUpload, RareUploadOptions } from './types/account.js';

type Request = (path: string, init: RequestInit, options?: RareAuthRequestOptions, timeoutMilliseconds?: number) => Promise<Response>;

/** Feature methods share one API transport; signed storage requests use a separate fetch. */
export function createAccountFeatures(apiRequest: Request, request: Request): RareAccountFeatures {
  const jsonRequest = async (path: string, init: RequestInit, options?: RareAuthRequestOptions, timeoutMilliseconds?: number): Promise<unknown> => featureResponse(await apiRequest(path, init, options, timeoutMilliseconds), path);
  const profileRequest = async (method: 'GET' | 'PATCH', body: string | undefined, requestOptions: RareAuthRequestOptions = {}) => {
    return parseAccountProfile(await jsonRequest('v1/me', {
      method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body }),
    }, requestOptions));
  };

  function upload(file: Uint8Array | Blob, filename: string, input?: RareUploadOptions & { access?: 'public' }, requestOptions?: RareAuthRequestOptions): Promise<RarePublicUpload>;
  function upload(file: Uint8Array | Blob, filename: string, input: RareUploadOptions & { access: 'private' }, requestOptions?: RareAuthRequestOptions): Promise<RarePrivateUpload>;
  function upload(file: Uint8Array | Blob, filename: string, input: RareUploadOptions, requestOptions?: RareAuthRequestOptions): Promise<RareUpload>;
  async function upload(file: Uint8Array | Blob, filename: string, input: RareUploadOptions = {}, requestOptions: RareAuthRequestOptions = {}): Promise<RareUpload> {
    const access = input.access ?? 'public';
    if (access !== 'public' && access !== 'private') throw featureError('invalid_upload');
    const plan = planUpload(file, filename, input.contentType);
    const session = parseUploadSession(await jsonRequest('v1/uploads', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ access, size: plan.file.size, contentType: plan.file.type }),
    }, requestOptions));
    // Google's resumable upload header avoids treating progress responses as HTTP redirects.
    const transfer = async (offset: number, recoveries = 0): Promise<void> => {
      const end = Math.min(offset + 8 * 1024 * 1024, plan.file.size);
      const response = await request(session.uploadUrl, {
        method: 'PUT', headers: { 'X-GUploader-No-308': 'yes', 'Content-Type': plan.file.type, 'Content-Range': `bytes ${offset}-${end - 1}/${plan.file.size}` },
        body: plan.file.slice(offset, end),
      }, requestOptions, 120_000).catch(async (error: unknown) => {
        if (!(error instanceof RareApiError) || error.code !== 'transport_error' || recoveries >= 2) throw error;
        // Query GCS's committed offset before retransmitting an ambiguous chunk.
        const status = await request(session.uploadUrl, { method: 'PUT', headers: { 'X-GUploader-No-308': 'yes', 'Content-Range': `bytes */${plan.file.size}` }, body: new Blob([]) }, requestOptions);
        if ((status.status === 200 || status.status === 201) && status.headers.get('x-http-status-code-override') !== '308') return status;
        if (status.status !== 308 && status.headers.get('x-http-status-code-override') !== '308') throw featureError('upload_failed', status.status);
        await transfer(uploadedOffset(status.headers.get('range'), plan.file.size), recoveries + 1);
        return null;
      });
      if (response === null) return;
      if (response.status === 308 || response.headers.get('x-http-status-code-override') === '308') {
        const next = uploadedOffset(response.headers.get('range'), plan.file.size);
        if (next <= offset || next > end) throw featureError('invalid_upload_progress');
        return transfer(next, recoveries);
      }
      if (response.status !== 200 && response.status !== 201) throw featureError('upload_failed', response.status);
      if (end !== plan.file.size) throw featureError('invalid_upload_progress');
    };
    await transfer(0);
    const result = parseUpload(await jsonRequest(`v1/uploads/${session.id}/complete`, {
      method: 'POST', headers: { Accept: 'application/json' },
    }, requestOptions, 300_000), session.id);
    if (result.access !== access || result.size !== plan.file.size) throw featureError('invalid_upload_response');
    return result;
  }
  const changeFollow = async (method: 'POST' | 'DELETE', input: UserSelector | string, options: RareAuthRequestOptions = {}): Promise<void> => {
    const query = userQuery(input);
    const search = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
    const body = await jsonRequest(`v1/me/following?${search}`, { method, headers: { Accept: 'application/json' } }, options);
    if (!isRecord(body) || !isRecord(body.data) || body.data.following !== (method === 'POST')) throw featureError('invalid_follow_response');
  };
  const favoriteRequest = async (method: 'GET' | 'PUT' | 'DELETE', input: FavoriteArtworkInput, options: RareAuthRequestOptions = {}): Promise<boolean> => {
    const id = normalizeFavoriteId(input);
    const result = parseFavoriteStatus(await jsonRequest(`v1/me/favorites/${encodeURIComponent(id)}`, {
      method, headers: { Accept: 'application/json' },
    }, options));
    if (method !== 'GET' && result !== (method === 'PUT')) throw featureError('invalid_favorite_response');
    return result;
  };
  const postRequest = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body: unknown, options: RareAuthRequestOptions = {}): Promise<unknown> => {
    return jsonRequest(path, {
      method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, options);
  };
  const postFavorite = async (method: 'GET' | 'PUT' | 'DELETE', postId: string, options?: RareAuthRequestOptions): Promise<boolean> => {
    const id = normalizePostId(postId);
    const result = parseFavoriteStatus(await postRequest(method, `v1/me/post-favorites/${id}`, undefined, options));
    if (method !== 'GET' && result !== (method === 'PUT')) throw featureError('invalid_favorite_response');
    return result;
  };
  return {
    notifications: createNotificationsClient(postRequest),
    messaging: createMessagingClient(async (method, path, body, headers, requestOptions = {}) => {
      return apiRequest(path, { method, headers: { Accept: 'application/json', ...headers }, ...(body === undefined ? {} : { body }) }, requestOptions);
    }),
    drops: {
      async create(input, options) { const plan = planCreateDrop(input); return parsePostData(await postRequest('POST', 'v1/drops', plan, options), parseDrop); },
      async update(dropId, input, options) { const id = normalizeDropId(dropId); const plan = planDropUpdate(input); return parsePostData(await postRequest('PATCH', `v1/drops/${id}`, plan, options), parseDrop); },
      async delete(dropId, options) { const id = normalizeDropId(dropId); parsePostDeleted(await postRequest('DELETE', `v1/drops/${id}`, undefined, options)); },
    },
    posts: {
      async create(input, options) { const plan = planCreatePost(input); return parsePostData(await postRequest('POST', 'v1/posts', plan, options), parsePost); },
      async comment(postId, input, options) { const id = normalizePostId(postId); const plan = planPostComment(input.body, input.parentCommentId); return parsePostData(await postRequest('POST', `v1/posts/${id}/comments`, plan, options), parsePostComment); },
      async delete(postId, options) { const id = normalizePostId(postId); parsePostDeleted(await postRequest('DELETE', `v1/posts/${id}`, undefined, options)); },
      async deleteComment(postId, commentId, options) { const id = normalizePostId(postId); const comment = normalizePostId(commentId); parsePostDeleted(await postRequest('DELETE', `v1/posts/${id}/comments/${comment}`, undefined, options)); },
    },
    postFavorites: {
      async list(input = {}, options) { const query = favoritePageQuery(input); return parsePostPage(await postRequest('GET', `v1/me/post-favorites?page=${query.page}&perPage=${query.perPage}`, undefined, options), parsePost); },
      has: (id, options) => postFavorite('GET', id, options),
      async add(id, options) { await postFavorite('PUT', id, options); },
      async remove(id, options) { await postFavorite('DELETE', id, options); },
    },
    artworkFavorites: {
      async list(input = {}, options) {
        const query = favoritePageQuery(input);
        return parseFavoritesPage(await jsonRequest(`v1/me/favorites?page=${query.page}&perPage=${query.perPage}`, { method: 'GET', headers: { Accept: 'application/json' } }, options));
      },
      has: (input, options) => favoriteRequest('GET', input, options),
      async add(input, options) { await favoriteRequest('PUT', input, options); },
      async remove(input, options) { await favoriteRequest('DELETE', input, options); },
    },
    upload,
    user: { following: { add: (input, options) => changeFollow('POST', input, options), delete: (input, options) => changeFollow('DELETE', input, options) } },
    profile: {
      async uploadAvatar(buffer, filename, requestOptions = {}) {
        const plan = planAvatarUpload(buffer, filename);
        const { url: avatar } = await upload(buffer, plan.filename, { contentType: plan.contentType, access: 'public' }, requestOptions);
        try {
          return await profileRequest('PATCH', JSON.stringify({ profile: { avatar } }), requestOptions);
        } catch (cause) {
          throw new AvatarProfileUpdateError(avatar, cause);
        }
      },
      get: (requestOptions = {}) => profileRequest('GET', undefined, requestOptions),
      update: (patch, requestOptions = {}) => {
        validateAccountProfilePatch(patch);
        return profileRequest('PATCH', JSON.stringify(profilePatchBody(patch)), requestOptions);
      },
    },
  };
}
