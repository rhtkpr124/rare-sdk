import { getAddress, isAddress, isHex } from 'viem';
import type { CartListing, CartFulfillmentKind } from './types/cart.js';
import type { PreparePrintListing, PrintListingPreparation } from './types/prints.js';

export function validatePrintListingQuantityLimit(input: PreparePrintListing): { valid: true } | { valid: false; message: string } {
  const quantity = input.maxQuantityPerCheckout ?? '1';
  if (typeof quantity !== 'string' || !/^[1-9][0-9]*$/u.test(quantity) || quantity.length > 4 || BigInt(quantity) > 1000n) {
    return { valid: false, message: 'Print checkout quantity limits must be positive integer strings from 1 to 1000.' };
  }
  if (input.fulfillmentKind === 2 && quantity !== '1') {
    return { valid: false, message: 'An ERC-721 transfer print Listing can allow only one copy per checkout.' };
  }
  return { valid: true };
}

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
export function parsePrintListingTerms(preparation: PrintListingPreparation): { listing: CartListing; deadline: bigint; dropId: string } {
  const snapshot: unknown = preparation.snapshot;
  if (!record(snapshot) || !record(snapshot.configured) || !record(snapshot.configured.listing) || !record(snapshot.intent)) {
    throw new Error('Print preparation does not contain frozen Listing terms.');
  }
  if (typeof snapshot.dropId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(snapshot.dropId)) {
    throw new Error('Print preparation does not identify its owned drop.');
  }
  const value = snapshot.configured.listing;
  return { dropId: snapshot.dropId, deadline: integer(snapshot.intent.deadline), listing: {
    listingSalt: hex(value.listingSalt), seller: address(value.seller), sku: hex(value.sku),
    fulfillmentKind: fulfillmentKind(value.fulfillmentKind), tokenContract: address(value.tokenContract),
    tokenId: integer(value.tokenId), settlementCurrency: address(value.settlementCurrency),
    minimumUnitPrice: integer(value.minimumUnitPrice), availableQuantity: integer(value.availableQuantity),
    paymentRecipient: address(value.paymentRecipient),
  } };
}
