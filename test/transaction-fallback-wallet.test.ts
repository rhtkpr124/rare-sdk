import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { base } from 'viem/chains';
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  type PublicClient,
  type WalletClient,
} from 'viem';

const walletActions = vi.hoisted(() => ({
  sendCalls: vi.fn(),
  waitForCallsStatus: vi.fn(),
}));

vi.mock('viem/actions', async (importOriginal) => ({
  ...await importOriginal<typeof import('viem/actions')>(),
  ...walletActions,
}));

import { createRareWalletClient } from '../src/sdk/wallet.js';

const createWalletClientWithCallsFallback = <Wallet extends WalletClient>(
  publicClient: PublicClient,
  walletClient: Wallet,
): Wallet => createRareWalletClient({ publicClient, walletClient });

const contractAddress = '0x0000000000000000000000000000000000000001';
const account = '0x0000000000000000000000000000000000000002';
const transactionHash = `0x${'1'.repeat(64)}` as const;
const approvalAbi = [{
  type: 'function',
  name: 'approve',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [],
}] as const;
const payableAbi = [{
  type: 'function',
  name: 'buy',
  stateMutability: 'payable',
  inputs: [],
  outputs: [],
}] as const;

describe('createWalletClientWithCallsFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes the original contract request and returns the bundle receipt hash', async () => {
    const writeContract = vi.fn().mockRejectedValue(
      new Error('Cannot convert eip155:8453 to a BigInt'),
    );
    const originalWallet = {
      writeContract,
      marker: 'preserved',
    } as unknown as WalletClient;
    walletActions.sendCalls.mockResolvedValue({ id: 'bundle-id' });
    walletActions.waitForCallsStatus.mockResolvedValue({
      receipts: [{ transactionHash }],
      status: 200,
    });

    const wallet = createWalletClientWithCallsFallback(
      { chain: base } as unknown as PublicClient,
      originalWallet,
    );
    const result = await wallet.writeContract({
      address: contractAddress,
      abi: approvalAbi,
      functionName: 'approve',
      args: [account, 42n],
      account,
      chain: undefined,
    });

    expect(result).toBe(transactionHash);
    expect(writeContract).toHaveBeenCalledOnce();
    expect(walletActions.sendCalls).toHaveBeenCalledWith(expect.anything(), {
      account,
      chain: base,
      calls: [{
        to: contractAddress,
        data: `0x095ea7b30000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000002a`,
        value: undefined,
      }],
    });
    expect(walletActions.waitForCallsStatus).toHaveBeenCalledWith(originalWallet, {
      id: 'bundle-id',
      throwOnFailure: true,
    });
    expect(Reflect.get(wallet, 'marker')).toBe('preserved');
  });

  it('reports the missing-chain precondition only after the matching failure', async () => {
    const originalError = new Error('Cannot convert eip155:8453 to a BigInt');
    const wallet = createWalletClientWithCallsFallback(
      { chain: undefined } as PublicClient,
      { writeContract: vi.fn().mockRejectedValue(originalError) } as unknown as WalletClient,
    );

    const result = wallet.writeContract({
      address: contractAddress,
      abi: approvalAbi,
      functionName: 'approve',
      args: [account, 42n],
      account,
      chain: undefined,
    });
    await expect(result).rejects.toThrow(
      'The Reown social-wallet fallback requires a public client with an explicit chain.',
    );
    await expect(result).rejects.toMatchObject({ cause: originalError });
    expect(walletActions.sendCalls).not.toHaveBeenCalled();
  });

  it('covers the SDK known-calldata sendTransaction path and preserves value', async () => {
    const sendTransaction = vi.fn().mockRejectedValue(
      new Error('Cannot convert eip155:8453 to a BigInt'),
    );
    const originalWallet = {
      sendTransaction,
      dataSuffix: '0xffff',
    } as unknown as WalletClient;
    walletActions.sendCalls.mockResolvedValue({ id: 'bundle-id' });
    walletActions.waitForCallsStatus.mockResolvedValue({
      receipts: [{ transactionHash }],
      status: 200,
    });
    const wallet = createWalletClientWithCallsFallback(
      { chain: base } as unknown as PublicClient,
      originalWallet,
    );

    await expect(wallet.sendTransaction({
      account,
      chain: undefined,
      to: contractAddress,
      data: '0x1234',
      dataSuffix: '0xabcd',
      value: 42n,
    })).resolves.toBe(transactionHash);
    expect(walletActions.sendCalls).toHaveBeenCalledWith(expect.anything(), {
      account,
      chain: base,
      calls: [{
        to: contractAddress,
        data: '0x1234abcd',
        value: 42n,
      }],
    });
    const callsWalletClient = walletActions.sendCalls.mock.calls[0]?.[0];
    expect(callsWalletClient).not.toBe(originalWallet);
    expect(callsWalletClient?.dataSuffix).toBeUndefined();
  });

  it('preserves payable writeContract value and request-over-client suffix precedence', async () => {
    const writeContract = vi.fn().mockRejectedValue(
      new Error('Cannot convert eip155:8453 to a BigInt'),
    );
    const originalWallet = {
      writeContract,
      dataSuffix: { value: '0xffff', required: true },
    } as unknown as WalletClient;
    walletActions.sendCalls.mockResolvedValue({ id: 'bundle-id' });
    walletActions.waitForCallsStatus.mockResolvedValue({
      receipts: [{ transactionHash }],
      status: 200,
    });
    const wallet = createWalletClientWithCallsFallback(
      { chain: base } as unknown as PublicClient,
      originalWallet,
    );

    await expect(wallet.writeContract({
      account,
      address: contractAddress,
      abi: payableAbi,
      functionName: 'buy',
      value: 42n,
      dataSuffix: '0xabcd',
      chain: undefined,
    })).resolves.toBe(transactionHash);
    expect(walletActions.sendCalls).toHaveBeenCalledWith(expect.anything(), {
      account,
      chain: base,
      calls: [{
        to: contractAddress,
        data: `${encodeFunctionData({ abi: payableAbi, functionName: 'buy' })}abcd`,
        value: 42n,
      }],
    });
    const callsWalletClient = walletActions.sendCalls.mock.calls[0]?.[0];
    expect(callsWalletClient?.dataSuffix).toBeUndefined();
  });

  it('applies the client suffix once when sendTransaction has no request override', async () => {
    const sendTransaction = vi.fn().mockRejectedValue(
      new Error('Cannot convert eip155:8453 to a BigInt'),
    );
    const originalWallet = {
      sendTransaction,
      dataSuffix: '0xabcd',
    } as unknown as WalletClient;
    walletActions.sendCalls.mockResolvedValue({ id: 'bundle-id' });
    walletActions.waitForCallsStatus.mockResolvedValue({
      receipts: [{ transactionHash }],
      status: 200,
    });
    const wallet = createWalletClientWithCallsFallback(
      { chain: base } as unknown as PublicClient,
      originalWallet,
    );

    await wallet.sendTransaction({
      account,
      chain: undefined,
      to: contractAddress,
      data: '0x1234',
    });
    expect(walletActions.sendCalls).toHaveBeenCalledWith(expect.anything(), {
      account,
      chain: base,
      calls: [{
        to: contractAddress,
        data: '0x1234abcd',
        value: undefined,
      }],
    });
  });

  it('preserves a concrete wallet client type and custom extensions', () => {
    const concreteWallet = createWalletClient({
      account,
      chain: base,
      transport: custom({ request: vi.fn() }),
    }).extend(() => ({
      customAction: () => 'preserved' as const,
    }));
    const wallet = createWalletClientWithCallsFallback(
      { chain: base } as unknown as PublicClient,
      concreteWallet,
    );

    expectTypeOf(wallet).toEqualTypeOf(concreteWallet);
    expect(wallet.customAction()).toBe('preserved');
  });
});
