import type { Address, Hex } from 'viem';
import type {
  BuildUtilsTreeParams,
  UtilsTreeArtifact,
  UtilsTreeProofArtifact,
  UtilsTreeProofParams,
  UtilsTreeProofVerifyParams,
} from '../batch-core.js';
import type { UtilsMerkleProofArtifact, UtilsMerkleProofParams } from './batch-listing.js';
import type { BatchListingRootArtifact } from './batch-listing.js';
import type { TimestampInput } from './common.js';
import type { ReleaseAllowlistArtifact } from './release.js';
import type {
  CurvePresetDescription,
  CurvePresetKey,
  LiquidCurveSegment,
  LiquidCurveSupplyAmount,
} from '../../liquid/curve-config.js';

export type {
  BuildUtilsTreeParams,
  UtilsTreeArtifact,
  UtilsTreeProofArtifact,
  UtilsTreeProofParams,
  UtilsTreeProofVerifyParams,
} from '../batch-core.js';
export type { UtilsMerkleProofArtifact, UtilsMerkleProofParams } from './batch-listing.js';
export type {
  CurvePresetDescription,
  CurvePresetKey,
  LiquidCurveSegment,
  LiquidCurveSupplyAmount,
} from '../../liquid/curve-config.js';

export type UtilsParseCurveConfigParams = {
  value: string;
  totalCurveSupplyTokens: LiquidCurveSupplyAmount;
  tickSpacing: number;
};

export type UtilsBuildBatchListingArtifactParams =
  | {
      source: 'root-artifact';
      artifact: BatchListingRootArtifact;
      currency?: Address;
      price?: string;
      splitAddresses?: Address[];
      splitRatios?: number[];
    }
  | {
      source: 'token-tree';
      artifact: UtilsTreeArtifact;
      currency: Address;
      price: string;
      splitAddresses?: Address[];
      splitRatios?: number[];
    };

export type UtilsBuildBatchListingArtifactResult = BatchListingRootArtifact;

export type UtilsValidateReleaseAllowlistParams = {
  contract: Address;
  root?: Hex;
  artifact?: ReleaseAllowlistArtifact;
  endTime: TimestampInput;
};

export type UtilsValidatedReleaseAllowlist = {
  contract: Address;
  root: Hex;
  endTimestamp: bigint;
};

export type UtilsNamespace = {
  tree: {
    build: (params: BuildUtilsTreeParams) => UtilsTreeArtifact;
    proof: (params: UtilsTreeProofParams) => UtilsTreeProofArtifact;
    verify: (params: UtilsTreeProofVerifyParams) => boolean;
  };
  merkle: {
    proof: (params: UtilsMerkleProofParams) => UtilsMerkleProofArtifact;
  };
  liquidCurve: {
    getPresetDefinition: (preset: CurvePresetKey) => CurvePresetDescription;
    parseConfig: (params: UtilsParseCurveConfigParams) => LiquidCurveSegment[];
  };
}
