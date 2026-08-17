import { formatUnits, type Address } from 'viem';

export type LiquidFactoryConfig = {
  baseToken: Address;
  maxTotalSupplyWei: bigint;
  creatorLaunchRewardWei: bigint;
  curvePoolSupplyWei: bigint;
  minRareLiquidityWei: bigint;
  maxTotalSupplyTokens: string;
  creatorLaunchRewardTokens: string;
  curvePoolSupplyTokens: string;
  minRareLiquidityTokens: string;
  lpTickLower: number;
  lpTickUpper: number;
  poolTickSpacing: number;
}

export type LiquidTokenAmountInput = bigint;

export type LiquidTokenSupplyAmountError =
  | 'invalid-decimal'
  | 'non-finite-number'
  | 'unsafe-number'
  | 'too-many-decimals'
  | 'not-positive'
  | 'below-creator-launch-reward';

export type LiquidTokenSupplyAmountResult =
  | { isValid: true; amountWei: bigint }
  | { isValid: false; error: LiquidTokenSupplyAmountError; errorMessage: string };

export type LiquidFactoryConfigForSupplyResult =
  | { isValid: true; factoryConfig: LiquidFactoryConfig; totalSupplyWei?: bigint }
  | { isValid: false; error: LiquidTokenSupplyAmountError; errorMessage: string };

function formatTokenAmount(value: bigint, label: string): string {
  if (value < 0n) {
    throw new Error(`Liquid factory ${label} is invalid`);
  }
  return formatUnits(value, 18);
}

function parseTick(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`Liquid factory ${label} is invalid`);
  }
  return value;
}

export function deriveLiquidFactoryConfig(
  baseToken: Address,
  maxTotalSupplyWei: bigint,
  creatorLaunchRewardWei: bigint,
  minRareLiquidityWei: bigint,
  poolConfig: {
    lpTickLower: number;
    lpTickUpper: number;
    poolTickSpacing: number;
  },
): LiquidFactoryConfig {
  if (maxTotalSupplyWei <= 0n) {
    throw new Error('Liquid factory maxTotalSupply must be greater than 0');
  }
  if (creatorLaunchRewardWei < 0n) {
    throw new Error('Liquid factory creatorLaunchReward cannot be negative');
  }
  if (creatorLaunchRewardWei > maxTotalSupplyWei) {
    throw new Error('Liquid factory creatorLaunchReward exceeds maxTotalSupply');
  }
  if (minRareLiquidityWei < 0n) {
    throw new Error('Liquid factory minRareLiquidityWei cannot be negative');
  }

  const curvePoolSupplyWei = maxTotalSupplyWei - creatorLaunchRewardWei;
  if (curvePoolSupplyWei <= 0n) {
    throw new Error('Liquid factory curve pool supply must be greater than 0');
  }

  const lpTickLower = parseTick(poolConfig.lpTickLower, 'lpTickLower');
  const lpTickUpper = parseTick(poolConfig.lpTickUpper, 'lpTickUpper');
  const poolTickSpacing = parseTick(poolConfig.poolTickSpacing, 'poolTickSpacing');

  if (poolTickSpacing <= 0) {
    throw new Error('Liquid factory poolTickSpacing must be greater than 0');
  }
  if (lpTickLower >= lpTickUpper) {
    throw new Error('Liquid factory lpTickLower must be less than lpTickUpper');
  }
  if (lpTickLower % poolTickSpacing !== 0 || lpTickUpper % poolTickSpacing !== 0) {
    throw new Error('Liquid factory LP ticks must align to poolTickSpacing');
  }

  return {
    baseToken,
    maxTotalSupplyWei,
    creatorLaunchRewardWei,
    curvePoolSupplyWei,
    minRareLiquidityWei,
    maxTotalSupplyTokens: formatTokenAmount(maxTotalSupplyWei, 'maxTotalSupply'),
    creatorLaunchRewardTokens: formatTokenAmount(creatorLaunchRewardWei, 'creatorLaunchReward'),
    curvePoolSupplyTokens: formatTokenAmount(curvePoolSupplyWei, 'curve pool supply'),
    minRareLiquidityTokens: formatTokenAmount(minRareLiquidityWei, 'minRareLiquidityWei'),
    lpTickLower,
    lpTickUpper,
    poolTickSpacing,
  };
}

function invalidSupplyAmount(error: LiquidTokenSupplyAmountError, errorMessage: string): LiquidTokenSupplyAmountResult {
  return { isValid: false, error, errorMessage };
}

export function parseLiquidTokenSupplyAmount(
  value: LiquidTokenAmountInput,
  field = 'totalSupply',
): LiquidTokenSupplyAmountResult {
  if (value <= 0n) {
    return invalidSupplyAmount('not-positive', `${field} must be greater than 0.`);
  }
  return { isValid: true, amountWei: value };
}

export function withLiquidFactoryMaxTotalSupply(
  factoryConfig: LiquidFactoryConfig,
  maxTotalSupplyWei: bigint,
): LiquidFactoryConfig {
  return deriveLiquidFactoryConfig(
    factoryConfig.baseToken,
    maxTotalSupplyWei,
    factoryConfig.creatorLaunchRewardWei,
    factoryConfig.minRareLiquidityWei,
    {
      lpTickLower: factoryConfig.lpTickLower,
      lpTickUpper: factoryConfig.lpTickUpper,
      poolTickSpacing: factoryConfig.poolTickSpacing,
    },
  );
}

export function resolveLiquidFactoryConfigForSupply(
  factoryConfig: LiquidFactoryConfig,
  totalSupply?: LiquidTokenAmountInput,
): LiquidFactoryConfigForSupplyResult {
  if (totalSupply === undefined) {
    return { isValid: true, factoryConfig };
  }

  const parsed = parseLiquidTokenSupplyAmount(totalSupply);
  if (!parsed.isValid) {
    return parsed;
  }
  if (parsed.amountWei <= factoryConfig.creatorLaunchRewardWei) {
    return {
      isValid: false,
      error: 'below-creator-launch-reward',
      errorMessage: 'totalSupply must be greater than the Liquid factory creator launch reward.',
    };
  }

  return {
    isValid: true,
    factoryConfig: withLiquidFactoryMaxTotalSupply(factoryConfig, parsed.amountWei),
    totalSupplyWei: parsed.amountWei,
  };
}
