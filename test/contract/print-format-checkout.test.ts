import { createServer } from 'node:http';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createPublicClient, http, zeroAddress, type Hex } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../dist/sdk/index.js';
import type { CartApiPreparedPurchaseWire, CartCheckoutIntent, CartPrintOptionSelection } from '../../dist/sdk/index.js';
import { getContractAddresses } from '../../src/contracts/addresses.js';

const preparationId = '11111111-1111-4111-8111-111111111111';
const optionId = '22222222-2222-4222-8222-222222222222';
const changedOptionId = '33333333-3333-4333-8333-333333333333';
const digest: Hex = `0x${'1'.repeat(64)}`;
const sku: Hex = `0x${'2'.repeat(64)}`;
const emptyHash: Hex = `0x${'0'.repeat(64)}`;

describe('collector format selection through generic Cart checkout', () => {
  it('retains the reviewed selection and idempotency key through authorization, recovery, and card checkout', async () => {
    const cart = getContractAddresses('sepolia').cart;
    if (cart === undefined) throw new Error('Missing Cart contract');
    const deadline = String(Math.floor(Date.now() / 1000) + 3600);
    const wire: CartApiPreparedPurchaseWire = { schemaVersion: 1, chainId: '11155111', cartAddress: cart, preparedAt: new Date().toISOString(),
      executePurchase: {
        order: { orderId: digest, paymentCurrency: zeroAddress, deadline, paymentAmount: '100', orderLinesHash: emptyHash, payoutRouteHash: emptyHash, fulfillmentActionsHash: emptyHash },
        lines: [{ sku, listingDigest: digest, fulfillmentKind: 1, quantity: '1', settlementCurrency: zeroAddress, amount: '100', paymentRecipient: cart }],
        listings: [], authorization: { listingRoots: [], listingRootSignatures: [], listingRootIndexes: [], listingProofs: [] },
        route: { commands: '0x', inputs: [], routerValue: '0' }, actions: [], platformSignature: '0x12',
      },
    };
    const requests: { path: string; idempotencyKey?: string; body: unknown }[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const path = new URL(request.url ?? '', 'http://example.test').pathname;
      const key = request.headers['idempotency-key'];
      requests.push({ path, idempotencyKey: typeof key === 'string' ? key : undefined, body: JSON.parse(Buffer.concat(chunks).toString()) });
      const data = path.endsWith('/preview') ? { preparationReference: 'reviewed-preparation', preparation: wire }
        : path.endsWith('/coinflow') ? { checkoutJwtToken: 'fixture-jwt', sessionKey: 'fixture-session', config: { merchantId: 'fixture', env: 'sandbox' }, preparedPurchase: wire }
        : wire;
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ data }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing HTTP address');
    const origin = `http://127.0.0.1:${address.port}`;
    const rare = createRareClient({ publicClient: createPublicClient({ chain: sepolia, transport: http('http://127.0.0.1:1') }),
      transport: (path, init) => fetch(`${origin}${path}`, init) });
    const selections: CartPrintOptionSelection[] = [{ preparationId, optionId }];
    const delivery = { savedAddressId: preparationId };
    const intent: CartCheckoutIntent = { paymentCurrency: zeroAddress, items: [{ kind: 'listing', listingDigest: digest, quantity: 1n }], delivery, optionSelections: selections };
    try {
      const reviewed = await rare.cart.checkout.prepare(intent);
      const selection = selections[0];
      if (selection === undefined || reviewed.idempotencyKey === undefined) throw new Error('Missing review identity');
      selection.optionId = changedOptionId;
      expect(reviewed.intent.optionSelections).toEqual([{ preparationId, optionId }]);
      await rare.cart.checkout.authorize(reviewed);
      const saved = { ...reviewed.intent, delivery, idempotencyKey: reviewed.idempotencyKey };
      await rare.cart.checkout.authorize(saved);
      await rare.cart.checkout.coinflow(saved);
      expect(requests.map(request => request.path)).toEqual([
        '/v1/cart/checkout/preview', '/v1/cart/checkout/prepare', '/v1/cart/checkout/prepare', '/v1/cart/checkout/coinflow',
      ]);
      for (const request of requests) expect(request.body).toMatchObject({ optionSelections: [{ preparationId, optionId }], delivery });
      expect(requests.slice(1).every(request => request.idempotencyKey === reviewed.idempotencyKey)).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('rejects ambiguous selections and selections without delivery before any HTTP request', async () => {
    const rare = createRareClient({ apiBaseUrl: 'http://127.0.0.1:1', publicClient: createPublicClient({ chain: sepolia, transport: http('http://127.0.0.1:1') }) });
    const intent: CartCheckoutIntent = { paymentCurrency: zeroAddress, items: [{ kind: 'listing', listingDigest: digest, quantity: 1n }],
      delivery: { savedAddressId: preparationId }, optionSelections: [{ preparationId, optionId }, { preparationId, optionId: changedOptionId }] };
    expect(() => rare.cart.checkout.prepare(intent)).toThrow('intent is invalid');
    await expect(rare.cart.checkout.authorize({ ...intent, delivery: { savedAddressId: preparationId }, idempotencyKey: preparationId })).rejects.toThrow('saved checkout draft is invalid');
    await expect(rare.cart.checkout.coinflow({ ...intent, delivery: { savedAddressId: preparationId }, idempotencyKey: preparationId })).rejects.toThrow('one print format');
    expect(() => rare.cart.checkout.prepare({ ...intent, delivery: undefined, optionSelections: [{ preparationId, optionId }] })).toThrow('intent is invalid');
  });
});
