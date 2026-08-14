import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  deriveLiquidFactoryConfig,
  parseLiquidTokenSupplyAmount,
  resolveLiquidFactoryConfigForSupply,
} from '../../../src/liquid/factory-config-core.js';

test('deriveLiquidFactoryConfig uses maxTotalSupply minus creatorLaunchReward for curve supply', () => {
  const config = deriveLiquidFactoryConfig(
    '0xba5BDe662c17e2aDFF1075610382B9B691296350',
    1_000_000n * 10n ** 18n,
    100_000n * 10n ** 18n,
    0n,
    {
      lpTickLower: -887220,
      lpTickUpper: 887220,
      poolTickSpacing: 60,
    },
  );

  assert.equal(config.maxTotalSupplyTokens, '1000000');
  assert.equal(config.creatorLaunchRewardTokens, '100000');
  assert.equal(config.curvePoolSupplyTokens, '900000');
});

test('deriveLiquidFactoryConfig preserves fractional token precision', () => {
  const config = deriveLiquidFactoryConfig(
    '0xba5BDe662c17e2aDFF1075610382B9B691296350',
    10n ** 18n + 1n,
    1n,
    0n,
    {
      lpTickLower: -887220,
      lpTickUpper: 887220,
      poolTickSpacing: 60,
    },
  );

  assert.equal(config.maxTotalSupplyTokens, '1.000000000000000001');
  assert.equal(config.creatorLaunchRewardTokens, '0.000000000000000001');
  assert.equal(config.curvePoolSupplyTokens, '1');
});

test('deriveLiquidFactoryConfig rejects creator rewards above max supply', () => {
  assert.throws(
    () =>
      deriveLiquidFactoryConfig(
        '0xba5BDe662c17e2aDFF1075610382B9B691296350',
        10n,
        11n,
        0n,
        { lpTickLower: -60, lpTickUpper: 60, poolTickSpacing: 60 },
      ),
    /creatorLaunchReward exceeds maxTotalSupply/i,
  );
});

test('deriveLiquidFactoryConfig rejects negative minimum rare liquidity', () => {
  assert.throws(
    () =>
      deriveLiquidFactoryConfig(
        '0xba5BDe662c17e2aDFF1075610382B9B691296350',
        10n ** 18n,
        0n,
        -1n,
        { lpTickLower: -60, lpTickUpper: 60, poolTickSpacing: 60 },
      ),
    /minRareLiquidityWei cannot be negative/i,
  );
});

test('deriveLiquidFactoryConfig rejects ticks that do not align to spacing', () => {
  assert.throws(
    () =>
      deriveLiquidFactoryConfig(
        '0xba5BDe662c17e2aDFF1075610382B9B691296350',
        10n ** 18n,
        0n,
        0n,
        { lpTickLower: -50, lpTickUpper: 60, poolTickSpacing: 60 },
      ),
    /align to poolTickSpacing/i,
  );
});

test('parseLiquidTokenSupplyAmount parses human token amounts to 18 decimal units', () => {
  assert.deepEqual(parseLiquidTokenSupplyAmount('123.45'), {
    isValid: true,
    amountWei: 123_450_000_000_000_000_000n,
  });
  assert.deepEqual(parseLiquidTokenSupplyAmount(2n), {
    isValid: true,
    amountWei: 2n,
  });
});

test('parseLiquidTokenSupplyAmount returns structured validation failures', () => {
  assert.deepEqual(parseLiquidTokenSupplyAmount('0'), {
    isValid: false,
    error: 'not-positive',
    errorMessage: 'totalSupply must be greater than 0.',
  });
  assert.deepEqual(parseLiquidTokenSupplyAmount('not-a-number'), {
    isValid: false,
    error: 'invalid-decimal',
    errorMessage: 'totalSupply must be a valid positive decimal amount.',
  });
  assert.deepEqual(parseLiquidTokenSupplyAmount('0.0000000000000000001'), {
    isValid: false,
    error: 'too-many-decimals',
    errorMessage: 'totalSupply cannot have more than 18 decimal places.',
  });
});

test('resolveLiquidFactoryConfigForSupply recalculates curve supply for custom total supply', () => {
  const config = deriveLiquidFactoryConfig(
    '0xba5BDe662c17e2aDFF1075610382B9B691296350',
    1_000_000n * 10n ** 18n,
    100_000n * 10n ** 18n,
    0n,
    {
      lpTickLower: -887220,
      lpTickUpper: 887220,
      poolTickSpacing: 60,
    },
  );

  const custom = resolveLiquidFactoryConfigForSupply(config, '250000');

  assert.equal(custom.isValid, true);
  if (!custom.isValid) throw new Error('expected valid custom supply config');
  assert.equal(custom.factoryConfig.maxTotalSupplyTokens, '250000');
  assert.equal(custom.factoryConfig.creatorLaunchRewardTokens, '100000');
  assert.equal(custom.factoryConfig.curvePoolSupplyTokens, '150000');
  assert.equal(custom.totalSupplyWei, 250_000n * 10n ** 18n);
});

test('resolveLiquidFactoryConfigForSupply returns a structured failure when supply cannot cover rewards', () => {
  const config = deriveLiquidFactoryConfig(
    '0xba5BDe662c17e2aDFF1075610382B9B691296350',
    1_000_000n * 10n ** 18n,
    100_000n * 10n ** 18n,
    0n,
    {
      lpTickLower: -887220,
      lpTickUpper: 887220,
      poolTickSpacing: 60,
    },
  );

  assert.deepEqual(resolveLiquidFactoryConfigForSupply(config, '100000'), {
    isValid: false,
    error: 'below-creator-launch-reward',
    errorMessage: 'totalSupply must be greater than the Liquid factory creator launch reward.',
  });
});
