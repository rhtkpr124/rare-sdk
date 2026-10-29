import { describe, expect, it } from 'vitest';
import { cartCatalogPage } from '../src/sdk/cart-pagination-core.js';

describe('Cart catalog pagination', () => {
  it('preserves continuation evidence without fabricating search totals', () => {
    const result = cartCatalogPage({ data: ['item'], hasNextPage: true }, { page: 3, perPage: 1 });
    expect(result).toEqual({ data: ['item'], pagination: { page: 3, perPage: 1, hasNextPage: true } });
    expect(result.pagination).not.toHaveProperty('totalCount');
    expect(result.pagination).not.toHaveProperty('totalPages');
  });
});
