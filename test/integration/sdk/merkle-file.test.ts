import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { ETH_ADDRESS } from '../../../src/contracts/addresses.js';
import {
  loadMerkleRootArtifact,
} from '../../../src/sdk/merkle-file.js';
import {
  validateRootArtifact,
} from '../../../src/sdk/merkle-core.js';
import type { BatchListingRootArtifact } from '../../../src/sdk/batch-listing.js';

const contract = '0x1111111111111111111111111111111111111111' satisfies Address;
const buyer = '0x1000000000000000000000000000000000000000' satisfies Address;
const otherBuyer = '0x2000000000000000000000000000000000000000' satisfies Address;

const allowListedRootArtifact = {
  root: '0xa01f005c90f56c0f2b981e045caf4949f489bf82e5d3c49effb1334cab26043a',
  currency: ETH_ADDRESS,
  amount: '1',
  splitAddresses: [],
  splitRatios: [],
  tokens: [
    { contract, tokenId: '1' },
    { contract, tokenId: '2' },
  ],
  allowList: {
    root: '0x27544996534742c5e4c082fa1ed524eea6991a4d0325902124bc233e8d7379af',
    addresses: [buyer, otherBuyer],
    endTimestamp: '1234',
  },
} satisfies BatchListingRootArtifact;

describe('merkle artifact file integration', () => {
  it('loads root artifacts from disk without recomputing roots from token-set input', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rare-batch-root-artifact-'));
    const path = join(dir, 'artifact.json');
    try {
      await writeFile(path, JSON.stringify(allowListedRootArtifact, null, 2));
      const loaded = await loadMerkleRootArtifact(path);
      expect(loaded.root).toBe(allowListedRootArtifact.root);
      expect(loaded.allowList?.root).toBe(allowListedRootArtifact.allowList.root);

      const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
      expect(() => validateRootArtifact(parsed)).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
