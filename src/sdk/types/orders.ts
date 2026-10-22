import type { paths } from '../../data-access/commerce-schema.js';
import type { RareAuthRequestOptions } from './account.js';

export type AccountOrder = paths['/v1/account/orders/{id}']['get']['responses'][200]['content']['application/json']['data'];
export type AccountCheckoutRecoveryWire = paths['/v1/account/orders/checkout/{idempotencyKey}']['get']['responses'][200]['content']['application/json']['data'];
export type AccountOrdersPage = paths['/v1/account/orders']['get']['responses'][200]['content']['application/json'];
export type AccountOrdersNamespace = {
  /** Lists Orders with account-owned fulfillment records, not legacy NFT purchases. */
  list: (input?: { after?: string; take?: number }, options?: RareAuthRequestOptions) => Promise<AccountOrdersPage>;
  /** COMPLETED fulfillment means provider acceptance, not shipment or delivery. */
  get: (id: string, options?: RareAuthRequestOptions) => Promise<AccountOrder>;
};
