import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';
import { parseSiweMessage } from 'viem/siwe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRareClient } from '../../src/sdk/client.js';

const config = () => {
  const apiBaseUrl = process.env.RARE_ACCOUNT_BROWSER_API_URL ?? process.env.RARE_ACCOUNT_TEST_API_URL;
  const key = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY;
  if (!apiBaseUrl || new URL(apiBaseUrl).hostname === 'api.superrare.com') throw new Error('Set a non-production RARE_ACCOUNT_BROWSER_API_URL or RARE_ACCOUNT_TEST_API_URL');
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('Use HTTPS or a real disposable loopback Auth service');
  if (!key || !/^0x[0-9a-f]{64}$/iu.test(key)) throw new Error('Set the existing dedicated RARE_ACCOUNT_TEST_PRIVATE_KEY');
  return { apiBaseUrl: apiBaseUrl.replace(/\/$/u, ''), wallet: privateKeyToAccount(key as `0x${string}`), local: url.protocol === 'http:' };
};

// Only the empty application page is intercepted. Every API/Auth request reaches
// the real service, with Origin/preflight behavior enforced by Chromium.
const applicationPage = async (browser: Browser, local: boolean) => {
  const page = await browser.newPage();
  const applicationHtml = '<!doctype html><title>SDK authentication integration</title>';
  const origin = await (async () => {
    if (!local) {
      const value = `https://sdk-${randomUUID()}.example`;
      await page.route(`${value}/`, route => route.fulfill({ status: 200, contentType: 'text/html', body: applicationHtml }));
      return value;
    }
    // A real loopback document gives Chromium the correct address-space classification.
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(applicationHtml);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    page.once('close', () => server.close());
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing application server address');
    return `http://127.0.0.1:${address.port}`;
  })();
  await page.goto(`${origin}/`);
  return { page, origin };
};

const browserFetch = (page: Page): typeof fetch => async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (init.body !== undefined && init.body !== null && typeof init.body !== 'string' && !(init.body instanceof URLSearchParams)) throw new Error('Browser auth integration supports text request bodies');
  const result = await page.evaluate(async ({ url, method, headers, body }) => {
    const response = await fetch(url, { method, headers, ...(body === undefined ? {} : { body }), credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000) });
    return { status: response.status, headers: Array.from(response.headers.entries()), body: await response.text() };
  }, { url, method: init.method ?? 'GET', headers: Array.from(new Headers(init.headers).entries()), body: init.body == null ? undefined : String(init.body) });
  return new Response(result.status === 204 ? null : result.body, { status: result.status, headers: result.headers });
};

type Challenge = { challenge_id: string; message: string };
describe('real-browser third-party wallet authentication', () => {
  const runtime: { browser?: Browser } = {};
  beforeAll(async () => {
    // eslint-disable-next-line functional/immutable-data
    runtime.browser = await chromium.launch();
  });
  afterAll(async () => { await runtime.browser?.close(); });
  const browser = () => {
    if (!runtime.browser) throw new Error('Browser did not start');
    return runtime.browser;
  };
  const challenge = async (request: typeof fetch, origin: string) => {
    const { apiBaseUrl, wallet } = config();
    const response = await request(`${apiBaseUrl}/auth/v2/wallet/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: 'rare-sdk', address: wallet.address, chain_id: 1, origin }) });
    expect(response.status).toBe(200);
    return await response.json() as Challenge;
  };
  const grant = async (request: typeof fetch, value: Challenge, message = value.message) => {
    const { apiBaseUrl, wallet } = config();
    return request(`${apiBaseUrl}/auth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:superrare:params:oauth:grant-type:siwe', client_id: 'rare-sdk', challenge_id: value.challenge_id, message, signature: await wallet.signMessage({ message }) }) });
  };
  const revoke = async (request: typeof fetch, refreshToken: string) => {
    const response = await request(`${config().apiBaseUrl}/auth/v2/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'rare-sdk', token: refreshToken, token_type_hint: 'refresh_token' }) });
    expect(response.status).toBe(200);
  };

  it('authenticates two unregistered browser origins with independent SDK bearer sessions', async () => {
    const { apiBaseUrl, wallet, local } = config();
    const apps = await Promise.all([applicationPage(browser(), local), applicationPage(browser(), local)]);
    const clients = apps.map(({ page, origin }) => ({ origin, client: createRareClient({ apiBaseUrl, fetch: browserFetch(page) }) }));
    try {
      for (const { origin, client } of clients) {
        await client.auth.loginWithWallet({ address: wallet.address, chainId: 1, signingOrigin: origin, signMessage: message => {
          const parsed = parseSiweMessage(message);
          expect(parsed.domain).toBe(new URL(origin).host);
          expect(parsed.uri).toBe(origin);
          expect(parsed.statement).toMatch(/SuperRare.*account|account.*SuperRare/iu);
          return wallet.signMessage({ message });
        } });
        expect(await client.auth.getSession()).not.toBeNull();
        if (!local) expect((await client.profile.get()).address.toLowerCase()).toBe(wallet.address.toLowerCase());
      }
      const [first, second] = clients;
      if (!first || !second) throw new Error('Missing browser clients');
      const firstSession = await first.client.auth.getSession();
      if (!firstSession) throw new Error('Missing first session');
      await first.client.auth.logout();
      const invalidRefresh = await browserFetch(apps[0]!.page)(`${apiBaseUrl}/auth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'rare-sdk', grant_type: 'refresh_token', refresh_token: firstSession.refreshToken }) });
      expect(invalidRefresh.status).toBe(400);
      await second.client.auth.refresh();
      if (!local) expect((await second.client.profile.get()).address.toLowerCase()).toBe(wallet.address.toLowerCase());
    } finally {
      await Promise.all(clients.map(({ client }) => client.auth.logout()));
      await Promise.all(apps.map(({ page }) => page.close()));
    }
  }, 120_000);

  it('allows hosted Connect authorization initiation without browser cookies', async () => {
    const { apiBaseUrl, local } = config();
    const { page } = await applicationPage(browser(), local);
    try {
      const authorization = await createRareClient({ apiBaseUrl, fetch: browserFetch(page) }).auth.startDeviceAuthorization();
      expect(new URL(authorization.verificationUri).protocol).toMatch(/^https?:$/u);
      expect(authorization.expiresAt).toBeGreaterThan(Date.now());
      expect(authorization.userCode).not.toBe('');
    } finally { await page.close(); }
  });

  it('rejects mismatched challenge origins, altered domain/URI, wrong redemption origin and proof replay', async () => {
    const { apiBaseUrl, wallet, local } = config();
    const first = await applicationPage(browser(), local);
    const second = await applicationPage(browser(), local);
    const request = browserFetch(first.page);
    try {
      const mismatch = await request(`${apiBaseUrl}/auth/v2/wallet/challenge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_id: 'rare-sdk', address: wallet.address, chain_id: 1, origin: second.origin }) });
      expect(mismatch.status).toBe(403);
      for (const field of ['domain', 'uri'] as const) {
        const value = await challenge(request, first.origin);
        const tampered = field === 'domain' ? value.message.replace(new URL(first.origin).host, new URL(second.origin).host) : value.message.replace(`URI: ${first.origin}`, `URI: ${second.origin}`);
        expect(tampered).not.toBe(value.message);
        expect((await grant(request, value, tampered)).status).toBe(400);
      }
      const value = await challenge(request, first.origin);
      expect((await grant(browserFetch(second.page), value)).status).toBe(400);
      // A new challenge avoids assuming whether a rejected proof consumes it.
      const fresh = await challenge(request, first.origin);
      const issued = await grant(request, fresh);
      expect(issued.status).toBe(200);
      const tokens = await issued.json() as { refresh_token: string };
      try { expect((await grant(request, fresh)).status).toBe(400); }
      finally { await revoke(request, tokens.refresh_token); }
    } finally { await first.page.close(); await second.page.close(); }
  }, 120_000);

  it('rejects a genuinely expired server challenge without issuing credentials', async () => {
    const { local } = config();
    const { page, origin } = await applicationPage(browser(), local);
    const request = browserFetch(page);
    try {
      const value = await challenge(request, origin);
      const expiresAt = parseSiweMessage(value.message).expirationTime?.getTime();
      if (!expiresAt || expiresAt > Date.now() + 300_000) throw new Error('Unexpected challenge expiration');
      await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now() + 1_000)));
      const response = await grant(request, value);
      expect(response.status).toBe(400);
      expect(await response.json()).not.toHaveProperty('access_token');
    } finally { await page.close(); }
  }, 330_000);
});
