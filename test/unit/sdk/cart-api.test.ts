import { describe, expect, it } from 'vitest';
import { zeroAddress } from 'viem';
import { createCartApiNamespace } from '../../../src/sdk/cart-api.js';

describe('Cart rare-api namespace', () => {
  it('serializes chain-bound Cart inputs and normalizes PreparedPurchase wire values', async () => {
    const requests: Array<{ url: string; method: string; body?: unknown; headers: Headers }> = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init);
      const url = request.url;
      const requestBody = await request.clone().text();
      const body = requestBody === '' ? undefined : JSON.parse(requestBody);
      requests.push({ url, method: request.method, body, headers: request.headers });
      if (url.endsWith('/v1/cart/products') && request.method === 'POST') {
        return jsonResponse({ data: {
          id: '1', slug: 'test', metadata: {}, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        } });
      }
      if (url.includes('/v1/cart/checkout/prepare')) {
        return jsonResponse({ data: preparedPurchaseWire });
      }
      return jsonResponse({ data: {} });
    };
    const api = createCartApiNamespace(
      { baseUrl: 'https://rare-api.example', fetch },
      { chainId: 11_155_111n, cartAddress: '0x0000000000000000000000000000000000000001' },
    );

    await expect(api.catalog.products.create({ metadata: { source: 'test' } })).resolves.toMatchObject({ id: '1' });
    const prepared = await api.checkout.prepareOrder({
      paymentCurrency: zeroAddress,
      items: [{ listingDigest: bytes32('1'), quantity: 2n, recipient: zeroAddress }],
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    });

    expect(requests[0]).toMatchObject({
      url: 'https://rare-api.example/v1/cart/products',
      method: 'POST',
      body: { metadata: { source: 'test' } },
    });
    const checkoutRequest = requests.find((request) => request.url.includes('/checkout/prepare'))!;
    expect(checkoutRequest.body).toEqual({
      paymentCurrency: zeroAddress,
      items: [{ listingDigest: bytes32('1'), quantity: '2', recipient: zeroAddress }],
    });
    expect(checkoutRequest.headers.get('idempotency-key')).toBe('00000000-0000-4000-8000-000000000001');
    expect(prepared.chainId).toBe(11_155_111n);
    expect(prepared.executePurchase.order.deadline).toBe(2_000_000_000n);
    expect(prepared.executePurchase.lines).toEqual([]);
  });
});

const preparedPurchaseWire = {
  schemaVersion: 1 as const,
  chainId: '11155111',
  cartAddress: '0x0000000000000000000000000000000000000001',
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  preparedAt: '2026-01-01T00:00:00.000Z',
  executePurchase: {
    order: {
      orderId: bytes32('2'), paymentCurrency: zeroAddress, deadline: '2000000000', paymentAmount: '10',
      orderLinesHash: bytes32('3'), payoutRouteHash: bytes32('4'), fulfillmentActionsHash: bytes32('5'),
    },
    lines: [],
    listings: [],
    authorization: { listingRoots: [], listingRootSignatures: [], listingRootIndexes: [], listingProofs: [] },
    route: { commands: '0x', inputs: [] },
    actions: [],
    platformSignature: '0x',
  },
};

function bytes32(value: string): `0x${string}` {
  return `0x${value.repeat(64).slice(0, 64)}`;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}
