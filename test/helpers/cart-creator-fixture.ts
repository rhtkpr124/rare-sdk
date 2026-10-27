import { randomUUID } from 'node:crypto';
import { createWalletClient, http, isHex, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { createRareClient } from '../../src/sdk/client.js';
import { cartAbi } from '../../src/contracts/abis/cart.js';
import { getCartAddress } from '../../src/contracts/addresses.js';
import { cartDomain, hashCartListing } from '../../src/sdk/cart-core.js';
import { createTestSepoliaPublicClient, getTestRpcUrl } from './liveViem.js';

export async function createCreatorCartScenario() {
  const apiBaseUrl = process.env.RARE_API_BASE_URL;
  const rawKeys = process.env.E2E_SELLER_PRIVATE_KEYS;
  const key = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY ?? rawKeys?.split(/[,\s]+/u).find(Boolean);
  if (!apiBaseUrl || !key || !isHex(key) || key.length !== 66) {
    throw new Error('Set RARE_API_BASE_URL, TEST_RPC_URL and a registered creator test wallet in RARE_ACCOUNT_TEST_PRIVATE_KEY or E2E_SELLER_PRIVATE_KEYS.');
  }
  const seller = privateKeyToAccount(key);
  const publicClient = createTestSepoliaPublicClient();
  if (await publicClient.getChainId() !== 11155111) throw new Error('Cart integration requires Sepolia.');
  const cart = getCartAddress('sepolia');
  const runId = randomUUID();
  const walletClient = createWalletClient({ account: seller, chain: sepolia, transport: http(getTestRpcUrl()) });
  const rare = createRareClient({ publicClient, walletClient, apiBaseUrl });
  await rare.auth.loginWithWallet({ address: seller.address, chainId: 11155111,
    signMessage: message => seller.signMessage({ message }) });
  try {
    await rare.profile.get();
    const collection = await rare.collection.deploy.erc721({ name: `SDK Cart ${runId}`, symbol: 'SCART', maxTokens: 2 });
    const tokenUri = `data:application/json,${encodeURIComponent(JSON.stringify({ name: `SDK Cart ${runId}` }))}`;
    const tokens = [
      await rare.collection.mint({ contract: collection.contract, tokenUri }),
      await rare.collection.mint({ contract: collection.contract, tokenUri }),
    ];
    const createdProduct = await rare.cart.catalog.products.create({
      slug: `sdk-cart-${runId}`, metadata: { title: 'SDK Cart integration', source: 'rare-sdk', runId },
    });
    const chainId = 11155111;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const listingIntent = { seller: seller.address, deadline, listings: tokens.map(token => ({
      nft: { contract: collection.contract, tokenId: token.tokenId }, fulfillmentKind: 2 as const,
      settlementCurrency: zeroAddress, unitPrice: 1000000000000n, quantity: 1n, paymentRecipient: seller.address,
    })) };
    const listings = await rare.cart.api.listing.preview(listingIntent);
    const repeated = await rare.cart.api.listing.preview(listingIntent);
    if (listings.some((listing, index) => listing.sku !== repeated[index]?.sku)) {
      throw new Error('Repeated listing preparation created duplicate NFT SKUs.');
    }
    for (const [position, listing] of listings.entries()) {
      await rare.cart.catalog.products.attachSku(createdProduct.id, { sku: listing.sku, position, metadata: {} });
    }
    await rare.cart.catalog.products.publish(createdProduct.id);
    const product = await rare.cart.api.catalog.products.get(createdProduct.id);
    await rare.cart.approval.approve(collection.contract);
    const listingNonce = await publicClient.readContract({ address: cart, abi: cartAbi,
      functionName: 'listingNonces', args: [seller.address] });
    const artifact = rare.utils.cart.buildListingRoot({ listings, chainId, cart, nonce: listingNonce, deadline });
    const signature = await seller.signTypedData({ domain: cartDomain(chainId, cart), primaryType: 'ListingRoot',
      types: { ListingRoot: [ { name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' } ] },
      message: { listingsRoot: artifact.root.listingsRoot, nonce: BigInt(artifact.root.nonce), deadline } });
    const signedArtifact = { ...artifact, signature };
    const ingested = await rare.cart.api.listing.publish(listingIntent, signedArtifact);
    const skuA = product.variants[0];
    if (!skuA) throw new Error('Creator Product did not return its variants.');
    return { rare, publicClient, cart, chainId, runId, apiBaseUrl, product, skuA, seller,
      createdListings: listings.map(listing => ({ listingDigest: hashCartListing(listing, BigInt(chainId), cart) })),
      listings, listingNonce, artifact, signedArtifact, ingested, listingIntent };
  } catch (error) {
    await rare.auth.logout();
    throw error;
  }
}
