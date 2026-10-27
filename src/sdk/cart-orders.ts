import type { ApiClient } from '../data-access/client.js';
import type { CartOrdersNamespace } from './types/orders.js';

/** Order history uses the account transport and does not require a chain client. */
export function createCartOrdersNamespace(client: ApiClient): CartOrdersNamespace {
  return {
    async list(input = {}, options = {}) {
      const result = await client.GET('/v1/account/orders', { params: { query: input }, signal: options.signal });
      if (result.data === undefined) throw new Error('Rare API did not return Cart Orders.');
      return result.data;
    },
    async get(id, options = {}) {
      const result = await client.GET('/v1/account/orders/{id}', { params: { path: { id } }, signal: options.signal });
      if (result.data === undefined) throw new Error('Rare API did not return the Cart Order.');
      return result.data.data;
    },
  };
}
