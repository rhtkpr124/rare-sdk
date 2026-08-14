/* eslint-disable no-restricted-syntax, @typescript-eslint/explicit-function-return-type */
import { describe, expect, it, vi } from 'vitest';
import type { Address } from 'viem';
import { ETH_ADDRESS } from '../../../src/contracts/addresses.js';
import { ApprovalSideEffectError } from '../../../src/sdk/approvals-shell.js';
import { createReleaseNamespace } from '../../../src/sdk/release.js';
import { buildReleaseAllowlistArtifact } from '../../../src/sdk/release-core.js';

const accountAddress = '0x0000000000000000000000000000000000000001' as Address;
const collection = '0x1000000000000000000000000000000000000000' as Address;
const customCurrency = '0x3000000000000000000000000000000000000000' as Address;
const rareMinter = '0x2000000000000000000000000000000000000000' as Address;
const auction = '0x4000000000000000000000000000000000000000' as Address;
const otherAddress = '0x5000000000000000000000000000000000000000' as Address;

function createReleaseTestNamespace(publicClient: unknown, opts: {
  apiFetch?: typeof fetch;
  writeContract?: (params: { functionName: string; args?: readonly unknown[] }) => Promise<`0x${string}`>;
} = {}) {
  return createReleaseNamespace(
    publicClient as never,
    {
      publicClient: publicClient as never,
      walletClient: {
        account: { address: accountAddress },
        writeContract: opts.writeContract ?? (async (): Promise<never> => {
          throw new Error('unexpected release write');
        }),
      } as never,
      apiFetch: opts.apiFetch,
    },
    'sepolia',
    { rareMinter, auction },
  );
}

async function expectRejectionCause(
  promise: Promise<unknown>,
  message: string,
  cause: Error,
) {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(Error);
  expect((caught as Error).message).toContain(message);
  expect((caught as Error).cause).toBe(cause);
}

describe('release namespace shell errors', () => {
  it('preserves the ERC20 decimals read failure as the wrapped cause', async () => {
    const cause = new Error('decimals rpc failed');
    const release = createReleaseTestNamespace({
      async readContract(params: { functionName: string }): Promise<never> {
        expect(params.functionName).toBe('decimals');
        throw cause;
      },
    });

    await expectRejectionCause(
      release.configure({
        contract: collection,
        currency: customCurrency,
        price: '1',
        maxMints: 1,
      }),
      `Unable to read decimals for ERC20 currency ${customCurrency}`,
      cause,
    );
  });

  it('preserves owner read and mintTo simulation failures as wrapped causes', async () => {
    const ownerCause = new Error('owner rpc failed');
    const ownerReadRelease = createReleaseTestNamespace({
      async readContract(params: { functionName: string }): Promise<unknown> {
        if (params.functionName === 'isApprovedMinter') {
          throw new Error('unsupported minter approval read');
        }
        expect(params.functionName).toBe('owner');
        throw ownerCause;
      },
    });

    await expectRejectionCause(
      ownerReadRelease.configure({
        contract: collection,
        price: '1',
        maxMints: 1,
      }),
      `Unable to read owner() from collection ${collection}`,
      ownerCause,
    );

    const simulationCause = new Error('mintTo simulation failed');
    const simulationRelease = createReleaseTestNamespace({
      async readContract(params: { functionName: string }) {
        if (params.functionName === 'isApprovedMinter') {
          throw new Error('unsupported minter approval read');
        }
        expect(params.functionName).toBe('owner');
        return accountAddress;
      },
      async simulateContract(): Promise<never> {
        throw simulationCause;
      },
    });

    await expectRejectionCause(
      simulationRelease.configure({
        contract: collection,
        price: '1',
        maxMints: 1,
      }),
      `Collection ${collection} must expose mintTo(address)`,
      simulationCause,
    );
  });

  it('requires and writes Lazy Sovereign minter approval before release configure', async () => {
    let minterApproved = false;
    const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const approvalTxHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const release = createReleaseTestNamespace({
      async readContract(params: { functionName: string }) {
        if (params.functionName === 'isApprovedMinter') {
          return minterApproved;
        }
        if (params.functionName === 'owner') {
          return accountAddress;
        }
        throw new Error(`unexpected read ${params.functionName}`);
      },
      async simulateContract(params: { functionName: string }) {
        expect(params.functionName).toBe('mintTo');
        return {};
      },
      async waitForTransactionReceipt(params: { hash: string }) {
        if (params.hash === approvalTxHash) {
          minterApproved = true;
          return { blockNumber: 1n };
        }

        return { blockNumber: 2n };
      },
    }, {
      async writeContract(params) {
        if (params.functionName === 'setMinterApproval') {
          expect(params.args).toEqual([rareMinter, true]);
          return approvalTxHash;
        }
        if (params.functionName === 'prepareMintDirectSale') {
          return txHash;
        }

        throw new Error(`unexpected write ${params.functionName}`);
      },
    });

    await expect(release.configure({
      contract: collection,
      price: '1',
      maxMints: 1,
      autoApprove: false,
    })).rejects.toThrow(`Minter approval is required for collection ${collection} and minter ${rareMinter}.`);

    const configured = await release.configure({
      contract: collection,
      price: '1',
      maxMints: 1,
    });

    expect(configured.txHash).toBe(txHash);
    expect(configured.approvalTxHash).toBe(approvalTxHash);
  });

  it('retries minter approval read-back when the RPC node lags behind the receipt', async () => {
    let approvalReads = 0;
    const txHash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const approvalTxHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const release = createReleaseTestNamespace({
      async readContract(params: { functionName: string }) {
        if (params.functionName === 'owner') {
          return accountAddress;
        }
        if (params.functionName === 'isApprovedMinter') {
          approvalReads += 1;
          // pre-check + first post-receipt read are stale (false); then true.
          return approvalReads >= 3;
        }
        throw new Error(`unexpected read ${params.functionName}`);
      },
      async simulateContract(params: { functionName: string }) {
        expect(params.functionName).toBe('mintTo');
        return {};
      },
      async waitForTransactionReceipt() {
        return { blockNumber: 1n, status: 'success' };
      },
    }, {
      async writeContract(params) {
        if (params.functionName === 'setMinterApproval') {
          return approvalTxHash;
        }
        if (params.functionName === 'prepareMintDirectSale') {
          return txHash;
        }
        throw new Error(`unexpected write ${params.functionName}`);
      },
    });

    const configured = await release.configure({
      contract: collection,
      price: '1',
      maxMints: 1,
    });

    expect(configured.txHash).toBe(txHash);
    expect(configured.approvalTxHash).toBe(approvalTxHash);
    expect(approvalReads).toBeGreaterThanOrEqual(3);
  });

  it('reports a reverted minter approval transaction', async () => {
    const approvalTxHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const release = createReleaseTestNamespace({
      async readContract(params: { functionName: string }) {
        if (params.functionName === 'owner') {
          return accountAddress;
        }
        if (params.functionName === 'isApprovedMinter') {
          return false;
        }
        throw new Error(`unexpected read ${params.functionName}`);
      },
      async waitForTransactionReceipt() {
        return { blockNumber: 1n, status: 'reverted' };
      },
    }, {
      async writeContract(params) {
        expect(params.functionName).toBe('setMinterApproval');
        return approvalTxHash;
      },
    });

    await expect(release.configure({
      contract: collection,
      price: '1',
      maxMints: 1,
    })).rejects.toThrow(`Lazy Sovereign minter approval for ${rareMinter} reverted`);
  });

  it('rejects owner mismatch before writing Lazy Sovereign minter approval', async () => {
    const writeContract = vi.fn(async (): Promise<never> => {
      throw new Error('unexpected write');
    });
    const release = createReleaseTestNamespace({
      async readContract(params: { functionName: string }) {
        if (params.functionName === 'owner') {
          return otherAddress;
        }
        throw new Error(`unexpected read ${params.functionName}`);
      },
    }, { writeContract });

    await expect(release.configure({
      contract: collection,
      price: '1',
      maxMints: 1,
    })).rejects.toThrow(`Contract owner is ${otherAddress}.`);

    expect(writeContract).not.toHaveBeenCalled();
  });

  it('reports mined minter approval when a later release configure check fails', async () => {
    let minterApproved = false;
    const approvalTxHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const simulationCause = new Error('mintTo simulation failed');
    const release = createReleaseTestNamespace({
      async readContract(params: { functionName: string }) {
        if (params.functionName === 'owner') {
          return accountAddress;
        }
        if (params.functionName === 'isApprovedMinter') {
          return minterApproved;
        }
        throw new Error(`unexpected read ${params.functionName}`);
      },
      async simulateContract(): Promise<never> {
        throw simulationCause;
      },
      async waitForTransactionReceipt(params: { hash: string }) {
        expect(params.hash).toBe(approvalTxHash);
        minterApproved = true;
        return { blockNumber: 1n };
      },
    }, {
      async writeContract(params) {
        expect(params.functionName).toBe('setMinterApproval');
        expect(params.args).toEqual([rareMinter, true]);
        return approvalTxHash;
      },
    });

    let caught: unknown;
    try {
      await release.configure({
        contract: collection,
        price: '1',
        maxMints: 1,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApprovalSideEffectError);
    expect(caught).toMatchObject({
      operation: 'release configure',
      approvals: [{
        type: 'minter',
        approvalTxHash,
        target: collection,
        minter: rareMinter,
      }],
    });
    expect((caught as Error).message).toContain(`Approval transaction ${approvalTxHash} was mined`);
    expect((caught as Error).message).toContain('The approval remains valid; retry the operation or revoke approval');
    expect((caught as Error).cause).toBeInstanceOf(Error);
    expect(((caught as Error).cause as Error).cause).toBe(simulationCause);
  });

  it('does not resolve rare-api proofs when callers provide an explicit empty singleton proof', async () => {
    const artifact = buildReleaseAllowlistArtifact([accountAddress]);
    const writeReached = new Error('write reached with explicit empty proof');
    const release = createReleaseTestNamespace({
      async readContract(params: { functionName: string }) {
        if (params.functionName === 'getDirectSaleConfig') {
          return {
            seller: accountAddress,
            currencyAddress: ETH_ADDRESS,
            price: 0n,
            startTime: 0n,
            maxMints: 1n,
            splitRecipients: [accountAddress],
            splitRatios: [100],
          };
        }
        if (params.functionName === 'getContractAllowListConfig') {
          return {
            root: artifact.root,
            endTimestamp: 2_000n,
          };
        }
        if (
          params.functionName === 'getContractMintLimit' ||
          params.functionName === 'getContractTxLimit' ||
          params.functionName === 'getContractMintsPerAddress' ||
          params.functionName === 'getContractTxsPerAddress' ||
          params.functionName === 'totalSupply'
        ) {
          return 0n;
        }
        if (params.functionName === 'maxTokens') {
          return 10n;
        }
        throw new Error(`unexpected read ${params.functionName}`);
      },
      async getBlock() {
        return { timestamp: 1_000n };
      },
    }, {
      apiFetch: async (): Promise<never> => {
        throw new Error('unexpected rare-api proof resolution');
      },
      async writeContract(params): Promise<never> {
        expect(params.functionName).toBe('mintDirectSale');
        expect(params.args?.[4]).toEqual([]);
        throw writeReached;
      },
    });

    await expect(release.mint({
      contract: collection,
      proof: [],
    })).rejects.toBe(writeReached);
  });

  it('validates allowlist config before uploading artifact addresses', async () => {
    const artifact = buildReleaseAllowlistArtifact([accountAddress]);
    const apiFetch = vi.fn<typeof fetch>();
    const release = createReleaseTestNamespace({
      async readContract(): Promise<never> {
        throw new Error('unexpected owner read');
      },
    }, { apiFetch });

    await expect(release.allowlist.setConfig({
      contract: collection,
      artifact,
      endTime: 'not-a-time',
    })).rejects.toThrow('endTime must be a unix timestamp or ISO date string.');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('checks collection ownership before uploading allowlist artifact addresses', async () => {
    const artifact = buildReleaseAllowlistArtifact([accountAddress]);
    const apiFetch = vi.fn<typeof fetch>();
    const release = createReleaseTestNamespace({
      async readContract(params: { functionName: string }) {
        expect(params.functionName).toBe('owner');
        return otherAddress;
      },
    }, { apiFetch });

    await expect(release.allowlist.setConfig({
      contract: collection,
      artifact,
      endTime: 2_000,
    })).rejects.toThrow(
      `Connected wallet ${accountAddress} is not the owner of collection ${collection}. Contract owner is ${otherAddress}.`,
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('rejects mismatched rare-api allowlist roots before writing config', async () => {
    const artifact = buildReleaseAllowlistArtifact([accountAddress]);
    const apiRoot = `0x${'11'.repeat(32)}` as const;
    const writeContract = vi.fn(async (): Promise<`0x${string}`> => {
      throw new Error('unexpected allowlist write');
    });
    const release = createReleaseTestNamespace({
      async readContract(params: { functionName: string }) {
        expect(params.functionName).toBe('owner');
        return accountAddress;
      },
    }, {
      apiFetch: async (): Promise<Response> => jsonResponse({ merkleRoot: apiRoot }),
      writeContract,
    });

    await expect(release.allowlist.setConfig({
      contract: collection,
      artifact,
      endTime: 2_000,
    })).rejects.toThrow(`rare-api allowlist root ${apiRoot} does not match artifact root ${artifact.root}.`);
    expect(writeContract).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}
