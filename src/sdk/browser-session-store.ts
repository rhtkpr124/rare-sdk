import { isRecord, joinAuthPath, normalizeAuthBaseUrl, RareAuthError, requireString } from './account-auth-core.js';
import { parseAccountSession } from './account-session-store.js';
import type { RareAccountSessionStore, RareStoredAccountSession } from './types/account.js';

const clientId = 'rare-sdk';

/**
 * Persists managed browser credentials for this origin and API authority.
 * Web Locks serializes refresh and session changes across same-origin tabs.
 * Credentials remain readable by same-origin JavaScript; this is not an XSS boundary.
 * Capability checks are deferred until use, so public reads need no storage access.
 */
export function createBrowserAccountSessionStore(apiBaseUrl: string): RareAccountSessionStore {
  const scope = () => {
    const api = normalizeAuthBaseUrl(apiBaseUrl);
    return { api, auth: joinAuthPath(api, 'auth/v2'), key: `superrare:account:${clientId}:${api}` };
  };
  const storage = (): Storage => {
    try {
      if (typeof window === 'undefined') throw new Error('No browser');
      return window.localStorage;
    } catch { throw new RareAuthError('browser_storage_unavailable'); }
  };
  const validate = (value: unknown): RareStoredAccountSession => {
    if (!isRecord(value)) throw new RareAuthError('invalid_session');
    const revision = requireString(value.revision, 'session_revision');
    const { api, auth } = scope();
    const session = parseAccountSession(value, auth, clientId, api);
    if (session !== null) return session;
    if (value.loggedOut !== true) throw new RareAuthError('invalid_session');
    return { revision, apiBaseUrl: api, authBaseUrl: auth, clientId, loggedOut: true };
  };
  return {
    async get() {
      const key = scope().key;
      const raw = (() => {
        try { return storage().getItem(key); }
        catch { throw new RareAuthError('browser_storage_unavailable'); }
      })();
      if (raw === null) return null;
      const parsed: unknown = (() => {
        try { return JSON.parse(raw) as unknown; }
        catch { throw new RareAuthError('invalid_session'); }
      })();
      return validate(parsed);
    },
    async set(value) {
      const key = scope().key;
      const encoded = JSON.stringify(validate(value));
      try { storage().setItem(key, encoded); }
      catch { throw new RareAuthError('browser_storage_unavailable'); }
    },
    async clear() {
      const key = scope().key;
      try { storage().removeItem(key); }
      catch { throw new RareAuthError('browser_storage_unavailable'); }
    },
    async withLock<T>(operation: () => Promise<T>): Promise<T> {
      const key = scope().key;
      const locks = (() => {
        try {
          if (typeof window === 'undefined' || window.navigator.locks === undefined) throw new Error('No browser locks');
          return window.navigator.locks;
        } catch { throw new RareAuthError('browser_locking_unavailable'); }
      })();
      const result = await locks.request(key, { mode: 'exclusive' }, async () => {
        try { return { type: 'success' as const, value: await operation() }; }
        catch (error) { return { type: 'failure' as const, error }; }
      }).catch(() => { throw new RareAuthError('browser_locking_unavailable'); });
      if (result.type === 'failure') throw result.error;
      return result.value;
    },
  };
}
