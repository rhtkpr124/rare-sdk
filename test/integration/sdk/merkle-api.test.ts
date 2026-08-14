import { describe, expect, it } from 'vitest';
import {
  generateApiAddressMerkleRoot,
  generateApiNftMerkleRoot,
  resolveApiAddressMerkleProof,
  resolveApiNftMerkleProof,
} from '../../../src/sdk/merkle-api.js';
import { verifyBatchTokenProof } from '../../../src/sdk/batch-core.js';
import { verifyReleaseAllowlistProof } from '../../../src/sdk/release-core.js';
import { RareApiError } from '../../../src/data-access/errors.js';
import { loadDotEnv } from '../../helpers/env.js';

loadDotEnv();

const describeRareApiMerkle = process.env.SDK_TEST_MODE === 'live' && process.env.RARE_API_BASE_URL
  ? describe
  : describe.skip;

const config = {};

const testNfts = [
  {
    contractAddress: '0x1111111111111111111111111111111111111111',
    tokenId: '1',
  },
  {
    contractAddress: '0x2222222222222222222222222222222222222222',
    tokenId: '2',
  },
] as const;

const testAddresses = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000',
] as const;

describeRareApiMerkle('SDK rare-api Merkle integration', () => {
  it('generates an NFT root and resolves a proof from rare-api', async () => {
    const root = await generateApiNftMerkleRoot(config, testNfts);
    const proof = await resolveApiNftMerkleProof(config, {
      chainId: 11155111,
      contractAddress: testNfts[0].contractAddress,
      tokenId: testNfts[0].tokenId,
      root,
      context: 'batch-listing',
    });

    expect(proof.root).toBe(root);
    expect(proof.contractAddress).toBe(testNfts[0].contractAddress);
    expect(proof.tokenId).toBe(testNfts[0].tokenId);
    expect(proof.proof.length).toBeGreaterThan(0);
    expect(verifyBatchTokenProof({
      root,
      contractAddress: proof.contractAddress,
      tokenId: proof.tokenId,
      proof: proof.proof,
    })).toBe(true);
  }, 30_000);

  it('generates an address root and resolves proofs from rare-api storage targets', async () => {
    const root = await generateApiAddressMerkleRoot(config, {
      addresses: testAddresses,
      storageTarget: 'both',
    });

    for (const storageTarget of ['batch-listing', 'collection-allowlist'] as const) {
      const proof = await resolveApiAddressMerkleProof(config, {
        root,
        address: testAddresses[0],
        storageTarget,
      });

      expect(proof.root).toBe(root);
      expect(proof.address).toBe(testAddresses[0]);
      expect(proof.proof.length).toBeGreaterThan(0);
      expect(verifyReleaseAllowlistProof({
        root,
        address: proof.address,
        proof: proof.proof,
      })).toBe(true);
    }
  }, 30_000);

  it('surfaces rare-api not-found proof responses as RareApiError', async () => {
    const request = resolveApiNftMerkleProof(config, {
      chainId: 11155111,
      contractAddress: testNfts[0].contractAddress,
      tokenId: testNfts[0].tokenId,
      root: `0x${'ab'.repeat(32)}`,
    });

    await expect(request).rejects.toThrow(RareApiError);
    await expect(request).rejects.toMatchObject({
      name: 'RareApiError',
      status: 404,
      path: '/v1/merkle-roots/nfts/proof',
    });
  }, 30_000);
});
