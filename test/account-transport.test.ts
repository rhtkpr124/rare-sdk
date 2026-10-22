import type { RareExternalApiClient } from '../src/sdk/types/client.js';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createRareClient } from '../src/sdk/client.js';
import type { RareAccountTransport } from '../src/sdk/types/account.js';

const profile = { accountId: '42', address: '0x1111111111111111111111111111111111111111', username: 'artist', email: null, profile: { fullName: null, bio: 'hello', avatar: null } };
const response = (value: unknown) => Response.json(value);

describe('application-owned account transport', () => {
  it('dispatches feature requests without acquiring a bearer session or exposing auth methods', async () => {
    const transport = vi.fn<RareAccountTransport>(async () => response({ data: profile }));
    const client = createRareClient({ transport });
    expectTypeOf(client).toEqualTypeOf<RareExternalApiClient>();
    expect('auth' in client).toBe(false);
    expect(await client.profile.get()).toEqual(profile);
    await client.profile.update({ profile: { bio: 'updated' } });
    const call = transport.mock.calls[0];
    if (!call) throw new Error('Missing transport request');
    const [path, init] = call;
    expect(path).toBe('/v1/me');
    expect(new Headers(init.headers).has('authorization')).toBe(false);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(transport).toHaveBeenLastCalledWith('/v1/me', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ profile: { bio: 'updated' } }) }));
  });

  it('preserves binary messaging attachment responses and API errors', async () => {
    const transport = vi.fn(async () => new Response('image', { headers: { 'Content-Type': 'image/png' } }));
    const client = createRareClient({ transport });
    expect(await (await client.messaging.readImage('11111111-1111-4111-8111-111111111111')).text()).toBe('image');
    transport.mockImplementation(async () => Response.json({ error: 'authentication_required' }, { status: 401 }));
    await expect(client.profile.get()).rejects.toMatchObject({ code: 'authentication_required', status: 401 });
  });

  it('passes cancellation to the transport without retrying an uncertain write', async () => {
    const controller = new AbortController();
    const transport = vi.fn(async (_path: string, init: RequestInit) => {
      controller.abort();
      expect(init.signal?.aborted).toBe(true);
      throw new DOMException('Aborted', 'AbortError');
    });
    await expect(createRareClient({ transport }).following.follow({ username: 'artist' }, { signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('keeps signed storage transfers outside the API transport and omits credentials', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const uploadUrl = 'https://storage.googleapis.com/upload/storage/v1/b/public/o?upload_id=signed';
    const transport = vi.fn(async (path: string, init: RequestInit) => {
      expect(new Headers(init.headers).has('authorization')).toBe(false);
      return path === '/v1/uploads'
        ? response({ id, uploadUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() })
        : response({ access: 'public', key: 'a'.repeat(64), url: 'https://storage.googleapis.com/public/object', contentType: 'image/png', size: 3 });
    });
    const storageFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    const client = createRareClient({ transport, apiFetch: storageFetch });
    await client.uploads.upload(new Uint8Array([1, 2, 3]), 'image.png', { contentType: 'image/png' });
    expect(transport.mock.calls.map(([path]) => path)).toEqual(['/v1/uploads', `/v1/uploads/${id}/complete`]);
    expect(storageFetch).toHaveBeenCalledTimes(1);
    expect(storageFetch).toHaveBeenCalledWith(uploadUrl, expect.objectContaining({ method: 'PUT', credentials: 'omit', redirect: 'error' }));
    const headers = new Headers(storageFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('cookie')).toBe(false);
  });
});
