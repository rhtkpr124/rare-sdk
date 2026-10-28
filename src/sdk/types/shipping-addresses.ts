import type { paths } from '../../data-access/commerce-schema.js';
import type { RareAuthRequestOptions } from './account.js';

export type SaveShippingAddress = paths['/v1/account/shipping-addresses']['put']['requestBody']['content']['application/json'];
export type ShippingAddress = paths['/v1/account/shipping-addresses']['get']['responses'][200]['content']['application/json']['data'][number];
export type ShippingDetails = ShippingAddress['details'];
export type ShippingAddressesNamespace = {
  list: (options?: RareAuthRequestOptions) => Promise<ShippingAddress[]>;
  save: (input: SaveShippingAddress, options?: RareAuthRequestOptions) => Promise<ShippingAddress>;
  delete: (id: string, options?: RareAuthRequestOptions) => Promise<void>;
};
