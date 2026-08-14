/* eslint-disable no-restricted-syntax, @typescript-eslint/explicit-function-return-type */
import { describe, expect, it, vi } from 'vitest';
import { keccak256, toBytes, type Address, zeroAddress } from 'viem';
import { createCollectionMint } from '../../../src/sdk/mint.js';

const accountAddress = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
const receiverAddress = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' as Address;
const collectionAddress = '0x1111111111111111111111111111111111111111' as Address;
const unrelatedTokenAddress = '0x2222222222222222222222222222222222222222' as Address;
const txHash = `0x${'1'.repeat(64)}` as const;
const transferTopic = keccak256(toBytes('Transfer(address,address,uint256)'));

function indexedAddress(address: Address) {
  return `0x${address.slice(2).padStart(64, '0')}` as const;
}

function indexedUint(value: bigint) {
  return `0x${value.toString(16).padStart(64, '0')}` as const;
}

function transferLog(address: Address, args: { from: Address; to: Address; tokenId: bigint }) {
  return {
    address,
    data: '0x',
    topics: [
      transferTopic,
      indexedAddress(args.from),
      indexedAddress(args.to),
      indexedUint(args.tokenId),
    ],
  };
}

describe('collection mint SDK', () => {
  it('returns the token ID from the matching collection mint Transfer log', async () => {
    const receipt = {
      logs: [
        transferLog(unrelatedTokenAddress, {
          from: accountAddress,
          to: receiverAddress,
          tokenId: 999n,
        }),
        transferLog(collectionAddress, {
          from: zeroAddress,
          to: receiverAddress,
          tokenId: 123n,
        }),
      ],
    };
    const mint = createCollectionMint(
      {
        waitForTransactionReceipt: vi.fn(async () => receipt),
      } as never,
      {
        walletClient: {
          account: { address: accountAddress },
          writeContract: vi.fn(async () => txHash),
        },
      } as never,
    );

    const result = await mint({
      contract: collectionAddress,
      tokenUri: 'ipfs://metadata',
      to: receiverAddress,
    });

    expect(result.tokenId).toBe(123n);
  });
});
