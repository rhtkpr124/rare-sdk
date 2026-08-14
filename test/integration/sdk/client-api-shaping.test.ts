/* eslint-disable functional/immutable-data */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { text } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { createRareClient } from '../../../src/sdk/client.js';

type ApiRequest = {
  method: string;
  pathname: string;
  query: Record<string, string>;
  body?: unknown;
};

const contract = '0x1000000000000000000000000000000000000000' as const;
const owner = '0x2000000000000000000000000000000000000000' as const;
const account = '0x3000000000000000000000000000000000000000' as const;

describe('Rare SDK client API request shaping', () => {
  it('binds search and NFT event API requests to the client chain', async () => {
    await withRareApiFixture(async ({ baseUrl, requests }) => {
      const rare = createTestClient(baseUrl);

      await rare.search.nfts({
        page: 2,
        perPage: 3,
        query: 'portrait',
        listingType: 'SALE_PRICE',
        auctionState: 'RUNNING',
        offerBuyerAddress: owner,
      });
      await rare.search.collections({ page: 4, perPage: 5, query: 'editions' });
      await rare.search.events({
        contract,
        tokenId: 7,
        page: 1,
        perPage: 2,
        eventType: ['CREATE_NFT'],
      });
      await rare.search.events({
        collectionId: 'custom-collection-id',
        page: 8,
        perPage: 9,
      });

      expect(requests).toEqual([
        expect.objectContaining({
          method: 'GET',
          pathname: '/v1/nfts',
          query: expect.objectContaining({
            chainId: '1',
            page: '2',
            perPage: '3',
            q: 'portrait',
            hasAuction: 'true',
            hasListing: 'true',
            hasOffer: 'true',
            listingType: 'SALE_PRICE',
            auctionState: 'RUNNING',
            offerBuyerAddress: owner,
          }),
        }),
        expect.objectContaining({
          method: 'GET',
          pathname: '/v1/collections',
          query: expect.objectContaining({
            chainId: '1',
            page: '4',
            perPage: '5',
            q: 'editions',
          }),
        }),
        expect.objectContaining({
          method: 'GET',
          pathname: `/v1/nfts/1-${contract}-7/events`,
          query: expect.objectContaining({
            page: '1',
            perPage: '2',
            eventType: 'CREATE_NFT',
          }),
        }),
        expect.objectContaining({
          method: 'GET',
          pathname: '/v1/collections/custom-collection-id/events',
          query: expect.objectContaining({
            page: '8',
            perPage: '9',
          }),
        }),
      ]);
    });
  });

  it('posts metadata and import requests with normalized client-owned bodies', async () => {
    await withRareApiFixture(async ({ baseUrl, requests }) => {
      const rare = createTestClient(baseUrl, account);

      await rare.media.pinMetadata({
        name: 'Pinned',
        description: 'Pinned metadata',
        image: {
          url: 'ipfs://image',
          mimeType: 'image/png',
          size: 12,
        },
        attributes: [{ trait_type: 'Kind', value: 'Test' }],
      });
      await rare.import.erc721({ contract, owner });
      await rare.import.erc721({ contract });

      expect(requests).toEqual([
        expect.objectContaining({
          method: 'POST',
          pathname: '/v1/nfts/metadata',
          body: expect.objectContaining({
            name: 'Pinned',
            description: 'Pinned metadata',
            nftMedia: {
              image: {
                url: 'ipfs://image',
                mimeType: 'image/png',
                size: 12,
              },
            },
            tags: [],
            attributes: [{ trait_type: 'Kind', value: 'Test' }],
          }),
        }),
        expect.objectContaining({
          method: 'POST',
          pathname: '/v1/collections/import',
          body: {
            chainId: 1,
            contractAddress: contract,
            ownerAddress: owner,
          },
        }),
        expect.objectContaining({
          method: 'POST',
          pathname: '/v1/collections/import',
          body: {
            chainId: 1,
            contractAddress: contract,
            ownerAddress: account,
          },
        }),
      ]);
    });
  });

  it('runs the full media upload handshake against a controlled API fixture', async () => {
    await withRareApiFixture(async ({ baseUrl, requests }) => {
      const rare = createTestClient(baseUrl);

      const media = await rare.media.upload(new Uint8Array([1, 2, 3, 4]), 'folder/Mint Image.PNG');

      expect(media).toEqual({
        url: 'ipfs://bafymedia',
        mimeType: 'image/png',
        size: 4,
        dimensions: { width: 1, height: 1 },
      });
      expect(requests.map((request) => request.pathname)).toEqual([
        '/v1/nfts/metadata/media/uploads',
        '/upload-part/1',
        '/v1/nfts/metadata/media/uploads/complete',
        '/v1/nfts/metadata/media/generate',
      ]);
      expect(requests[0]?.body).toEqual({
        fileSize: 4,
        filename: 'Mint Image.PNG',
      });
      expect(requests[2]?.body).toEqual({
        key: 'media/Mint Image.PNG',
        uploadId: 'upload-1',
        bucket: 'rare-cli-test',
        parts: [{ ETag: 'fixture-etag', PartNumber: 1 }],
      });
      expect(requests[3]?.body).toEqual({
        uri: 'ipfs://bafymedia',
        mimeType: 'image/png',
      });
    });
  });

  it('pins arbitrary files without NFT media post-processing', async () => {
    await withRareApiFixture(async ({ baseUrl, requests }) => {
      const rare = createTestClient(baseUrl);

      const pinned = await rare.ipfs.pinFile(new Uint8Array([1, 2, 3, 4]), 'folder/metadata.json');

      expect(pinned).toEqual({
        cid: 'bafymedia',
        ipfsUrl: 'ipfs://bafymedia',
        gatewayUrl: 'https://fixture.example/ipfs/bafymedia',
      });
      expect(requests.map((request) => request.pathname)).toEqual([
        '/v1/nfts/metadata/media/uploads',
        '/upload-part/1',
        '/v1/nfts/metadata/media/uploads/complete',
      ]);
      expect(requests[0]?.body).toEqual({
        fileSize: 4,
        filename: 'metadata.json',
      });
    });
  });

  it('pins JSON objects with a metadata filename by default', async () => {
    await withRareApiFixture(async ({ baseUrl, requests }) => {
      const rare = createTestClient(baseUrl);

      const pinned = await rare.ipfs.pinJson({ name: 'Standalone token URI' });

      expect(pinned.ipfsUrl).toBe('ipfs://bafymedia');
      expect(requests.map((request) => request.pathname)).toEqual([
        '/v1/nfts/metadata/media/uploads',
        '/upload-part/1',
        '/v1/nfts/metadata/media/uploads/complete',
      ]);
      expect(requests[0]?.body).toEqual({
        fileSize: 31,
        filename: 'metadata.json',
      });
    });
  });
});

function createTestClient(baseUrl: string, configuredAccount?: typeof account): ReturnType<typeof createRareClient> {
  return createRareClient({
    publicClient: createPublicClient({
      chain: mainnet,
      transport: http('http://127.0.0.1:8545'),
    }),
    apiBaseUrl: baseUrl,
    ...(configuredAccount === undefined ? {} : { account: configuredAccount }),
  });
}

async function withRareApiFixture<T>(
  fn: (fixture: { baseUrl: string; requests: ApiRequest[] }) => Promise<T>,
): Promise<T> {
  const requests: ApiRequest[] = [];
  const server = createServer((req, res) => {
    void handleRequest(req, res, requests, () => server.address())
      .catch((error: unknown) => {
        writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Rare API fixture server did not bind to a TCP port.');
  }

  try {
    return await fn({
      baseUrl: `http://127.0.0.1:${address.port}`,
      requests,
    });
  } finally {
    await closeServer(server);
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requests: ApiRequest[],
  serverAddress: () => ReturnType<ReturnType<typeof createServer>['address']>,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://rare-api.test');
  if (url.pathname === '/upload-part/1') {
    requests.push({
      method: req.method ?? 'PUT',
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
    });
    res.writeHead(200, { etag: 'fixture-etag' });
    res.end();
    return;
  }

  const body = await readJsonBody(req);
  requests.push({
    method: req.method ?? 'GET',
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    ...(body === undefined ? {} : { body }),
  });

  if (url.pathname === '/v1/nfts') {
    writeJson(res, 200, page([{ universalTokenId: 'mainnet-token' }], url));
    return;
  }
  if (url.pathname === '/v1/collections') {
    writeJson(res, 200, page([{ collectionId: 'mainnet-collection' }], url));
    return;
  }
  if (url.pathname.endsWith('/events')) {
    writeJson(res, 200, page([], url));
    return;
  }
  if (url.pathname === '/v1/nfts/metadata') {
    writeJson(res, 201, { ipfsUrl: 'ipfs://bafymetadata' });
    return;
  }
  if (url.pathname === '/v1/collections/import') {
    writeJson(res, 200, { imported: true });
    return;
  }
  if (url.pathname === '/v1/nfts/metadata/media/uploads') {
    const address = serverAddress();
    if (address === null || typeof address === 'string') {
      writeJson(res, 500, { error: 'fixture server unavailable' });
      return;
    }
    writeJson(res, 201, {
      uploadId: 'upload-1',
      key: 'media/Mint Image.PNG',
      bucket: 'rare-cli-test',
      partSize: 4,
      presignedUrls: [`http://127.0.0.1:${address.port}/upload-part/1`],
    });
    return;
  }
  if (url.pathname === '/v1/nfts/metadata/media/uploads/complete') {
    writeJson(res, 200, {
      cid: 'bafymedia',
      ipfsUrl: 'ipfs://bafymedia',
      gatewayUrl: 'https://fixture.example/ipfs/bafymedia',
    });
    return;
  }
  if (url.pathname === '/v1/nfts/metadata/media/generate') {
    writeJson(res, 200, {
      media: {
        uri: 'ipfs://bafymedia',
        mimeType: 'image/png',
        dimensions: '1x1',
      },
    });
    return;
  }

  writeJson(res, 404, { error: `Unhandled fixture path: ${url.pathname}` });
}

async function readJsonBody(req: IncomingMessage): Promise<unknown | undefined> {
  const raw = await text(req);
  return raw.length === 0 ? undefined : JSON.parse(raw) as unknown;
}

function page<T>(data: T[], url: URL): { data: T[]; pagination: { page: number; perPage: number; totalCount: number; totalPages: number } } {
  return {
    data,
    pagination: {
      page: Number(url.searchParams.get('page') ?? 1),
      perPage: Number(url.searchParams.get('perPage') ?? 24),
      totalCount: data.length,
      totalPages: 1,
    },
  };
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
