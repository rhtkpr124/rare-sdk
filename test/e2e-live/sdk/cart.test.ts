import { describe, expect, it } from 'vitest';
import { hashDomain, isAddress, isAddressEqual, keccak256, toBytes, zeroAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createRareClient } from '../../../src/sdk/client.js';
import { cartAbi, cartLensAbi, getCartAddress, getCartLensAddress } from '../../../src/sdk/contracts.js';
import { buildCartListingRootArtifact, cartDomain } from '../../../src/sdk/cart-core.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeRpc = hasTestRpcUrl() ? describe : describe.skip;

describeRpc('SDK Cart integration', () => {
  it('accepts a signed free Listing through the configured Sepolia Lens', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const seller = privateKeyToAccount(generatePrivateKey());
    const cart = getCartAddress('sepolia');
    const lens = getCartLensAddress('sepolia');
    if (!lens) throw new Error('Sepolia Cart Lens must be configured.');
    const block = await publicClient.getBlock();
    const listing = {
      listingSalt: keccak256(toBytes('free-listing-deployment-check')),
      seller: seller.address,
      sku: keccak256(toBytes('free-offchain-sku')),
      fulfillmentKind: 1 as const,
      tokenContract: zeroAddress,
      tokenId: 0n,
      settlementCurrency: zeroAddress,
      minimumUnitPrice: 0n,
      availableQuantity: 1n,
      paymentRecipient: seller.address,
    };
    const deadline = block.timestamp + 3600n;
    const artifact = buildCartListingRootArtifact({
      listings: [listing], chainId: 11_155_111, cart, nonce: 0n, deadline,
    });
    const root = { listingsRoot: artifact.root.listingsRoot, nonce: 0n, deadline };
    const signature = await seller.signTypedData({
      domain: cartDomain(11_155_111, cart), primaryType: 'ListingRoot',
      types: { ListingRoot: [
        { name: 'listingsRoot', type: 'bytes32' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ] },
      message: root,
    });
    const result = await publicClient.readContract({
      address: lens, abi: cartLensAbi, functionName: 'validateListing',
      args: [cart, listing, root, signature, [], 1n],
    });
    expect(result.valid).toBe(true);
    expect(result.code).toBe(0);
  }, 30_000);

  it('matches the deployed Sepolia Cart domain and exposes optional Lens configuration', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const rare = createRareClient({ publicClient });
    const cart = getCartAddress('sepolia');
    const [domainSeparator, platformSigner, paused] = await Promise.all([
      publicClient.readContract({ address: cart, abi: cartAbi, functionName: 'DOMAIN_SEPARATOR' }),
      publicClient.readContract({ address: cart, abi: cartAbi, functionName: 'platformSigner' }),
      publicClient.readContract({ address: cart, abi: cartAbi, functionName: 'paused' }),
    ]);

    expect(domainSeparator).toBe(hashDomain({ domain: { ...cartDomain(11_155_111, cart), chainId: 11_155_111n }, types: { EIP712Domain: [
      { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ] } }));
    expect(isAddress(platformSigner)).toBe(true);
    expect(typeof paused).toBe('boolean');
    expect(isAddressEqual(rare.contracts.cart!, cart)).toBe(true);
    expect(isAddressEqual(rare.contracts.cartLens!, getCartLensAddress('sepolia')!)).toBe(true);
    expect(rare.cart.catalog).toBeDefined();
    expect(rare.cart.listing).toBeDefined();
    expect(rare.cart).not.toHaveProperty('order');
    expect(rare.cart.checkout).toBeDefined();
  }, 30_000);
});
