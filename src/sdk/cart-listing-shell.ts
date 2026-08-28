import { bytesToHex, zeroHash, type Hex } from 'viem';
import type { CartListing, CartListingInput } from './types/cart.js';

export function generateCartListingSalt(): Hex {
  const salt = bytesToHex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
  return salt === zeroHash ? generateCartListingSalt() : salt;
}

export function addCartListingSalt(listing: CartListingInput): CartListing {
  return {
    ...listing,
    listingSalt: listing.listingSalt ?? generateCartListingSalt(),
  };
}
