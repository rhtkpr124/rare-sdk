import { describe, expect, it } from 'vitest';
import { parseEther } from 'viem';
import { ETH_ADDRESS, PUBLIC_LISTING_TARGET } from '../../../src/contracts/addresses.js';
import {
  planAuctionBid,
  planAuctionCreate,
  planAuctionTokenAction,
  planListingBuy,
  planListingCancel,
  planListingCreate,
  planOfferAccept,
  planOfferCancel,
  planOfferCreate,
  shapeAuctionBidRead,
  shapeAuctionStatus,
  shapeListingStatus,
  shapeOfferStatus,
} from '../../../src/sdk/marketplace-core.js';

const accountAddress = '0x0000000000000000000000000000000000000001' as const;
const buyerAddress = '0x0000000000000000000000000000000000000002' as const;
const nftContract = '0x1000000000000000000000000000000000000000' as const;
const erc20Currency = '0x3000000000000000000000000000000000000000' as const;
const AUCTION_TYPE = `0x${'11'.repeat(32)}` as const;
const NOW_SECONDS = 1767225600n;

describe('marketplace transaction planning', () => {
  it('plans listing create defaults and normalized values', () => {
    expect(planListingCreate({ contract: nftContract, tokenId: '1', price: '0.5' }, accountAddress)).toEqual({
      nftAddress: nftContract,
      tokenId: 1n,
      currency: ETH_ADDRESS,
      price: parseEther('0.5'),
      target: PUBLIC_LISTING_TARGET,
      splitAddresses: [accountAddress],
      splitRatios: [100],
    });
  });

  it('allows zero-price listings because the Bazaar treats them as disabled listings', () => {
    expect(planListingCreate({ contract: nftContract, tokenId: '1', price: '0' }, accountAddress).price).toBe(0n);
  });

  it('plans listing create with custom splits and validates them before contract writes', () => {
    expect(
      planListingCreate(
        {
          contract: nftContract,
          tokenId: '1',
          price: '0.5',
          splitAddresses: [accountAddress, buyerAddress],
          splitRatios: [70, 30],
        },
        accountAddress,
      ),
    ).toMatchObject({
      splitAddresses: [accountAddress, buyerAddress],
      splitRatios: [70, 30],
    });

    expect(() =>
      planListingCreate(
        { contract: nftContract, tokenId: '1', price: '1', splitAddresses: [], splitRatios: [] },
        accountAddress,
      ),
    ).toThrow('splitAddresses must include at least 1 address.');
    expect(() =>
      planListingCreate(
        {
          contract: nftContract,
          tokenId: '1',
          price: '1',
          splitAddresses: [accountAddress, buyerAddress],
          splitRatios: [100],
        },
        accountAddress,
      ),
    ).toThrow('splitAddresses and splitRatios must have the same length.');
    expect(() =>
      planListingCreate(
        {
          contract: nftContract,
          tokenId: '1',
          price: '1',
          splitAddresses: [accountAddress, buyerAddress],
          splitRatios: [60, 20],
        },
        accountAddress,
      ),
    ).toThrow('splitRatios must sum to 100 (got 80).');
  });

  it('plans listing cancel and buy inputs', () => {
    expect(planListingCancel({ contract: nftContract, tokenId: '3' })).toEqual({
      tokenId: 3n,
      target: PUBLIC_LISTING_TARGET,
    });
    expect(planListingBuy({ contract: nftContract, tokenId: '4', price: '1', currency: erc20Currency })).toEqual({
      tokenId: 4n,
      currency: erc20Currency,
      amount: parseEther('1'),
    });
  });

  it('plans auction create, bid, and token actions', () => {
    expect(
      planAuctionCreate(
        {
          contract: nftContract,
          tokenId: '3',
          price: '2',
          endTime: '1767229200',
        },
        accountAddress,
        NOW_SECONDS,
      ),
    ).toEqual({
      nftAddress: nftContract,
      tokenId: 3n,
      currency: ETH_ADDRESS,
      startingPrice: parseEther('2'),
      duration: 3600n,
      auctionType: 'reserve',
      startTime: 0n,
      splitAddresses: [accountAddress],
      splitRatios: [100],
    });
    expect(planAuctionBid({ contract: nftContract, tokenId: '8', price: '1' })).toEqual({
      tokenId: 8n,
      currency: ETH_ADDRESS,
      amount: parseEther('1'),
    });
    expect(planAuctionTokenAction({ contract: nftContract, tokenId: 10 })).toEqual({ tokenId: 10n });
  });

  it('plans scheduled auctions and validates seller splits', () => {
    expect(
      planAuctionCreate(
        {
          contract: nftContract,
          tokenId: '3',
          price: '0',
          endTime: '1778503600',
          startTime: '1778500000',
          splitAddresses: [accountAddress, buyerAddress],
          splitRatios: [75, 25],
        },
        accountAddress,
        NOW_SECONDS,
      ),
    ).toEqual({
      nftAddress: nftContract,
      tokenId: 3n,
      currency: ETH_ADDRESS,
      startingPrice: 0n,
      duration: 3600n,
      auctionType: 'scheduled',
      startTime: 1778500000n,
      splitAddresses: [accountAddress, buyerAddress],
      splitRatios: [75, 25],
    });

    expect(() => planAuctionCreate({
      contract: nftContract,
      tokenId: '1',
      price: '1',
      endTime: '1767229200',
      splitAddresses: [accountAddress, buyerAddress],
      splitRatios: [50],
    }, accountAddress, NOW_SECONDS)).toThrow('splitAddresses and splitRatios must have the same length.');

    expect(() => planAuctionCreate({
      contract: nftContract,
      tokenId: '1',
      price: '1',
      endTime: '1767229200',
      splitAddresses: [accountAddress, buyerAddress],
      splitRatios: [50, 40],
    }, accountAddress, NOW_SECONDS)).toThrow('splitRatios must sum to 100 (got 90).');

    expect(() => planAuctionCreate({
      contract: nftContract,
      tokenId: '1',
      price: '0',
      endTime: '1778503600',
      auctionType: 'scheduled',
      startTime: '-1',
    }, accountAddress, NOW_SECONDS)).toThrow('startTime must be greater than 0.');
  });

  it('plans offer create, cancel, and accept inputs', () => {
    expect(planOfferCreate({ contract: nftContract, tokenId: '5', price: '2', currency: erc20Currency })).toEqual({
      tokenId: 5n,
      currency: erc20Currency,
      amount: parseEther('2'),
    });
    expect(planOfferCancel({ contract: nftContract, tokenId: '11' })).toEqual({
      tokenId: 11n,
      currency: ETH_ADDRESS,
    });
    expect(planOfferAccept({ contract: nftContract, tokenId: '12', price: '1' }, accountAddress)).toEqual({
      tokenId: 12n,
      currency: ETH_ADDRESS,
      amount: parseEther('1'),
      splitAddresses: [accountAddress],
      splitRatios: [100],
    });
    expect(
      planOfferAccept(
        {
          contract: nftContract,
          tokenId: '12',
          price: '1',
          splitAddresses: [accountAddress, buyerAddress],
          splitRatios: [70, 30],
        },
        accountAddress,
      ),
    ).toMatchObject({
      splitAddresses: [accountAddress, buyerAddress],
      splitRatios: [70, 30],
    });
  });

  it('rejects unsafe money and token inputs before shell code can read or write', () => {
    expect(() => planListingBuy({ contract: nftContract, tokenId: '1', price: '0' })).toThrow(
      'price must be greater than 0.',
    );
    expect(() =>
      planAuctionCreate(
        { contract: nftContract, tokenId: '1', price: '0', endTime: '1767229200' },
        accountAddress,
        NOW_SECONDS,
      ),
    ).toThrow('price must be greater than 0.');
    expect(() =>
      planAuctionCreate(
        { contract: nftContract, tokenId: '1', price: '1', endTime: '1767225600' },
        accountAddress,
        NOW_SECONDS,
      ),
    ).toThrow('endTime must be after the auction start time.');
    expect(() => planOfferCreate({ contract: nftContract, tokenId: '-1', price: '1' })).toThrow(
      'tokenId must be greater than or equal to 0.',
    );
  });

  it('validates offer accept splits before contract writes', () => {
    expect(() =>
      planOfferAccept(
        { contract: nftContract, tokenId: '1', price: '1', splitAddresses: [], splitRatios: [] },
        accountAddress,
      ),
    ).toThrow('splitAddresses must include at least 1 address.');
    expect(() =>
      planOfferAccept(
        {
          contract: nftContract,
          tokenId: '1',
          price: '1',
          splitAddresses: [accountAddress, buyerAddress],
          splitRatios: [100],
        },
        accountAddress,
      ),
    ).toThrow('splitAddresses and splitRatios must have the same length.');
    expect(() =>
      planOfferAccept(
        {
          contract: nftContract,
          tokenId: '1',
          price: '1',
          splitAddresses: [accountAddress, buyerAddress],
          splitRatios: [60, 20],
        },
        accountAddress,
      ),
    ).toThrow('splitRatios must sum to 100 (got 80).');
  });
});

describe('marketplace result shaping', () => {
  it('shapes listing status', () => {
    expect(
      shapeListingStatus([accountAddress, ETH_ADDRESS, parseEther('1'), [accountAddress], [100]], {
        target: PUBLIC_LISTING_TARGET,
        wallet: buyerAddress,
      }),
    ).toEqual({
      seller: accountAddress,
      currencyAddress: ETH_ADDRESS,
      amount: parseEther('1'),
      hasListing: true,
      isEth: true,
      target: PUBLIC_LISTING_TARGET,
      splitAddresses: [accountAddress],
      splitRatios: [100],
      canBuy: true,
    });
    expect(
      shapeListingStatus([accountAddress, ETH_ADDRESS, 0n, [], []], {
        target: PUBLIC_LISTING_TARGET,
        wallet: buyerAddress,
      }),
    ).toMatchObject({
      amount: 0n,
      hasListing: false,
      canBuy: false,
    });
  });

  it('shapes listing buyer eligibility from wallet and target', () => {
    const activeListing = [accountAddress, ETH_ADDRESS, parseEther('1'), [accountAddress], [100]] as const;

    expect(shapeListingStatus(activeListing, { target: PUBLIC_LISTING_TARGET, wallet: accountAddress }).canBuy).toBe(false);
    expect(shapeListingStatus(activeListing, { target: PUBLIC_LISTING_TARGET, wallet: buyerAddress }).canBuy).toBe(true);
    expect(shapeListingStatus(activeListing, { target: buyerAddress, wallet: buyerAddress }).canBuy).toBe(true);
    expect(shapeListingStatus(activeListing, { target: accountAddress, wallet: buyerAddress }).canBuy).toBe(false);
    expect(shapeListingStatus(activeListing, { target: PUBLIC_LISTING_TARGET }).canBuy).toBeNull();
  });

  it('shapes offer status', () => {
    expect(shapeOfferStatus([buyerAddress, parseEther('1'), 123n, 3, true], { nowSeconds: 200n })).toEqual({
      buyer: buyerAddress,
      amount: parseEther('1'),
      timestamp: 123n,
      marketplaceFee: 3,
      hasOffer: true,
      currency: ETH_ADDRESS,
      tokenOwner: null,
      cancellableAfter: null,
      canAccept: null,
      canCancel: null,
    });
  });

  it('uses Bazaar strict offer cancellation delay semantics', () => {
    expect(
      shapeOfferStatus([buyerAddress, parseEther('1'), 100n, 3, false], {
        cancellationDelay: 5n,
        wallet: buyerAddress,
        nowSeconds: 105n,
      }),
    ).toMatchObject({
      cancellableAfter: 106n,
      canCancel: false,
    });

    expect(
      shapeOfferStatus([buyerAddress, parseEther('1'), 100n, 3, false], {
        cancellationDelay: 5n,
        wallet: buyerAddress,
        nowSeconds: 106n,
      }),
    ).toMatchObject({
      cancellableAfter: 106n,
      canCancel: true,
    });
  });

  it('classifies auction status as pending, running, or ended', () => {
    const now = 1_000n;
    const base = [accountAddress, 10n, 0n, 60n, ETH_ADDRESS, parseEther('1'), AUCTION_TYPE, [accountAddress], [100]] as const;

    expect(shapeAuctionStatus(base, now)).toMatchObject({
      status: 'PENDING',
      state: 'RESERVE_NOT_MET',
      started: false,
      endTime: null,
      currentBid: 0n,
      minimumNextBid: parseEther('1'),
      settlementEligible: false,
    });
    expect(shapeAuctionStatus(
      [accountAddress, 10n, now - 30n, 60n, ETH_ADDRESS, parseEther('1'), AUCTION_TYPE, [accountAddress], [100]],
      now,
      {
        currentBid: {
          bidder: buyerAddress,
          currencyAddress: ETH_ADDRESS,
          amount: parseEther('2'),
          marketplaceFee: 3,
        },
        minimumBidIncreasePercentage: 10,
      },
    )).toMatchObject({
      status: 'RUNNING',
      state: 'ACTIVE',
      started: true,
      endTime: now + 30n,
      currentBidder: buyerAddress,
      currentBid: parseEther('2'),
      minimumNextBid: parseEther('2.2'),
    });
    expect(shapeAuctionStatus([accountAddress, 10n, now - 90n, 60n, ETH_ADDRESS, parseEther('1'), AUCTION_TYPE, [accountAddress], [100]], now)).toMatchObject({
      status: 'ENDED',
      state: 'ENDED',
      started: true,
      endTime: now - 30n,
      settlementEligible: true,
    });
  });

  it('shapes raw auction bid reads', () => {
    expect(shapeAuctionBidRead([buyerAddress, erc20Currency, parseEther('1'), 3])).toEqual({
      bidder: buyerAddress,
      currencyAddress: erc20Currency,
      amount: parseEther('1'),
      marketplaceFee: 3,
    });
  });
});
