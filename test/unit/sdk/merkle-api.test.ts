/* eslint-disable no-restricted-syntax */
import { describe, expect, it, vi } from 'vitest';
import { RareApiError } from '../../../src/data-access/errors.js';
import {
  generateApiAddressMerkleRoot,
  generateApiNftMerkleRoot,
  isApiNftMerkleProofResolutionError,
  resolveApiNftMerkleProof,
  resolveApiNftMerkleProofFromRoots,
} from '../../../src/sdk/merkle-api.js';

const hex32 = (byte: string): `0x${string}` => `0x${byte.repeat(64)}`;

describe('SDK merkle API client', () => {
  it('posts through the shared rare-api client and normalizes responses', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body: unknown = await request.clone().json();

      expect(request.method).toBe('POST');
      expect(request.url).toBe('https://rare-api.test/v1/merkle-roots/nfts/proof');
      expect(request.headers.get('content-type')).toBe('application/json');
      expect(body).toEqual({
        chainId: 11155111,
        contractAddress: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        root: hex32('1'),
        context: 'batch-listing',
      });

      return jsonResponse({
        root: hex32('1'),
        contractAddress: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        leaf: hex32('2'),
        proof: [hex32('3')],
      });
    });

    const proof = await resolveApiNftMerkleProof(
      { apiBaseUrl: 'https://rare-api.test', apiFetch: fetchImpl },
      {
        chainId: 11155111,
        contractAddress: '0x1111111111111111111111111111111111111111',
        tokenId: 1n,
        root: hex32('1'),
        context: 'batch-listing',
      },
    );

    expect(proof).toEqual({
      root: hex32('1'),
      contractAddress: '0x1111111111111111111111111111111111111111',
      tokenId: '1',
      leaf: hex32('2'),
      proof: [hex32('3')],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces merkle endpoint failures as RareApiError', async () => {
    const request = generateApiNftMerkleRoot(
      {
        apiBaseUrl: 'https://rare-api.test',
        apiFetch: async () => jsonResponse({ error: 'rate limit exceeded' }, { status: 429, statusText: 'Too Many Requests' }),
      },
      [{ contractAddress: '0x1111111111111111111111111111111111111111', tokenId: 1n }],
    );

    await expect(request).rejects.toThrow(RareApiError);
    await expect(request).rejects.toMatchObject({
      name: 'RareApiError',
      status: 429,
      path: '/v1/merkle-roots/nfts',
      message: 'API error 429 on /v1/merkle-roots/nfts: rate limit exceeded',
    });
  });

  it('retries transient rare-api transport failures', async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      if (fetchImpl.mock.calls.length === 1) {
        throw new TypeError('fetch failed', { cause: new Error('read ECONNRESET') });
      }

      return jsonResponse({
        merkleRoot: hex32('1'),
      });
    });

    const root = await generateApiAddressMerkleRoot(
      { apiBaseUrl: 'https://rare-api.test', apiFetch: fetchImpl },
      {
        addresses: ['0x1111111111111111111111111111111111111111'],
        storageTarget: 'collection-allowlist',
      },
    );

    expect(root).toBe(hex32('1'));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('resolves a proof from candidate roots and ignores not-found roots', async () => {
    const missingRoot = hex32('1');
    const matchingRoot = hex32('2');
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = await request.clone().json() as { root: string };

      if (body.root === missingRoot) {
        return jsonResponse({ error: 'No Merkle root found' }, { status: 404, statusText: 'Not Found' });
      }

      expect(body.root).toBe(matchingRoot);
      return jsonResponse({
        root: matchingRoot,
        contractAddress: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        leaf: hex32('3'),
        proof: [hex32('4')],
      });
    });

    const proof = await resolveApiNftMerkleProofFromRoots(
      { apiBaseUrl: 'https://rare-api.test', apiFetch: fetchImpl },
      {
        chainId: 11155111,
        contractAddress: '0x1111111111111111111111111111111111111111',
        tokenId: 1n,
        roots: [missingRoot, matchingRoot],
        context: 'batch-auction',
      },
    );

    expect(proof.root).toBe(matchingRoot);
    expect(proof.proof).toEqual([hex32('4')]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('requires an explicit root when more than one candidate root contains the token', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init);
      const body = await request.clone().json() as { root: `0x${string}` };
      return jsonResponse({
        root: body.root,
        contractAddress: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        leaf: hex32('3'),
        proof: [hex32('4')],
      });
    });

    const request = resolveApiNftMerkleProofFromRoots(
      { apiBaseUrl: 'https://rare-api.test', apiFetch: fetchImpl },
      {
        chainId: 11155111,
        contractAddress: '0x1111111111111111111111111111111111111111',
        tokenId: 1n,
        roots: [hex32('1'), hex32('2')],
        context: 'batch-offer',
      },
    );

    await expect(request).rejects.toThrow(
      'Multiple active batch-offer Merkle roots contain token 0x1111111111111111111111111111111111111111/1. Pass root as an override.',
    );
  });

  it('classifies rare-api NFT proof resolution misses', () => {
    expect(isApiNftMerkleProofResolutionError(
      new RareApiError('No Merkle root found', 404, '/v1/merkle-roots/nfts/proof'),
    )).toBe(true);
    expect(isApiNftMerkleProofResolutionError(
      new RareApiError('Multiple Merkle roots found', 409, '/v1/merkle-roots/nfts/proof'),
    )).toBe(true);
    expect(isApiNftMerkleProofResolutionError(
      new RareApiError('unexpected', 500, '/v1/merkle-roots/nfts/proof'),
    )).toBe(false);
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
}
