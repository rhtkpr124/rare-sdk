import { getAddress, isAddress, isHex } from 'viem';
import type { CartListing, CartFulfillmentKind } from './types/cart.js';
import type { PrintListingPreparation } from './types/prints.js';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hex = (value: unknown) => {
  if (typeof value !== 'string' || !isHex(value) || value.length !== 66) throw new Error('Print preparation contains an invalid digest.');
  return value;
};
const address = (value: unknown) => {
  if (typeof value !== 'string' || !isAddress(value)) throw new Error('Print preparation contains an invalid address.');
  return getAddress(value);
};
const integer = (value: unknown): bigint => {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value) || BigInt(value) >= 2n ** 256n) throw new Error('Print preparation contains an invalid integer.');
  return BigInt(value);
};
const fulfillmentKind = (value: unknown): CartFulfillmentKind => {
  if (value === 1 || value === 2 || value === 3 || value === 5) return value;
  throw new Error('Print preparation contains an unsupported fulfillment kind.');
};

/** Validate server-owned frozen terms before asking the wallet to sign them. */
export function parsePrintListingTerms(preparation: PrintListingPreparation): { listing: CartListing; deadline: bigint } {
  const snapshot: unknown = preparation.snapshot;
  if (!record(snapshot) || !record(snapshot.configured) || !record(snapshot.configured.listing) || !record(snapshot.intent)) {
    throw new Error('Print preparation does not contain frozen Listing terms.');
  }
  const value = snapshot.configured.listing;
  return { deadline: integer(snapshot.intent.deadline), listing: {
    listingSalt: hex(value.listingSalt), seller: address(value.seller), sku: hex(value.sku),
    fulfillmentKind: fulfillmentKind(value.fulfillmentKind), tokenContract: address(value.tokenContract),
    tokenId: integer(value.tokenId), settlementCurrency: address(value.settlementCurrency),
    minimumUnitPrice: integer(value.minimumUnitPrice), availableQuantity: integer(value.availableQuantity),
    paymentRecipient: address(value.paymentRecipient),
  } };
}
