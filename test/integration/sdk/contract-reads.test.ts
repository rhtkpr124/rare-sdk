import { describe, expect, it, type TestContext } from 'vitest';
import { isAddress, type Address } from 'viem';
import { ETH_ADDRESS, PUBLIC_LISTING_TARGET } from '../../../src/contracts/addresses.js';
import { RareApiError } from '../../../src/data-access/errors.js';
import { createRareClient } from '../../../src/sdk/client.js';
import type { RareClient } from '../../../src/sdk/client.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

type ReadableNftFixture = {
  contract: Address;
  tokenId: string;
};

const describeLive = hasTestRpcUrl() ? describe : describe.skip;
const setup = hasTestRpcUrl()
  ? Promise.resolve().then(async (): Promise<{ rare: RareClient; fixture: ReadableNftFixture }> => {
      const rare = createRareClient({ publicClient: createTestSepoliaPublicClient() });
      return { rare, fixture: await findReadableSepoliaNft(rare) };
    })
  : undefined;

describeLive('SDK contract read integration', () => {
  it('reads token contract and token info through real RPC', async (ctx) => {
    const { rare, fixture } = await requireSetup(ctx, setup);
    const { contract: contractInfo } = await rare.token.status({ contract: fixture.contract });
    expect(contractInfo.contract).toBe(fixture.contract);
    expect(contractInfo.chain).toBe('sepolia');
    expect(contractInfo.name).toEqual(expect.any(String));
    expect(contractInfo.symbol).toEqual(expect.any(String));
    expect(contractInfo.totalSupply === null || contractInfo.totalSupply >= 1n).toBe(true);

    const { token: tokenInfo } = await rare.token.status({
      contract: fixture.contract,
      tokenId: fixture.tokenId,
    });
    expect(tokenInfo).toBeDefined();
    if (tokenInfo === undefined) {
      throw new Error('Expected token status for fixture token.');
    }
    expect(tokenInfo.contract).toBe(fixture.contract);
    expect(tokenInfo.tokenId).toBe(BigInt(fixture.tokenId));
    expect(isAddress(tokenInfo.owner)).toBe(true);
    expect(tokenInfo.tokenUri).toEqual(expect.any(String));
  }, 30_000);

  it('reads marketplace listing, offer, auction, and release status through real RPC', async (ctx) => {
    const { rare, fixture } = await requireSetup(ctx, setup);
    const [listing, offer, auction, release] = await Promise.all([
      rare.listing.status({ contract: fixture.contract, tokenId: fixture.tokenId }),
      rare.offer.status({ contract: fixture.contract, tokenId: fixture.tokenId }),
      rare.auction.status({ contract: fixture.contract, tokenId: fixture.tokenId }),
      rare.listing.release.status({ contract: fixture.contract }),
    ]);

    expect(isAddress(listing.seller)).toBe(true);
    expect(isAddress(listing.currencyAddress)).toBe(true);
    expect(listing.hasListing).toBe(listing.amount > 0n);
    expect(listing.isEth).toBe(listing.currencyAddress === ETH_ADDRESS);
    expect(listing.target).toBe(PUBLIC_LISTING_TARGET);
    expect(Array.isArray(listing.splitAddresses)).toBe(true);
    expect(listing.splitAddresses.every((address) => isAddress(address))).toBe(true);
    expect(Array.isArray(listing.splitRatios)).toBe(true);
    expect(listing.splitRatios.every((ratio) => Number.isInteger(ratio))).toBe(true);
    expect(listing.canBuy).toBeNull();

    expect(isAddress(offer.buyer)).toBe(true);
    expect(offer.hasOffer).toBe(offer.amount > 0n);

    expect(isAddress(auction.seller)).toBe(true);
    expect(['PENDING', 'RUNNING', 'ENDED']).toContain(auction.status);
    expect(auction.started).toBe(auction.status !== 'PENDING');
    if (auction.started) {
      expect(auction.endTime).toBe(auction.startingTime + auction.lengthOfAuction);
    } else {
      expect(auction.endTime).toBeNull();
    }

    expect(release.contract).toBe(fixture.contract);
    expect(isAddress(release.rareMinter)).toBe(true);
    expect(release.configured).toBe(release.seller !== ETH_ADDRESS);
    expect(release.currentlyMintable).toBeTypeOf('boolean');
    expect(release.splitRecipients.length).toBe(release.splitRatios.length);
  }, 30_000);
});

async function requireSetup(
  ctx: TestContext,
  setup: Promise<{ rare: RareClient; fixture: ReadableNftFixture }> | undefined,
): Promise<{ rare: RareClient; fixture: ReadableNftFixture }> {
  if (!setup) {
    throw new Error('SDK contract read integration setup did not run.');
  }
  try {
    return await setup;
  } catch (error) {
    if (error instanceof RareApiError && error.status >= 500) {
      ctx.skip(`Rare API ${error.path} returned ${error.status}.`);
    }
    throw error;
  }
}

async function findReadableSepoliaNft(rareClient: RareClient): Promise<ReadableNftFixture> {
  const tested = new Set<string>();

  for (let page = 1; page <= 5; page += 1) {
    const search = await rareClient.search.nfts({ page, perPage: 24 });

    for (const nft of search.data) {
      if (!isAddress(nft.contractAddress)) continue;

      const candidate = {
        contract: nft.contractAddress,
        tokenId: nft.tokenId,
      };
      const key = `${candidate.contract.toLowerCase()}:${candidate.tokenId}`;
      if (tested.has(key)) continue;
      tested.add(key);

      try {
        await rareClient.token.status(candidate);
        return candidate;
      } catch {
        // Keep scanning until we find an indexed Sepolia NFT with standard ERC-721 reads.
      }
    }

    if (page >= search.pagination.totalPages) {
      break;
    }
  }

  throw new Error('Unable to find a readable Sepolia NFT fixture from the Rare API.');
}
