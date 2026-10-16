import { randomUUID } from 'node:crypto';
import { erc721Abi, getAddress, isAddressEqual, isHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { isRecord, requireString } from '../../src/sdk/account-auth-core.js';
import { createRareAccountClient } from '../../src/sdk/account-client.js';
import { createRareClient } from '../../src/sdk/client.js';
import { cartAbi } from '../../src/contracts/abis/cart.js';
import { getCartAddress } from '../../src/contracts/addresses.js';
import { cartDomain, hashCartListing } from '../../src/sdk/cart-core.js';
import { createTestSepoliaPublicClient } from './liveViem.js';

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Creator fixture returned an invalid object.');
  return value;
}

function candidates(value: unknown) {
  const page = record(value);
  if (!Array.isArray(page.records)) throw new Error('Creator fixture did not return candidates.');
  return page.records.map((entry: unknown) => {
    const candidate = record(record(entry).record);
    return { universal_token_id: requireString(candidate.universal_token_id, 'universal_token_id'),
      contract_address: requireString(candidate.contract_address, 'contract_address'), chain_id: String(candidate.chain_id),
      token_id: requireString(candidate.token_id, 'token_id'), type: requireString(candidate.type, 'type') };
  });
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
  const accountClient = createRareAccountClient({ apiBaseUrl });
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
    const eligible = candidates(await request('/v1/cart/products/variant-candidates?perPage=100')).filter(candidate =>
      candidate.chain_id === '11155111' && candidate.type.replaceAll('_', '').toUpperCase() === 'ERC721');
    const owned = await Promise.all(eligible.map(async candidate => {
      const owner = await publicClient.readContract({ address: getAddress(candidate.contract_address),
        abi: erc721Abi, functionName: 'ownerOf', args: [BigInt(candidate.token_id)] });
      if (!isAddressEqual(owner, seller.address)) return undefined;
      const approvedForAll = await publicClient.readContract({ address: getAddress(candidate.contract_address),
        abi: erc721Abi, functionName: 'isApprovedForAll', args: [seller.address, cart] });
      if (approvedForAll) return candidate;
      const approved = await publicClient.readContract({ address: getAddress(candidate.contract_address),
        abi: erc721Abi, functionName: 'getApproved', args: [BigInt(candidate.token_id)] });
      return isAddressEqual(approved, cart) ? candidate : undefined;
    }));
    const selected = owned.filter(candidate => candidate !== undefined).slice(0, 2);
    if (selected.length !== 2) throw new Error('Cart integration requires two indexed Sepolia ERC-721 creations owned by the registered creator test wallet and already approved for Cart. This integration suite does not send approval transactions.');
    const runId = randomUUID();
    const createdProduct = productData(await request('/v1/cart/products', {
      slug: `sdk-cart-${runId}`, metadata: { title: 'SDK Cart integration', source: 'rare-sdk', runId },
    }));
    const attached = productData(await request(`/v1/cart/products/${createdProduct.id}/variants`, {
      universalTokenIds: selected.map(candidate => candidate.universal_token_id),
    }));
    await request(`/v1/cart/products/${createdProduct.id}/publish`, {});
    const rare = createRareClient({ publicClient, apiBaseUrl, accountClient });
    const product = await rare.cart.api.catalog.products.get(createdProduct.id);
    const chainId = 11155111;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const listingIntent = { seller: seller.address, deadline, listings: attached.variants.map(variant => {
      if (!isHex(variant.sku)) throw new Error('Creator variant returned an invalid SKU.');
      return { sku: variant.sku, settlementCurrency: getAddress('0x0000000000000000000000000000000000000000'),
        unitPrice: 1000000000000n, quantity: 1n, paymentRecipient: seller.address };
    }) };
    const listings = await rare.cart.api.listing.preview(listingIntent);
    const listingNonce = await publicClient.readContract({ address: cart, abi: cartAbi,
      functionName: 'listingNonces', args: [seller.address] });
    const artifact = rare.utils.cart.buildListingRoot({ listings, chainId, cart, nonce: listingNonce, deadline });
    const signature = await seller.signTypedData({ domain: cartDomain(chainId, cart), primaryType: 'ListingRoot',
      types: { ListingRoot: [ { name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' } ] },
      message: { listingsRoot: artifact.root.listingsRoot, nonce: BigInt(artifact.root.nonce), deadline } });
    const signedArtifact = { ...artifact, signature };
    const ingested = await rare.cart.api.listing.publish(listingIntent, signedArtifact);
    const skuA = attached.variants[0];
    if (!skuA) throw new Error('Creator Product did not return its variants.');
    return { rare, publicClient, cart, chainId, runId, apiFetch, apiBaseUrl, product, skuA, seller,
      createdListings: listings.map(listing => ({ listingDigest: hashCartListing(listing, BigInt(chainId), cart) })),
      listings, listingNonce, artifact, signedArtifact, ingested, listingIntent, accountClient };
  } catch (error) {
    await accountClient.auth.logout();
    throw error;
  }
}
