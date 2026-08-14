import { describe, expect, it } from 'vitest';
import {
  buildCollectionMintBatchWrite,
  buildCollectionMinterApprovalWrite,
  buildCollectionPrepareLazyMintWrite,
  buildCollectionRoyaltyPercentageWrite,
  buildCreateLazySovereignCollectionWrite,
  buildCreateSovereignCollectionWrite,
  defaultRoyaltyInfoSalePrice,
  normalizeLazySovereignCollectionContractType,
  normalizeSovereignCollectionContractType,
  planCollectionBaseUri,
  planCollectionContract,
  planCollectionMintBatch,
  planCollectionMinterApproval,
  planCollectionPrepareLazyMint,
  planCollectionReceiver,
  planCollectionRoyaltyPercentage,
  planCollectionRoyaltyInfo,
  planCollectionToken,
  planCollectionTokenReceiver,
  planCollectionTokenUri,
  planCreateLazySovereignCollection,
  planCreateSovereignCollection,
  shapeCollectionPrepareMintEvent,
} from '../../../src/sdk/collection-core.js';

const COLLECTION_ADDRESS = '0x1111111111111111111111111111111111111111';
const MINTER_ADDRESS = '0x2222222222222222222222222222222222222222';

describe('Sovereign collection core', () => {
  it('normalizes supported contract type aliases', () => {
    expect(normalizeSovereignCollectionContractType(undefined)).toBeUndefined();
    expect(normalizeSovereignCollectionContractType('standard')).toBe('standard');
    expect(normalizeSovereignCollectionContractType('sovereign-nft')).toBe('standard');
    expect(normalizeSovereignCollectionContractType('royalty-guard')).toBe('royalty-guard');
    expect(normalizeSovereignCollectionContractType('deadman')).toBe('deadman-royalty-guard');
  });

  it('rejects unsupported contract types', () => {
    expect(() => normalizeSovereignCollectionContractType('lazy')).toThrow(
      'Unsupported Sovereign collection contract type "lazy".',
    );
  });

  it('plans standard collection creation with optional max supply', () => {
    expect(planCreateSovereignCollection({
      name: 'Test',
      symbol: 'TST',
    })).toEqual({
      name: 'Test',
      symbol: 'TST',
      maxTokens: undefined,
      contractType: 'standard',
      contractTypeReadName: undefined,
    });

    expect(planCreateSovereignCollection({
      name: 'Test',
      symbol: 'TST',
      maxTokens: '100',
      contractType: 'standard',
    })).toEqual({
      name: 'Test',
      symbol: 'TST',
      maxTokens: 100n,
      contractType: 'standard',
      contractTypeReadName: undefined,
    });
  });

  it('requires max supply for non-standard contract types', () => {
    expect(() => planCreateSovereignCollection({
      name: 'Guarded',
      symbol: 'GRD',
      contractType: 'royalty-guard',
    })).toThrow('maxTokens is required when creating a royalty-guard Sovereign collection.');
  });

  it('maps non-standard contract types to factory constant reads', () => {
    expect(planCreateSovereignCollection({
      name: 'Guarded',
      symbol: 'GRD',
      maxTokens: 10,
      contractType: 'royalty-guard',
    }).contractTypeReadName).toBe('ROYALTY_GUARD');

    expect(planCreateSovereignCollection({
      name: 'Deadman',
      symbol: 'DTH',
      maxTokens: 10,
      contractType: 'deadman-royalty-guard',
    }).contractTypeReadName).toBe('ROYALTY_GUARD_DEADMAN');
  });

  it('builds overloaded Sovereign factory write arguments in core', () => {
    expect(buildCreateSovereignCollectionWrite(planCreateSovereignCollection({
      name: 'Test',
      symbol: 'TST',
    }))).toEqual({
      functionName: 'createSovereignNFTContract',
      args: ['Test', 'TST'],
    });

    expect(buildCreateSovereignCollectionWrite(planCreateSovereignCollection({
      name: 'Capped',
      symbol: 'CAP',
      maxTokens: 10,
    }))).toEqual({
      functionName: 'createSovereignNFTContract',
      args: ['Capped', 'CAP', 10n],
    });

    const guarded = planCreateSovereignCollection({
      name: 'Guarded',
      symbol: 'GRD',
      maxTokens: 10,
      contractType: 'royalty-guard',
    });
    expect(buildCreateSovereignCollectionWrite(guarded, `0x${'11'.repeat(32)}`)).toEqual({
      functionName: 'createSovereignNFTContract',
      args: ['Guarded', 'GRD', 10n, `0x${'11'.repeat(32)}`],
    });
    expect(() => buildCreateSovereignCollectionWrite(guarded)).toThrow(
      'contractType is required for royalty-guard Sovereign collection writes.',
    );
  });

  it('rejects invalid runtime Sovereign contract types before selecting a factory path', () => {
    expect(() => planCreateSovereignCollection({
      name: 'Typo',
      symbol: 'TPO',
      maxTokens: 10,
      // @ts-expect-error exercises runtime validation for invalid external input.
      contractType: 'royalty-gaurd',
    })).toThrow('Unsupported Sovereign collection contract type "royalty-gaurd".');
  });

  it('normalizes supported lazy contract type aliases', () => {
    expect(normalizeLazySovereignCollectionContractType(undefined)).toBeUndefined();
    expect(normalizeLazySovereignCollectionContractType('lazy')).toBe('lazy');
    expect(normalizeLazySovereignCollectionContractType('standard')).toBe('lazy');
    expect(normalizeLazySovereignCollectionContractType('royalty-guard')).toBe('lazy-royalty-guard');
    expect(normalizeLazySovereignCollectionContractType('deadman')).toBe('lazy-deadman-royalty-guard');
  });

  it('rejects unsupported lazy contract types', () => {
    expect(() => normalizeLazySovereignCollectionContractType('batch')).toThrow(
      'Unsupported Lazy Sovereign collection contract type "batch".',
    );
  });

  it('plans lazy collection creation with required max supply and factory constant read', () => {
    expect(planCreateLazySovereignCollection({
      name: 'Release',
      symbol: 'REL',
      maxTokens: '100',
    })).toEqual({
      name: 'Release',
      symbol: 'REL',
      maxTokens: 100n,
      contractType: 'lazy',
      contractTypeReadName: 'LAZY_SOVEREIGN_NFT',
    });

    expect(planCreateLazySovereignCollection({
      name: 'Guarded Release',
      symbol: 'GRL',
      maxTokens: 100,
      contractType: 'lazy-deadman-royalty-guard',
    }).contractTypeReadName).toBe('LAZY_ROYALTY_GUARD_DEADMAN');
  });

  it('builds Lazy Sovereign factory write arguments in core', () => {
    const plan = planCreateLazySovereignCollection({
      name: 'Release',
      symbol: 'REL',
      maxTokens: '100',
    });
    const contractType = `0x${'11'.repeat(32)}` as const;

    expect(buildCreateLazySovereignCollectionWrite(plan, contractType)).toEqual({
      functionName: 'createSovereignNFTContract',
      args: ['Release', 'REL', 100n, contractType],
    });
  });

  it('rejects invalid runtime Lazy Sovereign contract types before selecting a factory constant', () => {
    expect(() => planCreateLazySovereignCollection({
      name: 'Typo',
      symbol: 'TPO',
      maxTokens: 10,
      // @ts-expect-error exercises runtime validation for invalid external input.
      contractType: 'lazy-royalty-gaurd',
    })).toThrow('Unsupported Lazy Sovereign collection contract type "lazy-royalty-gaurd".');
  });

  it('plans collection batch mint with positive token count', () => {
    expect(planCollectionMintBatch({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://batch',
      amount: '25',
    })).toEqual({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://batch',
      tokenCount: 25n,
    });
  });

  it('rejects non-positive collection batch mint counts', () => {
    expect(() => planCollectionMintBatch({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://batch',
      amount: 0,
    })).toThrow('amount must be greater than 0.');
  });

  it('plans lazy prepare mint with optional minter', () => {
    expect(planCollectionPrepareLazyMint({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://lazy',
      amount: 3,
    })).toEqual({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://lazy',
      tokenCount: 3n,
    });

    expect(planCollectionPrepareLazyMint({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://lazy',
      amount: '3',
      minter: MINTER_ADDRESS,
    })).toEqual({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://lazy',
      tokenCount: 3n,
      minter: MINTER_ADDRESS,
    });
  });

  it('rejects non-positive lazy prepare mint counts', () => {
    expect(() => planCollectionPrepareLazyMint({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://lazy',
      amount: '-1',
    })).toThrow('amount must be greater than 0.');
  });

  it('builds collection mint write arguments in core', () => {
    const batchPlan = planCollectionMintBatch({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://batch',
      amount: '25',
    });
    expect(buildCollectionMintBatchWrite(batchPlan)).toEqual({
      functionName: 'batchMint',
      args: ['ipfs://batch', 25n],
    });

    const lazyPlan = planCollectionPrepareLazyMint({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://lazy',
      amount: 3,
    });
    expect(buildCollectionPrepareLazyMintWrite(lazyPlan)).toEqual({
      functionName: 'prepareMint',
      args: ['ipfs://lazy', 3n],
    });

    const minterPlan = planCollectionPrepareLazyMint({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://lazy',
      amount: 3,
      minter: MINTER_ADDRESS,
    });
    expect(buildCollectionPrepareLazyMintWrite(minterPlan)).toEqual({
      functionName: 'prepareMintWithMinter',
      args: ['ipfs://lazy', 3n, MINTER_ADDRESS],
    });
  });

  it('plans Lazy Sovereign minter approval writes', () => {
    const defaultApproval = planCollectionMinterApproval({
      contract: COLLECTION_ADDRESS,
      minter: MINTER_ADDRESS,
    });
    expect(defaultApproval).toEqual({
      contract: COLLECTION_ADDRESS,
      minter: MINTER_ADDRESS,
      approved: true,
    });
    expect(buildCollectionMinterApprovalWrite(defaultApproval)).toEqual({
      functionName: 'setMinterApproval',
      args: [MINTER_ADDRESS, true],
    });

    const revoked = planCollectionMinterApproval({
      contract: COLLECTION_ADDRESS,
      minter: MINTER_ADDRESS,
      approved: false,
    });
    expect(buildCollectionMinterApprovalWrite(revoked)).toEqual({
      functionName: 'setMinterApproval',
      args: [MINTER_ADDRESS, false],
    });
  });

  it('shapes both lazy prepare mint event variants', () => {
    expect(shapeCollectionPrepareMintEvent({
      numberOfTokens: 3n,
      baseURI: 'ipfs://lazy',
    })).toEqual({
      baseUri: 'ipfs://lazy',
      tokenCount: 3n,
    });

    expect(shapeCollectionPrepareMintEvent({
      startTokenId: 10n,
      endTokenId: 12n,
      baseURI: 'ipfs://lazy',
    })).toEqual({
      baseUri: 'ipfs://lazy',
      tokenCount: 3n,
      fromTokenId: 10n,
      toTokenId: 12n,
    });

    expect(() => shapeCollectionPrepareMintEvent({
      startTokenId: 12n,
      endTokenId: 10n,
      baseURI: 'ipfs://lazy',
    })).toThrow('PrepareMint endTokenId must be greater than or equal to startTokenId.');
  });

  it('plans collection token reads with non-negative token IDs', () => {
    expect(planCollectionToken({
      contract: COLLECTION_ADDRESS,
      tokenId: '0',
    })).toEqual({
      contract: COLLECTION_ADDRESS,
      tokenId: 0n,
    });

    expect(() => planCollectionToken({
      contract: COLLECTION_ADDRESS,
      tokenId: '-1',
    })).toThrow('tokenId must be greater than or equal to 0.');
  });

  it('plans royalty info with a default raw sale price quote', () => {
    expect(planCollectionRoyaltyInfo({
      contract: COLLECTION_ADDRESS,
      tokenId: 1,
    })).toEqual({
      contract: COLLECTION_ADDRESS,
      tokenId: 1n,
      salePrice: defaultRoyaltyInfoSalePrice,
    });

    expect(planCollectionRoyaltyInfo({
      contract: COLLECTION_ADDRESS,
      tokenId: 1,
      price: '500',
    }).salePrice).toBe(500n);
  });

  it('plans collection owner write inputs', () => {
    expect(planCollectionReceiver({
      contract: COLLECTION_ADDRESS,
      receiver: MINTER_ADDRESS,
    })).toEqual({
      contract: COLLECTION_ADDRESS,
      receiver: MINTER_ADDRESS,
    });

    expect(planCollectionTokenReceiver({
      contract: COLLECTION_ADDRESS,
      tokenId: '2',
      receiver: MINTER_ADDRESS,
    })).toEqual({
      contract: COLLECTION_ADDRESS,
      tokenId: 2n,
      receiver: MINTER_ADDRESS,
    });
  });

  it('plans and builds default royalty percentage writes', () => {
    const percentagePlan = planCollectionRoyaltyPercentage({
      contract: COLLECTION_ADDRESS,
      percentage: '15',
    });

    expect(percentagePlan).toEqual({
      contract: COLLECTION_ADDRESS,
      percentage: 15,
    });
    expect(buildCollectionRoyaltyPercentageWrite(percentagePlan)).toEqual({
      functionName: 'setDefaultRoyaltyPercentage',
      args: [15n],
    });
  });

  it('rejects default royalty percentages outside the contract range', () => {
    expect(() => planCollectionRoyaltyPercentage({
      contract: COLLECTION_ADDRESS,
      percentage: '-1',
    })).toThrow('percentage must be between 0 and 100.');

    expect(() => planCollectionRoyaltyPercentage({
      contract: COLLECTION_ADDRESS,
      percentage: '101',
    })).toThrow('percentage must be between 0 and 100.');
  });

  it('plans Lazy Sovereign metadata operations', () => {
    expect(planCollectionBaseUri({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://next',
    })).toEqual({
      contract: COLLECTION_ADDRESS,
      baseUri: 'ipfs://next',
    });

    expect(planCollectionTokenUri({
      contract: COLLECTION_ADDRESS,
      tokenId: '3',
      tokenUri: 'ipfs://token',
    })).toEqual({
      contract: COLLECTION_ADDRESS,
      tokenId: 3n,
      tokenUri: 'ipfs://token',
    });

    expect(planCollectionContract({ contract: COLLECTION_ADDRESS })).toEqual({
      contract: COLLECTION_ADDRESS,
    });
  });

});
