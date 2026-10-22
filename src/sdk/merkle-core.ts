import { Buffer } from 'buffer';
import { MerkleTree } from 'merkletreejs';
import {
  encodePacked,
  getAddress,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  type Address,
} from 'viem';
import { toInteger } from './amounts-core.js';
import type { IntegerInput } from './types/common.js';
import type {
  BatchListingProofArtifact,
  BatchListingRootArtifact,
  BatchListingTokenEntry,
} from './types/batch-listing.js';

type BuildBatchListingTreeResult = {
  root: `0x${string}`;
  tree: MerkleTree;
  sortedTokens: { contract: Address; tokenId: string }[];
}

type BuildAllowListTreeResult = {
  root: `0x${string}`;
  tree: MerkleTree;
  sortedAddresses: Address[];
}

type NormalizedTokenEntry = {
  contract: Address;
  tokenId: string;
  tokenIdBigInt: bigint;
};

type AllowListProofFields = {
  allowListProof: `0x${string}`[];
  allowListAddress: Address;
};

export const ZERO_ROOT = '0x0000000000000000000000000000000000000000000000000000000000000000' as const;

function hexBuffer(hex: string): Buffer {
  return Buffer.from(hex.startsWith('0x') ? hex.slice(2) : hex, 'hex');
}

function tokenLeaf(contract: Address, tokenId: bigint): Buffer {
  const packed = encodePacked(['address', 'uint256'], [contract, tokenId]);
  return hexBuffer(keccak256(packed));
}

function addressLeaf(address: Address): Buffer {
  return hexBuffer(keccak256(address));
}

function parseBytes32(value: string, field: string): `0x${string}` {
  if (!isHex(value, { strict: true }) || value.length !== 66) {
    throw new Error(`${field} must be a 0x-prefixed bytes32 hex string`);
  }
  const normalized = value.toLowerCase();
  if (!isHex(normalized, { strict: true }) || normalized.length !== 66) {
    throw new Error(`${field} must be a 0x-prefixed bytes32 hex string`);
  }
  return normalized;
}

function parseBytes32Array(values: string[], field: string): `0x${string}`[] {
  return values.map((value, index) => parseBytes32(value, `${field}[${index}]`));
}

function compareTokenEntries(a: NormalizedTokenEntry, b: NormalizedTokenEntry): number {
  if (!isAddressEqual(a.contract, b.contract)) {
    return a.contract.localeCompare(b.contract);
  }
  return a.tokenId.localeCompare(b.tokenId);
}

function normalizeTokenEntry(token: BatchListingTokenEntry): NormalizedTokenEntry {
  if (!isAddress(token.contract)) {
    throw new Error(`Invalid token contract address: ${token.contract}`);
  }
  return {
    contract: getAddress(token.contract),
    tokenId: String(token.tokenId),
    tokenIdBigInt: toInteger(token.tokenId, 'tokenId'),
  };
}

function buildBatchListingTree(
  tokens: BatchListingTokenEntry[],
): BuildBatchListingTreeResult {
  if (tokens.length < 2) {
    throw new Error('buildBatchListingTree requires at least two tokens');
  }

  const sorted = tokens.map(normalizeTokenEntry).sort(compareTokenEntries);
  const leaves = sorted.map((token) => tokenLeaf(token.contract, token.tokenIdBigInt));
  const tree = new MerkleTree(leaves, (data: Buffer) => hexBuffer(keccak256(data)), {
    sortPairs: true,
  });

  return {
    root: parseBytes32(tree.getHexRoot(), 'root'),
    tree,
    sortedTokens: sorted.map(({ contract, tokenId }) => ({ contract, tokenId })),
  };
}

function buildAllowListTree(addresses: Address[]): BuildAllowListTreeResult {
  if (addresses.length < 2) {
    throw new Error('buildAllowListTree requires at least two addresses');
  }

  const sorted = addresses
    .map((address) => {
      if (!isAddress(address)) throw new Error(`Invalid allowlist address: ${address}`);
      return getAddress(address);
    })
    .sort((a, b) => a.localeCompare(b));
  const leaves = sorted.map(addressLeaf);
  const tree = new MerkleTree(leaves, (data: Buffer) => hexBuffer(keccak256(data)), {
    sortPairs: true,
  });

  return {
    root: parseBytes32(tree.getHexRoot(), 'root'),
    tree,
    sortedAddresses: sorted,
  };
}

export function getTokenProof(
  tree: MerkleTree,
  contract: Address,
  tokenId: bigint,
): `0x${string}`[] {
  const leaf = tokenLeaf(getAddress(contract), tokenId);
  return parseBytes32Array(tree.getHexProof(leaf), 'proof');
}

export function getAddressProof(tree: MerkleTree, address: Address): `0x${string}`[] {
  const leaf = addressLeaf(getAddress(address));
  return parseBytes32Array(tree.getHexProof(leaf), 'proof');
}

export function buildMerkleProofArtifact(
  artifact: BatchListingRootArtifact,
  contract: Address,
  tokenId: IntegerInput,
  buyer?: Address,
): BatchListingProofArtifact {
  const tokenIdBig = toInteger(tokenId, 'tokenId');
  const contractChecksum = getAddress(contract);
  const found = artifact.tokens.find(
    (token) => isAddressEqual(token.contract, contractChecksum) && BigInt(token.tokenId) === tokenIdBig,
  );

  if (found === undefined) {
    throw new Error(
      `Token ${contractChecksum}/${tokenIdBig.toString()} is not in this root artifact's token set`,
    );
  }

  const { tree, root } = buildBatchListingTree(
    artifact.tokens.map((token) => ({ contract: token.contract, tokenId: token.tokenId })),
  );
  const artifactRoot = parseBytes32(artifact.root, 'artifact.root');
  if (root !== artifactRoot) {
    throw new Error(
      `Recomputed NFT tree root (${root}) does not match artifact root (${artifact.root}). Artifact is corrupt or tree encoding has drifted.`,
    );
  }

  const allowListProofFields = buildAllowListProofFields(artifact, buyer);
  return {
    root: artifactRoot,
    contract: contractChecksum,
    tokenId: tokenIdBig.toString(),
    proof: getTokenProof(tree, contractChecksum, tokenIdBig),
    ...(allowListProofFields ?? {}),
  };
}

function buildAllowListProofFields(
  artifact: BatchListingRootArtifact,
  buyer: Address | undefined,
): AllowListProofFields | undefined {
  if (artifact.allowList === undefined) return undefined;
  if (buyer === undefined) {
    throw new Error(
      'This root has an allowlist; pass buyer address to buildMerkleProofArtifact to include allowListProof',
    );
  }
  if (!isAddress(buyer)) throw new Error(`Invalid buyer address: ${buyer}`);

  const buyerChecksum = getAddress(buyer);
  const inAllowList = artifact.allowList.addresses.some((address) => isAddressEqual(address, buyerChecksum));
  if (!inAllowList) {
    throw new Error(`Buyer ${buyerChecksum} is not in the allowlist`);
  }

  const { tree, root } = buildAllowListTree(artifact.allowList.addresses);
  const artifactAllowListRoot = parseBytes32(artifact.allowList.root, 'allowList.root');
  if (root !== artifactAllowListRoot) {
    throw new Error(
      `Recomputed allowlist root (${root}) does not match artifact (${artifact.allowList.root})`,
    );
  }

  return {
    allowListProof: getAddressProof(tree, buyerChecksum),
    allowListAddress: buyerChecksum,
  };
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be a JSON object`);
  }
}

function assertHexRoot(value: unknown, field: string): asserts value is `0x${string}` {
  if (typeof value !== 'string' || !isHex(value, { strict: true }) || value.length !== 66) {
    throw new Error(`${field} must be a 0x-prefixed bytes32 hex string`);
  }
}

function assertAddress(value: unknown, field: string): asserts value is Address {
  if (typeof value !== 'string' || !isAddress(value)) {
    throw new Error(`${field} must be a valid 0x address`);
  }
}

export function validateRootArtifact(value: unknown): asserts value is BatchListingRootArtifact {
  assertRecord(value, 'Root artifact');
  if (isBatchTokenTreeArtifactLike(value)) {
    throw new Error(
      'Input looks like a token tree artifact from rare utils tree build, not a batch listing root artifact. ' +
        'For rare listing batch create, pass --price and optionally --currency/--split with the token tree artifact.',
    );
  }
  assertHexRoot(value.root, 'root');
  assertAddress(value.currency, 'currency');
  if (typeof value.amount !== 'string') throw new Error('amount must be a string (base units)');
  if (!Array.isArray(value.splitAddresses)) throw new Error('splitAddresses must be an array');
  if (!Array.isArray(value.splitRatios)) throw new Error('splitRatios must be an array');
  if (!Array.isArray(value.tokens) || value.tokens.length < 2) {
    throw new Error('tokens must contain at least two entries');
  }
  value.tokens.forEach((token) => {
    assertRecord(token, 'tokens[]');
    assertAddress(token.contract, 'tokens[].contract');
    if (typeof token.tokenId !== 'string') throw new Error('tokens[].tokenId must be a string');
  });
  if (value.allowList !== undefined && value.allowList !== null) {
    assertRecord(value.allowList, 'allowList');
    assertHexRoot(value.allowList.root, 'allowList.root');
    if (!Array.isArray(value.allowList.addresses)) throw new Error('allowList.addresses must be an array');
    if (value.allowList.addresses.length < 2) {
      throw new Error('allowList.addresses must contain at least two entries');
    }
    value.allowList.addresses.forEach((address) => {
      assertAddress(address, 'allowList.addresses entry');
    });
  }
}

function isBatchTokenTreeArtifactLike(value: Record<string, unknown>): boolean {
  if (value.type === 'rare-batch-token-list') {
    return true;
  }
  return (
    Array.isArray(value.tokens) &&
    !('currency' in value) &&
    !('amount' in value) &&
    !('splitAddresses' in value) &&
    !('splitRatios' in value)
  );
}

export function validateProofArtifact(value: unknown): asserts value is BatchListingProofArtifact {
  assertRecord(value, 'Proof artifact');
  assertHexRoot(value.root, 'root');
  assertAddress(value.contract, 'contract');
  if (typeof value.tokenId !== 'string') throw new Error('tokenId must be a string');
  if (!Array.isArray(value.proof)) throw new Error('proof must be an array of bytes32 hex');
  value.proof.forEach((proof) => {
    assertHexRoot(proof, 'proof entry');
  });
  if (value.allowListProof !== undefined && value.allowListProof !== null) {
    if (!Array.isArray(value.allowListProof)) throw new Error('allowListProof must be an array');
    value.allowListProof.forEach((proof) => {
      assertHexRoot(proof, 'allowListProof entry');
    });
  }
  if (value.allowListAddress !== undefined && value.allowListAddress !== null) {
    assertAddress(value.allowListAddress, 'allowListAddress');
  }
}
