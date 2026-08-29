import { getAddress, isAddress, isHex, type Address, type Hex } from 'viem';
import { createApiClient } from '../data-access/index.js';
import type { RareApiOptions } from './api.js';
import type {
  CartFulfillmentKind,
  CartListing,
  CartListingRoot,
  CartListingRootArtifact,
} from './types/cart.js';
import { buildCartVariantSearchQuery, type CartChainId } from './cart-core.js';
import { generateCartListingSalt } from './cart-listing-shell.js';
import type {
  CartCheckoutIntentItem,
  CartApiListing,
  CartApiListingRoot,
  CartApiListingSearchParams,
  CartApiListingSearchResult,
  CartApiNamespace,
  CartApiPage,
  CartApiPreparedPurchase,
  CartApiPreparedPurchaseWire,
  CartApiProduct,
  CartCheckoutIntent,
  CartCheckoutPreparation,
  CartCatalogVariant,
  CartProductSearchParams,
  CartVariantSearchParams,
  CartListingIntent,
  CartListingPreviewWire,
  CartListingRootArtifactWire,
} from './types/cart-api.js';

type CartApiTransport = {
  GET: (path: string, options?: unknown) => Promise<{ data?: unknown }>;
  POST: (path: string, options?: unknown) => Promise<{ data?: unknown }>;
};

type CartApiScope = {
  chainId: CartChainId;
  cartAddress?: Address;
};

export function createCartApiNamespace(
  options: RareApiOptions,
  scope: CartApiScope,
): CartApiNamespace {
  const client = createApiClient(options.baseUrl, options.fetch) as unknown as CartApiTransport;
  const chainId = chainIdString(scope.chainId);
  const cartAddress = (): Address => {
    if (scope.cartAddress === undefined) {
      throw new Error('Cart API methods require a configured Cart address on this chain.');
    }
    return getAddress(scope.cartAddress);
  };

  const getData = async <T>(request: Promise<{ data?: unknown }>, message: string): Promise<T> => {
    const response = await request;
    if (response.data === undefined) throw new Error(message);
    return response.data as T;
  };
  const getWrappedData = async <T>(request: Promise<{ data?: unknown }>, message: string): Promise<T> => {
    const body = await getData<unknown>(request, message);
    if (!isRecord(body) || !('data' in body)) throw new Error(message);
    return body.data as T;
  };

  const catalog = {
    products: {
      search: async (params: CartProductSearchParams = {}): Promise<CartApiPage<CartApiProduct>> => {
        const page = await getData<CartApiPage<CartApiProduct>>(
          client.GET('/v1/cart/products', { params: { query: params } }), 'Rare API did not return Cart Products.',
        );
        return { ...page, data: page.data.map(normalizeProduct) };
      },
      get: async (id: string): Promise<CartApiProduct> => normalizeProduct(await getWrappedData(
        client.GET(`/v1/cart/products/${encodeURIComponent(id)}`, {}), 'Rare API did not return the Cart Product.',
      )),
    },
    variants: {
      search: async (params: CartVariantSearchParams = {}): Promise<CartApiPage<CartCatalogVariant>> => getData(
        client.GET('/v1/cart/variants', { params: { query: buildCartVariantSearchQuery(params, scope.chainId) } }),
        'Rare API did not return Cart Variants.',
      ),
    },
  };

  const listing = {
    preview: async (intent: CartListingIntent): Promise<CartListing[]> => {
      const wire = await getWrappedData<CartListingPreviewWire>(
        client.POST('/v1/cart/listings/preview', { params: { query: { chainId, cartAddress: cartAddress() } }, body: {
          seller: getAddress(intent.seller),
          deadline: intent.deadline.toString(),
          listings: intent.listings.map((item) => ({
            listingSalt: generateCartListingSalt(),
            sku: item.sku,
            ...(item.fulfillmentKind === undefined ? {} : { fulfillmentKind: item.fulfillmentKind }),
            settlementCurrency: getAddress(item.settlementCurrency),
            displayUnitPrice: item.unitPrice.toString(),
            availableQuantity: item.quantity.toString(),
            ...(item.paymentRecipient === undefined ? {} : { paymentRecipient: getAddress(item.paymentRecipient) }),
          })),
        } }),
        'Rare API did not return the Cart Listing preparation.',
      );
      return wire.listings.map(normalizeListing);
    },
    search: async (params: CartApiListingSearchParams = {}): Promise<CartApiListingSearchResult> => getData(
      client.GET('/v1/cart/listings/search', { params: { query: { ...params, chainId, cartAddress: cartAddress() } } }),
      'Rare API did not return Cart Listing search results.',
    ),
    get: async (listingDigest: Hex): Promise<CartApiListing> => getWrappedData(
      client.GET(`/v1/cart/listings/${encodeURIComponent(listingDigest)}`, { params: { query: { chainId, cartAddress: cartAddress() } } }),
      'Rare API did not return the Cart Listing.',
    ),
    invalidate: async (listingDigest: Hex, invalidatedAt?: string | null): Promise<CartApiListing> => getWrappedData(
      client.POST(`/v1/cart/listings/${encodeURIComponent(listingDigest)}/invalidate`, {
        params: { query: { chainId, cartAddress: cartAddress() } },
        ...(invalidatedAt === undefined ? {} : { body: { invalidatedAt } }),
      }),
      'Rare API did not return the invalidated Cart Listing.',
    ),
    publish: async (artifact: CartListingRootArtifact & { signature: Hex }): Promise<CartApiListingRoot> => getWrappedData(
      client.POST('/v1/cart/listing-roots', { body: toCartListingRootArtifactWire(artifact) }),
      'Rare API did not return the ingested Cart Listing Root.',
    ),
  };

  const checkout = {
    preview: async (intent: CartCheckoutIntent): Promise<CartCheckoutPreparation> => {
      const wire = await getWrappedData<CartApiPreparedPurchaseWire>(
        client.POST('/v1/cart/checkout/preview', {
          params: { query: { chainId, cartAddress: cartAddress() } },
          body: {
            paymentCurrency: intent.paymentCurrency,
            items: intent.items.map(toWireDraftItem),
          },
        }),
        'Rare API did not return the Cart checkout preparation.',
      );
      return checkoutPreparationFromPreparedPurchase(normalizePreparedPurchase(wire), intent);
    },
    prepare: async (intent: CartCheckoutIntent): Promise<CartApiPreparedPurchase> => {
      const wire = await getWrappedData<CartApiPreparedPurchaseWire>(
        client.POST('/v1/cart/checkout/prepare', {
          params: { query: { chainId, cartAddress: cartAddress() } },
          body: { paymentCurrency: intent.paymentCurrency, items: intent.items.map(toWireDraftItem) },
        }),
        'Rare API did not return the signed Cart Purchase.',
      );
      return normalizePreparedPurchase(wire);
    },
  };

  return { catalog, listing, checkout };
}

export function toCartListingRootArtifactWire(
  artifact: CartListingRootArtifact & { signature: Hex },
): CartListingRootArtifactWire {
  return {
    version: 1,
    type: 'rare-cart-listing-root',
    chainId: chainIdString(artifact.chainId),
    cart: getAddress(artifact.cart),
    seller: getAddress(artifact.seller),
    root: artifact.root,
    entries: artifact.entries.map((entry) => ({
      listing: {
        ...entry.listing,
        seller: getAddress(entry.listing.seller),
        tokenContract: getAddress(entry.listing.tokenContract),
        settlementCurrency: getAddress(entry.listing.settlementCurrency),
        paymentRecipient: getAddress(entry.listing.paymentRecipient),
      },
      listingDigest: entry.listingDigest,
      leaf: entry.leaf,
      proof: entry.proof,
    })),
    signature: artifact.signature,
  };
}

function toWireDraftItem(item: CartCheckoutIntentItem): { listingDigest: Hex; quantity: string; recipient?: Address } {
  return {
    listingDigest: item.listingDigest,
    quantity: item.quantity.toString(),
    ...(item.recipient === undefined ? {} : { recipient: getAddress(item.recipient) }),
  };
}

function checkoutPreparationFromPreparedPurchase(
  value: CartApiPreparedPurchase,
  intent: CartCheckoutIntent,
): CartCheckoutPreparation {
  const settlements = value.executePurchase.lines.reduce((totals, line) => {
    const currency = getAddress(line.settlementCurrency);
    return new Map([...totals, [currency, (totals.get(currency) ?? 0n) + line.amount]]);
  }, new Map<Address, bigint>());
  return {
    schemaVersion: 1,
    chainId: value.chainId,
    cartAddress: value.cartAddress,
    preparedAt: value.preparedAt,
    expiresAt: new Date(Number(value.executePurchase.order.deadline) * 1000).toISOString(),
    intent,
    paymentAmount: value.executePurchase.order.paymentAmount,
    fees: value.executePurchase.lines
      .filter((line) => line.fulfillmentKind === 0)
      .map((line) => ({ label: line.sku, currency: line.settlementCurrency, amount: line.amount })),
    settlements: [...settlements].map(([currency, amount]) => ({ currency, amount })),
    lines: value.executePurchase.lines,
    route: value.executePurchase.route,
  };
}

function normalizePreparedPurchase(value: CartApiPreparedPurchaseWire): CartApiPreparedPurchase {
  if (value.schemaVersion !== 1) throw new Error(`Unsupported Cart Prepared Purchase schema version: ${String(value.schemaVersion)}`);
  if (!isAddress(value.cartAddress)) throw new Error('Rare API returned an invalid Cart address.');
  if (!isHex(value.executePurchase.platformSignature)) throw new Error('Rare API returned an invalid platform signature.');
  const execute = value.executePurchase;
  return {
    schemaVersion: 1,
    chainId: BigInt(value.chainId),
    cartAddress: getAddress(value.cartAddress),
    preparedAt: value.preparedAt,
    executePurchase: {
      order: {
        ...execute.order,
        paymentCurrency: getAddress(execute.order.paymentCurrency),
        deadline: BigInt(execute.order.deadline),
        paymentAmount: BigInt(execute.order.paymentAmount),
      },
      lines: execute.lines.map((line) => ({
        ...line,
        fulfillmentKind: normalizeFulfillmentKind(line.fulfillmentKind),
        quantity: BigInt(line.quantity),
        settlementCurrency: getAddress(line.settlementCurrency),
        amount: BigInt(line.amount),
        paymentRecipient: getAddress(line.paymentRecipient),
      })),
      listings: execute.listings.map((listing) => ({
        ...listing,
        fulfillmentKind: normalizeFulfillmentKind(listing.fulfillmentKind),
        seller: getAddress(listing.seller),
        tokenContract: getAddress(listing.tokenContract),
        tokenId: BigInt(listing.tokenId),
        settlementCurrency: getAddress(listing.settlementCurrency),
        minimumUnitPrice: BigInt(listing.minimumUnitPrice),
        availableQuantity: BigInt(listing.availableQuantity),
        paymentRecipient: getAddress(listing.paymentRecipient),
      })),
      authorization: {
        listingRoots: execute.authorization.listingRoots.map((root): CartListingRoot => ({
          listingsRoot: root.listingsRoot,
          nonce: BigInt(root.nonce),
          deadline: BigInt(root.deadline),
        })),
        listingRootSignatures: execute.authorization.listingRootSignatures,
        listingRootIndexes: execute.authorization.listingRootIndexes.map(BigInt),
        listingProofs: execute.authorization.listingProofs,
      },
      route: { ...execute.route, routerValue: BigInt(execute.route.routerValue) },
      actions: execute.actions.map((action) => ({
        lineIndex: BigInt(action.lineIndex),
        quantity: BigInt(action.quantity),
        recipient: getAddress(action.recipient),
      })),
      platformSignature: execute.platformSignature,
    },
  };
}

function chainIdString(chainId: CartChainId): string {
  if (typeof chainId === 'number') {
    if (!Number.isSafeInteger(chainId) || chainId < 0) throw new Error('Cart chainId must be a safe non-negative integer.');
    return chainId.toString();
  }
  if (chainId < 0n) throw new Error('Cart chainId must be a non-negative integer.');
  return chainId.toString();
}

function normalizeFulfillmentKind(value: number): CartFulfillmentKind {
  if (!Number.isInteger(value) || value < 0 || value > 6) {
    throw new Error(`Rare API returned an invalid Cart fulfillment kind: ${String(value)}`);
  }
  return value as CartFulfillmentKind;
}

function normalizeListing(value: CartListingPreviewWire['listings'][number]): CartListing {
  return {
    ...value,
    seller: getAddress(value.seller),
    fulfillmentKind: normalizeFulfillmentKind(value.fulfillmentKind),
    tokenContract: getAddress(value.tokenContract),
    tokenId: BigInt(value.tokenId),
    settlementCurrency: getAddress(value.settlementCurrency),
    minimumUnitPrice: BigInt(value.minimumUnitPrice),
    availableQuantity: BigInt(value.availableQuantity),
    paymentRecipient: getAddress(value.paymentRecipient),
  };
}

function normalizeProduct(value: CartApiProduct): CartApiProduct {
  return { ...value, variants: value.variants.map((variant) => ({ ...variant })) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
