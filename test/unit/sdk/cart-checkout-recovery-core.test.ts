import { describe, expect, it } from 'vitest';
import { zeroAddress, type Hex } from 'viem';
import { validateCartCheckoutRecovery } from '../../../src/sdk/cart-checkout-recovery-core.js';
import type { CartApiPreparedPurchase } from '../../../src/sdk/types/cart-api.js';

const orderId: Hex = `0x${'1'.repeat(64)}`;
const scope = { chainId: 11155111n, cart: zeroAddress };
const prepared: CartApiPreparedPurchase = {
  schemaVersion: 1, chainId: scope.chainId, cartAddress: scope.cart,
  preparedAt: '2026-10-20T00:00:00.000Z',
  executePurchase: {
    order: { orderId, paymentCurrency: zeroAddress, deadline: 1n, paymentAmount: 100n,
      orderLinesHash: orderId, payoutRouteHash: orderId, fulfillmentActionsHash: orderId },
    lines: [], listings: [], actions: [],
    authorization: { listingRoots: [], listingRootSignatures: [], listingRootIndexes: [], listingProofs: [] },
    route: { commands: '0x', inputs: [], routerValue: 0n },
    platformSignature: `0x${'1'.repeat(130)}`,
  },
};

describe('saved checkout recovery validation', () => {
  it('keeps unknown and pending outcomes distinct from a confirmed unsigned failure', () => {
    expect(validateCartCheckoutRecovery({ status: 'UNKNOWN' }, scope)).toEqual({ isValid: true });
    expect(validateCartCheckoutRecovery({ status: 'PREPARING', orderId }, scope)).toEqual({ isValid: true });
    expect(validateCartCheckoutRecovery({ status: 'PREPARATION_FAILED', orderId }, scope)).toEqual({ isValid: true });
    expect(validateCartCheckoutRecovery({ status: 'PREPARATION_FAILED' }, scope).isValid).toBe(false);
    expect(validateCartCheckoutRecovery({ status: 'UNKNOWN', orderId }, scope).isValid).toBe(false);
  });

  it('rejects unsigned failure evidence that also includes a payment authorization', () => {
    expect(validateCartCheckoutRecovery({ status: 'PREPARATION_FAILED', orderId, preparedPurchase: prepared }, scope).isValid).toBe(false);
    expect(validateCartCheckoutRecovery({ status: 'PREPARING', orderId, preparedPurchase: prepared }, scope).isValid).toBe(false);
  });

  it('retains signed authorizations even after expiration for reconciliation', () => {
    for (const status of ['READY', 'EXECUTED', 'EXPIRED'] as const) {
      expect(validateCartCheckoutRecovery({ status, orderId, preparedPurchase: prepared }, scope)).toEqual({ isValid: true });
      expect(validateCartCheckoutRecovery({ status, orderId }, scope).isValid).toBe(false);
    }
  });

  it('rejects a different chain, Cart, or Order ID', () => {
    const recovery = { status: 'READY' as const, orderId, preparedPurchase: prepared };
    expect(validateCartCheckoutRecovery(recovery, { ...scope, chainId: 1n }).isValid).toBe(false);
    expect(validateCartCheckoutRecovery(recovery, { ...scope, cart: '0x1000000000000000000000000000000000000000' }).isValid).toBe(false);
    expect(validateCartCheckoutRecovery({ ...recovery, orderId: `0x${'2'.repeat(64)}` }, scope).isValid).toBe(false);
    expect(validateCartCheckoutRecovery({ status: 'PREPARATION_FAILED', orderId: '0x12' }, scope).isValid).toBe(false);
  });

  it('rejects a signed state without a complete signature', () => {
    expect(validateCartCheckoutRecovery({ status: 'READY', orderId, preparedPurchase: {
      ...prepared, executePurchase: { ...prepared.executePurchase, platformSignature: '0x' },
    } }, scope).isValid).toBe(false);
  });
});
