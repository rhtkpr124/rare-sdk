/* eslint-disable functional/immutable-data -- Browser fixtures manipulate real DOM/storage state and collect network observations. */
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { build } from 'tsdown';
import { privateKeyToAccount } from 'viem/accounts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RareApiClient } from '../../src/sdk/types/client.js';
import type { RareAccountSession } from '../../src/sdk/types/account.js';

declare global {
  interface Window {
    RareSdk: typeof import('../../src/sdk/index.js');
    rareBrowserTest: RareApiClient;
    signExistingTestWallet: (index: number, message: string) => Promise<string>;
    approvePendingBrowserLogin?: () => Promise<void>;
    pendingBrowserLogin?: Promise<{ code: string }>;
  }
}

const configuration = () => {
  const apiBaseUrl = (process.env.RARE_ACCOUNT_BROWSER_API_URL ?? process.env.RARE_ACCOUNT_TEST_API_URL)?.replace(/\/$/u, '');
  if (!apiBaseUrl || new URL(apiBaseUrl).hostname === 'api.superrare.com') throw new Error('Set a non-production RARE_ACCOUNT_BROWSER_API_URL or RARE_ACCOUNT_TEST_API_URL');
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Use HTTPS or a real disposable loopback Auth service');
  const wallets = ['RARE_ACCOUNT_TEST_PRIVATE_KEY', 'RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY'].map(name => {
    const key = process.env[name];
    if (!key || !/^0x[0-9a-f]{64}$/iu.test(key)) throw new Error(`Set existing dedicated ${name}`);
    return privateKeyToAccount(key as `0x${string}`);
  });
  if (wallets[0]?.address === wallets[1]?.address) throw new Error('Use two different existing dedicated wallets');
  return { apiBaseUrl, wallets, authOnly: url.protocol === 'http:' };
};

type BrowserFixture = {
  context: BrowserContext;
  refreshRequests: string[];
  refreshTokens: string[];
  captures: Promise<void>[];
};
const state: { browser?: Browser; server?: Server; directory?: string; origin?: string; fixtures: BrowserFixture[] } = { fixtures: [] };

const openPage = async (fixture: BrowserFixture) => {
  const page = await fixture.context.newPage();
  await page.exposeFunction('signExistingTestWallet', async (index: number, message: string) => {
    const wallet = configuration().wallets[index];
    if (!wallet) throw new Error('Unknown dedicated wallet');
    return wallet.signMessage({ message });
  });
  await page.goto(state.origin ?? '');
  await page.evaluate(apiBaseUrl => { window.rareBrowserTest = window.RareSdk.createRareClient({ apiBaseUrl }); }, configuration().apiBaseUrl);
  return page;
};
const createFixture = async (): Promise<BrowserFixture> => {
  if (!state.browser) throw new Error('Browser did not start');
  const context = await state.browser.newContext();
  const fixture: BrowserFixture = { context, refreshRequests: [], refreshTokens: [], captures: [] };
  context.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/auth/v2/token') && new URLSearchParams(request.postData() ?? '').get('grant_type') === 'refresh_token') fixture.refreshRequests.push('refresh');
  });
  context.on('response', response => {
    if (!new URL(response.url()).pathname.endsWith('/auth/v2/token') || response.status() !== 200) return;
    fixture.captures.push((async () => {
      const value: unknown = await response.json();
      if (value && typeof value === 'object' && 'refresh_token' in value && typeof value.refresh_token === 'string') fixture.refreshTokens.push(value.refresh_token);
    })());
  });
  state.fixtures.push(fixture);
  return fixture;
};
const login = async (page: Page, walletIndex = 0) => {
  const wallet = configuration().wallets[walletIndex];
  if (!wallet) throw new Error('Missing dedicated wallet');
  await page.evaluate(async ({ address, walletIndex }) => {
    await window.rareBrowserTest.auth.loginWithWallet({ address, chainId: 1, signMessage: message => window.signExistingTestWallet(walletIndex, message) });
  }, { address: wallet.address, walletIndex });
};
const session = (page: Page) => page.evaluate(() => window.rareBrowserTest.auth.getSession());
const assertSameCredential = (left: RareAccountSession | null, right: RareAccountSession | null) => {
  expect(left !== null && right !== null && left.accessToken === right.accessToken && left.refreshToken === right.refreshToken).toBe(true);
};

const authenticatedAddress = (page: Page) => page.evaluate(async ({ apiBaseUrl, authOnly }) => {
  if (!authOnly) return (await window.rareBrowserTest.profile.get()).address.toLowerCase();
  const current = await window.rareBrowserTest.auth.getSession();
  if (!current) throw new Error('Missing real session');
  const response = await fetch(`${apiBaseUrl}/auth/v2/introspect`, { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: current.accessToken }) });
  if (!response.ok) throw new Error(`Real introspection returned ${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || !('active' in value) || value.active !== true || !('address' in value) || typeof value.address !== 'string') throw new Error('Real Auth session is inactive');
  return value.address.toLowerCase();
}, { apiBaseUrl: configuration().apiBaseUrl, authOnly: configuration().authOnly });

beforeAll(async () => {
  configuration();
  state.directory = await mkdtemp(join(tmpdir(), 'rare-sdk-browser-session-'));
  await build({ config: false, entry: [resolve('src/sdk/index.ts')], format: 'iife', globalName: 'RareSdk', platform: 'browser', target: 'es2023', dts: false, outDir: state.directory, deps: { alwaysBundle: () => true }, clean: true, logLevel: 'error' });
  const javascript = await readFile(join(state.directory, 'index.iife.js'));
  state.server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': request.url === '/sdk.js' ? 'application/javascript' : 'text/html' });
    response.end(request.url === '/sdk.js' ? javascript : '<!doctype html><title>SDK persistent sessions</title><script src="/sdk.js"></script>');
  });
  state.server.listen(0, '127.0.0.1');
  await once(state.server, 'listening');
  const address = state.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing application server address');
  state.origin = `http://127.0.0.1:${address.port}`;
  state.browser = await chromium.launch();
}, 60_000);
afterEach(async () => {
  await Promise.all(state.fixtures.map(async fixture => {
    await Promise.all(fixture.captures);
    for (const token of fixture.refreshTokens) {
      const response = await fetch(`${configuration().apiBaseUrl}/auth/v2/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'rare-sdk', token, token_type_hint: 'refresh_token' }), signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`Real Auth cleanup returned HTTP ${response.status}`);
    }
    await fixture.context.close();
  }));
  state.fixtures.length = 0;
});
afterAll(async () => {
  await state.browser?.close();
  await new Promise<void>((resolve, reject) => state.server?.close(error => error ? reject(error) : resolve()) ?? resolve());
  if (state.directory) await rm(state.directory, { recursive: true, force: true });
});

describe('managed browser sessions against real Auth', () => {
  it('uses persistence by default across reloads and scopes it to the API authority', async () => {
    const fixture = await createFixture();
    const page = await openPage(fixture);
    await login(page);
    const before = await session(page);
    await page.reload();
    await page.evaluate(apiBaseUrl => { window.rareBrowserTest = window.RareSdk.createRareClient({ apiBaseUrl }); }, configuration().apiBaseUrl);
    assertSameCredential(before, await session(page));
    await page.evaluate(async () => { await window.rareBrowserTest.auth.refresh(); });
    expect((await session(page))?.refreshToken === before?.refreshToken).toBe(false);
    expect(await page.evaluate(apiBaseUrl => window.RareSdk.createRareClient({ apiBaseUrl: `${apiBaseUrl}/different-authority` }).auth.getSession(), configuration().apiBaseUrl)).toBeNull();
  });

  it('keeps explicitly selected memory sessions out of browser persistence', async () => {
    const fixture = await createFixture();
    const page = await openPage(fixture);
    await page.evaluate(apiBaseUrl => { window.rareBrowserTest = window.RareSdk.createRareClient({ apiBaseUrl, sessionStore: window.RareSdk.createMemoryAccountSessionStore() }); }, configuration().apiBaseUrl);
    await login(page);
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    await page.reload();
    await page.evaluate(apiBaseUrl => { window.rareBrowserTest = window.RareSdk.createRareClient({ apiBaseUrl }); }, configuration().apiBaseUrl);
    expect(await session(page)).toBeNull();
  });

  it('rejects corrupted storage and cross-authority writes until explicitly cleared', async () => {
    const fixture = await createFixture();
    const page = await openPage(fixture);
    await login(page);
    const codes = await page.evaluate(async apiBaseUrl => {
      const current = await window.rareBrowserTest.auth.getSession();
      if (!current) throw new Error('Missing real session');
      const otherStore = window.RareSdk.createBrowserAccountSessionStore(`${apiBaseUrl}/different-authority`);
      const mismatch = await otherStore.set(current).then(() => 'unexpected_success', error => error instanceof window.RareSdk.RareAuthError ? error.code : 'unexpected_error');
      const key = localStorage.key(0);
      if (!key) throw new Error('Missing persisted session');
      localStorage.setItem(key, 'invalid-json');
      const corruption = await window.rareBrowserTest.auth.getSession().then(() => 'unexpected_success', error => error instanceof window.RareSdk.RareAuthError ? error.code : 'unexpected_error');
      await window.rareBrowserTest.auth.clearSession();
      return { mismatch, corruption, cleared: await window.rareBrowserTest.auth.getSession() === null };
    }, configuration().apiBaseUrl);
    expect(codes).toEqual({ mismatch: 'session_authority_mismatch', corruption: 'invalid_session', cleared: true });
  });

  it('serializes cross-tab refresh and propagates logout without reloading', async () => {
    const fixture = await createFixture();
    const first = await openPage(fixture);
    const second = await openPage(fixture);
    await login(first);
    const before = await session(first);
    assertSameCredential(before, await session(second));
    await Promise.all([first.evaluate(() => window.rareBrowserTest.auth.refresh()), second.evaluate(() => window.rareBrowserTest.auth.refresh())]);
    expect(fixture.refreshRequests.length).toBe(2);
    const refreshed = await session(first);
    assertSameCredential(refreshed, await session(second));
    expect(refreshed?.refreshToken === before?.refreshToken).toBe(false);
    await first.evaluate(() => window.rareBrowserTest.auth.logout());
    expect(await session(second)).toBeNull();
    const code = await second.evaluate(async () => {
      try { await window.rareBrowserTest.auth.refresh(); return 'unexpected_success'; }
      catch (error) { return error instanceof window.RareSdk.RareAuthError ? error.code : 'unexpected_error'; }
    });
    expect(code).toBe('authentication_required');
  });

  it('automatically rotates once for two simultaneous expired-session feature requests', async () => {
    const fixture = await createFixture();
    const first = await openPage(fixture);
    const second = await openPage(fixture);
    await login(first);
    const before = await session(first);
    await first.evaluate(async apiBaseUrl => {
      const current = await window.rareBrowserTest.auth.getSession();
      if (!current) throw new Error('Missing real session');
      const store = window.RareSdk.createBrowserAccountSessionStore(apiBaseUrl);
      await store.withLock(() => store.set({ ...current, expiresAt: Date.now() - 1_000 }));
    }, configuration().apiBaseUrl);
    const read = (page: Page) => page.evaluate(async () => {
      try { await window.rareBrowserTest.profile.get(); return { status: 200 }; }
      catch (error) { return error instanceof window.RareSdk.RareApiError ? { status: error.status, code: error.code, path: error.path } : { status: -1 }; }
    });
    const statuses = await Promise.all([read(first), read(second)]);
    // The local fixture runs full Auth + Redis, not Rare API. Chromium rejects
    // the missing application's profile preflight after real automatic refresh.
    // Deployed mode must successfully read the actual profile instead.
    const expected = configuration().authOnly ? { status: 0, code: 'transport_error', path: '/v1/me' } : { status: 200 };
    expect(statuses).toEqual([expected, expected]);
    expect(fixture.refreshRequests.length).toBe(1);
    const after = await session(first);
    assertSameCredential(after, await session(second));
    expect(after?.refreshToken === before?.refreshToken).toBe(false);
    expect(after?.refreshBlocked).toBeUndefined();
    expect(await authenticatedAddress(second)).toBe(configuration().wallets[0]?.address.toLowerCase());
    await second.evaluate(() => window.rareBrowserTest.auth.refresh());
  });

  it('shares a newly selected account across tabs and after reload', async () => {
    const fixture = await createFixture();
    const first = await openPage(fixture);
    const second = await openPage(fixture);
    await login(first, 0);
    const original = await session(first);
    expect(await authenticatedAddress(first)).toBe(configuration().wallets[0]?.address.toLowerCase());
    await login(second, 1);
    const selected = await session(second);
    expect(selected?.revision === original?.revision).toBe(false);
    assertSameCredential(selected, await session(first));
    expect(await authenticatedAddress(first)).toBe(configuration().wallets[1]?.address.toLowerCase());
    await first.reload();
    await first.evaluate(apiBaseUrl => { window.rareBrowserTest = window.RareSdk.createRareClient({ apiBaseUrl }); }, configuration().apiBaseUrl);
    assertSameCredential(selected, await session(first));
    await first.evaluate(() => window.rareBrowserTest.auth.refresh());
  });

  it.each(['logout', 'account switch'] as const)('does not resurrect an in-flight login after another tab performs %s', async action => {
    const fixture = await createFixture();
    const first = await openPage(fixture);
    const second = await openPage(fixture);
    await login(first, 0);
    const address = configuration().wallets[0]?.address;
    if (!address) throw new Error('Missing dedicated wallet');
    await first.evaluate(address => {
      window.pendingBrowserLogin = window.rareBrowserTest.auth.loginWithWallet({ address, chainId: 1, signMessage: message => new Promise(resolve => {
        window.approvePendingBrowserLogin = async () => { resolve(await window.signExistingTestWallet(0, message)); };
      }) }).then(() => ({ code: 'unexpected_success' }), error => ({ code: error instanceof window.RareSdk.RareAuthError ? error.code : 'unexpected_error' }));
    }, address);
    await first.waitForFunction(() => typeof window.approvePendingBrowserLogin === 'function');
    if (action === 'logout') await second.evaluate(() => window.rareBrowserTest.auth.logout());
    else await login(second, 1);
    const selected = await session(second);
    await first.evaluate(async () => { await window.approvePendingBrowserLogin?.(); });
    expect(await first.evaluate(() => window.pendingBrowserLogin)).toEqual({ code: 'session_superseded' });
    if (selected === null) expect(await session(first)).toBeNull();
    else assertSameCredential(selected, await session(first));
  });

  it.each(['storage', 'locking'] as const)('fails clearly when browser %s is unavailable without blocking construction', async capability => {
    const fixture = await createFixture();
    await fixture.context.addInitScript(capability => {
      if (capability === 'storage') Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Storage denied', 'SecurityError'); } });
      else Object.defineProperty(navigator, 'locks', { value: undefined });
    }, capability);
    const page = await openPage(fixture);
    const result = await page.evaluate(async () => {
      const constructed = typeof window.rareBrowserTest.search.nfts === 'function';
      try { await window.rareBrowserTest.auth.getSession(); return { constructed, code: 'unexpected_success' }; }
      catch (error) { return { constructed, code: error instanceof window.RareSdk.RareAuthError ? error.code : 'unexpected_error' }; }
    });
    expect(result).toEqual({ constructed: true, code: capability === 'storage' ? 'browser_storage_unavailable' : 'browser_locking_unavailable' });
  });
});
