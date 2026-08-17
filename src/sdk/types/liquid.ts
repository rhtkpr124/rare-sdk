import type { LiquidEdition } from '../api.js';
import type { Address, Hex } from 'viem';
import type { CurvePresetKey, LiquidCurvePreview, LiquidCurveSegment } from '../../liquid/curve-config.js';
import type { LiquidFactoryConfig } from '../../liquid/factory-config.js';
import type { AmountInput, TransactionResult } from './common.js';

export type GeneratePresetCurvesParams = {
  preset: CurvePresetKey;
  totalSupply?: AmountInput;
}

export type GeneratePresetCurvesResult = {
  preset: CurvePresetKey;
  rarePriceUsd: number;
  curves: LiquidCurveSegment[];
  preview: LiquidCurvePreview;
}

export type ValidateLiquidCurvesParams = {
  curves: LiquidCurveSegment[];
  totalSupply?: AmountInput;
}

export type DeployLiquidEditionParams = {
  name: string;
  symbol: string;
  tokenUri: string;
  initialRareLiquidity?: AmountInput;
  totalSupply?: AmountInput;
  curves: LiquidCurveSegment[];
  autoApprove?: boolean;
}

export type DeployLiquidEditionResult = {
  contract: Address;
  tokenUri: string;
  curves: LiquidCurveSegment[];
} & TransactionResult

export type LiquidEditionPoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

export type LiquidEditionPoolInfo = {
  contract: Address;
  poolId: Hex;
  poolKey: LiquidEditionPoolKey;
}

export type LiquidEditionMarketState = {
  rarePerToken: bigint;
  tokenPerRare: bigint;
  sqrtPriceX96: bigint;
  currentTick: number;
  liquidity: bigint;
  currentSupply: bigint;
}

export type LiquidEditionCurrentPrice = {
  contract: Address;
  rarePerToken: bigint;
  tokenPerRare: bigint;
}

export type LiquidEditionTelemetry = {
  contract: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  maxTotalSupply: bigint;
  poolLaunchSupply: bigint;
  creatorLaunchReward: bigint;
  baseToken: Address;
  tokenCreator: Address;
  initialTokenUri: string;
  tokenUri: string;
  renderContract: Address;
  poolManager: Address;
  pool: LiquidEditionPoolInfo;
  lpTickLower: number;
  lpTickUpper: number;
  lpLiquidity: bigint;
  totalLiquidity: bigint;
  marketState: LiquidEditionMarketState;
  currentPrice: LiquidEditionCurrentPrice;
}

export type SetLiquidEditionRenderContractParams = {
  contract: Address;
  renderContract: Address;
}

export type SetLiquidEditionRenderContractResult = {
  contract: Address;
  renderContract: Address;
} & TransactionResult

export type LiquidEditionNamespace = {
  /** Indexed public discovery data for an edition on the client chain. */
  get: (params: { contract: Address }) => Promise<LiquidEdition>;
  getFactoryConfig: (params?: { totalSupply?: AmountInput }) => Promise<LiquidFactoryConfig>;
  generatePresetCurves: (params: GeneratePresetCurvesParams) => Promise<GeneratePresetCurvesResult>;
  validateCurves: (params: ValidateLiquidCurvesParams) => Promise<LiquidCurvePreview>;
  deploy: {
    multiCurve: (params: DeployLiquidEditionParams) => Promise<DeployLiquidEditionResult>;
  };
  getTokenUri: (params: { contract: Address }) => Promise<string>;
  getRenderContract: (params: { contract: Address }) => Promise<Address>;
  setRenderContract: (params: SetLiquidEditionRenderContractParams) => Promise<SetLiquidEditionRenderContractResult>;
  getPoolInfo: (params: { contract: Address }) => Promise<LiquidEditionPoolInfo>;
  getMarketState: (params: { contract: Address }) => Promise<LiquidEditionMarketState>;
  getCurrentPrice: (params: { contract: Address }) => Promise<LiquidEditionCurrentPrice>;
  status: (params: { contract: Address }) => Promise<LiquidEditionTelemetry>;
}
