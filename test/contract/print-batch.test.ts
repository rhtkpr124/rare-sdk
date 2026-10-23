import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPublicClient, createWalletClient, http, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../src/sdk/client.js';
import type { CreatePrintDrop, PrintListingPreparation } from '../../src/sdk/types/prints.js';
import { getContractAddresses } from '../../src/contracts/addresses.js';
import { hashCartListing } from '../../src/sdk/cart-core.js';
import type { CartListing } from '../../src/sdk/types/cart.js';

describe('print batch authoring over HTTP', () => {
  it('retains a signed authorization on publish failure and retries without another wallet signature or RPC read', async () => {
    const account = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890123');
    const cart = getContractAddresses('sepolia').cart;
    if (cart === undefined) throw new Error('No Cart address configured');
    const listing: CartListing = { listingSalt: `0x${'11'.repeat(32)}`, seller: account.address, sku: `0x${'22'.repeat(32)}`,
      fulfillmentKind: 1, tokenContract: zeroAddress, tokenId: 0n, settlementCurrency: zeroAddress,
      minimumUnitPrice: 1n, availableQuantity: 10n, paymentRecipient: account.address };
    const deadline = String(Math.floor(Date.now() / 1000) + 3600);
    const preparation: PrintListingPreparation = { id: randomUUID(), user_id: 'test', option_id: randomUUID(),
      fulfillment_kind: 'PRODIGI_PRINT', chain_id: '11155111', cart_address: cart,
      listing_digest: hashCartListing(listing, sepolia.id, cart), listing_id: null, created_at: new Date().toISOString(),
      snapshot: { dropId: randomUUID(), intent: { deadline }, configured: { listing: { ...listing,
        tokenId: '0', minimumUnitPrice: '1', availableQuantity: '10' } } } };
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      requests.push(request.url ?? '');
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/rpc') {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof body !== 'object' || body === null || !('id' in body)) throw new Error('Invalid JSON RPC');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: `0x${'0'.repeat(64)}` }));
      } else if (request.url?.endsWith('/publish')) {
        const publications = requests.filter(path => path.endsWith('/publish'));
        if (publications.length === 1) {
          response.writeHead(503);
          response.end(JSON.stringify({ error: 'upstream_unavailable' }));
        } else response.end(JSON.stringify({ data: preparation }));
      } else response.end(JSON.stringify({ data: { status: 'DRAFT' } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
    const apiBaseUrl = `http://127.0.0.1:${address.port}`;
    const rare = createRareClient({ apiBaseUrl,
      publicClient: createPublicClient({ chain: sepolia, transport: http(`${apiBaseUrl}/rpc`) }),
      walletClient: createWalletClient({ account, chain: sepolia, transport: http(`${apiBaseUrl}/rpc`) }),
      transport: (path, init) => fetch(`${apiBaseUrl}${path}`, init) });
    try {
      const results = await rare.prints.listings.signAndPublish([{ key: 'print', input: { preparation } }]);
      const failed = results[0];
      expect(failed?.status).toBe('rejected');
      if (failed?.status !== 'rejected' || failed.signedArtifact === undefined) throw new Error('Signed artifact was lost');
      const previousRequestCount = requests.length;
      const retried = await rare.prints.listings.signAndPublish([{ key: 'print', input: { preparation, signedArtifact: failed.signedArtifact } }]);
      expect(retried[0]).toMatchObject({ key: 'print', status: 'fulfilled', value: { signedArtifact: failed.signedArtifact } });
      expect(requests.slice(previousRequestCount)).toEqual([`/v1/prints/listings/${preparation.id}/publish`]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('continues after a failed item, skips completed results, and reuses request keys on retry', async () => {
    const requests: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString();
      requests.push(body);
      response.setHeader('Content-Type', 'application/json');
      if (requests.length === 2) {
        response.writeHead(503);
        response.end(JSON.stringify({ error: 'upstream_unavailable', message: 'Try again later' }));
      } else {
        response.end(JSON.stringify({ data: { id: requests.length === 1 ? 'first' : 'second' } }));
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
    const apiBaseUrl = `http://127.0.0.1:${address.port}`;
    const rare = createRareClient({ apiBaseUrl, publicClient: createPublicClient({ chain: sepolia, transport: http() }),
      transport: (path, init) => fetch(`${apiBaseUrl}${path}`, init) });
    const first: CreatePrintDrop = { name: 'First', chainId: '11155111', idempotencyKey: randomUUID() };
    const second: CreatePrintDrop = { name: 'Second', chainId: '11155111', idempotencyKey: randomUUID() };
    const items = [{ key: 'first', input: first }, { key: 'second', input: second }];
    try {
      await expect(rare.prints.drops.create([{ key: 'duplicate', input: first }, { key: 'duplicate', input: second }])).rejects.toThrow('unique');
      expect(requests).toHaveLength(0);
      const result = await rare.prints.drops.create(items);
      expect(result).toMatchObject([{ key: 'first', status: 'fulfilled', value: { id: 'first' } }, { key: 'second', status: 'rejected' }]);
      const retried = await rare.prints.drops.create(items, { previousResults: result });
      expect(retried).toMatchObject([{ key: 'first', status: 'fulfilled', value: { id: 'first' } }, { key: 'second', status: 'fulfilled', value: { id: 'second' } }]);
      expect(requests).toHaveLength(3);
      expect(requests[1]).toBe(requests[2]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
