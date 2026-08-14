import { describe, expect, it } from 'vitest';
import { zeroAddress, type TransactionReceipt } from 'viem';
import { ETH_ADDRESS } from '../../../src/contracts/addresses.js';
import {
  planErc1155CollectionCreateToken,
  planErc1155CollectionMint,
  planErc1155CollectionMintBatch,
  planErc1155CollectionUpdateTokenUri,
  erc1155CheckoutItemKinds,
  groupErc1155CheckoutPayments,
  planErc1155CheckoutInput,
  planErc1155CheckoutResolved,
  planErc1155ListingCancel,
  planErc1155ListingBuy,
  planErc1155ListingCreate,
  planErc1155ListingCreateBatch,
  planErc1155ListingStatus,
  planErc1155OfferAccept,
  planErc1155OfferCancel,
  planErc1155OfferCreate,
  planErc1155ReleaseAllowlistConfig,
  planErc1155ReleaseAllowlistConfigBatch,
  planErc1155ReleaseClearAllowlistConfig,
  planErc1155ReleaseConfigure,
  planErc1155ReleaseConfigureBatch,
  planErc1155ReleaseCancel,
  planErc1155ReleaseLimitConfig,
  planErc1155ReleaseLimitConfigBatch,
  planErc1155ReleaseMint,
  providedSplits,
  shapeErc1155CollectionStatus,
  shapeErc1155CheckoutResult,
  shapeErc1155ReleaseAllowlistConfig,
  shapeErc1155ReleaseLimitConfig,
  shapeErc1155ListingStatus,
  shapeErc1155OfferStatus,
  shapeErc1155ReleaseStatus,
  totalPrice,
  validateErc1155CheckoutLogs,
  erc1155CheckoutFailureStages,
  zeroBytes4,
  zeroBytes32,
} from '../../../src/sdk/erc1155-core.js';

const account = '0x0000000000000000000000000000000000000001' as const;
const buyer = '0x0000000000000000000000000000000000000002' as const;
const seller = '0x0000000000000000000000000000000000000003' as const;
const contract = '0x1000000000000000000000000000000000000000' as const;
const erc20 = '0x2000000000000000000000000000000000000000' as const;
const marketplace = '0x3000000000000000000000000000000000000000' as const;
const NOW = 1_800_000_000n;
const txHash = `0x${'55'.repeat(32)}` as const;
const emptyLogsBloom = `0x${'00'.repeat(256)}` as const;

describe('ERC1155 core planning', () => {
  it('normalizes collection token and batch mint inputs', () => {
    expect(planErc1155CollectionCreateToken({
      contract,
      maxSupply: '10',
    })).toEqual({
      contract,
      tokenUri: '',
      maxSupply: 10n,
      royaltyReceiver: undefined,
    });

    expect(planErc1155CollectionMintBatch({
      contract,
      items: [
        { tokenId: '1', quantity: '2' },
        { tokenId: 2, quantity: 3 },
      ],
    }).items).toEqual([
      { tokenId: 1n, quantity: 2n },
      { tokenId: 2n, quantity: 3n },
    ]);

    expect(() => planErc1155CollectionMintBatch({
      contract,
      items: [
        { tokenId: '2', quantity: '1' },
        { tokenId: '1', quantity: '1' },
      ],
    })).toThrow('tokenIds must be strictly ascending.');

    expect(planErc1155CollectionUpdateTokenUri({
      contract,
      tokenId: '3',
      tokenUri: 'ipfs://updated',
    })).toEqual({
      contract,
      tokenId: 3n,
      tokenUri: 'ipfs://updated',
    });
  });

  it('rejects invalid collection token and mint inputs', () => {
    expect(() => planErc1155CollectionCreateToken({ contract, maxSupply: '0' }))
      .toThrow('maxSupply must be greater than 0.');
    expect(() => planErc1155CollectionMint({ contract, tokenId: '-1', quantity: '1' }))
      .toThrow('tokenId must be greater than or equal to 0.');
    expect(() => planErc1155CollectionMint({ contract, tokenId: '1', quantity: '0' }))
      .toThrow('quantity must be greater than 0.');
    expect(() => planErc1155CollectionMintBatch({ contract, items: [] }))
      .toThrow('items must include at least one token.');
    expect(() => planErc1155CollectionMintBatch({
      contract,
      items: [{ tokenId: '1', quantity: '0' }],
    })).toThrow('quantity must be greater than 0.');
  });

  it('plans listings, offers, and release configs with quantities and per-unit prices', () => {
    expect(planErc1155ListingCreate({
      contract,
      tokenId: '4',
      quantity: '5',
      price: 100n,
      currency: erc20,
      splitAddresses: [account, buyer],
      splitRatios: [70, 30],
    }, account)).toEqual({
      contract,
      tokenId: 4n,
      quantity: 5n,
      currency: erc20,
      price: 100n,
      expirationTime: 0n,
      splitAddresses: [account, buyer],
      splitRatios: [70, 30],
    });

    expect(planErc1155ListingBuy({
      contract,
      seller,
      tokenId: '4',
      quantity: '5',
      price: 100n,
      currency: erc20,
      recipient: buyer,
    }, account)).toMatchObject({
      recipient: buyer,
      totalPrice: 500n,
    });

    expect(planErc1155OfferCreate({
      contract,
      tokenId: '4',
      quantity: '5',
      price: 100n,
      currency: ETH_ADDRESS,
      expirationTime: '1800000100',
    })).toMatchObject({
      quantity: 5n,
      totalPrice: 500n,
      expirationTime: 1_800_000_100n,
    });

    expect(planErc1155ReleaseConfigure({
      contract,
      tokenId: '4',
      price: 100n,
      currency: ETH_ADDRESS,
      maxMints: '0',
    }, account, NOW)).toMatchObject({
      tokenId: 4n,
      price: 100n,
      maxMints: 0n,
      startTime: NOW,
    });
  });

  it('plans listing and offer cancellation/status requests', () => {
    expect(planErc1155ListingCancel({ tokenIds: ['1', 2] })).toEqual([1n, 2n]);
    expect(() => planErc1155ListingCancel({ tokenIds: [] })).toThrow('tokenIds must include at least one token.');
    expect(() => planErc1155ListingCancel({ tokenIds: ['2', '2'] })).toThrow('tokenIds must be strictly ascending.');

    expect(planErc1155ListingStatus({ contract, seller, tokenId: '9' })).toEqual({
      contract,
      seller,
      tokenId: 9n,
    });
    expect(planErc1155OfferCancel({ tokenId: '9', currency: erc20 })).toEqual({
      tokenId: 9n,
      currency: erc20,
    });
    expect(planErc1155OfferAccept({
      contract,
      tokenId: '9',
      buyer,
      quantity: '2',
      price: 10n,
      currency: erc20,
    }, seller)).toMatchObject({
      tokenId: 9n,
      buyer,
      quantity: 2n,
      splitAddresses: [seller],
      splitRatios: [100],
    });
  });

  it('plans ERC1155 batch listing and release writes', () => {
    expect(planErc1155ListingCreateBatch({
      contract,
      currency: erc20,
      items: [
        { tokenId: '1', quantity: '2', price: 100n },
        { tokenId: '2', quantity: '3', price: 200n, expirationTime: '1800000100' },
      ],
    }, account)).toEqual({
      contract,
      currency: erc20,
      items: [
        { tokenId: 1n, quantity: 2n, price: 100n, expirationTime: 0n },
        { tokenId: 2n, quantity: 3n, price: 200n, expirationTime: 1_800_000_100n },
      ],
      splitAddresses: [account],
      splitRatios: [100],
    });

    expect(planErc1155ReleaseConfigureBatch({
      contract,
      currency: ETH_ADDRESS,
      items: [
        { tokenId: '1', price: 100n, maxMints: '0' },
        { tokenId: '2', price: 200n, maxMints: '3', startTime: '1800000100' },
      ],
    }, account, NOW)).toEqual({
      contract,
      currency: ETH_ADDRESS,
      items: [
        { tokenId: 1n, price: 100n, startTime: NOW, maxMints: 0n },
        { tokenId: 2n, price: 200n, startTime: 1_800_000_100n, maxMints: 3n },
      ],
      splitAddresses: [account],
      splitRatios: [100],
    });

    expect(planErc1155ReleaseCancel({ contract, tokenIds: ['1', 2] })).toEqual({
      contract,
      tokenIds: [1n, 2n],
    });

    expect(() => planErc1155ListingCreateBatch({ contract, currency: erc20, items: [] }, account))
      .toThrow('items must include at least one listing.');
    expect(() => planErc1155ReleaseConfigureBatch({ contract, currency: erc20, items: [] }, account, NOW))
      .toThrow('items must include at least one release config.');
    expect(() => planErc1155ReleaseCancel({ contract, tokenIds: ['2', '1'] }))
      .toThrow('tokenIds must be strictly ascending.');
  });

  it('plans ERC1155 release allowlist and limit batches', () => {
    const root = `0x${'11'.repeat(32)}` as const;
    expect(planErc1155ReleaseAllowlistConfigBatch({
      contract,
      items: [
        { tokenId: '1', root, endTime: '1800000100' },
      ],
    })).toEqual([{
      contract,
      tokenId: 1n,
      root,
      endTimestamp: 1_800_000_100n,
    }]);

    expect(planErc1155ReleaseLimitConfigBatch({
      contract,
      items: [
        { tokenId: '1', limit: '0' },
        { tokenId: '2', limit: '5' },
      ],
    })).toEqual([
      { contract, tokenId: 1n, limit: 0n },
      { contract, tokenId: 2n, limit: 5n },
    ]);

    expect(() => planErc1155ReleaseAllowlistConfigBatch({
      contract,
      items: [{ tokenId: '1', endTime: '1800000100' }],
    })).toThrow('items[0].root or items[0].artifact is required.');
    expect(() => planErc1155ReleaseLimitConfigBatch({
      contract,
      items: [{ tokenId: '2', limit: '1' }, { tokenId: '1', limit: '1' }],
    })).toThrow('tokenIds must be strictly ascending.');
  });

  it('validates quantities, prices, and splits for marketplace planners', () => {
    expect(totalPrice(7n, 6n)).toBe(42n);
    expect(() => planErc1155ListingBuy({ contract, seller, tokenId: '1', quantity: '0', price: 10n, currency: erc20 }, account))
      .toThrow('quantity must be greater than 0.');
    expect(() => planErc1155OfferCreate({ contract, tokenId: '1', quantity: '-1', price: 10n, currency: erc20 }))
      .toThrow('quantity must be greater than 0.');
    expect(() => planErc1155ReleaseMint({ contract, tokenId: '1', quantity: '0' }, account))
      .toThrow('quantity must be greater than 0.');
    expect(() => providedSplits([account], [50])).toThrow('splitRatios must sum to 100 (got 50).');
    expect(() => providedSplits([account], [100, 0])).toThrow('splitAddresses and splitRatios must have the same length.');
    expect(() => providedSplits([account, buyer, seller, contract, erc20, marketplace], [20, 20, 20, 20, 10, 10]))
      .toThrow('splitAddresses cannot include more than 5 addresses.');
    expect(() => providedSplits([], [])).toThrow('splitAddresses must include at least 1 address.');
  });

  it('plans checkout release and listing items', () => {
    const [release, listing] = planErc1155CheckoutInput({
      items: [
        {
          kind: 'release',
          contract,
          tokenId: '1',
          quantity: '2',
          proof: [`0x${'11'.repeat(32)}`],
        },
        {
          kind: 'listing',
          contract,
          seller,
          tokenId: '2',
          quantity: '3',
          price: '0.01',
          currency: 'eth',
        },
      ],
    });
    expect(release).toMatchObject({
      kind: 'release',
      tokenId: 1n,
      quantity: 2n,
      proof: [`0x${'11'.repeat(32)}`],
    });
    expect(listing).toMatchObject({
      kind: 'listing',
      seller,
      tokenId: 2n,
      quantity: 3n,
      priceInput: '0.01',
    });

    expect(planErc1155CheckoutResolved({
      recipient: buyer,
      items: [
        { kind: 'release', contract, seller, currency: ETH_ADDRESS, tokenId: 1n, price: 10n, quantity: 2n, proof: [] },
        { kind: 'listing', contract, seller, currency: erc20, tokenId: 2n, price: 20n, quantity: 3n },
      ],
    })).toMatchObject({
      recipient: buyer,
      items: [
      {
        kind: 'release',
        itemKind: erc1155CheckoutItemKinds.release,
        contract,
        seller,
        currency: ETH_ADDRESS,
        tokenId: 1n,
        price: 10n,
        quantity: 2n,
        proof: [],
        totalPrice: 20n,
      },
      {
        kind: 'listing',
        itemKind: erc1155CheckoutItemKinds.listing,
        contract,
        seller,
        currency: erc20,
        tokenId: 2n,
        price: 20n,
        quantity: 3n,
        proof: [],
        totalPrice: 60n,
      },
      ],
    });
  });

  it('rejects invalid checkout inputs and groups checkout payment requirements', () => {
    expect(() => planErc1155CheckoutInput({ items: [] })).toThrow('items must include at least one checkout item.');
    expect(() => planErc1155CheckoutInput({
      items: [{ kind: 'release', contract, tokenId: '-1', quantity: '1' }],
    })).toThrow('items[0].tokenId must be greater than or equal to 0.');
    expect(() => planErc1155CheckoutInput({
      items: [{ kind: 'release', contract, tokenId: '1', quantity: '0' }],
    })).toThrow('items[0].quantity must be greater than 0.');
    expect(() => planErc1155CheckoutInput({
      items: [{ kind: 'release', contract, tokenId: '1', quantity: '1', proof: ['0x1234'] }],
    })).toThrow('items[0].proof[0] must be a bytes32 hex string.');
    expect(() => planErc1155CheckoutResolved({
      recipient: buyer,
      items: [{ kind: 'listing', contract, currency: ETH_ADDRESS, tokenId: 1n, price: 1n, quantity: 1n }],
    })).toThrow('items[0].seller is required for listing checkout items.');
    expect(() => planErc1155CheckoutResolved({
      recipient: zeroAddress,
      items: [{ kind: 'release', contract, seller, currency: ETH_ADDRESS, tokenId: 1n, price: 1n, quantity: 1n }],
    })).toThrow('recipient cannot be the zero address.');

    expect(groupErc1155CheckoutPayments([
      { currencyAddress: ETH_ADDRESS, requiredAmount: 10n },
      { currencyAddress: erc20, requiredAmount: 7n },
      { currencyAddress: ETH_ADDRESS, requiredAmount: 3n },
    ])).toEqual([
      { currencyAddress: ETH_ADDRESS, requiredAmount: 13n },
      { currencyAddress: erc20, requiredAmount: 7n },
    ]);
  });

  it('plans allowlist configs from artifacts or roots', () => {
    expect(planErc1155ReleaseAllowlistConfig({
      contract,
      tokenId: '1',
      endTime: '1800000100',
      artifact: {
        kind: 'rare-release-allowlist-v1',
        version: 1,
        leafEncoding: 'keccak256(address)',
        tree: 'sorted-addresses-sort-pairs',
        root: `0x${'11'.repeat(32)}`,
        wallets: [],
      },
    })).toEqual({
      contract,
      tokenId: 1n,
      root: `0x${'11'.repeat(32)}`,
      endTimestamp: 1_800_000_100n,
    });
    expect(() => planErc1155ReleaseAllowlistConfig({ contract, tokenId: '1', endTime: '1800000100' })).toThrow('Pass root or artifact.');
    expect(() => planErc1155ReleaseAllowlistConfig({
      contract,
      tokenId: '1',
      endTime: '1800000100',
      root: '0x1234',
    })).toThrow('root must be a bytes32 hex string.');
    expect(() => planErc1155ReleaseAllowlistConfig({
      contract,
      tokenId: '1',
      endTime: '1800000100',
      artifact: {
        kind: 'rare-release-allowlist-v1',
        version: 1,
        leafEncoding: 'keccak256(address)',
        tree: 'sorted-addresses-sort-pairs',
        root: '0x1234',
        wallets: [],
      },
    })).toThrow('root must be a bytes32 hex string.');
  });

  it('plans release mint, clear allowlist, and limit configs', () => {
    expect(planErc1155ReleaseMint({
      contract,
      tokenId: '2',
      quantity: '3',
      currency: erc20,
      price: 8n,
      recipient: buyer,
      proof: [`0x${'22'.repeat(32)}`],
    }, account)).toEqual({
      contract,
      tokenId: 2n,
      quantity: 3n,
      recipient: buyer,
      currency: erc20,
      price: 8n,
      proof: [`0x${'22'.repeat(32)}`],
    });
    expect(() => planErc1155ReleaseMint({
      contract,
      tokenId: '2',
      quantity: '3',
      proof: ['0x1234'],
    }, account)).toThrow('proof[0] must be a bytes32 hex string.');
    expect(planErc1155ReleaseClearAllowlistConfig({ contract, tokenId: '2' })).toEqual({
      contract,
      tokenId: 2n,
      root: zeroBytes32,
      endTimestamp: 0n,
    });
    expect(planErc1155ReleaseLimitConfig({ contract, tokenId: '2', limit: '0' })).toEqual({
      contract,
      tokenId: 2n,
      limit: 0n,
    });
  });
});

describe('ERC1155 status shaping', () => {
  it('shapes collection status with optional token and account data', () => {
    expect(shapeErc1155CollectionStatus({
      contract,
      tokenId: 1n,
      account,
      name: 'Collection',
      symbol: 'COL',
      owner: seller,
      disabled: false,
      maxBatchSize: 20n,
      approvedMinter: true,
      uri: 'ipfs://token',
      maxSupply: 10n,
      totalMinted: 4n,
      balance: 2n,
      royalty: [seller, 0n],
    })).toEqual({
      contract,
      name: 'Collection',
      symbol: 'COL',
      owner: seller,
      disabled: false,
      maxBatchSize: 20n,
      account,
      accountApprovedMinter: true,
      token: {
        tokenId: 1n,
        uri: 'ipfs://token',
        maxSupply: 10n,
        totalMinted: 4n,
        accountBalance: 2n,
        royalty: {
          salePrice: 0n,
          receiver: seller,
          amount: 0n,
        },
      },
    });
  });

  it('shapes listing and offer availability', () => {
    expect(shapeErc1155ListingStatus([
      ETH_ADDRESS,
      100n,
      2n,
      NOW + 10n,
      [account],
      [100],
    ], { seller, wallet: buyer, nowSeconds: NOW })).toMatchObject({
      hasListing: true,
      expired: false,
      canBuy: true,
      quantity: 2n,
    });

    expect(shapeErc1155OfferStatus([
      ETH_ADDRESS,
      100n,
      2n,
      3n,
      NOW - 1n,
    ], { buyer, wallet: seller, nowSeconds: NOW })).toMatchObject({
      hasOffer: true,
      expired: true,
      canAccept: false,
    });
  });

  it('shapes release status from direct sale, limits, and supply', () => {
    expect(shapeErc1155ReleaseStatus({
      marketplace,
      contract,
      tokenId: 1n,
      config: [seller, ETH_ADDRESS, 0n, NOW - 10n, 0n, [seller], [100]],
      allowlist: [zeroBytes32, 0n],
      mintLimit: 2n,
      txLimit: 0n,
      account,
      accountMints: 1n,
      accountTxs: 0n,
      maxSupply: 10n,
      totalMinted: 4n,
      nowSeconds: NOW,
    })).toMatchObject({
      configured: true,
      started: true,
      currentlyMintable: true,
      price: 0n,
      maxMints: 0n,
      remainingSupply: 6n,
      isEth: true,
    });
  });

  it('shapes checkout filled, skipped, and completed events', () => {
    expect(shapeErc1155CheckoutResult({
      marketplace,
      txHash,
      receipt: checkoutReceipt(),
      completed: {
        payer: buyer,
        recipient: account,
        filledCount: 1n,
        skippedCount: 1n,
        ethSpent: 110n,
        ethRefunded: 5n,
      },
      items: [{
        itemIndex: 0n,
        itemKind: erc1155CheckoutItemKinds.release,
        contractAddress: contract,
        tokenId: 1n,
        seller,
        currencyAddress: ETH_ADDRESS,
        price: 100n,
        quantity: 1n,
        filled: false,
        failureStage: 1,
        reason: '0x12345678',
        failureData: '0x12345678',
        totalPaid: 0n,
        decodedFailure: { errorName: 'UnsupportedCheckoutItemKind', args: [3] },
      }, {
        itemIndex: 1n,
        itemKind: erc1155CheckoutItemKinds.listing,
        contractAddress: contract,
        tokenId: 2n,
        seller,
        currencyAddress: ETH_ADDRESS,
        price: 100n,
        quantity: 1n,
        filled: true,
        failureStage: 0,
        reason: '0x00000000',
        failureData: '0x',
        totalPaid: 110n,
      }],
      payments: [{ currencyAddress: ETH_ADDRESS, requiredAmount: 115n }],
    })).toMatchObject({
      marketplace,
      summary: {
        payer: buyer,
        recipient: account,
        filledCount: 1n,
        skippedCount: 1n,
        ethSpent: 110n,
        ethRefunded: 5n,
      },
      items: [
        {
          index: 0,
          status: 'skipped',
          filled: false,
          kind: 'release',
          seller,
          currencyAddress: ETH_ADDRESS,
          price: 100n,
          quantity: 1n,
          failureStageName: 'VALIDATION',
          reason: '0x12345678',
          failureData: '0x12345678',
          decodedFailure: { errorName: 'UnsupportedCheckoutItemKind', args: [3] },
        },
        {
          index: 1,
          status: 'filled',
          filled: true,
          kind: 'listing',
          failureStageName: 'NONE',
          reason: '0x00000000',
          failureData: '0x',
          totalPaid: 110n,
        },
      ],
      payments: [{ currencyAddress: ETH_ADDRESS, requiredAmount: 115n }],
    });
  });

  it('validates checkout processed logs against completion summary and input items', () => {
    const validated = validateErc1155CheckoutLogs({
      txHash,
      ethValue: 115n,
      expectedItems: [
        {
          itemKind: erc1155CheckoutItemKinds.release,
          contractAddress: contract,
          seller,
          currencyAddress: ETH_ADDRESS,
          tokenId: 1n,
          price: 100n,
          quantity: 1n,
        },
        {
          itemKind: erc1155CheckoutItemKinds.listing,
          contractAddress: contract,
          seller,
          currencyAddress: ETH_ADDRESS,
          tokenId: 2n,
          price: 10n,
          quantity: 1n,
        },
      ],
      completedLogs: [{
        payer: buyer,
        recipient: account,
        filledCount: 1n,
        skippedCount: 1n,
        ethSpent: 15n,
        ethRefunded: 100n,
      }],
      processedItems: [
        {
          itemIndex: 1n,
          itemKind: erc1155CheckoutItemKinds.listing,
          contractAddress: contract,
          tokenId: 2n,
          seller,
          currencyAddress: ETH_ADDRESS,
          price: 10n,
          quantity: 1n,
          filled: true,
          failureStage: erc1155CheckoutFailureStages.none,
          reason: zeroBytes4,
          failureData: '0x',
          totalPaid: 15n,
        },
        {
          itemIndex: 0n,
          itemKind: erc1155CheckoutItemKinds.release,
          contractAddress: contract,
          tokenId: 1n,
          seller,
          currencyAddress: ETH_ADDRESS,
          price: 100n,
          quantity: 1n,
          filled: false,
          failureStage: erc1155CheckoutFailureStages.validation,
          reason: '0x12345678',
          failureData: '0x1234567890',
          totalPaid: 0n,
        },
      ],
    });

    expect(validated.items.map((item) => Number(item.itemIndex))).toEqual([0, 1]);
    expect(validated.completed.filledCount).toBe(1n);
  });

  it('rejects malformed checkout logs', () => {
    const expectedItems = [{
      itemKind: erc1155CheckoutItemKinds.release,
      contractAddress: contract,
      seller,
      currencyAddress: ETH_ADDRESS,
      tokenId: 1n,
      price: 100n,
      quantity: 1n,
    }];
    const completedLogs = [{
      payer: buyer,
      recipient: account,
      filledCount: 1n,
      skippedCount: 0n,
      ethSpent: 110n,
      ethRefunded: 0n,
    }];
    const processedItems = [{
      itemIndex: 0n,
      itemKind: erc1155CheckoutItemKinds.release,
      contractAddress: contract,
      tokenId: 1n,
      seller,
      currencyAddress: ETH_ADDRESS,
      price: 100n,
      quantity: 1n,
      filled: true,
      failureStage: erc1155CheckoutFailureStages.none,
      reason: zeroBytes4,
      failureData: '0x' as const,
      totalPaid: 110n,
    }];

    expect(() => validateErc1155CheckoutLogs({
      txHash,
      ethValue: 110n,
      expectedItems,
      completedLogs: [],
      processedItems,
    })).toThrow('expected 1');

    expect(() => validateErc1155CheckoutLogs({
      txHash,
      ethValue: 110n,
      expectedItems,
      completedLogs,
      processedItems: [],
    })).toThrow('CheckoutItemProcessed logs for 1 input items');

    expect(() => validateErc1155CheckoutLogs({
      txHash,
      ethValue: 110n,
      expectedItems,
      completedLogs,
      processedItems: [{ ...processedItems[0]!, failureData: '0x1234' }],
    })).toThrow('filled item 0 has non-empty failure data');

    expect(() => validateErc1155CheckoutLogs({
      txHash,
      ethValue: 110n,
      expectedItems,
      completedLogs,
      processedItems: [{
        ...processedItems[0]!,
        filled: false,
        failureStage: erc1155CheckoutFailureStages.validation,
        reason: '0x87654321',
        failureData: '0x12345678',
        totalPaid: 0n,
      }],
    })).toThrow('reason does not match failureData selector');
  });

  it('shapes allowlist, limit, and sold-out release statuses', () => {
    expect(shapeErc1155ReleaseAllowlistConfig([`0x${'33'.repeat(32)}`, NOW + 1n], {
      marketplace,
      contract,
      tokenId: 1n,
      nowSeconds: NOW,
    })).toMatchObject({
      root: `0x${'33'.repeat(32)}`,
      active: true,
    });
    expect(shapeErc1155ReleaseLimitConfig(0n, { marketplace, contract, tokenId: 1n })).toMatchObject({
      enabled: false,
    });
    expect(shapeErc1155ReleaseStatus({
      marketplace,
      contract,
      tokenId: 1n,
      config: [seller, erc20, 100n, NOW - 10n, 5n, [], []],
      allowlist: [`0x${'44'.repeat(32)}`, NOW + 100n],
      mintLimit: 2n,
      txLimit: 1n,
      account,
      accountMints: 2n,
      accountTxs: 1n,
      maxSupply: 10n,
      totalMinted: 10n,
      nowSeconds: NOW,
    })).toMatchObject({
      allowlistActive: true,
      requiresAllowlist: true,
      remainingSupply: 0n,
      soldOut: true,
      currentlyMintable: false,
      isEth: false,
    });
  });
});

function checkoutReceipt(): TransactionReceipt {
  return {
    blockHash: `0x${'66'.repeat(32)}`,
    blockNumber: 12n,
    contractAddress: null,
    cumulativeGasUsed: 0n,
    effectiveGasPrice: 0n,
    from: buyer,
    gasUsed: 0n,
    logs: [],
    logsBloom: emptyLogsBloom,
    status: 'success',
    to: marketplace,
    transactionHash: txHash,
    transactionIndex: 0,
    type: 'legacy',
  };
}
