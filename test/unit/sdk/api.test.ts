import { describe, expect, it, vi } from 'vitest';
import { createRareApi } from '../../../src/sdk/api.js';

describe('SDK API failure handling', () => {
  it('surfaces missing search response data with a specific SDK error', async () => {
    const api = createRareApi({
      baseUrl: 'https://rare-api.test',
      fetch: async () => new Response(null, { status: 204 }),
    });

    await expect(api.searchNfts({ page: 1, perPage: 1 })).rejects.toThrow('Failed to search NFTs');
  });

  it('surfaces missing metadata pin response data with a specific SDK error', async () => {
    const api = createRareApi({
      baseUrl: 'https://rare-api.test',
      fetch: async () => new Response(null, { status: 204 }),
    });

    await expect(api.pinMetadata({
      name: 'Rare Token',
      description: 'A test token',
      image: { url: 'ipfs://image', mimeType: 'image/png', size: 10 },
    })).rejects.toThrow('Failed to pin metadata');
  });

  it('surfaces missing ERC-721 import response data with a specific SDK error', async () => {
    const api = createRareApi({
      baseUrl: 'https://rare-api.test',
      fetch: async () => new Response(null, { status: 204 }),
    });

    await expect(api.importErc721({
      chainId: 1,
      contract: '0x0000000000000000000000000000000000000001',
      owner: '0x0000000000000000000000000000000000000002',
    })).rejects.toThrow('Failed to import ERC-721 collection');
  });

  it('rejects empty IPFS uploads before API requests', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createRareApi({
      baseUrl: 'https://rare-api.test',
      fetch: fetchImpl,
    });

    await expect(api.pinFile(new Uint8Array(), 'empty.bin')).rejects.toThrow('IPFS upload file must not be empty.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects non-serializable JSON uploads before API requests', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createRareApi({
      baseUrl: 'https://rare-api.test',
      fetch: fetchImpl,
    });

    await expect(api.pinJson(undefined)).rejects.toThrow('IPFS JSON upload value must be JSON-serializable.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails media uploads when a presigned part upload is rejected', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init);

      if (request.method === 'POST' && request.url === 'https://rare-api.test/v1/nfts/metadata/media/uploads') {
        return jsonResponse({
          partSize: 1,
          presignedUrls: ['https://upload.test/part-1'],
          key: 'media-key',
          uploadId: 'upload-id',
          bucket: 'media-bucket',
        });
      }

      if (request.method === 'PUT' && request.url === 'https://upload.test/part-1') {
        return new Response('upload failed', { status: 500 });
      }

      return new Response(`unexpected request: ${request.method} ${request.url}`, { status: 500 });
    });
    const api = createRareApi({
      baseUrl: 'https://rare-api.test',
      fetch: fetchImpl,
    });

    await expect(api.uploadMedia(new Uint8Array([1]), 'art.png')).rejects.toThrow(
      'Part 1 upload failed with status 500',
    );
    expect(fetchImpl.mock.calls.map(([input, init]) => requestLabel(input, init))).toEqual([
      'POST https://rare-api.test/v1/nfts/metadata/media/uploads',
      'PUT https://upload.test/part-1',
    ]);
  });

  it('fails media uploads when a presigned part response omits the etag', async () => {
    const api = createRareApi({
      baseUrl: 'https://rare-api.test',
      fetch: async (input, init) => {
        const request = input instanceof Request ? input : new Request(input, init);

        if (request.method === 'POST' && request.url === 'https://rare-api.test/v1/nfts/metadata/media/uploads') {
          return jsonResponse({
            partSize: 1,
            presignedUrls: ['https://upload.test/part-1'],
            key: 'media-key',
            uploadId: 'upload-id',
            bucket: 'media-bucket',
          });
        }

        if (request.method === 'PUT' && request.url === 'https://upload.test/part-1') {
          return new Response('', { status: 200 });
        }

        return new Response(`unexpected request: ${request.method} ${request.url}`, { status: 500 });
      },
    });

    await expect(api.uploadMedia(new Uint8Array([1]), 'art.png')).rejects.toThrow(
      'Missing etag header for part 1',
    );
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestLabel(input: RequestInfo | URL, init?: RequestInit): string {
  const request = input instanceof Request ? input : new Request(input, init);
  return `${request.method} ${request.url}`;
}
