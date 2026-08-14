import { describe, expect, it } from 'vitest';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { resolveCurrency } from '../../../src/contracts/addresses.js';
import { createRareClient } from '../../../src/sdk/client.js';
import { createTestSepoliaPublicClient, getTestRpcUrl, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeLive = hasTestRpcUrl() ? describe : describe.skip;

describeLive('Liquid Editions SDK live integration', () => {
  it('reads the live factory config and validates curves against it', async () => {
    const rare = createRareClient({ publicClient: createTestSepoliaPublicClient() });

    const factoryConfig = await rare.liquidEdition.getFactoryConfig();
    expect(factoryConfig.baseToken).toBe(resolveCurrency('rare', 'sepolia'));
    expect(factoryConfig.maxTotalSupplyWei).toBeGreaterThan(0n);
    expect(factoryConfig.curvePoolSupplyWei).toBeGreaterThan(0n);
    expect(factoryConfig.poolTickSpacing).toBeGreaterThan(0);

    const preview = await rare.liquidEdition.validateCurves({
      curves: [{ tickLower: -60_000, tickUpper: 60_000, numPositions: 1, shares: '1' }],
    });

    expect(preview.baseToken).toBe(factoryConfig.baseToken);
    expect(preview.curvePoolSupplyTokens).toBe(factoryConfig.curvePoolSupplyTokens);
    expect(preview.totalPositions).toBe(1);
    expect(preview.totalShare).toBe(1);
  }, 30_000);

  it('generates preset curves from live factory config and the Rare price API', async () => {
    const rare = createRareClient({ publicClient: createTestSepoliaPublicClient() });

    const generated = await rare.liquidEdition.generatePresetCurves({ preset: 'medium-demand' });

    expect(generated.preset).toBe('medium-demand');
    expect(generated.rarePriceUsd).toBeGreaterThan(0);
    expect(generated.curves.length).toBeGreaterThan(0);
    expect(generated.preview.totalPositions).toBeGreaterThan(0);
    expect(generated.preview.totalShare).toBeCloseTo(1);
  }, 30_000);

  it('rejects unsupported curve share strings before deployment writes', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const rare = createRareClient({
      publicClient,
      walletClient: createWalletClient({
        account: privateKeyToAccount(generatePrivateKey()),
        chain: sepolia,
        transport: http(getTestRpcUrl(), {
          retryCount: 1,
          timeout: 30_000,
        }),
      }),
    });

    await expect(rare.liquidEdition.deploy.multiCurve({
      name: 'Invalid Shares',
      symbol: 'BAD',
      tokenUri: 'ipfs://token',
      initialRareLiquidity: '1',
      curves: [
        { tickLower: 0, tickUpper: 60_000, numPositions: 1, shares: '1e-7' },
        { tickLower: 60_000, tickUpper: 120_000, numPositions: 1, shares: '0.9999999' },
      ],
    })).rejects.toThrow(/Invalid curve segment values/);
  }, 30_000);
});
