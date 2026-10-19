import type { PublicClient, WalletClient } from 'viem';
import { createWalletClientWithCallsFallback } from './transaction-fallback-shell.js';

/**
 * Applies the SDK's wallet compatibility handling to direct viem writes.
 *
 * Use this for writes outside RareClient namespaces. createRareClient already
 * applies the same handling, so pass the original wallet client to that factory.
 * Ordinary wallet errors, including rejection, are propagated without retry.
 */
export function createRareWalletClient<Wallet extends WalletClient>(params: {
  readonly publicClient: PublicClient;
  readonly walletClient: Wallet;
}): Wallet {
  return createWalletClientWithCallsFallback(params.publicClient, params.walletClient);
}
