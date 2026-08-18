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
import type { BuildCartListingRootParams, BuildCartOrderParams, BuildCartRouteParams, CartListingAuthorizationBundle, CartListingRootArtifact, CartListingRootArtifactEntry, CartListingSelection, CartPayoutRoute, CartSignedOrder } from './cart.js';

export type {
  BuildUtilsTreeParams,
  UtilsTreeArtifact,
  UtilsTreeProofArtifact,
  UtilsTreeProofParams,
  UtilsTreeProofVerifyParams,
} from '../batch-core.js';
export type BuildBatchTokenTreeParams = BuildUtilsTreeParams;
export type BatchTokenTreeArtifact = UtilsTreeArtifact;
export type BatchTokenTreeProofArtifact = UtilsTreeProofArtifact;
export type BatchTokenTreeProofParams = UtilsTreeProofParams;
export type BatchTokenTreeProofVerifyParams = UtilsTreeProofVerifyParams;
export type { UtilsMerkleProofArtifact, UtilsMerkleProofParams } from './batch-listing.js';
export type {
  CurvePresetDescription,
  CurvePresetKey,
  LiquidCurveSegment,
  LiquidCurveSupplyAmount,
} from '../../liquid/curve-config.js';

export type ParseCurveConfigParams = {
  value: string;
  totalCurveSupplyTokens: LiquidCurveSupplyAmount;
  tickSpacing: number;
};

export type BuildBatchListingArtifactParams =
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
      artifact: BatchTokenTreeArtifact;
      currency: Address;
      price: string;
      splitAddresses?: Address[];
      splitRatios?: number[];
    };

export type BuildBatchListingArtifactResult = BatchListingRootArtifact;

export type NormalizeReleaseAllowlistConfigParams = {
  contract: Address;
  root?: Hex;
  artifact?: ReleaseAllowlistArtifact;
  endTime: TimestampInput;
};

export type NormalizedReleaseAllowlistConfig = {
  contract: Address;
  root: Hex;
  endTimestamp: bigint;
};

export type RareUtilsNamespace = {
  cart: {
    buildListingRoot: (params: BuildCartListingRootParams) => CartListingRootArtifact;
    parseListingArtifact: (content: string) => CartListingRootArtifact;
    validateListingArtifact: (artifact: unknown) => asserts artifact is CartListingRootArtifact;
    getListingEntry: (artifact: CartListingRootArtifact, listingDigest: Hex) => CartListingRootArtifactEntry | undefined;
    buildListingAuthorization: (selections: readonly CartListingSelection[]) => CartListingAuthorizationBundle;
    buildOrder: (params: BuildCartOrderParams) => Omit<CartSignedOrder, 'platformSignature'>;
    applyQuoteSpread: (estimatedInput: bigint, spreadBps: bigint) => bigint;
    buildRoute: (params: BuildCartRouteParams) => CartPayoutRoute;
  };
  tree: {
    build: (params: BuildBatchTokenTreeParams) => BatchTokenTreeArtifact;
    proof: (params: BatchTokenTreeProofParams) => BatchTokenTreeProofArtifact;
    verify: (params: BatchTokenTreeProofVerifyParams) => boolean;
  };
  merkle: {
    proof: (params: UtilsMerkleProofParams) => UtilsMerkleProofArtifact;
  };
  liquidCurve: {
    getPresetDefinition: (preset: CurvePresetKey) => CurvePresetDescription;
    parseConfig: (params: ParseCurveConfigParams) => LiquidCurveSegment[];
  };
};
