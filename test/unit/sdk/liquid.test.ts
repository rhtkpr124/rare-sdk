/* eslint-disable no-restricted-syntax, @typescript-eslint/explicit-function-return-type */
import { describe, expect, it } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseEther,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { liquidFactoryAbi } from '../../../src/contracts/abis/liquid-factory.js';
import { createLiquidNamespace } from '../../../src/sdk/liquid.js';
import type { LiquidCurveSegment } from '../../../src/liquid/curve-config.js';

const accountAddress = '0x1000000000000000000000000000000000000000' as Address;
const liquidFactory = '0x2000000000000000000000000000000000000000' as Address;
const baseToken = '0x3000000000000000000000000000000000000000' as Address;
const deployedToken = '0x4000000000000000000000000000000000000000' as Address;
const liquidEdition = '0x5000000000000000000000000000000000000000' as Address;
const renderContract = '0x6000000000000000000000000000000000000000' as Address;
const txHash = `0x${'12'.repeat(32)}` satisfies Hex;
const curves: LiquidCurveSegment[] = [
  { tickLower: -16080, tickUpper: -9180, numPositions: 3, shares: '0.1' },
  { tickLower: -9180, tickUpper: 6960, numPositions: 2, shares: '0.65' },
  { tickLower: 6960, tickUpper: 29940, numPositions: 2, shares: '0.23' },
  { tickLower: 29940, tickUpper: 76020, numPositions: 1, shares: '0.02' },
];

describe('Liquid Edition SDK shell receipt handling', () => {
  it('resolves default and custom factory supplies and rejects invalid custom supplies', async () => {
    const namespace = createTestLiquidNamespace({
      async waitForTransactionReceipt() {
        return receipt({ logs: [] });
      },
      async getTransactionReceipt() {
        return receipt({ logs: [] });
      },
    });

    const defaultConfig = await namespace.getFactoryConfig();
    expect(defaultConfig.maxTotalSupplyTokens).toBe('1000000');
    expect(defaultConfig.curvePoolSupplyTokens).toBe('900000');

    const customConfig = await namespace.getFactoryConfig({ totalSupply: '500000' });
    expect(customConfig.maxTotalSupplyTokens).toBe('500000');
    expect(customConfig.creatorLaunchRewardTokens).toBe('100000');
    expect(customConfig.curvePoolSupplyTokens).toBe('400000');

    await expect(namespace.getFactoryConfig({ totalSupply: '99999' })).rejects.toThrow(
      /creator launch reward/i,
    );
  });

  it('retries a successful deploy receipt until delayed LiquidTokenCreated logs are available', async () => {
    let getReceiptCalls = 0;
    const namespace = createTestLiquidNamespace({
      async waitForTransactionReceipt() {
        return receipt({ logs: [] });
      },
      async getTransactionReceipt() {
        getReceiptCalls += 1;
        return receipt({ logs: [liquidTokenCreatedLog()] });
      },
    });

    const result = await namespace.deploy.multiCurve({
      name: 'Delayed Logs',
      symbol: 'DLAY',
      tokenUri: 'ipfs://token',
      curves,
    });

    expect(getReceiptCalls).toBe(1);
    expect(result.contract).toBe(deployedToken);
    expect(result.txHash).toBe(txHash);
  });

  it('surfaces reverted deploy receipts before trying to read delayed logs', async () => {
    const namespace = createTestLiquidNamespace({
      async waitForTransactionReceipt() {
        return receipt({ status: 'reverted', logs: [] });
      },
      async getTransactionReceipt(): Promise<never> {
        throw new Error('unexpected delayed receipt lookup');
      },
    });

    await expect(namespace.deploy.multiCurve({
      name: 'Reverted Logs',
      symbol: 'RVRT',
      tokenUri: 'ipfs://token',
      curves,
    })).rejects.toThrow(
      `Liquid Edition deploy transaction reverted before emitting LiquidTokenCreated. Transaction hash: ${txHash}. Block: 123.`,
    );
  });

  it('rejects reverted setRenderContract receipts before returning success', async () => {
    const namespace = createTestLiquidNamespace({
      async waitForTransactionReceipt() {
        return receipt({ status: 'reverted', logs: [] });
      },
      async getTransactionReceipt(): Promise<never> {
        throw new Error('unexpected delayed receipt lookup');
      },
      expectedWrite: {
        functionName: 'setRenderContract',
        args: [renderContract],
      },
    });

    await expect(namespace.setRenderContract({
      contract: liquidEdition,
      renderContract,
    })).rejects.toThrow(
      `Liquid Edition setRenderContract transaction was confirmed with status "reverted". Transaction hash: ${txHash}. Block: 123.`,
    );
  });

});

function createTestLiquidNamespace(publicClientOverrides: {
  waitForTransactionReceipt: () => Promise<TransactionReceipt>;
  getTransactionReceipt: () => Promise<TransactionReceipt>;
  expectedWrite?: {
    functionName: string;
    args?: readonly unknown[];
  };
}) {
  const publicClient = {
    readContract: readLiquidFactoryConfigContract,
    waitForTransactionReceipt: publicClientOverrides.waitForTransactionReceipt,
    getTransactionReceipt: publicClientOverrides.getTransactionReceipt,
  };

  return createLiquidNamespace(
    {
      publicClient: publicClient as never,
      walletClient: {
        account: { address: accountAddress },
        async writeContract(params: { functionName: string; args?: readonly unknown[] }) {
          const expectedWrite = publicClientOverrides.expectedWrite ?? {
            functionName: 'createLiquidTokenMultiCurve',
            args: [accountAddress],
          };
          expect(params.functionName).toBe(expectedWrite.functionName);
          for (const [index, expectedArg] of (expectedWrite.args ?? []).entries()) {
            expect(params.args?.[index]).toBe(expectedArg);
          }
          return txHash;
        },
      } as never,
    },
    'sepolia',
    { liquidFactory },
  );
}

async function readLiquidFactoryConfigContract(params: { functionName: string }) {
  if (params.functionName === 'baseToken') return baseToken;
  if (params.functionName === 'maxTotalSupply') return parseEther('1000000');
  if (params.functionName === 'creatorLaunchReward') return parseEther('100000');
  if (params.functionName === 'minRareLiquidityWei') return 0n;
  if (params.functionName === 'lpTickLower') return -887_220;
  if (params.functionName === 'lpTickUpper') return 887_220;
  if (params.functionName === 'poolTickSpacing') return 60;
  throw new Error(`unexpected readContract ${params.functionName}`);
}

function receipt(params: {
  status?: 'success' | 'reverted';
  logs: TransactionReceipt['logs'];
}): TransactionReceipt {
  return {
    status: params.status ?? 'success',
    blockNumber: 123n,
    logs: params.logs,
  } as TransactionReceipt;
}

function liquidTokenCreatedLog(): TransactionReceipt['logs'][number] {
  return {
    address: liquidFactory,
    topics: encodeEventTopics({
      abi: liquidFactoryAbi,
      eventName: 'LiquidTokenCreated',
      args: {
        token: deployedToken,
        creator: accountAddress,
      },
    }),
    data: encodeAbiParameters([{ type: 'string' }], ['ipfs://token']),
  } as TransactionReceipt['logs'][number];
}
