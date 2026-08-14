import { describe, expect, it } from 'vitest';
import {
  buildBatchTokenTreeArtifact,
  getBatchTokenProof,
  hashBatchToken,
  parseBatchTokenList,
  parseBatchTokenListArtifact,
  parseBatchTokenListArtifactOrBuild,
  parseBatchTokenProofArtifact,
  parseBatchTokenProofInput,
  validateBatchTokenProofInputMatchesTarget,
  verifyBatchTokenProof,
} from '../../../src/sdk/batch-core.js';

const CONTRACT_A = '0x1111111111111111111111111111111111111111';
const CONTRACT_B = '0x2222222222222222222222222222222222222222';
const EXPECTED_ROOT = '0xc7f290f1b2d1f0644c2b52ff9de94e33f0d877c8708cc9e2abbcbfb6af169f4e';
const EXPECTED_TOKEN_1_LEAF = '0x5f8770c2413473708dbdc47ac14a9ff677d97b2cbe546cc465b146dfc075a643';

describe('batch marketplace token tree core', () => {
  it('builds deterministic token-list artifacts from JSON', () => {
    const artifact = buildBatchTokenTreeArtifact({
      content: JSON.stringify([
        { contractAddress: CONTRACT_B, tokenId: '2' },
        { contractAddress: CONTRACT_A, tokenId: '10' },
        { contractAddress: CONTRACT_A, tokenId: '1' },
      ]),
      format: 'json',
      chainId: 11_155_111,
    });

    expect(artifact).toMatchObject({
      version: 1,
      type: 'rare-batch-token-list',
      root: EXPECTED_ROOT,
      count: 3,
      chainId: 11_155_111,
      tokens: [
        { contractAddress: CONTRACT_A, tokenId: '1', chainId: 11_155_111 },
        { contractAddress: CONTRACT_A, tokenId: '10', chainId: 11_155_111 },
        { contractAddress: CONTRACT_B, tokenId: '2', chainId: 11_155_111 },
      ],
    });
    expect(artifact.entries[0]).toMatchObject({
      contractAddress: CONTRACT_A,
      tokenId: '1',
      leaf: EXPECTED_TOKEN_1_LEAF,
      proof: [
        '0x5868884c430c60a29311d58c8a4a6fd8a3fae2f51ac88e6ec92aa45b2272a876',
        '0xb2c80c66cfaaddab31ff06b724cacc9f8febc80aefb671756cc33b22b86a80ef',
      ],
    });
  });

  it('parses CSV and JSON token lists with chain context', () => {
    expect(parseBatchTokenList({
      content: [
        'contract_address,token_id,chain_id',
        `${CONTRACT_B},2,11155111`,
        `${CONTRACT_A},01,11155111`,
      ].join('\n'),
      format: 'csv',
    })).toEqual([
      { contractAddress: CONTRACT_A, tokenId: '1', chainId: 11_155_111 },
      { contractAddress: CONTRACT_B, tokenId: '2', chainId: 11_155_111 },
    ]);

    expect(parseBatchTokenList({
      content: JSON.stringify({
        tokens: [
          { contract: CONTRACT_B, id: 2 },
          { contractAddress: CONTRACT_A, tokenId: '1' },
        ],
      }),
      format: 'json',
      chainId: '11155111',
    })).toEqual([
      { contractAddress: CONTRACT_A, tokenId: '1', chainId: 11_155_111 },
      { contractAddress: CONTRACT_B, tokenId: '2', chainId: 11_155_111 },
    ]);
  });

  it('parses quoted CSV cells without shifting later token columns', () => {
    expect(parseBatchTokenList({
      content: [
        'contract_address,token_id,note,chain_id',
        `"${CONTRACT_B}","2","token ""two"", with comma","11155111"`,
        `"${CONTRACT_A}","01","token one","11155111"`,
      ].join('\n'),
      format: 'csv',
    })).toEqual([
      { contractAddress: CONTRACT_A, tokenId: '1', chainId: 11_155_111 },
      { contractAddress: CONTRACT_B, tokenId: '2', chainId: 11_155_111 },
    ]);
  });

  it('hashes token leaves with packed address and uint256 token ID', () => {
    expect(hashBatchToken(CONTRACT_A, '1')).toBe(EXPECTED_TOKEN_1_LEAF);
    expect(hashBatchToken(CONTRACT_A, '01')).toBe(EXPECTED_TOKEN_1_LEAF);
  });

  it('generates and verifies token proofs', () => {
    const artifact = buildBatchTokenTreeArtifact({
      content: JSON.stringify([
        { contractAddress: CONTRACT_B, tokenId: '2' },
        { contractAddress: CONTRACT_A, tokenId: '10' },
        { contractAddress: CONTRACT_A, tokenId: '1' },
      ]),
      format: 'json',
      chainId: 11_155_111,
    });
    const proof = getBatchTokenProof({
      artifact,
      contractAddress: CONTRACT_B,
      tokenId: '2',
    });

    expect(proof).toMatchObject({
      version: 1,
      type: 'rare-batch-token-proof',
      root: EXPECTED_ROOT,
      contractAddress: CONTRACT_B,
      tokenId: '2',
      chainId: 11_155_111,
      leaf: '0xb2c80c66cfaaddab31ff06b724cacc9f8febc80aefb671756cc33b22b86a80ef',
      proof: ['0x413d3a43ec85185900a3cbfc846a450fbc5ede98437c3e53d26bd3fa2b802e04'],
      valid: true,
    });
    expect(verifyBatchTokenProof({
      root: EXPECTED_ROOT,
      contractAddress: CONTRACT_B,
      tokenId: '2',
      proof: proof.proof,
    })).toBe(true);
    expect(verifyBatchTokenProof({
      root: EXPECTED_ROOT,
      contractAddress: CONTRACT_B,
      tokenId: '3',
      proof: proof.proof,
    })).toBe(false);
  });

  it('parses artifacts and rejects mismatched roots', () => {
    const artifact = buildBatchTokenTreeArtifact({
      content: JSON.stringify([
        { contractAddress: CONTRACT_A, tokenId: '1' },
        { contractAddress: CONTRACT_B, tokenId: '2' },
      ]),
      format: 'json',
    });

    expect(parseBatchTokenListArtifact(JSON.stringify(artifact)).root).toBe(artifact.root);
    expect(parseBatchTokenListArtifact(JSON.stringify({
      root: artifact.root,
      count: artifact.count,
      tokens: artifact.tokens,
    })).root).toBe(artifact.root);
    expect(() => parseBatchTokenListArtifact(JSON.stringify({
      ...artifact,
      root: EXPECTED_ROOT,
    }))).toThrow('Batch token artifact root does not match its token list.');
    expect(() => parseBatchTokenListArtifactOrBuild({
      content: JSON.stringify({
        root: EXPECTED_ROOT,
        count: artifact.count,
        tokens: artifact.tokens,
      }),
      format: 'json',
    })).toThrow('Batch token artifact root does not match its token list.');
    expect(() => parseBatchTokenListArtifact(JSON.stringify({
      ...artifact,
      chainId: 11_155_111,
    }), 8453)).toThrow('Input chainId 11155111 does not match --chain-id 8453.');
  });

  it('parses proof artifacts and rejects mismatched leaves', () => {
    const artifact = buildBatchTokenTreeArtifact({
      content: JSON.stringify([
        { contractAddress: CONTRACT_A, tokenId: '1' },
        { contractAddress: CONTRACT_B, tokenId: '2' },
      ]),
      format: 'json',
    });
    const proof = getBatchTokenProof({
      artifact,
      contractAddress: CONTRACT_A,
      tokenId: '1',
    });

    expect(parseBatchTokenProofArtifact(JSON.stringify(proof))).toMatchObject({
      contractAddress: CONTRACT_A,
      tokenId: '1',
      valid: true,
    });
    expect(() => parseBatchTokenProofArtifact(JSON.stringify({
      ...proof,
      tokenId: '2',
    }))).toThrow('Batch token proof artifact leaf does not match');
  });

  it('parses proof JSON inputs and validates target metadata', () => {
    const artifact = buildBatchTokenTreeArtifact({
      content: JSON.stringify([
        { contractAddress: CONTRACT_A, tokenId: '1', chainId: 11_155_111 },
        { contractAddress: CONTRACT_B, tokenId: '2', chainId: 11_155_111 },
      ]),
      format: 'json',
    });
    const proof = getBatchTokenProof({
      artifact,
      contractAddress: CONTRACT_A,
      tokenId: '1',
    });
    const proofInput = parseBatchTokenProofInput(JSON.stringify(proof));

    expect(parseBatchTokenProofInput(JSON.stringify(proof.proof))).toEqual({
      proof: proof.proof,
    });
    expect(proofInput).toMatchObject({
      root: artifact.root,
      contractAddress: CONTRACT_A,
      tokenId: '1',
      chainId: 11_155_111,
      proof: proof.proof,
    });
    expect(() => validateBatchTokenProofInputMatchesTarget(proofInput, {
      artifact,
      contractAddress: CONTRACT_A,
      tokenId: '01',
      root: artifact.root,
      allowRootOverride: false,
    })).not.toThrow();
    expect(() => validateBatchTokenProofInputMatchesTarget(proofInput, {
      artifact,
      contractAddress: CONTRACT_B,
      tokenId: '1',
      root: artifact.root,
      allowRootOverride: false,
    })).toThrow('Proof artifact contractAddress does not match --contract.');
  });

  it('rejects duplicate, malformed, and cross-chain token lists', () => {
    expect(() => parseBatchTokenList({
      content: JSON.stringify([
        { contractAddress: CONTRACT_A, tokenId: '1' },
        { contractAddress: CONTRACT_A, tokenId: '01' },
      ]),
      format: 'json',
    })).toThrow(`Duplicate batch token: ${CONTRACT_A} #1.`);

    expect(() => parseBatchTokenList({
      content: 'contract,tokenId\nnot-an-address,1\n',
      format: 'csv',
    })).toThrow('batch token at index 0 contractAddress must be a valid 0x address.');

    expect(() => parseBatchTokenList({
      content: JSON.stringify([
        { contractAddress: CONTRACT_A, tokenId: '1', chainId: 1 },
        { contractAddress: CONTRACT_B, tokenId: '2', chainId: 11_155_111 },
      ]),
      format: 'json',
    })).toThrow('Batch token list must use one chainId');
  });
});
