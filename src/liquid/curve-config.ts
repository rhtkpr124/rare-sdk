import { type Address } from 'viem';
import type { LiquidFactoryConfig } from './factory-config.js';

export type CurvePresetKey = 'low-demand' | 'medium-demand' | 'high-demand';

export type LiquidCurveSegment = {
  tickLower: number;
  tickUpper: number;
  numPositions: number;
  shares: string;
}

export type LiquidCurvesValidationResult = {
  isValid: boolean;
  curves?: LiquidCurveSegment[];
  error?: string;
  errorMessage?: string;
}

export type LiquidCurveSegmentSummary = {
  tickLower: number;
  tickUpper: number;
  numPositions: number;
  shares: string;
  startTokenPriceUsd?: number;
  endTokenPriceUsd?: number;
}

export type LiquidCurvePreview = {
  totalPositions: number;
  totalShare: number;
  curvePoolSupplyTokens: string;
  maxTotalSupplyTokens: string;
  creatorLaunchRewardTokens: string;
  baseToken: Address;
  rarePriceUsd?: number;
  segments: LiquidCurveSegmentSummary[];
}

type CurvePresetUsdSegment = {
  endTokenPriceUsd: number;
  numPositions: number;
  sharesPercent: number;
};

type CurvePresetUsd = {
  startTokenPriceUsd: number;
  segments: CurvePresetUsdSegment[];
};

type CurvePresetDefinition = {
  title: string;
  description: string;
  coreCurvePresetUsd: CurvePresetUsd;
  reserveTailStartTokenPriceUsd: number;
};

type TokenPriceCurveInput = {
  startTokenPrice: number;
  endTokenPrice: number;
  numPositions: number;
  sharesPercent: number;
};

type UsdTokenPriceCurveInput = {
  startTokenPriceUsd: number;
  endTokenPriceUsd: number;
  numPositions: number;
  sharesPercent: number;
};

export type LiquidCurveSupplyAmount = string | number;
export type CurvePresetDescription = Pick<CurvePresetDefinition, 'title' | 'description'>;
type NormalizedShare = {
  decimal: string;
  scaledUnits: bigint;
}
type NormalizedCurveSegmentEntry = {
  segment: LiquidCurveSegment;
  shareScaledUnits: bigint;
}
type NormalizedSegmentResult =
  | { isValid: true; entry: NormalizedCurveSegmentEntry }
  | { isValid: false; result: LiquidCurvesValidationResult };
type GrossLiquidityTickEntry = {
  tick: number;
  grossLiquidity: number;
  curveIndexes: readonly number[];
};

const TICK_BASE = 1.0001;
const TICK_LOG_BASE = Math.log(TICK_BASE);
const TOKEN_BASE_UNITS = 1e18;
const SHARE_SCALE_UNITS = 10n ** 18n;
const RESERVE_TAIL_SHARES_PERCENT = 2;
const RESERVE_TAIL_END_PRICE_MULTIPLE = 100;
const SHARES_SUM_TOLERANCE = 1e-6;
const MAX_LIQUIDITY_PER_TICK = 1.15e34;
const MIN_TICK = -887220;
const MAX_TICK = 887220;
const MAX_TOTAL_POSITIONS = 25;

const CURVE_PRESET_DEFINITIONS: Record<CurvePresetKey, CurvePresetDefinition> = {
  'low-demand': {
    title: 'Low Demand',
    description: 'Lower starting price with more supply available earlier in the curve.',
    coreCurvePresetUsd: {
      startTokenPriceUsd: 0.08,
      segments: [
        { endTokenPriceUsd: 0.16, numPositions: 2, sharesPercent: 30 },
        { endTokenPriceUsd: 0.8, numPositions: 2, sharesPercent: 50 },
        { endTokenPriceUsd: 8, numPositions: 1, sharesPercent: 18 },
      ],
    },
    reserveTailStartTokenPriceUsd: 8,
  },
  'medium-demand': {
    title: 'Medium Demand',
    description: 'Middle-ground starting price with supply concentrated through the middle of the curve.',
    coreCurvePresetUsd: {
      startTokenPriceUsd: 0.2,
      segments: [
        { endTokenPriceUsd: 0.4, numPositions: 3, sharesPercent: 10 },
        { endTokenPriceUsd: 2, numPositions: 2, sharesPercent: 65 },
        { endTokenPriceUsd: 20, numPositions: 2, sharesPercent: 23 },
      ],
    },
    reserveTailStartTokenPriceUsd: 20,
  },
  'high-demand': {
    title: 'High Demand',
    description: 'Higher starting price with more supply held back for higher price bands.',
    coreCurvePresetUsd: {
      startTokenPriceUsd: 0.5,
      segments: [
        { endTokenPriceUsd: 1, numPositions: 4, sharesPercent: 10 },
        { endTokenPriceUsd: 5, numPositions: 3, sharesPercent: 40 },
        { endTokenPriceUsd: 50, numPositions: 3, sharesPercent: 48 },
      ],
    },
    reserveTailStartTokenPriceUsd: 50,
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositiveFiniteNumber(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function toValidNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function toNormalizedShare(value: unknown): NormalizedShare | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      return null;
    }
    return parseShareDecimalString(expandFiniteNumber(value));
  }

  if (typeof value !== 'string') {
    return null;
  }

  return parseShareDecimalString(value);
}

function expandFiniteNumber(value: number): string {
  const rawValue = value.toString();
  const [coefficient = '', exponentValue] = rawValue.toLowerCase().split('e');
  if (exponentValue === undefined) {
    return rawValue;
  }

  const exponent = Number(exponentValue);
  const [integerPart = '', fractionalPart = ''] = coefficient.split('.');
  const digits = `${integerPart}${fractionalPart}`;
  const decimalIndex = integerPart.length + exponent;

  if (decimalIndex <= 0) {
    return `0.${'0'.repeat(Math.abs(decimalIndex))}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  }
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function parseShareDecimalString(value: string): NormalizedShare | null {
  const normalized = value.trim();
  if (!/^(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
    return null;
  }

  const shareParts = normalized.startsWith('.')
    ? ['0', normalized.slice(1)]
    : normalized.split('.');
  const integerPart = shareParts[0] ?? '';
  const fractionalDigits = shareParts[1] ?? '';
  const excessFractionalDigits = fractionalDigits.slice(18);
  if (/[1-9]/.test(excessFractionalDigits)) {
    return null;
  }

  const integerUnits = BigInt(integerPart === '' ? '0' : integerPart);
  const fractionalUnits = BigInt(fractionalDigits.slice(0, 18).padEnd(18, '0'));
  const scaledUnits = integerUnits * SHARE_SCALE_UNITS + fractionalUnits;
  if (scaledUnits <= 0n || scaledUnits > SHARE_SCALE_UNITS) {
    return null;
  }

  return {
    decimal: formatScaledShareDecimal(scaledUnits),
    scaledUnits,
  };
}

function formatScaledShareDecimal(scaledUnits: bigint): string {
  const integerUnits = scaledUnits / SHARE_SCALE_UNITS;
  const fractionalUnits = scaledUnits % SHARE_SCALE_UNITS;
  if (fractionalUnits === 0n) {
    return integerUnits.toString();
  }

  return `${integerUnits}.${fractionalUnits.toString().padStart(18, '0').replace(/0+$/, '')}`;
}

function toApproxTokenAmount(value: LiquidCurveSupplyAmount, label: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Liquid factory ${label} is invalid`);
  }
  return numeric;
}

function formatShareDecimal(value: number): string {
  const normalized = value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
  return normalized.length > 0 ? normalized : '0';
}

function alignTickToSpacing(rawTick: number, tickSpacing: number, direction: 'down' | 'up' | 'nearest'): number {
  if (direction === 'down') return Math.floor(rawTick / tickSpacing) * tickSpacing;
  if (direction === 'up') return Math.ceil(rawTick / tickSpacing) * tickSpacing;
  return Math.round(rawTick / tickSpacing) * tickSpacing;
}

function rarePerTokenToRawTick(rarePerToken: number): number {
  return Math.log(rarePerToken) / TICK_LOG_BASE;
}

function usdToRarePerToken(tokenPriceUsd: number, rarePriceUsd: number): number {
  if (!isPositiveFiniteNumber(tokenPriceUsd)) {
    throw new Error('Token price must be greater than 0');
  }
  if (!isPositiveFiniteNumber(rarePriceUsd)) {
    throw new Error('Base token USD price must be greater than 0');
  }
  return tokenPriceUsd / rarePriceUsd;
}

function tokenPriceToTick(tokenPrice: number, tickSpacing: number): number {
  if (!isPositiveFiniteNumber(tokenPrice)) {
    throw new Error('Token price must be greater than 0');
  }
  return alignTickToSpacing(rarePerTokenToRawTick(tokenPrice), tickSpacing, 'nearest');
}

export function tickToRarePerToken(tick: number): number {
  return Math.pow(TICK_BASE, tick);
}

export function tickToTokenPriceUsd(tick: number, rarePriceUsd: number): number {
  return tickToRarePerToken(tick) * rarePriceUsd;
}

function appendReserveTailSegment({
  segments,
  reserveTailStartTokenPriceUsd,
}: {
  segments: UsdTokenPriceCurveInput[];
  reserveTailStartTokenPriceUsd: number;
}): UsdTokenPriceCurveInput[] {
  return [
    ...segments,
    {
      startTokenPriceUsd: reserveTailStartTokenPriceUsd,
      endTokenPriceUsd: reserveTailStartTokenPriceUsd * RESERVE_TAIL_END_PRICE_MULTIPLE,
      numPositions: 1,
      sharesPercent: RESERVE_TAIL_SHARES_PERCENT,
    },
  ];
}

function getUsdTokenPriceCurveInputsForPresetWithReserveTail(curvePresetKey: CurvePresetKey): UsdTokenPriceCurveInput[] {
  const preset = CURVE_PRESET_DEFINITIONS[curvePresetKey];
  const segments = preset.coreCurvePresetUsd.segments.map((segment, index) => {
    const previousSegment = preset.coreCurvePresetUsd.segments[index - 1];
    return {
      startTokenPriceUsd: previousSegment?.endTokenPriceUsd ?? preset.coreCurvePresetUsd.startTokenPriceUsd,
      endTokenPriceUsd: segment.endTokenPriceUsd,
      numPositions: segment.numPositions,
      sharesPercent: segment.sharesPercent,
    };
  });

  return appendReserveTailSegment({
    segments,
    reserveTailStartTokenPriceUsd: preset.reserveTailStartTokenPriceUsd,
  });
}

function computeGrossLiquidityAtFarTick(
  tickLower: number,
  totalSpan: number,
  numPositions: number,
  sharesFraction: number,
  totalCurveSupplyTokens: number,
): number {
  const totalAmount = totalCurveSupplyTokens * TOKEN_BASE_UNITS * sharesFraction;
  const amountPerPosition = totalAmount / numPositions;

  return Array.from({ length: numPositions }, (_value, index) => {
    const posUpper = tickLower + ((index + 1) * totalSpan) / numPositions;
    const sqrtLower = Math.pow(TICK_BASE, tickLower / 2);
    const sqrtUpper = Math.pow(TICK_BASE, posUpper / 2);
    return tickLower <= 0
      ? amountPerPosition / (sqrtUpper - sqrtLower)
      : amountPerPosition / (1 / sqrtLower - 1 / sqrtUpper);
  }).reduce((grossLiquidity, positionLiquidity) => {
    if (!Number.isFinite(positionLiquidity) || positionLiquidity < 0 || grossLiquidity === Infinity) {
      return Infinity;
    }
    return grossLiquidity + positionLiquidity;
  }, 0);
}

function getGrossLiquidityOverflow(
  segments: LiquidCurveSegment[],
  totalCurveSupplyTokens: number,
  tickSpacing: number,
): { tick: number; curveIndexes: number[] } | null {
  const positions = segments.flatMap((segment, curveIndex) => {
    const shareFraction = Number(segment.shares);
    const curveSupplyTokens = totalCurveSupplyTokens * TOKEN_BASE_UNITS * shareFraction;
    const amountPerPosition = curveSupplyTokens / segment.numPositions;
    const tickSpan = segment.tickUpper - segment.tickLower;

    return Array.from({ length: segment.numPositions }, (_value, positionIndex) => {
      const rawStartingTick = segment.tickLower + Math.floor((positionIndex * tickSpan) / segment.numPositions);
      const startingTick = Math.floor(rawStartingTick / tickSpacing) * tickSpacing;

      if (startingTick >= segment.tickUpper) return null;

      const sqrtLower = Math.pow(TICK_BASE, startingTick / 2);
      const sqrtUpper = Math.pow(TICK_BASE, segment.tickUpper / 2);
      const liquidityDenominator = 1 / sqrtLower - 1 / sqrtUpper;
      if (!isPositiveFiniteNumber(liquidityDenominator)) {
        return { type: 'overflow' as const, tick: startingTick, curveIndexes: [curveIndex] };
      }

      const liquidity = amountPerPosition / liquidityDenominator;
      if (!isPositiveFiniteNumber(liquidity)) {
        return { type: 'overflow' as const, tick: startingTick, curveIndexes: [curveIndex] };
      }

      return { type: 'position' as const, curveIndex, tickLower: startingTick, tickUpper: segment.tickUpper, liquidity };
    });
  });

  const invalidPosition = positions.find((position) => position?.type === 'overflow');
  if (invalidPosition?.type === 'overflow') {
    return { tick: invalidPosition.tick, curveIndexes: invalidPosition.curveIndexes };
  }

  const validPositions = positions.filter((position) => position?.type === 'position');
  const grossLiquidityByTick = validPositions
    .flatMap((position) => [
      { tick: position.tickLower, curveIndex: position.curveIndex, liquidity: position.liquidity },
      { tick: position.tickUpper, curveIndex: position.curveIndex, liquidity: position.liquidity },
    ])
    .reduce<readonly GrossLiquidityTickEntry[]>((entries, entry) => {
      const existing = entries.find((candidate) => candidate.tick === entry.tick);
      if (!existing) {
        return [
          ...entries,
          { tick: entry.tick, grossLiquidity: entry.liquidity, curveIndexes: [entry.curveIndex] },
        ];
      }
      return entries.map((candidate) => candidate.tick === entry.tick
        ? {
            tick: candidate.tick,
            grossLiquidity: candidate.grossLiquidity + entry.liquidity,
            curveIndexes: candidate.curveIndexes.includes(entry.curveIndex)
              ? candidate.curveIndexes
              : [...candidate.curveIndexes, entry.curveIndex],
          }
        : candidate);
    }, []);

  const overflow = grossLiquidityByTick.find((entry) => entry.grossLiquidity > MAX_LIQUIDITY_PER_TICK);
  if (overflow) {
    return { tick: overflow.tick, curveIndexes: [...overflow.curveIndexes].sort((a, b) => a - b) };
  }

  return null;
}

function validateAndNormalizeSegments(
  rawSegments: unknown[],
  totalCurveSupplyTokens: number,
  tickSpacing: number,
): LiquidCurvesValidationResult {
  if (rawSegments.length === 0) {
    return { isValid: false, error: 'empty', errorMessage: 'Please add at least one curve segment' };
  }

  const normalizedResults = rawSegments.map((segment) => normalizeSegment(segment, tickSpacing));
  const invalidResult = normalizedResults.find(
    (result): result is Extract<NormalizedSegmentResult, { isValid: false }> => !result.isValid,
  );
  if (invalidResult !== undefined) {
    return invalidResult.result;
  }

  const parsedEntries = normalizedResults
    .filter((result): result is Extract<NormalizedSegmentResult, { isValid: true }> => result.isValid)
    .map((result) => result.entry);

  const totalPositions = parsedEntries.reduce((sum, entry) => sum + entry.segment.numPositions, 0);
  if (totalPositions > MAX_TOTAL_POSITIONS) {
    return {
      isValid: false,
      error: 'too-many-positions',
      errorMessage: `Total positions across all curves must not exceed ${MAX_TOTAL_POSITIONS}`,
    };
  }

  const sortedEntries = [...parsedEntries].sort((a, b) => a.segment.tickLower - b.segment.tickLower);
  const hasGapOrOverlap = sortedEntries
    .slice(1)
    .some((current, index) => current.segment.tickLower !== sortedEntries[index]?.segment.tickUpper);
  if (hasGapOrOverlap) {
    return {
      isValid: false,
      error: 'segment-overlap',
      errorMessage: 'Curve segments must be contiguous (no overlap or gaps)',
    };
  }

  const shareSum = sortedEntries.reduce((sum, entry) => sum + entry.shareScaledUnits, 0n);
  if (shareSum !== SHARE_SCALE_UNITS) {
    return { isValid: false, error: 'share-sum-invalid', errorMessage: 'Curve share values must add up to 1' };
  }

  const sortedSegments = sortedEntries.map((entry) => entry.segment);
  const narrowSegment = sortedSegments.find((segment) => {
    const minSpan = segment.numPositions * tickSpacing;
    return segment.tickUpper - segment.tickLower < minSpan ||
      computeGrossLiquidityAtFarTick(segment.tickLower, segment.tickUpper - segment.tickLower, segment.numPositions, Number(segment.shares), totalCurveSupplyTokens) > MAX_LIQUIDITY_PER_TICK;
  });
  if (narrowSegment) {
    return {
      isValid: false,
      error: 'tick-span-too-narrow',
      errorMessage: 'One or more curve segments have too narrow a tick range for their positions and share allocation.',
    };
  }

  const overflow = getGrossLiquidityOverflow(sortedSegments, totalCurveSupplyTokens, tickSpacing);
  if (overflow) {
    return {
      isValid: false,
      error: 'tick-span-too-narrow',
      errorMessage: `Curve segments create too much stacked liquidity at tick ${overflow.tick}. Widen the price range or reduce positions/share.`,
    };
  }

  return { isValid: true, curves: sortedSegments };
}

function normalizeSegment(segment: unknown, tickSpacing: number): NormalizedSegmentResult {
  if (!isRecord(segment)) {
    return invalidSegmentResult();
  }

  const tickLower = toValidNumber(segment.tickLower);
  const tickUpper = toValidNumber(segment.tickUpper);
  const numPositions = toValidNumber(segment.numPositions);
  const share = toNormalizedShare(segment.shares);
  if (tickLower === null || tickUpper === null || numPositions === null || share === null) {
    return invalidSegmentResult();
  }
  if (!Number.isInteger(tickLower) || !Number.isInteger(tickUpper) || !Number.isInteger(numPositions) || numPositions <= 0) {
    return invalidSegmentResult();
  }
  if (tickLower % tickSpacing !== 0 || tickUpper % tickSpacing !== 0) {
    return { isValid: false, result: { isValid: false, error: 'tick-spacing-invalid', errorMessage: `Ticks must align to spacing ${tickSpacing}` } };
  }
  if (tickLower < MIN_TICK || tickUpper > MAX_TICK) {
    return { isValid: false, result: { isValid: false, error: 'tick-out-of-bounds', errorMessage: `Ticks must be within Uniswap V4 bounds (${MIN_TICK} to ${MAX_TICK})` } };
  }
  if (tickLower >= tickUpper) {
    return invalidSegmentResult();
  }

  return {
    isValid: true,
    entry: {
      segment: {
        tickLower,
        tickUpper,
        numPositions,
        shares: share.decimal,
      },
      shareScaledUnits: share.scaledUnits,
    },
  };
}

function invalidSegmentResult(): NormalizedSegmentResult {
  return { isValid: false, result: { isValid: false, error: 'invalid-segment', errorMessage: 'Invalid curve segment values' } };
}

export function parseCurveConfig(
  value: string,
  totalCurveSupplyTokens: LiquidCurveSupplyAmount,
  tickSpacing: number,
): LiquidCurveSegment[] {
  const parsed = parseCurveConfigJson(value);
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid curve JSON');
  }

  const totalCurveSupplyApproxTokens = toApproxTokenAmount(totalCurveSupplyTokens, 'curve pool supply');
  const validation = validateAndNormalizeSegments(parsed, totalCurveSupplyApproxTokens, tickSpacing);
  if (!validation.isValid || !validation.curves) {
    throw new Error(validation.errorMessage ?? 'Invalid curve configuration');
  }
  return validation.curves;
}

function parseCurveConfigJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Invalid curve JSON');
  }
}

export function validateCurves(
  curves: LiquidCurveSegment[],
  config: Pick<LiquidFactoryConfig, 'curvePoolSupplyTokens' | 'poolTickSpacing'>,
): LiquidCurvesValidationResult {
  const totalCurveSupplyApproxTokens = toApproxTokenAmount(config.curvePoolSupplyTokens, 'curve pool supply');
  return validateAndNormalizeSegments(curves, totalCurveSupplyApproxTokens, config.poolTickSpacing);
}

function tokenPriceCurveToSegments(
  segments: TokenPriceCurveInput[],
  tickSpacing: number,
  totalCurveSupplyApproxTokens: number,
): LiquidCurveSegment[] {
  if (segments.length === 0) {
    throw new Error('Please add at least one curve segment');
  }

  const shareSum = segments.reduce((sum, segment) => sum + segment.sharesPercent, 0);
  if (Math.abs(shareSum - 100) > SHARES_SUM_TOLERANCE) {
    throw new Error('Curve share values must add up to 100');
  }

  const customCurve = segments.map((segment, index) => {
    if (!Number.isInteger(segment.numPositions) || segment.numPositions <= 0) {
      throw new Error('Curve positions must be positive integers');
    }
    if (!isPositiveFiniteNumber(segment.startTokenPrice) || !isPositiveFiniteNumber(segment.endTokenPrice)) {
      throw new Error('Token prices must be greater than 0');
    }
    if (segment.startTokenPrice >= segment.endTokenPrice) {
      throw new Error('Start token price must be lower than end token price');
    }
    if (!isPositiveFiniteNumber(segment.sharesPercent) || segment.sharesPercent > 100) {
      throw new Error('Share percent must be greater than 0 and at most 100');
    }

    const tickLower = tokenPriceToTick(segment.startTokenPrice, tickSpacing);
    const tickUpper = tokenPriceToTick(segment.endTokenPrice, tickSpacing);
    if (tickUpper <= tickLower) {
      throw new Error('Start token price must be lower than end token price');
    }
    const previousSegment = index === 0 ? undefined : segments[index - 1];
    const previousTickUpper =
      previousSegment === undefined
        ? null
        : tokenPriceToTick(previousSegment.endTokenPrice, tickSpacing);
    if (previousTickUpper !== null && tickLower !== previousTickUpper) {
      throw new Error('Curve ranges must touch each other (no overlap and no gaps)');
    }

    return {
      tickLower,
      tickUpper,
      numPositions: segment.numPositions,
      shares: formatShareDecimal(segment.sharesPercent / 100),
    };
  });

  return parseCurveConfig(JSON.stringify(customCurve), totalCurveSupplyApproxTokens, tickSpacing);
}

function usdTokenPriceCurveToSegments(
  segments: UsdTokenPriceCurveInput[],
  rarePriceUsd: number,
  tickSpacing: number,
  totalCurveSupplyApproxTokens: number,
): LiquidCurveSegment[] {
  return tokenPriceCurveToSegments(
    segments.map((segment) => ({
      startTokenPrice: usdToRarePerToken(segment.startTokenPriceUsd, rarePriceUsd),
      endTokenPrice: usdToRarePerToken(segment.endTokenPriceUsd, rarePriceUsd),
      numPositions: segment.numPositions,
      sharesPercent: segment.sharesPercent,
    })),
    tickSpacing,
    totalCurveSupplyApproxTokens,
  );
}

export function generatePresetCurves(
  preset: CurvePresetKey,
  rarePriceUsd: number,
  config: Pick<LiquidFactoryConfig, 'curvePoolSupplyTokens' | 'poolTickSpacing'>,
): LiquidCurveSegment[] {
  const totalCurveSupplyApproxTokens = toApproxTokenAmount(config.curvePoolSupplyTokens, 'curve pool supply');
  return usdTokenPriceCurveToSegments(
    getUsdTokenPriceCurveInputsForPresetWithReserveTail(preset),
    rarePriceUsd,
    config.poolTickSpacing,
    totalCurveSupplyApproxTokens,
  );
}

export function buildCurvePreview(
  curves: LiquidCurveSegment[],
  factoryConfig: Pick<
    LiquidFactoryConfig,
    'curvePoolSupplyTokens' | 'maxTotalSupplyTokens' | 'creatorLaunchRewardTokens' | 'baseToken'
  >,
  rarePriceUsd?: number,
): LiquidCurvePreview {
  return {
    totalPositions: curves.reduce((sum, curve) => sum + curve.numPositions, 0),
    totalShare: curves.reduce((sum, curve) => sum + Number(curve.shares), 0),
    curvePoolSupplyTokens: factoryConfig.curvePoolSupplyTokens,
    maxTotalSupplyTokens: factoryConfig.maxTotalSupplyTokens,
    creatorLaunchRewardTokens: factoryConfig.creatorLaunchRewardTokens,
    baseToken: factoryConfig.baseToken,
    rarePriceUsd,
    segments: curves.map((curve) => ({
      ...curve,
      startTokenPriceUsd: rarePriceUsd !== undefined ? tickToTokenPriceUsd(curve.tickLower, rarePriceUsd) : undefined,
      endTokenPriceUsd: rarePriceUsd !== undefined ? tickToTokenPriceUsd(curve.tickUpper, rarePriceUsd) : undefined,
    })),
  };
}

export function getCurvePresetDefinition(preset: CurvePresetKey): CurvePresetDescription {
  const definition = CURVE_PRESET_DEFINITIONS[preset];
  return { title: definition.title, description: definition.description };
}
