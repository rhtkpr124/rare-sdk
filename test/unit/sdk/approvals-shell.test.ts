/* eslint-disable no-restricted-syntax */
import { describe, expect, it } from 'vitest';
import type { Address, Hash } from 'viem';
import {
  runWithApprovalSideEffectAlert,
} from '../../../src/sdk/approvals-shell.js';
import type { ApprovalSideEffectError } from '../../../src/sdk/approvals-shell.js';

const token = '0x1000000000000000000000000000000000000000' as Address;
const spender = '0x2000000000000000000000000000000000000000' as Address;
const approvalTxHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Hash;

describe('approval side effect alerting', () => {
  it('rethrows the original failure when no approval was mined', async () => {
    const cause = new Error('target failed');

    await expect(runWithApprovalSideEffectAlert({
      operation: 'listing buy',
      approvals: [{
        type: 'erc20',
        approvalTxHash: undefined,
        target: token,
        spender,
      }],
      async run(): Promise<never> {
        throw cause;
      },
    })).rejects.toBe(cause);
  });

  it('wraps target failures after a mined approval with approval details', async () => {
    const cause = new Error('target failed');

    await expect(runWithApprovalSideEffectAlert({
      operation: 'listing buy',
      approvals: [{
        type: 'erc20',
        approvalTxHash,
        target: token,
        spender,
      }],
      async run(): Promise<never> {
        throw cause;
      },
    })).rejects.toMatchObject({
      name: 'ApprovalSideEffectError',
      operation: 'listing buy',
      approvals: [{
        type: 'erc20',
        approvalTxHash,
        target: token,
        spender,
      }],
      cause,
    } satisfies Partial<ApprovalSideEffectError>);
  });
});
