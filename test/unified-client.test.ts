import { createPublicClient, createWalletClient, custom } from 'viem';
import { mainnet } from 'viem/chains';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createRareClient } from '../src/sdk/client.js';
import { createMemoryAccountSessionStore } from '../src/sdk/account-session-store.js';
import { createRareAccountClient } from '../src/sdk/account-client.js';
import type { RareAccountTransport } from '../src/sdk/types/account.js';
import type { RareApiClient, RareExternalApiClient } from '../src/sdk/types/client.js';

const contract = '0x1111111111111111111111111111111111111111';
const profile = { accountId: '42', address: contract, username: 'artist', email: null, profile: { fullName: null, bio: null, avatar: null } };
const pagination = { page: 1, perPage: 20, totalCount: 0, totalPages: 0 };
afterEach(() => vi.unstubAllEnvs());

describe('one primary SDK factory', () => {
  it('constructs default public/account features with no blockchain client', async () => {
    const client = createRareClient();
    expectTypeOf(client).toEqualTypeOf<RareApiClient>();
    expect('chain' in client).toBe(false);
    expect('listing' in client).toBe(false);
    expect(await client.auth.getSession()).toBeNull();
    await expect(client.profile.get()).rejects.toMatchObject({ code: 'authentication_required' });
    expect(client.drops).toEqual(expect.objectContaining({ list: expect.any(Function), get: expect.any(Function), create: expect.any(Function), update: expect.any(Function), delete: expect.any(Function) }));
    expect(client.posts).toEqual(expect.objectContaining({ list: expect.any(Function), get: expect.any(Function), comments: expect.any(Function), create: expect.any(Function), comment: expect.any(Function), delete: expect.any(Function), deleteComment: expect.any(Function) }));
    expect(client.messaging.public.resolveRoom).toBeTypeOf('function');
    expect(client.messaging.history).toBeTypeOf('function');
    expect(client.collection.get).toBeTypeOf('function');
    expect(client.liquidEdition.get).toBeTypeOf('function');
  });

  it('uses one external API transport for public and authenticated resource methods', async () => {
    const transport = vi.fn<RareAccountTransport>(async path => path === '/v1/me'
      ? Response.json({ data: profile })
      : Response.json({ data: [], pagination }));
    const client = createRareClient({ transport });
    expectTypeOf(client).toEqualTypeOf<RareExternalApiClient>();
    expect('auth' in client).toBe(false);
    await client.search.nfts({ chainId: 1, query: 'portrait' });
    expect(await client.profile.get()).toEqual(profile);
    await client.posts.list({ userId: 42 });
    await client.drops.list({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' });
    expect(transport.mock.calls.map(([path]) => path)).toEqual([
      expect.stringMatching(/^\/v1\/nfts\?/u), '/v1/me', expect.stringMatching(/^\/v1\/posts\?/u), expect.stringMatching(/^\/v1\/drops\?/u),
    ]);
  });

  it.each(['https://storage.example/signed-object', 'https://api.example/outside-base/signed-object'])('keeps signed IPFS transfer %s outside the API transport', async signedUrl => {
    const transport = vi.fn<RareAccountTransport>(async path => path.endsWith('/complete')
      ? Response.json({ ipfsUrl: 'ipfs://uploaded-object' })
      : Response.json({ key: 'object', uploadId: 'upload', bucket: 'bucket', partSize: 8, presignedUrls: [signedUrl] }));
    const apiFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200, headers: { etag: 'part-etag' } }));
    const client = createRareClient({ transport, apiFetch, apiBaseUrl: 'https://api.example/base' });
    expect(await client.ipfs.pinFile(new Uint8Array([1, 2, 3]), 'file.bin')).toEqual({ ipfsUrl: 'ipfs://uploaded-object' });
    expect(transport.mock.calls.map(([path]) => path)).toEqual(['/v1/nfts/metadata/media/uploads', '/v1/nfts/metadata/media/uploads/complete']);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch).toHaveBeenCalledWith(signedUrl, expect.objectContaining({ method: 'PUT', credentials: 'omit' }));
    const headers = new Headers(apiFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
  });

  it('requires explicit lookup chains without an RPC and accepts all-chain search', async () => {
    const apiFetch = vi.fn<typeof fetch>(async request => Response.json({ data: new URL(request instanceof Request ? request.url : String(request)).pathname.endsWith('/favorites/count') ? { count: 7 } : {} }));
    const client = createRareClient({ apiFetch });
    expect(() => client.nft.get({ contract, tokenId: 1 })).toThrow('Pass chainId or chain');
    expect(() => client.liquidEdition.get({ contract })).toThrow('Pass chainId or chain');
    expect(apiFetch).not.toHaveBeenCalled();
    expect(await client.nft.favoriteCount({ chainId: 1, contract, tokenId: 1 })).toBe(7);
    await client.liquidEdition.get({ chainId: 1, contract });
    expect(apiFetch.mock.calls.map(([request]) => new URL(request instanceof Request ? request.url : String(request)).pathname)).toEqual([`/v1/nfts/1-${contract}-1/favorites/count`, `/v1/liquid-editions/1-${contract}`]);
  });

  it('adds chain features without making an RPC call or losing HTTP resource methods', async () => {
    const rpc = vi.fn(async () => { throw new Error('Unexpected RPC request'); });
    const publicClient = createPublicClient({ chain: mainnet, transport: custom({ request: rpc }) });
    const client = createRareClient({ publicClient });
    expect(client.chainId).toBe(1);
    expect(client.listing.status).toBeTypeOf('function');
    expect(client.profile.get).toBeTypeOf('function');
    expect(client.nft.events).toBeTypeOf('function');
    expect(client.collection.events).toBeTypeOf('function');
    expect(client.drops.create).toBeTypeOf('function');
    expect(client.drops.list).toBeTypeOf('function');
    expect(client.messaging.public.history).toBeTypeOf('function');
    expect(rpc).not.toHaveBeenCalled();
    const external = createRareClient({ publicClient, transport: async () => Response.json({ data: profile }) });
    expect('auth' in external).toBe(false);
    expect(await external.profile.get()).toEqual(profile);
  });

  it('preserves internal HTTP construction while rejecting insecure authentication before transmission', async () => {
    const publicClient = createPublicClient({ chain: mainnet, transport: custom({ request: async () => { throw new Error('Unexpected RPC'); } }) });
    const apiFetch = vi.fn<typeof fetch>();
    const client = createRareClient({ publicClient, apiBaseUrl: 'http://rare-api-devmainnet.us-east1', apiFetch });
    expect(client.chainId).toBe(1);
    await expect(client.profile.get()).rejects.toThrow('Authentication requires HTTPS');
    expect(apiFetch).not.toHaveBeenCalled();
    const walletClient = createWalletClient({ chain: mainnet, transport: custom({ request: async () => undefined }) });
    // JavaScript consumers can pass this invalid combination despite TypeScript's overloads.
    expect(() => Reflect.apply(createRareClient, undefined, [{ walletClient }])).toThrow('publicClient is required');
  });

  it('resolves the existing environment base override once for public and account requests', async () => {
    vi.stubEnv('RARE_API_BASE_URL', 'https://environment.example');
    const apiFetch = vi.fn<typeof fetch>(async () => Response.json({ data: [], pagination }));
    const sessionStore = createMemoryAccountSessionStore();
    const client = createRareClient({ apiBaseUrl: 'https://explicit.example', apiFetch, sessionStore });
    await client.search.nfts();
    await client.auth.clearSession();
    expect(new URL((apiFetch.mock.calls[0]?.[0] as Request).url).origin).toBe('https://environment.example');
    expect(await client.auth.getSession()).toBeNull();
    expect(await sessionStore.get()).toMatchObject({ apiBaseUrl: 'https://environment.example', authBaseUrl: 'https://environment.example/auth/v2' });
  });

  it('keeps the deprecated account factory as a compatibility wrapper', async () => {
    const legacy = createRareAccountClient();
    expect(await legacy.auth.getSession()).toBeNull();
    const external = createRareAccountClient({ transport: async () => Response.json({ data: profile }) });
    expect('auth' in external).toBe(false);
    expect(await external.profile.get()).toEqual(profile);
    expect(() => createRareAccountClient({ apiBaseUrl: 'http://unsafe.example' })).toThrow('Authentication requires HTTPS');
  });
});
