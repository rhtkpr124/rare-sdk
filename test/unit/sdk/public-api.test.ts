import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import * as client from '../../../src/sdk/index.js';
import * as contracts from '../../../src/sdk/contracts.js';
import * as utils from '../../../src/sdk/public-utils.js';
import type { ReleaseMintDirectSaleParams } from '../../../src/sdk/types/release.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('public SDK API surface', () => {
  it('does not expose a recipient input for direct-sale release minting', () => {
    expectTypeOf<ReleaseMintDirectSaleParams>().not.toHaveProperty('recipient');
  });

  it('keeps the client runtime exports focused on the high-level SDK', () => {
    expect(Object.keys(client).sort()).toEqual([
      'ApprovalSideEffectError',
      'AvatarProfileUpdateError',
      'CartExecutionError',
      'CartPreparationError',
      'CartRoutingError',
      'CartVerificationError',
      'Erc1155CheckoutAllItemsSkippedError',
      'MinterApprovalRequiredError',
      'NftApprovalRequiredError',
      'PaymentApprovalRequiredError',
      'PaymentBalanceInsufficientError',
      'RareApiError',
      'RareAuthError',
      'cartFulfillmentKinds',
      'createBrowserAccountSessionStore',
      'createMemoryAccountSessionStore',
      'createRareApi',
      'createRareClient',
    ]);
    expect(client.cartFulfillmentKinds).toEqual({
      none: 0,
      offChain: 1,
      erc721Transfer: 2,
      erc1155Transfer: 3,
      erc721MintTo: 4,
      erc1155MintTo: 5,
      currencySwap: 6,
    });
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
    expect(rare.cart).not.toHaveProperty('api');
    expect(rare.cart.catalog.products.create).toBeTypeOf('function');
    expect(rare.cart.catalog.products.search).toBeTypeOf('function');
    expect(rare.cart.catalog.variants.search).toBeTypeOf('function');
    expect(rare.cart.catalog).not.toHaveProperty('skus');
    expect(rare.cart.listing).not.toHaveProperty('create');
    expect(rare.cart.listing.search).toBeTypeOf('function');
    expect(rare.cart.checkout.receipt).toBeTypeOf('function');
    expect(rare.cart.checkout.prepare).toBeTypeOf('function');
    expect(rare.cart.catalog.products.search).toBeTypeOf('function');
    expect(rare.cart.catalog.variants.search).toBeTypeOf('function');
    expect(rare.cart.listing.prepare).toBeTypeOf('function');
    expect(rare.cart.listing.publish).toBeTypeOf('function');
    expect(rare.cart.checkout.prepare).toBeTypeOf('function');
    expect(rare.cart.checkout.execute).toBeTypeOf('function');
    expect(rare.cart.checkout.purchase).toBeTypeOf('function');
    expect(rare.cart).not.toHaveProperty('order');
    expect(rare.cart.approval.status).toBeTypeOf('function');
    expect(rare.cart.approval.approve).toBeTypeOf('function');
    expect(rare.cart.approval.revoke).toBeTypeOf('function');
    expect(rare.cart.listing).not.toHaveProperty('approvalStatus');
    expect(rare.cart.listing).not.toHaveProperty('approve');
    expect(rare.cart.listing).not.toHaveProperty('buildRoot');
    expect(rare.cart.listing).not.toHaveProperty('signRoot');
    expect(rare.cart.listing).not.toHaveProperty('buildAuthorization');
    expect(rare.cart.routing.quote).toBeTypeOf('function');
    expect(rare.cart.routing.assertFresh).toBeTypeOf('function');
  });

  it('exposes contract building blocks from the contracts subpath', () => {
    expect(contracts).toHaveProperty('auctionAbi');
    expect(contracts).toHaveProperty('contractAddresses');
    expect(contracts).toHaveProperty('getCcipChainSelector');
    expect(contracts).toHaveProperty('getContractAddresses');
    expect(contracts).toHaveProperty('getCartHashesAddress');
    expect(contracts).toHaveProperty('getRareBridgeAddress');
    expect(contracts).toHaveProperty('isSupportedChain');
    expect(contracts).toHaveProperty('rareBridgeAbi');
    expect(contracts).toHaveProperty('cartAbi');
    expect(contracts).toHaveProperty('cartHashesAbi');
    expect(contracts).toHaveProperty('cartLensAbi');
  });

  it('exposes standalone pure helpers from the utils subpath', () => {
    expect(Object.keys(utils).sort()).toEqual([
      'applyCartQuoteSpread',
      'buildBatchListingArtifact',
      'buildBatchTokenTree',
      'buildCartEip712Domain',
      'buildCartListingPurchaseAuthorization',
      'buildCartListingRoot',
      'buildCartPurchaseOrder',
      'buildCartRoute',
      'buildMerkleProof',
      'buildReleaseAllowlistArtifact',
      'computeCartListingMerkleRoot',
      'deriveCartListingMerkleLeaf',
      'getBatchTokenProof',
      'getCartListingEntry',
      'getCurvePresetDefinition',
      'getReleaseAllowlistProof',
      'hashCartFulfillmentActions',
      'hashCartListing',
      'hashCartListingRoot',
      'hashCartOrderLines',
      'hashCartPayoutRoute',
      'hashCartPurchaseOrder',
      'normalizeMerkleRoot',
      'normalizeReleaseAllowlistConfig',
      'normalizeReleaseAllowlistProof',
      'normalizeReleasePrice',
      'normalizeReleaseStartTime',
      'normalizeTokenId',
      'parseBatchListingArtifact',
      'parseBatchTokenProof',
      'parseBatchTokenTreeInput',
      'parseCartListingArtifact',
      'parseCurveConfig',
      'parseReleaseAllowlistArtifact',
      'validateBatchTokenProofTarget',
      'validateCartListingArtifact',
      'validateMerkleProofArtifact',
      'validateMerkleRootArtifact',
      'verifyBatchTokenProof',
      'verifyCartListingMerkleProof',
    ]);
  });
});
