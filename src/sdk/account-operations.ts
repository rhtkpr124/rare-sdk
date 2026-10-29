import { createBrowserAccountSessionStore } from './browser-session-store.js';
import { featureError } from './feature-error.js';
import { createAccountFeatures } from './account-features.js';
import { isAddress } from 'viem';
import { parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { DEFAULT_RARE_API_BASE_URL } from '../data-access/base-url.js';
import {
  isAccountRequestAuthority, isRecord, joinAuthPath, normalizeAuthBaseUrl, parseAuthErrorCode, resolveSigningOrigin,
  RareAuthError, requirePositiveNumber, requireString,
} from './account-auth-core.js';
import { createMemoryAccountSessionStore, parseAccountSession } from './account-session-store.js';
import type {
  RareAccountClient, RareAccountSession,
  RareAuthRequestOptions, RareDeviceAuthorization, RareDevicePollResult,
  RareAccountFeatures, RareAccountTransport, RareAccountSessionStore,
} from './types/account.js';

type RareAccountClientOptions = { apiBaseUrl?: string; sessionStore?: RareAccountSessionStore; fetch?: typeof globalThis.fetch };
type RareAccountTransportOptions = { transport: RareAccountTransport; fetch?: typeof globalThis.fetch };

const scope = 'rare:account offline_access';
const deviceGrant = 'urn:ietf:params:oauth:grant-type:device_code';
const walletGrant = 'urn:superrare:params:oauth:grant-type:siwe';

/** Account operations do not require a chain client or a transaction signer. */
export function createAccountClient(options: RareAccountTransportOptions): RareAccountFeatures;
export function createAccountClient(options?: RareAccountClientOptions): RareAccountClient;
export function createAccountClient(options: RareAccountClientOptions | RareAccountTransportOptions = {}): RareAccountClient | RareAccountFeatures {
  if ('transport' in options) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const dispatch = async (target: string, init: RequestInit, requestOptions: RareAuthRequestOptions = {}, timeoutMilliseconds = 30_000): Promise<Response> => {
      const timeout = AbortSignal.timeout(timeoutMilliseconds);
      const signal = requestOptions.signal === undefined ? timeout : AbortSignal.any([timeout, requestOptions.signal]);
      try {
        return await options.transport(`/${target.replace(/^\//, '')}`, { ...init, headers: new Headers(init.headers), signal });
      } catch (cause) {
        if (cause instanceof RareAuthError) throw cause;
        throw featureError(requestOptions.signal?.aborted ? 'cancelled' : 'transport_error');
      }
    };
    const storageRequest = async (url: string, init: RequestInit, requestOptions: RareAuthRequestOptions = {}, timeoutMilliseconds = 30_000): Promise<Response> => {
      const timeout = AbortSignal.timeout(timeoutMilliseconds);
      const signal = requestOptions.signal === undefined ? timeout : AbortSignal.any([timeout, requestOptions.signal]);
      try { return await fetchImpl(url, { ...init, redirect: 'error', credentials: 'omit', signal }); }
      catch { throw featureError(requestOptions.signal?.aborted ? 'cancelled' : 'transport_error'); }
    };
    return createAccountFeatures(dispatch, storageRequest);
  }
  if ('authBaseUrl' in options) throw new RareAuthError('auth_url_not_supported');
  const apiBaseUrl = new URL(options.apiBaseUrl ?? DEFAULT_RARE_API_BASE_URL).href.replace(/\/+$/u, '');
  const authBaseUrl = joinAuthPath(apiBaseUrl, 'auth/v2');
  const clientId = 'rare-sdk';
  const storage = options.sessionStore ?? (typeof window === 'undefined' ? createMemoryAccountSessionStore() : createBrowserAccountSessionStore(apiBaseUrl));
  const fetchImpl = options.fetch ?? globalThis.fetch;
  // A logout/newer login invalidates an in-flight interactive login on this instance.
  // eslint-disable-next-line functional/no-let
  let generation = 0;

  const request = async (url: string, init: RequestInit, requestOptions: RareAuthRequestOptions = {}, timeoutMilliseconds = 30_000): Promise<Response> => {
    normalizeAuthBaseUrl(apiBaseUrl);
    try {
      const timeout = AbortSignal.timeout(timeoutMilliseconds);
      const signal = requestOptions.signal === undefined ? timeout : AbortSignal.any([timeout, requestOptions.signal]);
      return await fetchImpl(url, { ...init, redirect: 'error', credentials: 'omit', signal });
    } catch {
      throw new RareAuthError(requestOptions.signal?.aborted ? 'cancelled' : 'transport_error');
    }
  };
  const applicationRequest = (...args: Parameters<typeof request>): Promise<Response> => request(...args).catch((error: unknown) => {
    if (error instanceof RareAuthError && ['transport_error', 'cancelled'].includes(error.code)) throw featureError(error.code, error.status, new URL(args[0]).pathname);
    throw error;
  });
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
  const readSession = async (): Promise<RareAccountSession | null> => {
    normalizeAuthBaseUrl(apiBaseUrl);
    return parseAccountSession(await storage.get(), authBaseUrl, clientId, apiBaseUrl);
  };
  const readRevision = async (): Promise<string | null> => {
    normalizeAuthBaseUrl(apiBaseUrl);
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

  // Manual feature calls and generated API clients use the same native request
  // handling. HeadersInit may be an object, tuples, or a Headers instance.
  const authenticatedRequest = async (input: RequestInfo | URL, init?: RequestInit,
    requestOptions: RareAuthRequestOptions = {}, timeoutMilliseconds = 30_000): Promise<Response> => {
    const pending = new Request(input, init);
    if (!isAccountRequestAuthority(new URL(pending.url), new URL(apiBaseUrl))) throw new RareAuthError('request_authority_mismatch');
    const timeout = AbortSignal.timeout(timeoutMilliseconds);
    const signal = AbortSignal.any([pending.signal, timeout, ...(requestOptions.signal === undefined ? [] : [requestOptions.signal])]);
    const token = await accessToken({ signal });
    const headers = new Headers(pending.headers);
    headers.set('Authorization', `Bearer ${token}`);
    try {
      return await fetchImpl(new Request(pending, { headers, signal, redirect: 'error', credentials: 'omit' }));
    } catch {
      throw featureError(requestOptions.signal?.aborted || pending.signal.aborted ? 'cancelled' : 'transport_error', 0, new URL(pending.url).pathname);
    }
  };

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

  return {
    ...createAccountFeatures(async (path, init, requestOptions = {}, timeoutMilliseconds) => {
      return authenticatedRequest(joinAuthPath(apiBaseUrl, path), init, requestOptions, timeoutMilliseconds);
    }, applicationRequest),
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
      async loginWithWallet(input, requestOptions = {}) {
        if (!isAddress(input.address, { strict: false }) || !Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new RareAuthError('invalid_wallet');
        const signingOrigin = resolveSigningOrigin(apiBaseUrl, input.signingOrigin, typeof window === 'undefined' ? undefined : window.location.origin);
        generation += 1;
        const expectedGeneration = generation;
        const sessionRevision = await storage.withLock(readRevision);
        const value = await json(await request(joinAuthPath(authBaseUrl, 'wallet/challenge'), {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ client_id: clientId, address: input.address, chain_id: input.chainId, origin: signingOrigin }),
        }, requestOptions));
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
        const response = await postForm('token', { grant_type: walletGrant, client_id: clientId, challenge_id: challengeId, message, signature }, requestOptions);
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
