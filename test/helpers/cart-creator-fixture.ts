import { randomUUID } from 'node:crypto';
import { createWalletClient, http, isHex, zeroAddress } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { isRecord, requireString } from '../../src/sdk/account-auth-core.js';
import { createRareAccountClient } from '../../src/sdk/account-client.js';
import { createRareClient } from '../../src/sdk/client.js';
import { cartAbi } from '../../src/contracts/abis/cart.js';
import { getCartAddress } from '../../src/contracts/addresses.js';
import { cartDomain, hashCartListing } from '../../src/sdk/cart-core.js';
import { createTestSepoliaPublicClient, getTestRpcUrl } from './liveViem.js';

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Creator fixture returned an invalid object.');
  return value;
}

function productData(value: unknown) {
  const product = record(record(value).data);
  if (!Array.isArray(product.variants)) throw new Error('Creator fixture did not return variants.');
  return { id: requireString(product.id, 'id'), variants: product.variants.map((entry: unknown) => {
    const variant = record(entry);
    const sku = requireString(variant.sku, 'sku');
    if (!isHex(sku)) throw new Error('Creator variant returned an invalid SKU.');
    return { sku, universalTokenId: variant.universalTokenId === null ? null : requireString(variant.universalTokenId, 'universalTokenId') };
  }) };
}

export async function createCreatorCartScenario() {
  const apiBaseUrl = process.env.RARE_API_BASE_URL;
  const rawKeys = process.env.E2E_SELLER_PRIVATE_KEYS;
  const key = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY ?? rawKeys?.split(/[,\s]+/u).find(Boolean);
  if (!apiBaseUrl || !key || !isHex(key) || key.length !== 66) {
    throw new Error('Set RARE_API_BASE_URL, TEST_RPC_URL and a registered creator test wallet in RARE_ACCOUNT_TEST_PRIVATE_KEY or E2E_SELLER_PRIVATE_KEYS.');
  }
  const seller = privateKeyToAccount(key);
  const accountClient = createRareClient({ apiBaseUrl });
  await accountClient.auth.loginWithWallet({ address: seller.address, chainId: 11155111,
    signMessage: message => seller.signMessage({ message }) });
  try {
    await accountClient.profile.get();
    const apiFetch = accountClient.authenticatedFetch;
    const request = async (path: string, body?: unknown): Promise<unknown> => {
      const response = await apiFetch(new URL(path, apiBaseUrl), {
        method: body === undefined ? 'GET' : 'POST',
        ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`Creator Cart fixture ${path} failed with ${response.status}.`);
      return response.json();
    };
    const publicClient = createTestSepoliaPublicClient();
    if (await publicClient.getChainId() !== 11155111) throw new Error('Cart integration requires Sepolia.');
    const cart = getCartAddress('sepolia');
    const runId = randomUUID();
    const walletClient = createWalletClient({ account: seller, chain: sepolia, transport: http(getTestRpcUrl()) });
    const rare = createRareClient({ publicClient, walletClient, apiBaseUrl, accountClient });
    const collection = await rare.collection.deploy.erc721({ name: `SDK Cart ${runId}`, symbol: 'SCART', maxTokens: 2 });
    const tokenUri = `data:application/json,${encodeURIComponent(JSON.stringify({ name: `SDK Cart ${runId}` }))}`;
    const tokens = [
      await rare.collection.mint({ contract: collection.contract, tokenUri }),
      await rare.collection.mint({ contract: collection.contract, tokenUri }),
    ];
    const createdProduct = productData(await request('/v1/cart/products', {
      slug: `sdk-cart-${runId}`, metadata: { title: 'SDK Cart integration', source: 'rare-sdk', runId },
    }));
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
      await request(`/v1/cart/products/${createdProduct.id}/skus`, { sku: listing.sku, position, metadata: {} });
    }
    await request(`/v1/cart/products/${createdProduct.id}/publish`, {});
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
    return { rare, publicClient, cart, chainId, runId, apiFetch, apiBaseUrl, product, skuA, seller,
      createdListings: listings.map(listing => ({ listingDigest: hashCartListing(listing, BigInt(chainId), cart) })),
      listings, listingNonce, artifact, signedArtifact, ingested, listingIntent, accountClient };
  } catch (error) {
    await accountClient.auth.logout();
    throw error;
  }
}
