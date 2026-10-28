import type { CartOrder, CartOrdersNamespace } from '../../src/sdk/types/orders.js';

/** Shared test accounts can have older orders on earlier pages. */
export async function findCartOrderInHistory(orders: CartOrdersNamespace, id: string, pageNumber = 1): Promise<CartOrder | undefined> {
  if (pageNumber > 100) throw new Error('Order history exceeded 100 test-account pages.');
  const page = await orders.list({ page: pageNumber, perPage: 100 });
  const order = page.data.find(candidate => candidate.id === id);
  if (order !== undefined || pageNumber >= page.pagination.totalPages) return order;
  return findCartOrderInHistory(orders, id, pageNumber + 1);
}
