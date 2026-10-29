import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../dist/sdk/index.js';
import type { PrintProduct } from '../../dist/sdk/index.js';

const product = {
  id: 'GLOBAL-FAP-8X12', description: 'Enhanced matte art print', paper: 'Enhanced matte art paper · 200gsm',
  size: '8 × 12 in', widthInches: 8, heightInches: 12, sizeCategory: 'small', format: 'rectangular', automaticOrientation: true,
  printAreas: [{ name: 'default', required: true, recommendedWidthPixels: 2400, recommendedHeightPixels: 3600 }],
  fileRequirements: { acceptedContentTypes: ['image/jpeg', 'image/png'], maximumBytes: 250 * 1024 * 1024 },
} satisfies PrintProduct;

describe('public print products through the built SDK', () => {
  it('lists, gets, forwards cancellation, and exposes HTTP errors without authentication or RPC', async () => {
    const requests: { path: string | undefined; authorization: string | undefined }[] = [];
    const server = createServer((request, response) => {
      requests.push({ path: request.url, authorization: request.headers.authorization });
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/v1/prints/products') response.end(JSON.stringify({ data: [product] }));
      else if (request.url === `/v1/prints/products/${product.id}`) response.end(JSON.stringify({ data: product }));
      else { response.writeHead(404); response.end(JSON.stringify({ error: 'not_found', message: 'Unsupported print product' })); }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
    const rare = createRareClient({ apiBaseUrl: `http://127.0.0.1:${address.port}`,
      publicClient: createPublicClient({ chain: sepolia, transport: http('http://127.0.0.1:1') }) });
    try {
      const controller = new AbortController();
      expect(await rare.prints.products.list({ signal: controller.signal })).toEqual([product]);
      expect(await rare.prints.products.get(product.id, { signal: controller.signal })).toEqual(product);
      await expect(rare.prints.products.get('unsupported')).rejects.toMatchObject({ status: 404 });
      controller.abort();
      await expect(rare.prints.products.list({ signal: controller.signal })).rejects.toThrow();
      await expect(rare.prints.products.get(product.id, { signal: controller.signal })).rejects.toThrow();
      expect(requests).toEqual([
        { path: '/v1/prints/products', authorization: undefined },
        { path: `/v1/prints/products/${product.id}`, authorization: undefined },
        { path: '/v1/prints/products/unsupported', authorization: undefined },
      ]);
      expect(rare.prints).not.toHaveProperty('specifications');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
