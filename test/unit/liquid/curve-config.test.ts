import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseUnits } from 'viem';
import {
  buildCurvePreview,
  generatePresetCurves,
  parseCurveConfig,
  validateCurves,
  type LiquidCurveSegment,
} from '../../../src/liquid/curve-config.js';

const baseFactoryConfig = {
  baseToken: '0xba5BDe662c17e2aDFF1075610382B9B691296350' as const,
  curvePoolSupplyTokens: '900000',
  maxTotalSupplyTokens: '1000000',
  creatorLaunchRewardTokens: '100000',
  poolTickSpacing: 60,
};

test('generatePresetCurves matches medium-demand fixture', () => {
  const curves = generatePresetCurves('medium-demand', 1, baseFactoryConfig);

  assert.deepEqual(curves, [
    { tickLower: -16080, tickUpper: -9180, numPositions: 3, shares: '0.1' },
    { tickLower: -9180, tickUpper: 6960, numPositions: 2, shares: '0.65' },
    { tickLower: 6960, tickUpper: 29940, numPositions: 2, shares: '0.23' },
    { tickLower: 29940, tickUpper: 76020, numPositions: 1, shares: '0.02' },
  ]);
});

test('validateCurves rejects gaps between segments', () => {
  const curves: LiquidCurveSegment[] = [
    { tickLower: 0, tickUpper: 120, numPositions: 1, shares: '0.5' },
    { tickLower: 180, tickUpper: 300, numPositions: 1, shares: '0.5' },
  ];

  const result = validateCurves(curves, baseFactoryConfig);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage ?? '', /contiguous/i);
});

test('validateCurves rejects tick spacing mismatches', () => {
  const curves: LiquidCurveSegment[] = [{ tickLower: 0, tickUpper: 100, numPositions: 1, shares: '1' }];
  const result = validateCurves(curves, baseFactoryConfig);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage ?? '', /spacing 60/i);
});

test('validateCurves rejects share sums that do not add to 1', () => {
  const curves: LiquidCurveSegment[] = [
    { tickLower: 0, tickUpper: 120, numPositions: 1, shares: '0.4' },
    { tickLower: 120, tickUpper: 240, numPositions: 1, shares: '0.4' },
  ];

  const result = validateCurves(curves, baseFactoryConfig);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage ?? '', /add up to 1/i);
});

test('validateCurves rejects exponent notation share strings', () => {
  const curves: LiquidCurveSegment[] = [
    { tickLower: 0, tickUpper: 60_000, numPositions: 1, shares: '1e-7' },
    { tickLower: 60_000, tickUpper: 120_000, numPositions: 1, shares: '0.9999999' },
  ];

  const result = validateCurves(curves, baseFactoryConfig);

  assert.equal(result.isValid, false);
  assert.equal(result.error, 'invalid-segment');
});

test('parseCurveConfig normalizes numeric exponent shares into deployable decimal strings', () => {
  const curves = parseCurveConfig(JSON.stringify([
    { tickLower: 0, tickUpper: 60_000, numPositions: 1, shares: 1e-7 },
    { tickLower: 60_000, tickUpper: 120_000, numPositions: 1, shares: '0.9999999' },
  ]), baseFactoryConfig.curvePoolSupplyTokens, baseFactoryConfig.poolTickSpacing);

  assert.deepEqual(curves.map((curve) => curve.shares), ['0.0000001', '0.9999999']);
  assert.doesNotThrow(() => curves.forEach((curve) => parseUnits(curve.shares, 18)));
});

test('validateCurves rejects share precision that cannot be represented in 18 decimals', () => {
  const curves: LiquidCurveSegment[] = [
    { tickLower: 0, tickUpper: 60_000, numPositions: 1, shares: '0.0000000000000000001' },
    { tickLower: 60_000, tickUpper: 120_000, numPositions: 1, shares: '0.9999999999999999999' },
  ];

  const result = validateCurves(curves, baseFactoryConfig);

  assert.equal(result.isValid, false);
  assert.equal(result.error, 'invalid-segment');
});

test('validateCurves rejects too many positions', () => {
  const curves: LiquidCurveSegment[] = Array.from({ length: 13 }, (_, index) => ({
    tickLower: index * 120,
    tickUpper: index * 120 + 120,
    numPositions: 2,
    shares: index === 12 ? '0.04' : '0.08',
  }));

  const result = validateCurves(curves, baseFactoryConfig);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage ?? '', /must not exceed 25/i);
});

test('validateCurves rejects spans that are too narrow for their positions', () => {
  const curves: LiquidCurveSegment[] = [{ tickLower: 0, tickUpper: 60, numPositions: 2, shares: '1' }];
  const result = validateCurves(curves, baseFactoryConfig);
  assert.equal(result.isValid, false);
  assert.match(result.errorMessage ?? '', /narrow/i);
});

test('validateCurves rejects stacked liquidity that exceeds the per-tick limit', () => {
  const curves: LiquidCurveSegment[] = [
    { tickLower: 120_000, tickUpper: 120_060, numPositions: 1, shares: '0.2' },
    { tickLower: 120_060, tickUpper: 120_120, numPositions: 1, shares: '0.8' },
  ];
  const result = validateCurves(curves, {
    ...baseFactoryConfig,
    curvePoolSupplyTokens: '100000000000',
  });

  assert.equal(result.isValid, false);
  assert.equal(result.error, 'tick-span-too-narrow');
  assert.match(result.errorMessage ?? '', /stacked liquidity at tick 120060/i);
});

test('buildCurvePreview includes usd ranges when a price is supplied', () => {
  const curves = generatePresetCurves('low-demand', 2, baseFactoryConfig);
  const preview = buildCurvePreview(curves, baseFactoryConfig, 2);

  assert.equal(preview.totalPositions, 6);
  assert.equal(preview.rarePriceUsd, 2);
  assert.ok(preview.segments[0]?.startTokenPriceUsd !== undefined);
  assert.ok(preview.segments[0]?.endTokenPriceUsd !== undefined);
});
