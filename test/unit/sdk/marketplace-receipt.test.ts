/* eslint-disable no-restricted-syntax, @typescript-eslint/explicit-function-return-type */
import { describe, expect, it, vi } from 'vitest';
import { type Address, type Hash, type PublicClient, type TransactionReceipt, type WalletClient } from 'viem';
import { createRareClient } from '../../../src/sdk/client.js';

const accountAddress = '0x1000000000000000000000000000000000000000' as Address;
const contract = '0x2000000000000000000000000000000000000000' as Address;
const marketplaceSettings = '0x3000000000000000000000000000000000000000' as Address;
const txHash: Hash = `0x${'12'.repeat(32)}`;
const revertedReceipt = {
  status: 'reverted',
  blockNumber: 123n,
  logs: [],
} as unknown as TransactionReceipt;

describe('marketplace SDK write receipt handling', () => {
  it.each([
    ['listing.create', 'listing create', (rare: ReturnType<typeof createRareClient>) =>
      rare.listing.create({ contract, tokenId: 1n, price: 1n })],
    ['listing.cancel', 'listing cancel', (rare: ReturnType<typeof createRareClient>) =>
      rare.listing.cancel({ contract, tokenId: 1n })],
    ['listing.buy', 'listing buy', (rare: ReturnType<typeof createRareClient>) =>
      rare.listing.buy({ contract, tokenId: 1n, price: 1n })],
    ['auction.create', 'auction create', (rare: ReturnType<typeof createRareClient>) =>
      rare.auction.create({
        contract,
        tokenId: 1n,
        price: 1n,
        endTime: BigInt(Math.floor(Date.now() / 1000) + 86_400),
      })],
    ['auction.bid', 'auction bid', (rare: ReturnType<typeof createRareClient>) =>
      rare.auction.bid({ contract, tokenId: 1n, price: 1n })],
    ['auction.settle', 'auction settle', (rare: ReturnType<typeof createRareClient>) =>
      rare.auction.settle({ contract, tokenId: 1n })],
    ['auction.cancel', 'auction cancel', (rare: ReturnType<typeof createRareClient>) =>
      rare.auction.cancel({ contract, tokenId: 1n })],
  ])('rejects a reverted %s receipt before returning success', async (_method, operation, run) => {
    const publicClient = makePublicClient();
    const walletClient = makeWalletClient();
    const rare = createRareClient({ publicClient, walletClient });

    await expect(run(rare)).rejects.toThrow(
      `${operation} transaction was confirmed with status "reverted". Transaction hash: ${txHash}.`,
    );
    expect(walletClient.writeContract).toHaveBeenCalled();
    expect(publicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: txHash });
  });
});

function makePublicClient(): PublicClient {
  const readContract = vi.fn(async (params: { functionName: string }): Promise<unknown> => {
    if (params.functionName === 'isApprovedForAll') return true;
    if (params.functionName === 'COLDIE_AUCTION') return `0x${'00'.repeat(32)}`;
    if (params.functionName === 'SCHEDULED_AUCTION') return `0x${'01'.repeat(32)}`;
    if (params.functionName === 'marketplaceSettings') return marketplaceSettings;
    if (params.functionName === 'calculateMarketplaceFee') return 0n;
    throw new Error(`unexpected readContract ${params.functionName}`);
  });

  const waitForTransactionReceipt = vi.fn(async (): Promise<TransactionReceipt> => revertedReceipt);

  return {
    chain: { id: 11155111 },
    readContract,
    waitForTransactionReceipt,
  } as unknown as PublicClient;
}

function makeWalletClient(): WalletClient & {
  writeContract: ReturnType<typeof vi.fn<() => Promise<Hash>>>;
} {
  const writeContract = vi.fn(async (): Promise<Hash> => txHash);

  return {
    account: { address: accountAddress },
    writeContract,
  } as unknown as WalletClient & {
    writeContract: ReturnType<typeof vi.fn<() => Promise<Hash>>>;
  };
}
