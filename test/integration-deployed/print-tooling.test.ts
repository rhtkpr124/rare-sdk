import { randomUUID } from 'node:crypto';
import { createPublicClient, createWalletClient, getAddress, http, isAddressEqual, isHex, keccak256, toHex, zeroAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../dist/sdk/index.js';
import type { CreatePrintDrop } from '../../dist/sdk/index.js';
import { loadDotEnv } from '../helpers/env.js';
import { createCreatorCartScenario } from '../helpers/cart-creator-fixture.js';
import { getTestRpcUrl } from '../helpers/liveViem.js';
import { isRecord, requireString } from '../../src/sdk/account-auth-core.js';

loadDotEnv();

const setup = () => {
  const apiBaseUrl = process.env.RARE_ACCOUNT_TEST_API_URL ?? process.env.RARE_API_BASE_URL;
  const key = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY ?? process.env.E2E_SELLER_PRIVATE_KEYS?.split(/[,\s]+/u).find(Boolean);
  if (!apiBaseUrl || !key || !isHex(key) || key.length !== 66) throw new Error('Set a deployed feature API and registered dedicated test account private key.');
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com') throw new Error('Print integration tests require a non-production HTTPS API.');
  const wallet = privateKeyToAccount(key);
  const accountClient = createRareClient({ apiBaseUrl });
  const publicClient = createPublicClient({ chain: sepolia, transport: http(process.env.TEST_RPC_URL) });
  const walletClient = createWalletClient({ account: wallet, chain: sepolia, transport: http(process.env.TEST_RPC_URL) });
  const rare = createRareClient({ apiBaseUrl, accountClient, publicClient, walletClient });
  return { wallet, accountClient, rare, apiBaseUrl };
};

describe('print tooling through deployed Rare API', () => {
  it('publishes quantity-limited and gated prints, quotes copies, and reserves an earned claim', async () => {
    const { wallet, accountClient, rare } = setup();
    const addressId = randomUUID();
    let addressNeedsCleanup = false;
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
      addressNeedsCleanup = true;
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
        availableQuantity: '10', maxQuantityPerCheckout: '2', fulfillmentKind: 1 });
      const published = await rare.prints.listings.signAndPublish(frozen, { autoApprove: false });
      expect(published.approvalTxHash).toBeUndefined();
      const entry = published.signedArtifact.entries[0];
      if (!entry) throw new Error('Published print Listing returned no Cart entry.');
      const publicDrop = await rare.prints.drops.get(created.id);
      expect(publicDrop.options.find(candidate => candidate.listingDigest === entry.listingDigest)).toMatchObject({
        maxQuantityPerCheckout: '2', eligibilityRuleId: null,
      });
      expect('productionUploadKey' in publicDrop.metadata).toBe(false);
      expect((await rare.prints.drops.activity(created.id)).events).toEqual([]);
      const checkout = await rare.cart.checkout.prepare({ paymentCurrency: getAddress(entry.listing.settlementCurrency),
        items: [{ kind: 'listing', listingDigest: entry.listingDigest, quantity: 2n, recipient: wallet.address }], delivery: { savedAddressId: addressId } });
      expect(checkout.breakdown?.displayPrice).toBe(200_000_000n);
      expect(checkout.lines.find(line => line.listingDigest === entry.listingDigest)?.quantity).toBe(2n);
      await expect(rare.cart.checkout.prepare({ paymentCurrency: getAddress(entry.listing.settlementCurrency),
        items: [{ kind: 'listing', listingDigest: entry.listingDigest, quantity: 3n, recipient: wallet.address }],
        delivery: { savedAddressId: addressId } })).rejects.toMatchObject({ status: 422 });
      expect(checkout.breakdown?.shipping).toBeGreaterThanOrEqual(0n);
      expect(checkout.breakdown?.total).toBe(checkout.paymentAmount);
      if (!checkout.idempotencyKey || !checkout.intent.delivery) throw new Error('Delivery quote did not retain its idempotency key and delivery intent.');
      const request = { ...checkout.intent, delivery: checkout.intent.delivery, idempotencyKey: checkout.idempotencyKey };
      const signed = await rare.cart.api.checkout.prepare(request);
      expect((await rare.cart.api.checkout.prepare(request)).executePurchase.order.orderId).toBe(signed.executePurchase.order.orderId);
      expect(signed.executePurchase.order.paymentAmount).toBe(checkout.paymentAmount);
      expect(signed.executePurchase.lines.find(line => line.listingDigest === entry.listingDigest)?.quantity).toBe(2n);
      expect(signed.executePurchase.actions).toEqual([]);
      await expect(rare.cart.api.checkout.prepare({ ...request,
        items: [{ kind: 'listing', listingDigest: entry.listingDigest, quantity: 1n, recipient: wallet.address }],
      })).rejects.toMatchObject({ status: 409 });
      const orderId = signed.executePurchase.order.orderId;
      expect((await accountClient.orders.get(orderId)).id).toBe(orderId);
      expect((await accountClient.orders.list()).data.some(order => order.id === orderId)).toBe(true);
      const source = await createCreatorCartScenario({ tokenCount: 1, eligibility: true });
      try {
        const nft = source.listings[0];
        if (!nft) throw new Error('Gated print fixture requires a qualifying NFT.');
        if (input.print === undefined) throw new Error('The fixture requires physical print details.');
        const sourceUniversalTokenId = `11155111-${nft.tokenContract.toLowerCase()}-${nft.tokenId}`;
        const mapped = await rare.prints.drops.create({ ...input, idempotencyKey: randomUUID(),
          print: { ...input.print, sourceUniversalTokenId } });
        try {
          const mappedOption = await rare.prints.options.configure(mapped.id, { displayPriceUsdCents: '10000' });
          const mappedPreparation = await rare.prints.listings.prepare({ optionId: mappedOption.id, seller: wallet.address,
            listingSalt: keccak256(toHex(randomUUID())), deadline: String(Math.floor(Date.now() / 1000) + 86_400), availableQuantity: '10' });
          const mappedPublication = await rare.prints.listings.signAndPublish(mappedPreparation);
          const mappedEntry = mappedPublication.signedArtifact.entries[0];
          if (!mappedEntry) throw new Error('Mapped print returned no Listing.');
          expect(mappedEntry.listing.fulfillmentKind).toBe(1);
          await expect.poll(async () => (await rare.prints.releases.list({ universalTokenId: sourceUniversalTokenId })).some(drop => drop.id === mapped.id),
            { timeout: 60_000, interval: 2_000 }).toBe(true);
          const batch = await rare.cart.checkout.prepare({ paymentCurrency: getAddress(entry.listing.settlementCurrency),
            items: [entry, mappedEntry].map(selected => ({ kind: 'listing' as const, listingDigest: selected.listingDigest, quantity: 1n, recipient: wallet.address })),
            delivery: { savedAddressId: addressId } });
          if (!batch.intent.delivery || !batch.idempotencyKey) throw new Error('Batch quote lost its delivery identity.');
          expect(batch.breakdown?.displayPrice).toBe(200_000_000n);
          const preparedBatch = await rare.cart.api.checkout.prepare({ ...batch.intent, delivery: batch.intent.delivery, idempotencyKey: batch.idempotencyKey });
          const history = await accountClient.orders.get(preparedBatch.executePurchase.order.orderId);
          expect(history.fulfillments).toHaveLength(2);
          expect(new Set(history.fulfillments.map(item => item.orderLineIndex)).size).toBe(2);
          const recovered = await rare.cart.api.checkout.recover(batch.idempotencyKey);
          expect(recovered.status).toBe('READY');
          expect(recovered.preparedPurchase?.executePurchase.order.orderId).toBe(preparedBatch.executePurchase.order.orderId);
        } finally {
          await rare.prints.drops.archive(mapped.id);
        }
        const rule = await rare.eligibility.createRule({ definition: {
          kind: 'EVERY_SALE', source: { chainId: '11155111', tokenContract: nft.tokenContract },
          targets: [{ sku: option.sku }],
        } });
        try {
          const gated = await rare.prints.listings.prepare({ optionId: option.id, seller: wallet.address,
            listingSalt: keccak256(toHex(randomUUID())), deadline: String(Math.floor(Date.now() / 1000) + 86_400),
            availableQuantity: '10', maxQuantityPerCheckout: '2', eligibilityRuleId: rule.id, fulfillmentKind: 1 });
          const gatedPublication = await rare.prints.listings.signAndPublish(gated, { autoApprove: false });
          const gatedEntry = gatedPublication.signedArtifact.entries[0];
          if (!gatedEntry) throw new Error('Gated print publication returned no Listing.');
          expect((await rare.prints.drops.get(created.id)).options.find(candidate => candidate.listingDigest === gatedEntry.listingDigest))
            .toMatchObject({ maxQuantityPerCheckout: '2', eligibilityRuleId: rule.id });
          const gatedQuote = await rare.cart.checkout.prepare({ paymentCurrency: getAddress(gatedEntry.listing.settlementCurrency),
            items: [{ kind: 'listing', listingDigest: gatedEntry.listingDigest, quantity: 1n, recipient: wallet.address }],
            delivery: { savedAddressId: addressId } });
          if (!gatedQuote.intent.delivery || !gatedQuote.idempotencyKey) throw new Error('Gated quote lost its delivery identity.');
          await expect(rare.cart.api.checkout.prepare({ ...gatedQuote.intent, delivery: gatedQuote.intent.delivery,
            idempotencyKey: gatedQuote.idempotencyKey })).rejects.toMatchObject({ status: 409 });
          expect(await rare.eligibility.listClaims({ ruleId: rule.id })).toEqual([]);
          const buyerKey = process.env.E2E_BUYER_PRIVATE_KEYS?.split(/[,\s]+/u).find(Boolean);
          if (!buyerKey || !isHex(buyerKey) || buyerKey.length !== 66) throw new Error('Set a registered, funded Sepolia E2E_BUYER_PRIVATE_KEYS wallet.');
          const buyer = privateKeyToAccount(buyerKey);
          if (isAddressEqual(buyer.address, wallet.address)) throw new Error('The print eligibility buyer must differ from the creator.');
          const buyerAccount = createRareClient({ apiBaseUrl: source.apiBaseUrl });
          await buyerAccount.auth.loginWithWallet({ address: buyer.address, chainId: sepolia.id,
            signMessage: message => buyer.signMessage({ message }) });
          try {
            const buyerRare = createRareClient({ apiBaseUrl: source.apiBaseUrl, accountClient: buyerAccount,
              publicClient: source.publicClient, walletClient: createWalletClient({ account: buyer,
                chain: sepolia, transport: http(getTestRpcUrl()) }) });
            const sourceListing = source.createdListings[0];
            if (!sourceListing) throw new Error('Qualifying NFT has no published Listing.');
            const sourceQuote = await buyerRare.cart.checkout.prepare({ paymentCurrency: zeroAddress,
              items: [{ kind: 'listing', listingDigest: sourceListing.listingDigest, quantity: 1n, recipient: buyer.address }] });
            expect(sourceQuote.paymentAmount).toBeLessThanOrEqual(1_000_000_000_000_000n);
            expect((await buyerRare.cart.checkout.purchase({ preparation: sourceQuote })).receipt.status).toBe('success');
            const claims = () => buyerRare.eligibility.listClaims({ ruleId: rule.id });
            await expect.poll(claims, { timeout: 180_000, interval: 2_000 }).toMatchObject([{ status: 'AVAILABLE' }]);
            const twoCopies = await buyerRare.cart.checkout.prepare({ paymentCurrency: getAddress(gatedEntry.listing.settlementCurrency),
              items: [{ kind: 'listing', listingDigest: gatedEntry.listingDigest, quantity: 2n, recipient: buyer.address }],
              delivery: { recipientDetails: details } });
            if (!twoCopies.intent.delivery || !twoCopies.idempotencyKey) throw new Error('Multi-copy quote lost its delivery identity.');
            await expect(buyerRare.cart.api.checkout.prepare({ ...twoCopies.intent, delivery: twoCopies.intent.delivery,
              idempotencyKey: twoCopies.idempotencyKey })).rejects.toMatchObject({ status: 409 });
            expect(await claims()).toMatchObject([{ status: 'AVAILABLE' }]);
            const buyerQuote = await buyerRare.cart.checkout.prepare({ paymentCurrency: getAddress(gatedEntry.listing.settlementCurrency),
              items: [{ kind: 'listing', listingDigest: gatedEntry.listingDigest, quantity: 1n, recipient: buyer.address }],
              delivery: { recipientDetails: details } });
            if (!buyerQuote.intent.delivery || !buyerQuote.idempotencyKey) throw new Error('Eligible print quote lost its delivery identity.');
            const buyerRequest = { ...buyerQuote.intent, delivery: buyerQuote.intent.delivery, idempotencyKey: buyerQuote.idempotencyKey };
            const reserved = await buyerRare.cart.api.checkout.prepare(buyerRequest);
            expect((await buyerRare.cart.api.checkout.prepare(buyerRequest)).executePurchase.order.orderId)
              .toBe(reserved.executePurchase.order.orderId);
            expect(await claims()).toMatchObject([{ status: 'RESERVED' }]);
            // The qualifying NFT was purchased; the print Order remains unpaid and expires safely.
          } finally {
            await buyerAccount.auth.logout();
          }
        } finally {
          await rare.eligibility.disableRule(rule.id);
        }
      } finally {
        await source.accountClient.auth.logout();
      }
      // The regular print flow can include a receipt without creating a campaign.
      // This defines a zero-supply token and signs a checkout, but does not pay
      // for a print or submit a provider order.
      const receiptCollection = await rare.collection.deploy.erc1155({
        name: `Print receipt ${randomUUID()}`, symbol: 'PRINT', baseUri: '',
      });
      const receiptToken = await rare.collection.erc1155.createToken({
        contract: receiptCollection.contract, maxSupply: 1000n,
        tokenUri: 'data:application/json,%7B%22name%22%3A%22Print%20receipt%22%7D',
      });
      const receiptProduct = await rare.cart.catalog.products.create({ metadata: { title: 'Print receipt fixture' } }, { idempotencyKey: randomUUID() });
      const receiptProductId = receiptProduct.id;
      const cart = rare.contracts.cart;
      if (cart === undefined) throw new Error('Sepolia Cart address is not configured.');
      try {
        const receiptProductWithVariants = await rare.cart.catalog.variants.add(receiptProductId, {
          variants: [{ metadata: { type: 'ERC1155', chainId: '11155111',
            tokenContract: receiptCollection.contract, tokenId: receiptToken.tokenId.toString() } }],
        });
        const variant: unknown = receiptProductWithVariants.variants[0];
        if (!isRecord(variant)) throw new Error('Receipt variant was not returned.');
        const receiptSku = requireString(variant.sku, 'sku');
        if (!isHex(receiptSku) || receiptSku.length !== 66) throw new Error('Receipt variant returned an invalid SKU.');
        expect(receiptSku).not.toBe(option.sku);
        const configuredReceipt = await rare.prints.options.configure(created.id, {
          displayPriceUsdCents: '10000', receipt: { sku: receiptSku },
        });
        expect(configuredReceipt.sku).toBe(option.sku);
        await rare.collection.erc1155.setMinterApproval({ contract: receiptCollection.contract, minter: cart, approved: false });
        // Invalid permissions must fail before asking the creator to sign.
        await expect(rare.prints.listings.prepare({ optionId: option.id, seller: wallet.address,
          listingSalt: keccak256(toHex(randomUUID())), deadline: String(Math.floor(Date.now() / 1000) + 86_400),
          availableQuantity: '10', maxQuantityPerCheckout: '2' })).rejects.toMatchObject({ status: 409 });
        await rare.collection.erc1155.setMinterApproval({ contract: receiptCollection.contract, minter: cart, approved: true });
        const receiptPreparation = await rare.prints.listings.prepare({ optionId: option.id, seller: wallet.address,
          listingSalt: keccak256(toHex(randomUUID())), deadline: String(Math.floor(Date.now() / 1000) + 86_400),
          availableQuantity: '10', maxQuantityPerCheckout: '2' });
        const receiptPublished = await rare.prints.listings.signAndPublish(receiptPreparation, { autoApprove: false });
        const receiptEntry = receiptPublished.signedArtifact.entries[0];
        if (!receiptEntry) throw new Error('Receipt print Listing was not returned.');
        expect(receiptEntry.listing).toMatchObject({ sku: option.sku, fulfillmentKind: 5, tokenId: receiptToken.tokenId });
        expect(isAddressEqual(receiptEntry.listing.tokenContract, receiptCollection.contract)).toBe(true);
        await expect.poll(async () => (await rare.prints.drops.get(created.id)).options
          .find(candidate => candidate.listingDigest === receiptEntry.listingDigest)?.receipt,
        { timeout: 60_000, interval: 2_000 }).toMatchObject({ sku: receiptSku, tokenId: receiptToken.tokenId.toString() });
        const receiptQuote = await rare.cart.checkout.prepare({ paymentCurrency: getAddress(receiptEntry.listing.settlementCurrency),
          items: [{ kind: 'listing', listingDigest: receiptEntry.listingDigest, quantity: 2n, recipient: wallet.address }],
          delivery: { savedAddressId: addressId } });
        if (!receiptQuote.intent.delivery || !receiptQuote.idempotencyKey) throw new Error('Receipt quote lost its delivery identity.');
        const signedReceipt = await rare.cart.api.checkout.prepare({ ...receiptQuote.intent,
          delivery: receiptQuote.intent.delivery, idempotencyKey: receiptQuote.idempotencyKey });
        const receiptLineIndex = signedReceipt.executePurchase.lines.findIndex(line => line.listingDigest === receiptEntry.listingDigest);
        expect(receiptLineIndex).toBeGreaterThanOrEqual(0);
        expect(signedReceipt.executePurchase.actions).toEqual([{ lineIndex: BigInt(receiptLineIndex), quantity: 2n, recipient: wallet.address }]);
        const preserved = await rare.prints.options.configure(created.id, { displayPriceUsdCents: '10000' });
        expect(preserved.metadata.receipt).toEqual(configuredReceipt.metadata.receipt);
        await rare.prints.options.configure(created.id, { displayPriceUsdCents: '10000', receipt: null });
        const plain = await rare.prints.listings.prepare({ optionId: option.id, seller: wallet.address,
          listingSalt: keccak256(toHex(randomUUID())), deadline: String(Math.floor(Date.now() / 1000) + 86_400), availableQuantity: '10' });
        expect((await rare.prints.listings.signAndPublish(plain)).signedArtifact.entries[0]?.listing.fulfillmentKind).toBe(1);
      } finally {
        await rare.collection.erc1155.setMinterApproval({ contract: receiptCollection.contract, minter: cart, approved: false });
        await rare.cart.catalog.products.archive(receiptProductId);
      }
      // No purchase call: the prepared order expires without payment or provider submission.
      const anonymous = createRareClient({ publicClient: createPublicClient({ chain: sepolia, transport: http() }),
        apiBaseUrl: process.env.RARE_ACCOUNT_TEST_API_URL ?? process.env.RARE_API_BASE_URL });
      await expect(anonymous.prints.drops.getMine(created.id)).rejects.toThrow();
      expect((await rare.prints.drops.archive(created.id)).status).toBe('ARCHIVED');
      dropId = undefined;
      const remaining = await accountClient.shippingAddresses.delete(addressId);
      addressNeedsCleanup = false;
      expect(remaining).toEqual(addressesBefore);
    } finally {
      if (dropId !== undefined) await rare.prints.drops.archive(dropId);
      if (addressNeedsCleanup) await accountClient.shippingAddresses.delete(addressId);
      await accountClient.auth.logout();
    }
  }, 600_000);
});
