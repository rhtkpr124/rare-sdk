import { isAddressEqual, isHex, type Address } from 'viem';
import type { CartCheckoutRecovery } from './types/cart-api.js';

/** Validates an account-owned saved preparation; it never authorizes a replacement payment. */
export function validateCartCheckoutRecovery(
  value: CartCheckoutRecovery,
  scope: { chainId: bigint; cart: Address },
): { isValid: true } | { isValid: false; message: string } {
  const invalid = (message: string) => ({ isValid: false as const, message });
  if (value.orderId !== undefined && (!isHex(value.orderId) || value.orderId.length !== 66)) {
    return invalid('Rare API returned an invalid Order ID.');
  }
  switch (value.status) {
    case 'UNKNOWN':
      return value.orderId === undefined && value.preparedPurchase === undefined
        ? { isValid: true } : invalid('An unknown checkout cannot include a saved Order.');
    case 'PREPARING':
    case 'PREPARATION_FAILED':
      return value.orderId !== undefined && value.preparedPurchase === undefined
        ? { isValid: true } : invalid('The unsigned checkout status contradicts its saved Order.');
    case 'READY':
    case 'EXECUTED':
    case 'EXPIRED': {
      const prepared = value.preparedPurchase;
      if (value.orderId === undefined || prepared === undefined) {
        return invalid('The signed checkout status is missing its saved Order.');
      }
      if (prepared.chainId !== scope.chainId || !isAddressEqual(prepared.cartAddress, scope.cart) ||
        prepared.executePurchase.order.orderId.toLowerCase() !== value.orderId.toLowerCase()) {
        return invalid('The saved checkout does not match this Cart scope.');
      }
      const signature = prepared.executePurchase.platformSignature;
      return isHex(signature) && signature.length === 132
        ? { isValid: true } : invalid('The saved checkout is missing its platform signature.');
    }
    default:
      return invalid('Rare API returned an invalid checkout recovery status.');
  }
}
