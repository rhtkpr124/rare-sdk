import { createMemoryAccountSessionStore } from '../src/sdk/account-session-store.js';
import { describe, expect, it, vi } from 'vitest';
import { RareApiError } from '../src/data-access/errors.js';
import { RareAuthError } from '../src/sdk/account-auth-core.js';
import { createRareClient } from '../src/sdk/client.js';
import { featureResponse } from '../src/sdk/feature-error.js';
import { validateAccountProfilePatch } from '../src/sdk/account-profile-core.js';
import { userQuery } from '../src/sdk/user-core.js';

const id = '11111111-1111-4111-8111-111111111111';
describe('consistent feature errors', () => {
  it('reports local profile and public lookup validation as application failures', () => {
    for (const operation of [() => validateAccountProfilePatch({ profile: { bio: 'x'.repeat(181) } }), () => userQuery({ userId: 0 })]) {
      try { operation(); throw new Error('Expected validation failure'); }
      catch (error) {
        expect(error).toBeInstanceOf(RareApiError);
        expect(error).not.toBeInstanceOf(RareAuthError);
        expect(error).toMatchObject({ status: 0 });
        expect((error as Error).message).not.toContain('authentication failed');
      }
    }
  });

  it('retains HTTP status, route, code and field diagnostics for profile mutations', async () => {
    const details = [{ field: 'profile.bio', message: 'Must contain at most 180 characters' }];
    const client = createRareClient({ transport: async () => Response.json({ error: 'Validation failed', code: 'validation_error', details }, { status: 400 }) });
    await expect(client.profile.update({ profile: { bio: 'hello' } })).rejects.toMatchObject({ name: 'RareApiError', status: 400, path: '/v1/me', code: 'validation_error', details });
  });

  it('normalizes nested messaging errors without exposing arbitrary descriptions', async () => {
    const client = createRareClient({ transport: async () => Response.json({ error: { code: 'forbidden', message: 'private message or bearer credential' } }, { status: 403 }) });
    const error: unknown = await client.messaging.history(id).catch(error => error);
    expect(error).toBeInstanceOf(RareApiError);
    expect(error).toMatchObject({ status: 403, path: `/v1/messaging/conversations/${id}`, code: 'forbidden' });
    expect((error as Error).message).not.toContain('private message or bearer credential');
  });

  it('retains safe OAuth-shaped error codes on authenticated resource responses', async () => {
    const client = createRareClient({ transport: async () => Response.json({ error: 'authentication_required' }, { status: 401 }) });
    await expect(client.profile.get()).rejects.toMatchObject({ name: 'RareApiError', status: 401, path: '/v1/me', code: 'authentication_required' });
  });

  it('attaches a completed private upload without transferring its bytes again', async () => {
    const attachment = { id, contentType: 'image/png', sizeBytes: 8, width: 20, height: 30 };
    const transport = vi.fn(async () => Response.json(attachment));
    const client = createRareClient({ transport });
    expect(await client.messaging.attachImage(id, id, { width: 20, height: 30, attachmentId: id, purpose: 'message' })).toEqual(attachment);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(`/v1/messaging/conversations/${id}/attachments/from-upload`, expect.objectContaining({ method: 'POST', body: JSON.stringify({ uploadId: id, width: 20, height: 30, attachmentId: id, purpose: 'message' }) }));
    await expect(client.messaging.attachImage(id, id, { width: 0, height: 30 })).rejects.toMatchObject({ name: 'RareApiError', code: 'invalid_messaging_image' });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('bounds field diagnostics and rejects unstructured descriptions as codes', async () => {
    const error: unknown = await featureResponse(Response.json({ error: 'private submitted content', details: [{ field: 'a'.repeat(200), message: 'b'.repeat(800) }] }, { status: 422 }), '/v1/me?secret=do-not-retain').catch(error => error);
    expect(error).toMatchObject({ path: '/v1/me', code: 'request_failed', details: [{ field: 'a'.repeat(128), message: 'b'.repeat(512) }] });
    expect((error as Error).message).not.toContain('private submitted content');
  });
  it('recovers an uncertain managed storage transfer by reading its committed offset', async () => {
    const api = 'https://api.example';
    const storage = createMemoryAccountSessionStore();
    await storage.set({ revision: 'session', apiBaseUrl: api, authBaseUrl: `${api}/auth/v2`, clientId: 'rare-sdk', accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 300_000, scope: 'rare:account offline_access' });
    const storageCalls: RequestInit[] = [];
    const apiFetch = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://storage.googleapis.com/')) {
        // eslint-disable-next-line functional/immutable-data
        storageCalls.push(init ?? {});
        if (storageCalls.length === 1) throw new TypeError('Connection closed after transfer');
        return new Response(null, { status: 200 });
      }
      if (url.endsWith('/complete')) return Response.json({ access: 'public', key: 'a'.repeat(64), url: 'https://storage.googleapis.com/public/object', contentType: 'image/png', size: 3 });
      return Response.json({ id, uploadUrl: 'https://storage.googleapis.com/upload/storage/v1/b/private/o?upload_id=secret', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    });
    const result = await createRareClient({ apiBaseUrl: api, apiFetch, sessionStore: storage }).upload(new Uint8Array([1, 2, 3]), 'image.png', { contentType: 'image/png' });
    expect(result.size).toBe(3);
    expect(storageCalls).toHaveLength(2);
    expect(new Headers(storageCalls[1]?.headers).get('content-range')).toBe('bytes */3');
    for (const request of storageCalls) {
      expect(request.credentials).toBe('omit');
      expect(new Headers(request.headers).has('authorization')).toBe(false);
    }
  });

});
