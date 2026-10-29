import { describe, expect, it } from 'vitest';
import { cartCatalogPage } from '../src/sdk/cart-pagination-core.js';

describe('Cart catalog pagination', () => {
  it('uses the Rare API catalog defaults when options are omitted', () => {
    expect(cartCatalogPage({ data: [], hasNextPage: false }, {}).pagination).toEqual({ page: 1, perPage: 20, hasNextPage: false });
  });
  it('preserves continuation evidence without fabricating search totals', () => {
    const result = cartCatalogPage({ data: ['item'], hasNextPage: true }, { page: 3, perPage: 1 });
    expect(result).toEqual({ data: ['item'], pagination: { page: 3, perPage: 1, hasNextPage: true } });
    expect(result.pagination).not.toHaveProperty('totalCount');
    expect(result.pagination).not.toHaveProperty('totalPages');
  });
});
