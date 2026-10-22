import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createSiweMessage } from 'viem/siwe';
import { createPublicClient, http, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../src/sdk/client.js';
import { createMemoryAccountSessionStore } from '../../src/sdk/account-session-store.js';
import type { RareAccountSession, RareDeviceAuthorization } from '../../src/sdk/types/account.js';

// Controlled HTTP responses cover client edge cases; deployed-service coverage is separate.
const account = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123');
const profile = { accountId: '42', address: account.address.toLowerCase(), username: 'artist', email: null,
  profile: { fullName: null, bio: 'Hello', avatar: null } };
type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => Promise<void>;
// eslint-disable-next-line functional/no-let
let origin = '';
// eslint-disable-next-line functional/no-let
let handler: Handler;
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    // eslint-disable-next-line functional/immutable-data
    chunks.push(Buffer.from(chunk));
  }
  await handler(request, response, Buffer.concat(chunks).toString());
});
const reply = (response: ServerResponse, value: unknown, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
};
const tokens = { access_token: 'access-2', refresh_token: 'refresh-2', token_type: 'Bearer', expires_in: 300, scope: 'rare:account offline_access' };
const session = (expiresAt = Date.now() + 300000): RareAccountSession => ({
  revision: 'first-session', authBaseUrl: `${origin}/auth/v2`, apiBaseUrl: origin, clientId: 'rare-sdk',
  accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt, scope: tokens.scope,
});
const device = (extra: Partial<RareDeviceAuthorization> = {}): RareDeviceAuthorization => ({
  sessionRevision: null, authBaseUrl: `${origin}/auth/v2`, apiBaseUrl: origin, clientId: 'rare-sdk',
  deviceCode: 'device-secret', userCode: 'ABCD-EFGH', verificationUri: `${origin}/device`,
  expiresAt: Date.now() + 600000, interval: 5, nextPollAt: Date.now() - 1, ...extra,
});
const client = (storage = createMemoryAccountSessionStore()) => createRareClient({
  apiBaseUrl: origin, sessionStore: storage,
});

beforeEach(async () => {
  handler = async (_request, response) => { reply(response, { error: 'unexpected_request' }, 500); };
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing test address');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('account authentication over HTTP', () => {
  it.each(['bearer', 'application'])('shares address and order methods through %s authentication', async (mode) => {
    const storage = createMemoryAccountSessionStore();
    await storage.set(session());
    const sdk = mode === 'bearer' ? client(storage) : createRareClient({
      transport: (path, init) => fetch(`${origin}${path}`, {
        ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Cookie: 'sr-session=application-owned' },
      }),
    });
    const details = { name: 'SDK fixture', email: 'sdk@example.test', phoneNumber: '+12025550100', addressLine1: '123 Test Street',
      townOrCity: 'New York', postalOrZipCode: '10001', countryCode: 'US' };
    const input = { id: '11111111-1111-4111-8111-111111111111', label: 'Studio', details, makeDefault: false };
    handler = async (request, response, body) => {
      expect(request.headers.authorization).toBe(mode === 'bearer' ? 'Bearer access-1' : undefined);
      expect(request.headers.cookie).toBe(mode === 'application' ? 'sr-session=application-owned' : undefined);
      if (request.url === '/v1/account/orders?take=2') return reply(response, { data: [], pagination: {} });
      if (request.url === '/v1/account/shipping-addresses') {
        if (request.method === 'PUT') expect(JSON.parse(body)).toEqual(input);
        else expect(request.method).toBe('GET');
        return reply(response, { data: [] });
      }
      expect(request.url).toBe('/v1/account/shipping-addresses/fixture');
      expect(request.method).toBe('DELETE');
      return reply(response, { data: [] });
    };
    expect(await sdk.shippingAddresses.list()).toEqual([]);
    expect(await sdk.shippingAddresses.save(input)).toEqual([]);
    expect(await sdk.shippingAddresses.delete('fixture')).toEqual([]);
    expect((await sdk.orders.list({ take: 2 })).data).toEqual([]);
  });

  it.each(['existing account', 'unified client'])('shares %s refresh and session locking with Cart, keeping public reads anonymous', async (mode) => {
    const storage = createMemoryAccountSessionStore();
    await storage.set(session(Date.now() - 1));
    const received: string[] = [];
    handler = async (request, response) => {
      if (request.url === '/auth/v2/token') {
        // eslint-disable-next-line functional/immutable-data
        received.push('refresh');
        return reply(response, tokens);
      }
      if (request.url?.startsWith('/v1/cart/listings/search')) {
        expect(request.headers.authorization).toBeUndefined();
        return reply(response, { data: [], pagination: {} });
      }
      expect(request.url?.startsWith('/v1/cart/listings/preview')).toBe(true);
      expect(request.headers.authorization).toBe('Bearer access-2');
      // eslint-disable-next-line functional/immutable-data
      received.push('preview');
      return reply(response, { data: { listings: [] } });
    };
    const rare = createRareClient({
      publicClient: createPublicClient({ chain: sepolia, transport: http() }),
      apiBaseUrl: origin,
      ...(mode === 'existing account' ? { accountClient: client(storage) } : { sessionStore: storage }),
    });
    await rare.cart.api.listing.search();
    const intent = { seller: account.address, deadline: 9999999999n, listings: [{ sku: `0x${'12'.repeat(32)}` as const,
      settlementCurrency: zeroAddress, unitPrice: 0n, quantity: 1n }] };
    await Promise.all([rare.cart.api.listing.preview(intent), rare.cart.api.listing.preview(intent)]);
    expect(received).toEqual(['refresh', 'preview', 'preview']);
  });

  it('rejects an authenticated Cart API origin mismatch before reading or refreshing its session', async () => {
    const storage = createMemoryAccountSessionStore();
    await storage.set(session(Date.now() - 1));
    const rare = createRareClient({
      publicClient: createPublicClient({ chain: sepolia, transport: http() }),
      apiBaseUrl: 'https://different.example', accountClient: client(storage),
    });
    await expect(rare.cart.api.listing.invalidate(`0x${'11'.repeat(32)}`)).rejects.toMatchObject({ code: 'request_authority_mismatch' });
    expect(await storage.get()).toEqual(expect.objectContaining({ refreshToken: 'refresh-1' }));
  });

  it('does not forward credentials across API base paths or redirects, or replay unauthorized Cart mutations', async () => {
    const storage = createMemoryAccountSessionStore();
    await storage.set({ ...session(), apiBaseUrl: `${origin}/api`, authBaseUrl: `${origin}/api/auth/v2` });
    const authenticated = createRareClient({ apiBaseUrl: `${origin}/api`, sessionStore: storage });
    await expect(authenticated.authenticatedFetch(`${origin}/api-other/v1/cart/checkout/prepare`)).rejects.toMatchObject({ code: 'request_authority_mismatch' });
    const received: string[] = [];
    handler = async (request, response) => {
      // eslint-disable-next-line functional/immutable-data
      received.push(request.url ?? '');
      expect(request.headers.authorization).toBe('Bearer access-1');
      if (request.url === '/api/redirect') {
        response.writeHead(307, { Location: `${origin}/outside` }); response.end(); return;
      }
      reply(response, { code: 'authentication_required' }, 401);
    };
    await expect(authenticated.authenticatedFetch(`${origin}/api/redirect`, { method: 'POST' })).rejects.toThrow();
    const rare = createRareClient({ publicClient: createPublicClient({ chain: sepolia, transport: http() }),
      apiBaseUrl: `${origin}/api`, accountClient: authenticated });
    await expect(rare.cart.api.listing.invalidate(`0x${'11'.repeat(32)}`)).rejects.toMatchObject({ status: 401 });
    expect(received).toHaveLength(2);
    expect(received.every(path => path.startsWith('/api/'))).toBe(true);
  });

  it('defaults to the production API and rejects the removed separate auth URL', async () => {
    const storage = createMemoryAccountSessionStore();
    await createRareClient({ sessionStore: storage }).auth.clearSession();
    expect(await storage.get()).toMatchObject({ apiBaseUrl: 'https://api.superrare.com', authBaseUrl: 'https://api.superrare.com/auth/v2' });
    expect(() => createRareClient({ apiBaseUrl: origin, ...{ authBaseUrl: 'https://auth.example/auth/v2' } })).toThrow('auth_url_not_supported');
    expect(await createRareClient().auth.getSession()).toBeNull();
  });

  it('does not reuse a session issued by the old direct auth endpoint', async () => {
    const storage = createMemoryAccountSessionStore();
    await storage.set({ ...session(), authBaseUrl: 'https://auth.example/auth/v2' });
    await expect(client(storage).profile.get()).rejects.toMatchObject({ code: 'session_authority_mismatch' });
  });

  it('signs a bound wallet challenge and persists the token response', async () => {
    const sdk = client();
    const message = createSiweMessage({ address: account.address, chainId: 1, domain: new URL(origin).host,
      uri: origin, version: '1', nonce: 'abcdefgh1234', issuedAt: new Date(), expirationTime: new Date(Date.now() + 299000) });
    handler = async (request, response, body) => {
      if (request.url?.endsWith('/wallet/challenge')) {
        expect(JSON.parse(body)).toEqual({ client_id: 'rare-sdk', address: account.address, chain_id: 1, origin });
        reply(response, { challenge_id: 'challenge', message, expires_in: 300 });
      } else {
        const form = new URLSearchParams(body);
        expect(form.get('message')).toBe(message);
        expect(form.get('signature')).toBe(await account.signMessage({ message }));
        expect(form.get('grant_type')).toBe('urn:superrare:params:oauth:grant-type:siwe');
        reply(response, tokens);
      }
    };
    await sdk.auth.loginWithWallet({ address: account.address, chainId: 1, signMessage: message => account.signMessage({ message }) });
    expect((await sdk.auth.getSession())?.refreshToken).toBe('refresh-2');
  });

  it('rejects malformed challenge dates before asking the wallet to sign', async () => {
    const message = createSiweMessage({ address: account.address, chainId: 1, domain: new URL(origin).host,
      uri: origin, version: '1', nonce: 'abcdefgh1234', issuedAt: new Date(), expirationTime: new Date(Date.now() + 299000) })
      .replace(/Issued At: .*/, 'Issued At: invalid').replace(/Expiration Time: .*/, 'Expiration Time: invalid');
    handler = async (_request, response) => { reply(response, { challenge_id: 'challenge', message }); };
    await expect(client().auth.loginWithWallet({ address: account.address, chainId: 1,
      signMessage: async () => { throw new Error('SIGNER MUST NOT RUN'); } })).rejects.toMatchObject({ code: 'invalid_challenge_binding' });
  });

  it('persists polling cadence after slow_down and skips premature requests', async () => {
    const requests: string[] = [];
    handler = async (request, response) => {
      // eslint-disable-next-line functional/immutable-data
      requests.push(request.url ?? '');
      reply(response, { error: 'slow_down' }, 400);
    };
    const sdk = client();
    const result = await sdk.auth.pollDeviceAuthorization(device());
    expect(result.status).toBe('slow_down');
    if (result.status === 'authorized') throw new Error('Expected pending');
    expect(result.authorization.interval).toBe(10);
    const second = await sdk.auth.pollDeviceAuthorization(result.authorization);
    expect(second.status).toBe('pending');
    expect(requests).toHaveLength(1);
  });

  it('starts device authorization with standard forms and absolute expiry', async () => {
    handler = async (request, response, body) => {
      expect(request.url).toBe('/auth/v2/device/authorization');
      expect(new URLSearchParams(body).get('scope')).toBe(tokens.scope);
      reply(response, { device_code: 'secret', user_code: 'CODE', verification_uri: `${origin}/device`,
        verification_uri_complete: `${origin}/device?user_code=CODE`, expires_in: 600, interval: 5 });
    };
    const result = await client().auth.startDeviceAuthorization();
    expect(result.deviceCode).toBe('secret');
    expect(result.nextPollAt).toBeGreaterThan(Date.now());
    expect(result.expiresAt).toBeGreaterThan(result.nextPollAt);
  });

  it('refreshes once for concurrent expired-session profile requests', async () => {
    const storage = createMemoryAccountSessionStore();
    await storage.set(session(Date.now() - 100));
    const requests: string[] = [];
    handler = async (request, response, body) => {
      // eslint-disable-next-line functional/immutable-data
      requests.push(request.url ?? '');
      if (request.url?.endsWith('/token')) {
        expect(new URLSearchParams(body).get('refresh_token')).toBe('refresh-1');
        expect(await storage.get()).toMatchObject({ refreshBlocked: true });
        reply(response, tokens);
      } else {
        expect(request.headers.authorization).toBe('Bearer access-2');
        reply(response, { data: profile });
      }
    };
    const first = client(storage);
    const second = client(storage);
    expect(await Promise.all([first.profile.get(), second.profile.get()])).toEqual([profile, profile]);
    expect(requests.filter(path => path.endsWith('/token'))).toHaveLength(1);
    expect((await first.auth.getSession())?.revision).toBe('first-session');
  });

  it('does not replay a refresh after the authority consumes it but drops the response', async () => {
    const storage = createMemoryAccountSessionStore();
    await storage.set(session(Date.now() - 100));
    const requests: string[] = [];
    handler = async (request, response) => {
      // eslint-disable-next-line functional/immutable-data
      requests.push(request.url ?? '');
      response.destroy();
    };
    await expect(client(storage).profile.get()).rejects.toMatchObject({ code: 'reauthentication_required' });
    await expect(client(storage).profile.get()).rejects.toMatchObject({ code: 'reauthentication_required' });
    expect(requests).toHaveLength(1);
    expect((await client(storage).auth.getSession())?.refreshBlocked).toBe(true);
  });

  it('retains credentials after failed logout, removes them after confirmed revocation', async () => {
    const storage = createMemoryAccountSessionStore();
    await storage.set(session());
    handler = async (_request, response) => { reply(response, { error: 'server_error' }, 503); };
    const sdk = client(storage);
    await expect(sdk.auth.logout()).rejects.toMatchObject({ status: 503 });
    expect(await sdk.auth.getSession()).not.toBeNull();
    handler = async (_request, response, body) => {
      expect(new URLSearchParams(body).get('token')).toBe('refresh-1');
      response.writeHead(200); response.end();
    };
    await sdk.auth.logout();
    expect(await sdk.auth.getSession()).toBeNull();
    expect(await storage.get()).not.toHaveProperty('refreshToken');
  });

  it('does not resurrect login when another client logs out during device wait', async () => {
    const storage = createMemoryAccountSessionStore();
    const sdk = client(storage);
    const pending = sdk.auth.waitForDeviceAuthorization(device({ nextPollAt: Date.now() + 60 }));
    await client(storage).auth.logout();
    handler = async (_request, response) => { reply(response, tokens); };
    await expect(pending).rejects.toMatchObject({ code: 'session_superseded' });
    expect(await sdk.auth.getSession()).toBeNull();
  });

  it('cancels waiting without a network request', async () => {
    const controller = new AbortController();
    const pending = client().auth.waitForDeviceAuthorization(device({ nextPollAt: Date.now() + 5000 }), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('does not follow redirects with credentials or replay a rejected profile mutation', async () => {
    const storage = createMemoryAccountSessionStore();
    await storage.set(session());
    const requests: string[] = [];
    handler = async (request, response) => {
      // eslint-disable-next-line functional/immutable-data
      requests.push(request.url ?? '');
      response.writeHead(307, { Location: `${origin}/leak` }); response.end();
    };
    await expect(client(storage).profile.update({ profile: { bio: 'Updated bio' } })).rejects.toMatchObject({ code: 'transport_error' });
    expect(requests).toEqual(['/v1/me']);
  });

  it('rejects authority mismatch and unexpected profile update fields before HTTP', async () => {
    const storage = createMemoryAccountSessionStore();
    await storage.set({ ...session(), apiBaseUrl: 'https://other.example' });
    await expect(client(storage).profile.get()).rejects.toMatchObject({ code: 'session_authority_mismatch' });
    expect(() => client().profile.update(JSON.parse('{"accountId":"other"}'))).toThrow('invalid_profile_patch');
    expect(() => client().profile.update(JSON.parse('{"profile":{"bio":null}}'))).toThrow('invalid_profile_patch');
  });
  it('saves an approved device session before making authenticated profile calls', async () => {
    const sdk = client();
    handler = async (request, response) => {
      if (request.url?.endsWith('/token')) reply(response, tokens);
      else {
        expect(request.headers.authorization).toBe('Bearer access-2');
        reply(response, { data: profile });
      }
    };
    expect((await sdk.auth.pollDeviceAuthorization(device())).status).toBe('authorized');
    expect(await sdk.profile.get()).toEqual(profile);
  });

  it('backs off a dropped device response and makes no premature resumed request', async () => {
    const requests: string[] = [];
    handler = async (request, response) => {
      // eslint-disable-next-line functional/immutable-data
      requests.push(request.url ?? '');
      response.destroy();
    };
    const result = await client().auth.pollDeviceAuthorization(device());
    expect(result.status).toBe('retry');
    if (result.status === 'authorized') throw new Error('Expected retry');
    expect(result.authorization.interval).toBe(10);
    expect((await client().auth.pollDeviceAuthorization(result.authorization)).status).toBe('pending');
    expect(requests).toHaveLength(1);
  });

  it('does not transmit refresh if its write-ahead state cannot be saved', async () => {
    const memory = createMemoryAccountSessionStore();
    await memory.set(session(Date.now() - 100));
    const store = { ...memory, set: async () => { throw new Error('disk full'); } };
    await expect(client(store).profile.get()).rejects.toMatchObject({ code: 'session_persistence_failed' });
    // The default HTTP handler would fail if invoked; no token request has been made.
    expect(await memory.get()).toMatchObject({ refreshToken: 'refresh-1', revision: 'first-session' });
  });

  it('rejects cross-environment pending grants before transmitting the device secret', async () => {
    await expect(client().auth.pollDeviceAuthorization(device({ authBaseUrl: 'https://other.example' })))
      .rejects.toMatchObject({ code: 'device_authority_mismatch' });
  });

});
