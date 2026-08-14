import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import * as client from '../../../src/sdk/index.js';
import * as contracts from '../../../src/sdk/contracts.js';
import * as utils from '../../../src/sdk/public-utils.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public SDK API surface', () => {
  it('keeps the client runtime exports focused on the high-level SDK', () => {
    expect(Object.keys(client).sort()).toEqual([
      'ApprovalSideEffectError',
      'Erc1155CheckoutAllItemsSkippedError',
      'MinterApprovalRequiredError',
      'NftApprovalRequiredError',
      'PaymentApprovalRequiredError',
      'createRareClient',
    ]);
  });

  it('constructs the SDK client when process is unavailable', () => {
    vi.stubGlobal('process', undefined);

    const rare = client.createRareClient({
      publicClient: createPublicClient({
        chain: mainnet,
        transport: http('http://127.0.0.1:8545'),
      }),
    });

    expect(rare.chain).toBe('mainnet');
    expect(rare.chainId).toBe(1);
  });

  it('exposes contract building blocks from the contracts subpath', () => {
    expect(contracts).toHaveProperty('auctionAbi');
    expect(contracts).toHaveProperty('contractAddresses');
    expect(contracts).toHaveProperty('getCcipChainSelector');
    expect(contracts).toHaveProperty('getContractAddresses');
    expect(contracts).toHaveProperty('getRareBridgeAddress');
    expect(contracts).toHaveProperty('isSupportedChain');
    expect(contracts).toHaveProperty('rareBridgeAbi');
  });

  it('exposes standalone pure helpers from the utils subpath', () => {
    expect(Object.keys(utils).sort()).toEqual([
      'buildUtilsBatchListingArtifact',
      'buildUtilsMerkleProof',
      'buildUtilsReleaseAllowlist',
      'buildUtilsTree',
      'getCurvePresetDefinition',
      'getUtilsReleaseAllowlistProof',
      'getUtilsTreeProof',
      'normalizeUtilsMerkleRoot',
      'normalizeUtilsReleaseAllowlistProof',
      'normalizeUtilsReleasePrice',
      'normalizeUtilsReleaseStartTime',
      'normalizeUtilsTokenId',
      'parseCurveConfig',
      'parseUtilsBatchListingArtifact',
      'parseUtilsReleaseAllowlistArtifact',
      'parseUtilsTreeInput',
      'parseUtilsTreeProof',
      'validateUtilsMerkleProofArtifact',
      'validateUtilsMerkleRootArtifact',
      'validateUtilsReleaseAllowlistConfig',
      'validateUtilsTreeProofTarget',
      'verifyUtilsTreeProof',
    ]);
  });
});
