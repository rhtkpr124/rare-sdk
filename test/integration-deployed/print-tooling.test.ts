import { randomUUID } from 'node:crypto';
import { createPublicClient, createWalletClient, getAddress, http, isHex, keccak256, toHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { describe, expect, it } from 'vitest';
import { createRareAccountClient, createRareClient } from '../../dist/sdk/index.js';
import type { CreatePrintDrop } from '../../dist/sdk/index.js';
import { loadDotEnv } from '../helpers/env.js';

loadDotEnv();

const setup = () => {
  const apiBaseUrl = process.env.RARE_ACCOUNT_TEST_API_URL ?? process.env.RARE_API_BASE_URL;
  const key = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY ?? process.env.E2E_SELLER_PRIVATE_KEYS?.split(/[,\s]+/u).find(Boolean);
  if (!apiBaseUrl || !key || !isHex(key) || key.length !== 66) throw new Error('Set a deployed feature API and registered dedicated test account private key.');
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com') throw new Error('Print integration tests require a non-production HTTPS API.');
  const wallet = privateKeyToAccount(key);
  const accountClient = createRareAccountClient({ apiBaseUrl });
  const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.TEST_RPC_URL) });
  const walletClient = createWalletClient({ account: wallet, chain: sepolia, transport: http(process.env.TEST_RPC_URL) });
  const rare = createRareClient({ apiBaseUrl, accountClient, publicClient, walletClient });
  return { wallet, accountClient, rare };
};

describe('print tooling through deployed Rare API', () => {
  it('saves opted-in shipping details and creates a draft from a private production upload', async () => {
    const { wallet, accountClient, rare } = setup();
    const addressId = randomUUID();
    let dropId: string | undefined;
    await accountClient.auth.loginWithWallet({ address: wallet.address, chainId: sepolia.id,
      signMessage: message => wallet.signMessage({ message }) });
    try {
      // Fail before uploads or persistent changes when this deployment is missing print tooling.
      const specifications = await rare.prints.specifications.list();
      const specification = specifications[0];
      if (!specification) throw new Error('The API returned no user-facing print specifications.');
      const addressesBefore = await accountClient.shippingAddresses.list();
      const details = { name: 'SDK fulfillment fixture', email: 'sdk-fixture@example.test', phoneNumber: '+12025550100',
        addressLine1: '123 Test Street', addressLine2: '', townOrCity: 'New York', stateOrCounty: 'NY',
        postalOrZipCode: '10001', countryCode: 'US' };
      const saved = await accountClient.shippingAddresses.save({ id: addressId, label: 'SDK integration', details, makeDefault: false });
      expect(saved.find(address => address.id === addressId)?.details).toEqual(details);
      expect((await accountClient.shippingAddresses.list()).find(address => address.id === addressId)?.details).toEqual(details);
      const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jio8AAAAASUVORK5CYII=', 'base64'));
      const production = await accountClient.uploads.upload(bytes, 'production.png', { access: 'private', contentType: 'image/png' });
      expect(production.access).toBe('private');
      expect('url' in production).toBe(false);
      const photo = await accountClient.uploads.upload(bytes, 'preview.png', { contentType: 'image/png' });
      const input: CreatePrintDrop = { idempotencyKey: randomUUID(), chainId: '11155111', name: 'SDK print tooling fixture', description: 'Draft only, no purchase or fulfillment.',
        print: { name: 'SDK print tooling fixture', description: 'Draft only, no purchase or fulfillment.', tags: ['sdk-integration'],
          productionUploadKey: production.key, images: [photo.url], specificationId: specification.id } };
      const created = await rare.prints.drops.create(input);
      dropId = created.id;
      expect((await rare.prints.drops.create(input)).id).toBe(created.id);
      expect((await rare.prints.drops.getMine(created.id)).metadata.name).toBe(input.name);
      expect((await rare.prints.drops.listMine()).some(drop => drop.id === created.id)).toBe(true);
      await rare.prints.drops.update(created.id, { name: 'Updated SDK print fixture', tags: ['updated-sdk-integration'] });
      expect((await rare.prints.drops.getMine(created.id)).metadata.name).toBe('Updated SDK print fixture');
      const option = await rare.prints.options.configure(created.id, { displayPriceUsdCents: '10000' });
      const frozen = await rare.prints.listings.prepare({ optionId: option.id, seller: wallet.address,
        listingSalt: keccak256(toHex(randomUUID())), deadline: String(Math.floor(Date.now() / 1000) + 86_400),
        availableQuantity: '10', fulfillmentKind: 1 });
      const published = await rare.prints.listings.signAndPublish(frozen);
      const entry = published.signedArtifact.entries[0];
      if (!entry) throw new Error('Published print Listing returned no Cart entry.');
      const publicDrop = await rare.prints.drops.get(created.id);
      expect(publicDrop.options.some(candidate => candidate.listingDigest === entry.listingDigest)).toBe(true);
      expect('productionUploadKey' in publicDrop.metadata).toBe(false);
      expect((await rare.prints.drops.activity(created.id)).events).toEqual([]);
      const checkout = await rare.cart.checkout.prepare({ paymentCurrency: getAddress(entry.listing.settlementCurrency),
        items: [{ listingDigest: entry.listingDigest, quantity: 1n, recipient: wallet.address }], delivery: { savedAddressId: addressId } });
      expect(checkout.breakdown?.shipping).toBeGreaterThanOrEqual(0n);
      expect(checkout.breakdown?.total).toBe(checkout.paymentAmount);
      if (!checkout.idempotencyKey || !checkout.intent.delivery) throw new Error('Delivery quote did not retain its idempotency key and delivery intent.');
      const request = { ...checkout.intent, delivery: checkout.intent.delivery, idempotencyKey: checkout.idempotencyKey };
      const signed = await rare.cart.api.checkout.prepare(request);
      expect((await rare.cart.api.checkout.prepare(request)).executePurchase.order.orderId).toBe(signed.executePurchase.order.orderId);
      expect(signed.executePurchase.order.paymentAmount).toBe(checkout.paymentAmount);
      const orderId = signed.executePurchase.order.orderId;
      expect((await accountClient.orders.get(orderId)).id).toBe(orderId);
      expect((await accountClient.orders.list()).data.some(order => order.id === orderId)).toBe(true);
      // No purchase call: the prepared order expires without payment or provider submission.
      const anonymous = createRareClient({ publicClient: createPublicClient({ chain: sepolia, transport: http() }),
        apiBaseUrl: process.env.RARE_ACCOUNT_TEST_API_URL ?? process.env.RARE_API_BASE_URL });
      await expect(anonymous.prints.drops.getMine(created.id)).rejects.toThrow();
      expect((await rare.prints.drops.archive(created.id)).status).toBe('ARCHIVED');
      dropId = undefined;
      const remaining = await accountClient.shippingAddresses.delete(addressId);
      expect(remaining).toEqual(addressesBefore);
    } finally {
      if (dropId !== undefined) await rare.prints.drops.archive(dropId);
      await accountClient.shippingAddresses.delete(addressId);
      await accountClient.auth.logout();
    }
  }, 180_000);
});
