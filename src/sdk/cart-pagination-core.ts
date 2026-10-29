/** Catalog searches do not compute totals. Preserve their pagination evidence. */
export function cartCatalogPage<T>(wire: { data: T[]; hasNextPage: boolean }, input: { page?: number; perPage?: number }): { data: T[]; pagination: { page: number; perPage: number; hasNextPage: boolean } } {
  return { data: wire.data, pagination: { page: input.page ?? 1, perPage: input.perPage ?? 20, hasNextPage: wire.hasNextPage } };
}
