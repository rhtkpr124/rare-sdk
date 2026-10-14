import { createNotificationsClient } from './notifications-client.js';
import { createMessagingClient } from './messaging-client.js';
import { normalizeDropId, planCreateDrop, planDropUpdate, parseDrop } from './drops-core.js';
import { normalizePostId, planCreatePost, postText, parsePost, parsePostComment, parsePostData, parsePostPage, parsePostDeleted } from './posts-core.js';
import { normalizeFavoriteId, favoritePageQuery, parseFavoritesPage, parseFavoriteStatus, type FavoriteArtworkInput } from './favorites-core.js';
import { userQuery, type UserSelector } from './user-core.js';
import { planUpload, parseUpload, parseUploadSession, uploadedOffset } from './upload-core.js';
import { isAddress } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { DEFAULT_RARE_API_BASE_URL } from '../data-access/base-url.js';
import {
  isRecord, joinAuthPath, normalizeAuthBaseUrl, parseAuthErrorCode, resolveSigningOrigin,
  RareAuthError, requirePositiveNumber, requireString,
} from './account-auth-core.js';
import { AvatarProfileUpdateError, parseAccountProfile, planAvatarUpload, validateAccountProfilePatch } from './account-profile-core.js';
import { createMemoryAccountSessionStore, parseAccountSession } from './account-session-store.js';
import type {
  RareAccountClient, RareAccountClientOptions, RareAccountSession,
  RareAuthRequestOptions, RareDeviceAuthorization, RareDevicePollResult,
  RareUpload, RarePublicUpload, RarePrivateUpload, RareUploadOptions,
} from './types/account.js';

const scope = 'rare:account offline_access';
const deviceGrant = 'urn:ietf:params:oauth:grant-type:device_code';
const walletGrant = 'urn:superrare:params:oauth:grant-type:siwe';

/** Account operations do not require a chain client or a transaction signer. */
export function createRareAccountClient(options: RareAccountClientOptions = {}): RareAccountClient {
  if ('authBaseUrl' in options) throw new RareAuthError('auth_url_not_supported');
  const apiBaseUrl = normalizeAuthBaseUrl(options.apiBaseUrl ?? DEFAULT_RARE_API_BASE_URL);
  const authBaseUrl = joinAuthPath(apiBaseUrl, 'auth/v2');
  const clientId = options.clientId ?? 'rare-sdk';
  if (!['rare-sdk', 'rare-cli'].includes(clientId)) throw new RareAuthError('invalid_client');
  const storage = options.sessionStore ?? createMemoryAccountSessionStore();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  // A logout/newer login invalidates an in-flight interactive login on this instance.
  // eslint-disable-next-line functional/no-let
  let generation = 0;

  const request = async (url: string, init: RequestInit, requestOptions: RareAuthRequestOptions = {}, timeoutMilliseconds = 30_000): Promise<Response> => {
    try {
      const timeout = AbortSignal.timeout(timeoutMilliseconds);
      const signal = requestOptions.signal === undefined ? timeout : AbortSignal.any([timeout, requestOptions.signal]);
      return await fetchImpl(url, { ...init, redirect: 'error', credentials: 'omit', signal });
    } catch {
      throw new RareAuthError(requestOptions.signal?.aborted ? 'cancelled' : 'transport_error');
    }
  };
  const json = async (response: Response): Promise<unknown> => {
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new RareAuthError(parseAuthErrorCode(value), response.status);
    if (value === undefined) throw new RareAuthError('invalid_response', response.status);
    return value;
  };
  const postForm = async (path: string, body: Record<string, string>, requestOptions: RareAuthRequestOptions = {}): Promise<Response> =>
    request(joinAuthPath(authBaseUrl, path), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(body).toString(),
    }, requestOptions);
  const readSession = async (): Promise<RareAccountSession | null> =>
    parseAccountSession(await storage.get(), authBaseUrl, clientId, apiBaseUrl);
  const readRevision = async (): Promise<string | null> => {
    const stored = await storage.get();
    if (stored == null) return null;
    parseAccountSession(stored, authBaseUrl, clientId, apiBaseUrl);
    return isRecord(stored) ? requireString(stored.revision, 'session_revision') : null;
  };
  const tombstone = () => storage.set({ authBaseUrl, apiBaseUrl, clientId, revision: crypto.randomUUID(), loggedOut: true });
  const tokenSession = (value: unknown): RareAccountSession => {
    if (!isRecord(value) || value.token_type !== 'Bearer') throw new RareAuthError('invalid_token_response');
    const tokenScope = requireString(value.scope, 'scope');
    if (!tokenScope.split(' ').includes('rare:account')) throw new RareAuthError('invalid_scope');
    const expiresIn = requirePositiveNumber(value.expires_in, 'expires_in');
    if (expiresIn > 86400) throw new RareAuthError('invalid_expires_in');
    return {
      revision: crypto.randomUUID(), authBaseUrl, apiBaseUrl, clientId,
      accessToken: requireString(value.access_token, 'access_token'),
      refreshToken: requireString(value.refresh_token, 'refresh_token'),
      expiresAt: Date.now() + expiresIn * 1000,
      scope: tokenScope,
    };
  };
  const save = async (session: RareAccountSession): Promise<RareAccountSession> => {
    try { await storage.set(session); } catch { throw new RareAuthError('session_persistence_failed'); }
    return session;
  };
  const install = async (session: RareAccountSession, expectedGeneration: number, expectedRevision: string | null): Promise<RareAccountSession> => storage.withLock(async () => {
    if (expectedGeneration !== generation || await readRevision() !== expectedRevision) throw new RareAuthError('session_superseded');
    return save(session);
  });
  // Caller holds the storage lock. Do not retry ambiguous refresh failures.
  const refreshSession = async (session: RareAccountSession, requestOptions: RareAuthRequestOptions): Promise<RareAccountSession> => {
    if (session.refreshBlocked === true) throw new RareAuthError('reauthentication_required');
    if (requestOptions.signal?.aborted) throw new RareAuthError('cancelled');
    // Write ahead: a crash after transmission must never leave a replayable token.
    await save({ ...session, refreshBlocked: true });
    try {
      const response = await postForm('token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: session.refreshToken }, requestOptions);
      return await save({ ...tokenSession(await json(response)), revision: session.revision });
    } catch {
      // A request or persistence failure can occur after rotation. Keep the old
      // credential only for explicit revocation; never automatically replay it.
      try { await storage.set({ ...session, refreshBlocked: true }); }
      catch { await storage.clear().catch(() => undefined); }
      throw new RareAuthError('reauthentication_required');
    }
  };
  const accessToken = async (requestOptions: RareAuthRequestOptions): Promise<string> => storage.withLock(async () => {
    const session = await readSession();
    if (session === null) throw new RareAuthError('authentication_required');
    return session.expiresAt > Date.now() + 30_000
      ? session.accessToken
      : (await refreshSession(session, requestOptions)).accessToken;
  });

  const validateDevice = (value: RareDeviceAuthorization): void => {
    if (value.authBaseUrl !== authBaseUrl || value.apiBaseUrl !== apiBaseUrl || value.clientId !== clientId) {
      throw new RareAuthError('device_authority_mismatch');
    }
    requireString(value.deviceCode, 'device_code');
    if (value.sessionRevision !== null) requireString(value.sessionRevision, 'session_revision');
    requirePositiveNumber(value.expiresAt, 'expires_at');
    requirePositiveNumber(value.nextPollAt, 'next_poll_at');
    requirePositiveNumber(value.interval, 'interval');
    if (value.interval > 600 || value.expiresAt - Date.now() > 86400_000) throw new RareAuthError('invalid_device_state');
    if (value.expiresAt <= Date.now()) throw new RareAuthError('expired_token');
  };
  const pollDeviceAuthorization = async (authorization: RareDeviceAuthorization, requestOptions: RareAuthRequestOptions = {}, expectedGeneration = generation): Promise<RareDevicePollResult> => {
    validateDevice(authorization);
    if (expectedGeneration !== generation) throw new RareAuthError('session_superseded');
    if (requestOptions.signal?.aborted) throw new RareAuthError('cancelled');
    if (Date.now() < authorization.nextPollAt) return { status: 'pending', authorization };
    const response = await postForm('token', { grant_type: deviceGrant, client_id: clientId, device_code: authorization.deviceCode }, requestOptions)
      .catch((error: unknown) => {
        if (error instanceof RareAuthError && error.code === 'transport_error') return null;
        throw error;
      });
    if (response === null) {
      const interval = Math.min(authorization.interval * 2, 600);
      return { status: 'retry', authorization: { ...authorization, interval, nextPollAt: Date.now() + interval * 1000 } };
    }
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = parseAuthErrorCode(value);
      if (code === 'authorization_pending' || code === 'slow_down') {
        const interval = authorization.interval + (code === 'slow_down' ? 5 : 0);
        return {
          status: code === 'slow_down' ? 'slow_down' : 'pending',
          authorization: { ...authorization, interval, nextPollAt: Date.now() + interval * 1000 },
        };
      }
      throw new RareAuthError(code, response.status);
    }
    return { status: 'authorized', session: await install(tokenSession(value), expectedGeneration, authorization.sessionRevision) };
  };

  const profileRequest = async (method: 'GET' | 'PATCH', body: string | undefined, requestOptions: RareAuthRequestOptions = {}) => {
    const token = await accessToken(requestOptions);
    const response = await request(joinAuthPath(apiBaseUrl, 'v1/me'), {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body }),
    }, requestOptions);
    return parseAccountProfile(await json(response));
  };

  function upload(file: Uint8Array | Blob, filename: string, requestOptions?: RareUploadOptions & { access?: 'public' }): Promise<RarePublicUpload>;
  function upload(file: Uint8Array | Blob, filename: string, requestOptions: RareUploadOptions & { access: 'private' }): Promise<RarePrivateUpload>;
  function upload(file: Uint8Array | Blob, filename: string, requestOptions: RareUploadOptions): Promise<RareUpload>;
  async function upload(file: Uint8Array | Blob, filename: string, requestOptions: RareUploadOptions = {}): Promise<RareUpload> {
    const access = requestOptions.access ?? 'public';
    if (access !== 'public' && access !== 'private') throw new RareAuthError('invalid_upload');
    const plan = planUpload(file, filename, requestOptions.contentType);
    const token = await accessToken(requestOptions);
    const session = parseUploadSession(await json(await request(joinAuthPath(apiBaseUrl, 'v1/uploads'), {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ access, size: plan.file.size, contentType: plan.file.type }),
    }, requestOptions)));
    // Google's resumable upload header avoids treating progress responses as HTTP redirects.
    const transfer = async (offset: number, recoveries = 0): Promise<void> => {
      const end = Math.min(offset + 8 * 1024 * 1024, plan.file.size);
      const response = await request(session.uploadUrl, {
        method: 'PUT', headers: { 'X-GUploader-No-308': 'yes', 'Content-Type': plan.file.type, 'Content-Range': `bytes ${offset}-${end - 1}/${plan.file.size}` },
        body: plan.file.slice(offset, end),
      }, requestOptions, 120_000).catch(async (error: unknown) => {
        if (!(error instanceof RareAuthError) || error.code !== 'transport_error' || recoveries >= 2) throw error;
        // Query GCS's committed offset before retransmitting an ambiguous chunk.
        const status = await request(session.uploadUrl, { method: 'PUT', headers: { 'X-GUploader-No-308': 'yes', 'Content-Range': `bytes */${plan.file.size}` }, body: new Blob([]) }, requestOptions);
        if ((status.status === 200 || status.status === 201) && status.headers.get('x-http-status-code-override') !== '308') return status;
        if (status.status !== 308 && status.headers.get('x-http-status-code-override') !== '308') throw new RareAuthError('upload_failed', status.status);
        await transfer(uploadedOffset(status.headers.get('range'), plan.file.size), recoveries + 1);
        return null;
      });
      if (response === null) return;
      if (response.status === 308 || response.headers.get('x-http-status-code-override') === '308') {
        const next = uploadedOffset(response.headers.get('range'), plan.file.size);
        if (next <= offset || next > end) throw new RareAuthError('invalid_upload_progress');
        return transfer(next, recoveries);
      }
      if (response.status !== 200 && response.status !== 201) throw new RareAuthError('upload_failed', response.status);
      if (end !== plan.file.size) throw new RareAuthError('invalid_upload_progress');
    };
    await transfer(0);
    const finalToken = await accessToken(requestOptions);
    const result = parseUpload(await json(await request(joinAuthPath(apiBaseUrl, `v1/uploads/${session.id}/complete`), {
      method: 'POST', headers: { Authorization: `Bearer ${finalToken}`, Accept: 'application/json' },
    }, requestOptions, 300_000)));
    if (result.access !== access || result.size !== plan.file.size) throw new RareAuthError('invalid_upload_response');
    return result;
  }
  const changeFollow = async (method: 'POST' | 'DELETE', input: UserSelector | string, options: RareAuthRequestOptions = {}): Promise<void> => {
    const query = userQuery(input);
    const url = new URL(joinAuthPath(apiBaseUrl, 'v1/me/following'));
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const token = await accessToken(options);
    const body = await json(await request(url.href, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, options));
    if (!isRecord(body) || !isRecord(body.data) || body.data.following !== (method === 'POST')) throw new RareAuthError('invalid_follow_response');
  };
  const favoriteRequest = async (method: 'GET' | 'PUT' | 'DELETE', input: FavoriteArtworkInput, options: RareAuthRequestOptions = {}): Promise<boolean> => {
    const id = normalizeFavoriteId(input);
    const token = await accessToken(options);
    const result = parseFavoriteStatus(await json(await request(joinAuthPath(apiBaseUrl, `v1/me/favorites/${encodeURIComponent(id)}`), {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    }, options)));
    if (method !== 'GET' && result !== (method === 'PUT')) throw new RareAuthError('invalid_favorite_response');
    return result;
  };
  const postRequest = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body: unknown, options: RareAuthRequestOptions = {}): Promise<unknown> => {
    const token = await accessToken(options);
    return json(await request(joinAuthPath(apiBaseUrl, path), {
      method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, options));
  };
  const postFavorite = async (method: 'GET' | 'PUT' | 'DELETE', postId: string, options?: RareAuthRequestOptions): Promise<boolean> => {
    const id = normalizePostId(postId);
    const result = parseFavoriteStatus(await postRequest(method, `v1/me/post-favorites/${id}`, undefined, options));
    if (method !== 'GET' && result !== (method === 'PUT')) throw new RareAuthError('invalid_favorite_response');
    return result;
  };
  return {
    notifications: createNotificationsClient(postRequest),
    messaging: createMessagingClient(async (method, path, body, headers, requestOptions = {}) => {
      const token = await accessToken(requestOptions);
      return request(joinAuthPath(apiBaseUrl, path), { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...headers }, ...(body === undefined ? {} : { body }) }, requestOptions);
    }, json),
    drops: {
      async create(input, options) { const plan = planCreateDrop(input); return parsePostData(await postRequest('POST', 'v1/drops', plan, options), parseDrop); },
      async update(dropId, input, options) { const id = normalizeDropId(dropId); const plan = planDropUpdate(input); return parsePostData(await postRequest('PATCH', `v1/drops/${id}`, plan, options), parseDrop); },
      async delete(dropId, options) { const id = normalizeDropId(dropId); parsePostDeleted(await postRequest('DELETE', `v1/drops/${id}`, undefined, options)); },
    },
    posts: {
      async create(input, options) { const plan = planCreatePost(input); return parsePostData(await postRequest('POST', 'v1/posts', plan, options), parsePost); },
      async comment(postId, body, options) { const id = normalizePostId(postId); const input = { body: postText(body, 1000) }; return parsePostData(await postRequest('POST', `v1/posts/${id}/comments`, input, options), parsePostComment); },
      async delete(postId, options) { const id = normalizePostId(postId); parsePostDeleted(await postRequest('DELETE', `v1/posts/${id}`, undefined, options)); },
      async deleteComment(postId, commentId, options) { const id = normalizePostId(postId); const comment = normalizePostId(commentId); parsePostDeleted(await postRequest('DELETE', `v1/posts/${id}/comments/${comment}`, undefined, options)); },
    },
    postFavorites: {
      async list(options = {}) { const query = favoritePageQuery(options); return parsePostPage(await postRequest('GET', `v1/me/post-favorites?page=${query.page}&perPage=${query.perPage}`, undefined, options), parsePost); },
      has: (id, options) => postFavorite('GET', id, options),
      async add(id, options) { await postFavorite('PUT', id, options); },
      async remove(id, options) { await postFavorite('DELETE', id, options); },
    },
    favorites: {
      async list(options = {}) {
        const query = favoritePageQuery(options);
        const url = new URL(joinAuthPath(apiBaseUrl, 'v1/me/favorites'));
        url.searchParams.set('page', String(query.page));
        url.searchParams.set('perPage', String(query.perPage));
        const token = await accessToken(options);
        return parseFavoritesPage(await json(await request(url.href, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }, options)));
      },
      has: (input, options) => favoriteRequest('GET', input, options),
      async add(input, options) { await favoriteRequest('PUT', input, options); },
      async remove(input, options) { await favoriteRequest('DELETE', input, options); },
    },
    uploads: { upload },
    following: { follow: (input, options) => changeFollow('POST', input, options), unfollow: (input, options) => changeFollow('DELETE', input, options) },
    auth: {
      async startDeviceAuthorization(requestOptions = {}) {
        generation += 1;
        const sessionRevision = await storage.withLock(readRevision);
        const value = await json(await postForm('device/authorization', { client_id: clientId, scope }, requestOptions));
        if (!isRecord(value)) throw new RareAuthError('invalid_device_response');
        const interval = value.interval === undefined ? 5 : requirePositiveNumber(value.interval, 'interval');
        const expiresIn = requirePositiveNumber(value.expires_in, 'expires_in');
        if (interval > 600 || expiresIn > 86400) throw new RareAuthError('invalid_device_response');
        const userCode = requireString(value.user_code, 'user_code');
        if (!/^[A-Za-z0-9-]{4,32}$/.test(userCode)) throw new RareAuthError('invalid_user_code');
        const verificationUri = validateVerificationUri(value.verification_uri);
        const complete = value.verification_uri_complete === undefined ? undefined : validateVerificationUri(value.verification_uri_complete);
        if (complete !== undefined && new URL(complete).origin !== new URL(verificationUri).origin) throw new RareAuthError('invalid_verification_uri');
        return {
          sessionRevision, authBaseUrl, apiBaseUrl, clientId,
          deviceCode: requireString(value.device_code, 'device_code'), userCode,
          verificationUri, ...(complete === undefined ? {} : { verificationUriComplete: complete }),
          expiresAt: Date.now() + expiresIn * 1000, interval, nextPollAt: Date.now() + interval * 1000,
        };
      },
      pollDeviceAuthorization,
      async waitForDeviceAuthorization(initial, requestOptions = {}) {
        // eslint-disable-next-line functional/no-let
        let authorization = initial;
        const expectedGeneration = generation;
        for (;;) {
          validateDevice(authorization);
          if (expectedGeneration !== generation) throw new RareAuthError('session_superseded');
          await wait(Math.min(authorization.nextPollAt, authorization.expiresAt) - Date.now(), requestOptions.signal);
          const result = await pollDeviceAuthorization(authorization, requestOptions, expectedGeneration);
          if (result.status === 'authorized') return result.session;
          authorization = result.authorization;
        }
      },
      async loginWithWallet(input) {
        if (!isAddress(input.address, { strict: false }) || !Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new RareAuthError('invalid_wallet');
        const signingOrigin = resolveSigningOrigin(apiBaseUrl, input.signingOrigin, typeof window === 'undefined' ? undefined : window.location.origin);
        generation += 1;
        const expectedGeneration = generation;
        const sessionRevision = await storage.withLock(readRevision);
        const value = await json(await request(joinAuthPath(authBaseUrl, 'wallet/challenge'), {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ client_id: clientId, address: input.address, chain_id: input.chainId, origin: signingOrigin }),
        }, input));
        if (!isRecord(value)) throw new RareAuthError('invalid_challenge');
        const message = requireString(value.message, 'message');
        const challengeId = requireString(value.challenge_id, 'challenge_id');
        const parsed = parseSiweMessage(message);
        if (!validateSiweMessage({ message: parsed, address: input.address, domain: new URL(signingOrigin).host }) ||
            (parsed.scheme !== undefined && parsed.scheme !== new URL(signingOrigin).protocol.slice(0, -1)) ||
            parsed.chainId !== input.chainId || parsed.uri !== signingOrigin || parsed.expirationTime === undefined ||
            parsed.issuedAt === undefined || !Number.isFinite(parsed.issuedAt.getTime()) ||
            !Number.isFinite(parsed.expirationTime.getTime()) || parsed.expirationTime.getTime() <= Date.now() ||
            parsed.expirationTime.getTime() - parsed.issuedAt.getTime() > 300_000 ||
            parsed.issuedAt.getTime() > Date.now() + 30_000) {
          throw new RareAuthError('invalid_challenge_binding');
        }
        const signature = await input.signMessage(message).catch(() => { throw new RareAuthError('signing_failed'); });
        if (expectedGeneration !== generation) throw new RareAuthError('session_superseded');
        const response = await postForm('token', { grant_type: walletGrant, client_id: clientId, challenge_id: challengeId, message, signature }, input);
        return install(tokenSession(await json(response)), expectedGeneration, sessionRevision);
      },
      getSession: () => storage.withLock(readSession),
      refresh: (requestOptions = {}) => storage.withLock(async () => {
        const session = await readSession();
        if (session === null) throw new RareAuthError('authentication_required');
        return refreshSession(session, requestOptions);
      }),
      async logout(requestOptions = {}) {
        generation += 1;
        await storage.withLock(async () => {
          const session = await readSession();
          if (session !== null) {
            const response = await postForm('revoke', { client_id: clientId, token: session.refreshToken, token_type_hint: 'refresh_token' }, requestOptions);
            if (!response.ok) await json(response);
          }
          await tombstone();
        });
      },
      async clearSession() {
        generation += 1;
        await storage.withLock(tombstone);
      },
    },
    profile: {
      async uploadAvatar(buffer, filename, requestOptions = {}) {
        const plan = planAvatarUpload(buffer, filename);
        const { url: avatar } = await upload(buffer, plan.filename, { ...requestOptions, contentType: plan.contentType, access: 'public' });
        try {
          return await profileRequest('PATCH', JSON.stringify({ profile: { avatar } }), requestOptions);
        } catch (cause) {
          throw new AvatarProfileUpdateError(avatar, cause);
        }
      },
      get: (requestOptions = {}) => profileRequest('GET', undefined, requestOptions),
      update: (patch, requestOptions = {}) => {
        validateAccountProfilePatch(patch);
        return profileRequest('PATCH', JSON.stringify(patch), requestOptions);
      },
    },
  };
}

function validateVerificationUri(value: unknown): string {
  const text = requireString(value, 'verification_uri');
  const url = new URL(text);
  normalizeAuthBaseUrl(`${url.origin}${url.pathname}`);
  if (url.username || url.password || url.hash) throw new RareAuthError('invalid_verification_uri');
  return url.href;
}

function wait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new RareAuthError('cancelled'));
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new RareAuthError('cancelled')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, milliseconds);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
