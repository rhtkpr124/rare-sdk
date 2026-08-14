import { describe, expect, it } from 'vitest';
import { createUtilsNamespace } from '../src/sdk/utils.js';
import {
  getCurvePresetDefinition,
  parseCurveConfig,
} from '../src/sdk/public-utils.js';

const curveJson = JSON.stringify([
  { tickLower: -60, tickUpper: 0, numPositions: 1, shares: '1' },
]);

describe('public liquid curve utilities', () => {
  it('exposes the standalone helpers', () => {
    expect(getCurvePresetDefinition('medium-demand')).toEqual({
      title: 'Medium Demand',
      description: 'Middle-ground starting price with supply concentrated through the middle of the curve.',
    });
    expect(parseCurveConfig(curveJson, '1', 60)).toEqual([
      { tickLower: -60, tickUpper: 0, numPositions: 1, shares: '1' },
    ]);
  });

  it('exposes the same behavior through rare.utils', () => {
    const utils = createUtilsNamespace();

    expect(utils.liquidCurve.getPresetDefinition('medium-demand')).toEqual(
      getCurvePresetDefinition('medium-demand'),
    );
    expect(utils.liquidCurve.parseConfig({
      value: curveJson,
      totalCurveSupplyTokens: '1',
      tickSpacing: 60,
    })).toEqual(parseCurveConfig(curveJson, '1', 60));
  });
});
