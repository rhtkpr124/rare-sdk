import type { CartFeesNamespace } from "./cart-fees-core.js";
import {
  planCartFeeCreate,
  parseCartFee,
  parseCartFeePage,
  planCartFeeList,
  parseCartFeeId,
  parseCartFeeDisabled,
} from "./cart-fees-core.js";
type Transport = {
  GET: (path: string, options?: unknown) => Promise<{ data?: unknown }>;
  POST: (path: string, options?: unknown) => Promise<{ data?: unknown }>;
  DELETE: (path: string, options?: unknown) => Promise<{ data?: unknown }>;
};
const wrapped = (input: unknown): unknown => {
  if (input === null || typeof input !== "object" || !("data" in input))
    throw new Error("Rare API did not return the fee operation result.");
  return input.data;
};
export const createCartFeesNamespace = (
  transport: Transport,
): CartFeesNamespace => ({
  async create(input, options) {
    const plan = planCartFeeCreate(input);
    if (!plan.ok) throw new Error(plan.message);
    const response = await transport.POST("/v1/cart/fees", {
      body: plan.value,
      signal: options?.signal,
    });
    return parseCartFee(wrapped(response.data));
  },
  async list(input = {}, options) {
    const query = planCartFeeList(input);
    const response = await transport.GET("/v1/cart/fees", {
      params: { query },
      signal: options?.signal,
    });
    const page = parseCartFeePage(response.data);
    return {
      data: page.data,
      pagination: {
        page: query.page,
        perPage: query.perPage,
        hasNextPage: page.hasNextPage,
      },
    };
  },
  async disable(input, options) {
    const id = parseCartFeeId(input);
    const response = await transport.DELETE(`/v1/cart/fees/${id}`, {
      signal: options?.signal,
    });
    return parseCartFeeDisabled(wrapped(response.data));
  },
});
