import { describe, expect, it } from 'vitest';
import { getAddress, isAddress, isAddressEqual, zeroAddress, type Address } from 'viem';
import { createRareClient } from '../../../src/sdk/client.js';
import {
  ETH_ADDRESS,
  getContractAddresses,
  getErc1155ApprovalManagerAddress,
  getErc1155ContractFactoryAddress,
  getErc1155MarketplaceAddress,
  rareErc1155ContractFactoryAbi,
  rareErc1155MarketplaceAbi,
} from '../../../src/sdk/contracts.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeRpc = hasTestRpcUrl() ? describe : describe.skip;
const defaultErc1155Fixture = {
  contract: '0x18970e8881508620d12c714ec2a8ec5fa33c7f86',
  tokenId: '1',
} as const;

type Erc1155Fixture = {
  contract: Address;
  tokenId: string;
};

describeRpc('SDK ERC1155 integration', () => {
  it('exposes configured Sepolia ERC1155 contract addresses and reads factory/marketplace config', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const rare = createRareClient({ publicClient });
    const addresses = getContractAddresses('sepolia');

    expect(rare.contracts.erc1155Marketplace).toBe(getErc1155MarketplaceAddress('sepolia'));
    expect(rare.contracts.erc1155ContractFactory).toBe(getErc1155ContractFactoryAddress('sepolia'));
    expect(rare.contracts.erc1155ApprovalManager).toBe(getErc1155ApprovalManagerAddress('sepolia'));
    expect(rare.contracts.erc1155Marketplace).toBe(addresses.erc1155Marketplace);
    expect(rare.contracts.erc1155ContractFactory).toBe(addresses.erc1155ContractFactory);
    expect(rare.contracts.erc1155ApprovalManager).toBe(addresses.erc1155ApprovalManager);

    const [implementation, defaultMinter, marketplaceApprovalManager] = await Promise.all([
      publicClient.readContract({
        address: getErc1155ContractFactoryAddress('sepolia'),
        abi: rareErc1155ContractFactoryAbi,
        functionName: 'rareERC1155',
      }),
      publicClient.readContract({
        address: getErc1155ContractFactoryAddress('sepolia'),
        abi: rareErc1155ContractFactoryAbi,
        functionName: 'defaultMinter',
      }),
      publicClient.readContract({
        address: getErc1155MarketplaceAddress('sepolia'),
        abi: rareErc1155MarketplaceAbi,
        functionName: 'getERC1155ApprovalManager',
      }),
    ]);

    expect(isAddress(implementation)).toBe(true);
    expect(isAddress(defaultMinter)).toBe(true);
    expect(isAddressEqual(marketplaceApprovalManager, getErc1155ApprovalManagerAddress('sepolia'))).toBe(true);
    expect(rareErc1155MarketplaceAbi.some((entry) => entry.type === 'function' && entry.name === 'checkout')).toBe(true);
    const eventNames = rareErc1155MarketplaceAbi
      .filter((entry) => entry.type === 'event')
      .map((entry): string => entry.name);
    const errorNames = rareErc1155MarketplaceAbi
      .filter((entry) => entry.type === 'error')
      .map((entry): string => entry.name);
    expect(eventNames).toContain('CheckoutItemProcessed');
    expect(eventNames).toContain('CheckoutCompleted');
    expect(eventNames).not.toContain('CheckoutItemFilled');
    expect(eventNames).not.toContain('CheckoutItemSkipped');
    expect(errorNames).not.toContain('CheckoutRequiresSuccessfulFill');
  }, 30_000);

  it('reads ERC1155 collection and marketplace status for configured fixture', async () => {
    const fixture = requireErc1155Fixture();
    const rare = createRareClient({ publicClient: createTestSepoliaPublicClient() });

    const [collection, release, listing, offer] = await Promise.all([
      rare.collection.erc1155.status({
        contract: fixture.contract,
        tokenId: fixture.tokenId,
        account: zeroAddress,
      }),
      rare.listing.erc1155.release.status({
        contract: fixture.contract,
        tokenId: fixture.tokenId,
        account: zeroAddress,
      }),
      rare.listing.erc1155.status({
        contract: fixture.contract,
        tokenId: fixture.tokenId,
        seller: zeroAddress,
      }),
      rare.offer.erc1155.status({
        contract: fixture.contract,
        tokenId: fixture.tokenId,
        buyer: zeroAddress,
        currency: ETH_ADDRESS,
      }),
    ]);

    expect(collection.contract).toBe(fixture.contract);
    expect(collection.name).toEqual(expect.any(String));
    expect(collection.symbol).toEqual(expect.any(String));
    expect(collection.token?.tokenId).toBe(BigInt(fixture.tokenId));
    expect(collection.token?.maxSupply).toEqual(expect.anything());
    expect(typeof collection.token?.maxSupply).toBe('bigint');
    expect(collection.token?.totalMinted).toEqual(expect.anything());
    expect(typeof collection.token?.totalMinted).toBe('bigint');
    expect(collection.token?.uri).toEqual(expect.any(String));
    expect(release.contract).toBe(fixture.contract);
    expect(release.marketplace).toBe(getErc1155MarketplaceAddress('sepolia'));
    expect(release.tokenId).toBe(BigInt(fixture.tokenId));
    expect(release.splitRecipients.length).toBe(release.splitRatios.length);
    expect(listing.seller).toBe(zeroAddress);
    expect(listing.hasListing).toBe(false);
    expect(offer.buyer).toBe(zeroAddress);
    expect(offer.hasOffer).toBe(false);
  }, 30_000);
});

function requireErc1155Fixture(): Erc1155Fixture {
  const contract = process.env.TEST_ERC1155_CONTRACT ?? defaultErc1155Fixture.contract;
  const tokenId = process.env.TEST_ERC1155_TOKEN_ID ?? defaultErc1155Fixture.tokenId;
  if (!isAddress(contract)) {
    throw new Error('TEST_ERC1155_CONTRACT must be a valid EVM address.');
  }
  if (!/^\d+$/.test(tokenId)) {
    throw new Error('TEST_ERC1155_TOKEN_ID must be a non-negative integer string.');
  }
  return {
    contract: getAddress(contract),
    tokenId,
  };
}
