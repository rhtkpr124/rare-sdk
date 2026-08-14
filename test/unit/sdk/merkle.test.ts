import { describe, expect, it } from 'vitest';
import { isHex, type Address } from 'viem';
import { ETH_ADDRESS } from '../../../src/contracts/addresses.js';
import {
  buildMerkleProofArtifact,
  validateProofArtifact,
  validateRootArtifact,
} from '../../../src/sdk/merkle-core.js';
import type { BatchListingRootArtifact } from '../../../src/sdk/batch-listing.js';

const contract = '0x1111111111111111111111111111111111111111' satisfies Address;
const buyer = '0x1000000000000000000000000000000000000000' satisfies Address;
const otherBuyer = '0x2000000000000000000000000000000000000000' satisfies Address;

const rootArtifact = {
  root: '0xa01f005c90f56c0f2b981e045caf4949f489bf82e5d3c49effb1334cab26043a',
  currency: ETH_ADDRESS,
  amount: '1',
  splitAddresses: [],
  splitRatios: [],
  tokens: [
    { contract, tokenId: '1' },
    { contract, tokenId: '2' },
  ],
} satisfies BatchListingRootArtifact;

const allowListedRootArtifact = {
  ...rootArtifact,
  allowList: {
    root: '0x27544996534742c5e4c082fa1ed524eea6991a4d0325902124bc233e8d7379af',
    addresses: [buyer, otherBuyer],
    endTimestamp: '1234',
  },
} satisfies BatchListingRootArtifact;

function uppercaseHexDigits(hex: `0x${string}`): `0x${string}` {
  const value = `0x${hex.slice(2).toUpperCase()}`;
  if (!isHex(value, { strict: true })) {
    throw new Error(`Invalid uppercase hex fixture: ${value}`);
  }
  return value;
}

describe('merkle artifact core utilities', () => {
  it('builds token proofs from a service-provided root artifact', () => {
    const proof = buildMerkleProofArtifact(rootArtifact, contract, '1');

    expect(proof).toEqual({
      root: rootArtifact.root,
      contract,
      tokenId: '1',
      proof: ['0xfde38319eec56e703ba771c1e2abddca86188674940372bdfed26cec392ec314'],
    });
  });

  it('includes allowListProof for an allowlisted buyer', () => {
    const proof = buildMerkleProofArtifact(allowListedRootArtifact, contract, '1', buyer);

    expect(proof.allowListProof).toEqual([
      '0x8dfad888a2f79bcfe6633c369a5652e94379f63f5849d8e8fe519c586bb49633',
    ]);
    expect(proof.allowListAddress).toBe(buyer);
  });

  it('builds token proofs when artifact roots use uppercase hex', () => {
    const artifact = {
      ...rootArtifact,
      root: uppercaseHexDigits(rootArtifact.root),
    };

    expect(() => validateRootArtifact(artifact)).not.toThrow();

    const proof = buildMerkleProofArtifact(artifact, contract, '1');

    expect(proof).toEqual({
      root: rootArtifact.root,
      contract,
      tokenId: '1',
      proof: ['0xfde38319eec56e703ba771c1e2abddca86188674940372bdfed26cec392ec314'],
    });
  });

  it('builds allowlist proofs when allowlist roots use uppercase hex', () => {
    const artifact = {
      ...allowListedRootArtifact,
      allowList: {
        ...allowListedRootArtifact.allowList,
        root: uppercaseHexDigits(allowListedRootArtifact.allowList.root),
      },
    };

    expect(() => validateRootArtifact(artifact)).not.toThrow();

    const proof = buildMerkleProofArtifact(artifact, contract, '1', buyer);

    expect(proof.root).toBe(rootArtifact.root);
    expect(proof.proof).toEqual([
      '0xfde38319eec56e703ba771c1e2abddca86188674940372bdfed26cec392ec314',
    ]);
    expect(proof.allowListProof).toEqual([
      '0x8dfad888a2f79bcfe6633c369a5652e94379f63f5849d8e8fe519c586bb49633',
    ]);
    expect(proof.allowListAddress).toBe(buyer);
  });

  it('catches structural errors and root mismatches', () => {
    expect(() =>
      validateRootArtifact({
        version: 1,
        type: 'rare-batch-token-list',
        root: `0x${'11'.repeat(32)}`,
        count: 2,
        tokens: [
          { contractAddress: contract, tokenId: '1' },
          { contractAddress: contract, tokenId: '2' },
        ],
        entries: [],
      }),
    ).toThrow(/Input looks like a token tree artifact from rare utils tree build/);

    expect(() =>
      validateRootArtifact({
        root: `0x${'11'.repeat(32)}`,
        currency: '0x1111111111111111111111111111111111111111',
        amount: '1',
        splitAddresses: [],
        splitRatios: [],
        tokens: [],
      }),
    ).toThrow(/tokens must contain at least two entries/);

    expect(() =>
      validateProofArtifact({
        root: `0x${'11'.repeat(32)}`,
        contract: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        proof: ['0x1234'],
      }),
    ).toThrow(/proof entry must be a 0x-prefixed bytes32 hex string/);

    expect(() =>
      validateProofArtifact({
        root: `0x${'11'.repeat(32)}`,
        contract: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        proof: [],
      }),
    ).not.toThrow();

    expect(() =>
      validateRootArtifact({
        ...allowListedRootArtifact,
        allowList: {
          ...allowListedRootArtifact.allowList,
          addresses: [buyer, 'not-an-address'],
        },
      }),
    ).toThrow(/allowList\.addresses entry must be a valid 0x address/);

    expect(() =>
      validateProofArtifact({
        root: `0x${'11'.repeat(32)}`,
        contract: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        proof: [`0x${'22'.repeat(32)}`],
        allowListProof: ['0x1234'],
      }),
    ).toThrow(/allowListProof entry must be a 0x-prefixed bytes32 hex string/);

    expect(() =>
      validateProofArtifact({
        root: `0x${'11'.repeat(32)}`,
        contract: '0x1111111111111111111111111111111111111111',
        tokenId: '1',
        proof: [`0x${'22'.repeat(32)}`],
        allowListAddress: 'not-an-address',
      }),
    ).toThrow(/allowListAddress must be a valid 0x address/);

    expect(() =>
      buildMerkleProofArtifact(
        { ...rootArtifact, root: `0x${'00'.repeat(32)}` },
        contract,
        '1',
      ),
    ).toThrow(/does not match artifact root/);
  });

  it('validates root artifacts without computing roots from token-set input', () => {
    expect(() => validateRootArtifact(allowListedRootArtifact)).not.toThrow();
  });
});
