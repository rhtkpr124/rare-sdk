import type { paths } from '../../data-access/commerce-schema.js';
import type { RareAuthRequestOptions } from './account.js';

export type CartOrder = paths['/v1/account/orders/{id}']['get']['responses'][200]['content']['application/json']['data'];
export type AccountCheckoutRecoveryWire = paths['/v1/account/orders/checkout/{idempotencyKey}']['get']['responses'][200]['content']['application/json']['data'];
export type CartOrdersPage = paths['/v1/account/orders']['get']['responses'][200]['content']['application/json'];
export type CartOrdersNamespace = {
  /** Lists account-owned Cart orders, including NFT, print, swap and mixed purchases. */
  list: (input?: { after?: string; take?: number }, options?: RareAuthRequestOptions) => Promise<CartOrdersPage>;
  /** COMPLETED fulfillment means provider acceptance, not shipment or delivery. */
  get: (id: string, options?: RareAuthRequestOptions) => Promise<CartOrder>;
};
