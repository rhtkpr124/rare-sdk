import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { createMemoryAccountSessionStore, createRareClient } from '../../dist/sdk/index.js';
import type { CreatePrintEstimate, PrintEstimate, PrintReleaseManifestMutation, SavePrintReleaseManifest } from '../../dist/sdk/index.js';

const id = '11111111-1111-4111-8111-111111111111';
const releaseContractAddress = `0x${'a'.repeat(40)}`;
const entry = { id: '22222222-2222-4222-8222-222222222222', metadataUri: 'ipfs://example/1.json', productionUploadKey: 'a'.repeat(64) };
const input: SavePrintReleaseManifest = { expectedVersion: 0, idempotencyKey: id, chainId: '11155111', releaseContractAddress, entries: [entry] };
const header = { id, chainId: input.chainId, releaseContractAddress, version: 1, createdAt: '2026-10-29T00:00:00Z', updatedAt: '2026-10-29T00:00:00Z' };
const mutation: PrintReleaseManifestMutation = { ...header, entries: [entry], removedEntryIds: [] };
const estimateInput: CreatePrintEstimate = { specificationId: 'GLOBAL-FAP-16X24', destinationCountryCode: 'US' };
const estimate: PrintEstimate = { currency: 'USD', productionCostUsdCents: '1200', shippingCostUsdCents: '500', quotedAt: '2026-10-29T00:00:00Z', expiresAt: '2026-10-29T00:05:00Z',
  assumptions: { ...estimateInput, copies: 1, shippingMethod: 'Standard' }, warnings: ['estimate_only', 'artwork_price_taxes_and_checkout_fees_excluded'] };
const requests: { path?: string; method?: string; authorization?: string; cookie?: string; body: unknown; contentType?: string }[] = [];
let replies: { status?: number; body: unknown }[] = [];
let origin = '';
const server = createServer(async (request, response) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = Buffer.concat(chunks).toString();
  requests.push({ path: request.url, method: request.method, authorization: request.headers.authorization,
    cookie: request.headers.cookie, body: body ? JSON.parse(body) : undefined, contentType: request.headers['content-type'] });
  const reply = replies.shift() ?? { status: 500, body: { error: 'unexpected_request' } };
  response.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(reply.body));
});

beforeEach(async () => {
  requests.length = 0;
  replies = [];
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function createClient(mode: string) {
  const publicClient = createPublicClient({ chain: sepolia, transport: http('http://127.0.0.1:1') });
  const sessionStore = createMemoryAccountSessionStore();
  await sessionStore.set({ revision: 'print-preparation', authBaseUrl: `${origin}/auth/v2`, apiBaseUrl: origin,
    clientId: 'rare-sdk', accessToken: 'test-access', refreshToken: 'test-refresh', expiresAt: Date.now() + 300000, scope: 'rare:account offline_access' });
  return mode === 'bearer' ? createRareClient({ apiBaseUrl: origin, publicClient, sessionStore }) : createRareClient({ publicClient,
    transport: (path, init) => fetch(`${origin}${path}`, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Cookie: 'sr-session=application-owned' } }) });
}

describe('print preparation through the built SDK', () => {
  it.each(['bearer', 'application'])('shares %s authentication and preserves estimate assumptions and errors', async mode => {
    const rare = await createClient(mode);
    replies = [{ body: { data: estimate } }, { status: 503, body: { error: { code: 'print_dependency_unavailable', message: 'Try again', retryable: true } } }];
    expect(await rare.prints.estimates.create(estimateInput)).toEqual(estimate);
    await expect(rare.prints.estimates.create({ ...estimateInput, copies: 2 })).rejects.toMatchObject({ status: 503, code: 'print_dependency_unavailable' });
    expect(requests).toMatchObject([
      { path: '/v1/prints/estimates', method: 'POST', contentType: 'application/json', body: estimateInput },
      { path: '/v1/prints/estimates', method: 'POST', body: { ...estimateInput, copies: 2 } },
    ]);
    for (const request of requests) {
      expect(request.authorization).toBe(mode === 'bearer' ? 'Bearer test-access' : undefined);
      expect(request.cookie).toBe(mode === 'application' ? 'sr-session=application-owned' : undefined);
    }
  });

  it.each(['bearer', 'application'])('saves and resumes private preparations over %s transport without token or signing operations', async mode => {
    const rare = await createClient(mode);
    const page = { data: { ...header, entries: [entry] }, pagination: { page: 2, perPage: 100, totalCount: 101, totalPages: 2 } };
    replies = [{ body: { data: mutation } }, { body: { data: mutation } }, { body: page }, { body: { data: header } }, { body: { data: null } }];
    expect(await rare.prints.releaseManifests.save(id, input)).toEqual(mutation);
    expect(await rare.prints.releaseManifests.save(id, input)).toEqual(mutation);
    expect(requests[0]?.body).toEqual(requests[1]?.body);
    expect(requests[0]?.body).toEqual({ ...input, removeEntryIds: [] });
    expect(await rare.prints.releaseManifests.get(id, { page: 2, perPage: 100, expectedVersion: 1 })).toEqual(page);
    expect(await rare.prints.releaseManifests.lookup({ chainId: '11155111', releaseContractAddress })).toEqual(header);
    expect(await rare.prints.releaseManifests.lookup({ chainId: '11155111', releaseContractAddress })).toBeNull();
    expect(requests.map(request => request.path)).toEqual([
      `/v1/prints/release-manifests/${id}`, `/v1/prints/release-manifests/${id}`,
      `/v1/prints/release-manifests/${id}?page=2&perPage=100&expectedVersion=1`,
      `/v1/prints/release-manifests/lookup?chainId=11155111&releaseContractAddress=${releaseContractAddress}`,
      `/v1/prints/release-manifests/lookup?chainId=11155111&releaseContractAddress=${releaseContractAddress}`,
    ]);
    for (const request of requests) {
      expect(request.authorization).toBe(mode === 'bearer' ? 'Bearer test-access' : undefined);
      expect(request.cookie).toBe(mode === 'application' ? 'sr-session=application-owned' : undefined);
    }
  });

  it('surfaces conflicts without retrying with a new identity or version', async () => {
    const rare = await createClient('application');
    replies = [{ status: 409, body: { error: { code: 'manifest_version_conflict', message: 'Reload the manifest', retryable: false } } }];
    await expect(rare.prints.releaseManifests.save(id, input)).rejects.toMatchObject({ status: 409, code: 'manifest_version_conflict' });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.body).toEqual({ ...input, removeEntryIds: [] });
  });

  it('rejects invalid writes and canceled reads before reaching HTTP', async () => {
    const rare = await createClient('application');
    await expect(rare.prints.estimates.create({ ...estimateInput, copies: 0 })).rejects.toMatchObject({ code: 'invalid_print_estimate' });
    await expect(rare.prints.releaseManifests.save(id, { ...input, entries: [entry, entry] })).rejects.toMatchObject({ code: 'invalid_print_release_manifest' });
    await expect(rare.prints.releaseManifests.save(id, { ...input, removeEntryIds: [entry.id] })).rejects.toMatchObject({ code: 'invalid_print_release_manifest' });
    await expect(rare.prints.releaseManifests.get('invalid')).rejects.toMatchObject({ code: 'invalid_print_release_manifest_query' });
    const controller = new AbortController();
    controller.abort();
    await expect(rare.prints.estimates.create(estimateInput, { signal: controller.signal })).rejects.toThrow();
    await expect(rare.prints.releaseManifests.get(id, {}, { signal: controller.signal })).rejects.toThrow();
    await expect(rare.prints.releaseManifests.lookup({ chainId: '11155111', releaseContractAddress }, { signal: controller.signal })).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});
