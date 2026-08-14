/* eslint-disable functional/immutable-data */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RARE_API_BASE_URL, resolveRareApiBaseUrl } from '../../../src/data-access/base-url.js';
import { createApiClient } from '../../../src/data-access/client.js';
import { RareApiError } from '../../../src/data-access/errors.js';

const originalRareApiBaseUrl = process.env.RARE_API_BASE_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalRareApiBaseUrl === undefined) {
    delete process.env.RARE_API_BASE_URL;
  } else {
    process.env.RARE_API_BASE_URL = originalRareApiBaseUrl;
  }
});

describe('API client configuration', () => {
  it('resolves base URLs from env, explicit config, then the production default', () => {
    process.env.RARE_API_BASE_URL = 'https://rare-api.env.test';
    expect(resolveRareApiBaseUrl('https://rare-api.config.test')).toBe('https://rare-api.env.test');

    delete process.env.RARE_API_BASE_URL;
    expect(resolveRareApiBaseUrl('https://rare-api.config.test')).toBe('https://rare-api.config.test');
    expect(resolveRareApiBaseUrl()).toBe(DEFAULT_RARE_API_BASE_URL);
  });

  it('falls back to explicit config and default values when process is unavailable', () => {
    vi.stubGlobal('process', undefined);

    expect(resolveRareApiBaseUrl('https://rare-api.config.test')).toBe('https://rare-api.config.test');
    expect(resolveRareApiBaseUrl()).toBe(DEFAULT_RARE_API_BASE_URL);
  });

  it('ignores blank base URL overrides', () => {
    process.env.RARE_API_BASE_URL = '';
    expect(resolveRareApiBaseUrl('https://rare-api.config.test')).toBe('https://rare-api.config.test');

    process.env.RARE_API_BASE_URL = '   ';
    expect(resolveRareApiBaseUrl('https://rare-api.config.test')).toBe('https://rare-api.config.test');
    expect(resolveRareApiBaseUrl('')).toBe(DEFAULT_RARE_API_BASE_URL);
    expect(resolveRareApiBaseUrl('   ')).toBe(DEFAULT_RARE_API_BASE_URL);
  });

  it('trims base URL overrides before use', () => {
    process.env.RARE_API_BASE_URL = '  https://rare-api.env.test  ';
    expect(resolveRareApiBaseUrl('https://rare-api.config.test')).toBe('https://rare-api.env.test');

    delete process.env.RARE_API_BASE_URL;
    expect(resolveRareApiBaseUrl('  https://rare-api.config.test  ')).toBe('https://rare-api.config.test');
  });

  it('uses RARE_API_BASE_URL as the global base URL override', async () => {
    process.env.RARE_API_BASE_URL = 'https://rare-api.test';
    const requests: Request[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const request = input instanceof Request ? input : new Request(input);
      requests.push(request);
      return new Response(JSON.stringify({ data: [], pagination: { page: 1, perPage: 1, total: 0 } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = createApiClient('https://explicit-api.test');
    await client.GET('/v1/nfts', { params: { query: { page: 1, perPage: 1 } } });

    expect(requests[0]?.url).toBe('https://rare-api.test/v1/nfts?page=1&perPage=1');
  });

  it('throws RareApiError with API error bodies for non-2xx responses', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'rate limit exceeded' }), {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Content-Type': 'application/json' },
      }));

    const client = createApiClient('https://rare-api.test');
    const request = client.GET('/v1/nfts', { params: { query: { page: 1, perPage: 1 } } });

    await expect(request).rejects.toThrow(RareApiError);
    await expect(request).rejects.toMatchObject({
      name: 'RareApiError',
      status: 429,
      path: '/v1/nfts',
      message: 'API error 429 on /v1/nfts: rate limit exceeded',
    });
  });

  it('falls back to response status text when API error bodies are not JSON', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response('temporarily unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
      }));

    const client = createApiClient('https://rare-api.test');

    await expect(
      client.GET('/v1/users/{address}', {
        params: { path: { address: '0x0000000000000000000000000000000000000001' } },
      }),
    ).rejects.toMatchObject({
      name: 'RareApiError',
      status: 503,
      path: '/v1/users/0x0000000000000000000000000000000000000001',
      message: 'API error 503 on /v1/users/0x0000000000000000000000000000000000000001: Service Unavailable',
    });
  });
});
