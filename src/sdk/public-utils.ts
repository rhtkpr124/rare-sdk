import {
  buildBatchTokenTreeArtifact,
  getBatchTokenProof,
  normalizeBytes32,
  normalizeTokenId,
  parseBatchTokenListArtifactOrBuild,
  parseBatchTokenProofInput,
  validateBatchTokenProofInputMatchesTarget,
  verifyBatchTokenProof,
} from './batch-core.js';
import { buildMerkleProofArtifact, validateProofArtifact, validateRootArtifact } from './merkle-core.js';
import {
  parseBatchListingCreateRootArtifactInput,
  planBatchListingCreateArtifact,
} from './batch-listing-core.js';
import {
  buildReleaseAllowlistArtifactFromInput,
  getReleaseAllowlistProof,
  normalizeReleaseAllowlistProof,
  normalizeReleasePrice,
  normalizeReleaseStartTime,
  planReleaseAllowlistConfig,
  parseReleaseAllowlistArtifactJson,
} from './release-core.js';
export { getCurvePresetDefinition, parseCurveConfig } from '../liquid/curve-config.js';
export type {
  CurvePresetDescription,
  CurvePresetKey,
  LiquidCurveSegment,
  LiquidCurveSupplyAmount,
} from '../liquid/curve-config.js';
import type {
  BuildUtilsTreeParams,
  UtilsBuildBatchListingArtifactParams,
  UtilsBuildBatchListingArtifactResult,
  UtilsTreeArtifact,
  UtilsTreeProofArtifact,
  UtilsTreeProofParams,
  UtilsTreeProofVerifyParams,
  UtilsValidateReleaseAllowlistParams,
  UtilsValidatedReleaseAllowlist,
} from './types/utils.js';
import type { UtilsMerkleProofArtifact, UtilsMerkleProofParams } from './types/utils.js';

export type {
  BuildUtilsTreeParams,
  UtilsTreeArtifact,
  UtilsTreeProofArtifact,
  UtilsTreeProofParams,
  UtilsTreeProofVerifyParams,
  UtilsMerkleProofArtifact,
  UtilsMerkleProofParams,
  UtilsParseCurveConfigParams,
  UtilsBuildBatchListingArtifactParams,
  UtilsBuildBatchListingArtifactResult,
  UtilsValidateReleaseAllowlistParams,
  UtilsValidatedReleaseAllowlist,
} from './types/utils.js';

export function buildUtilsTree(params: BuildUtilsTreeParams): UtilsTreeArtifact {
  return buildBatchTokenTreeArtifact(params);
}

export function getUtilsTreeProof(params: UtilsTreeProofParams): UtilsTreeProofArtifact {
  return getBatchTokenProof(params);
}

export function verifyUtilsTreeProof(params: UtilsTreeProofVerifyParams): boolean {
  return verifyBatchTokenProof(params);
}

export function buildUtilsMerkleProof(params: UtilsMerkleProofParams): UtilsMerkleProofArtifact {
  return buildMerkleProofArtifact(params.artifact, params.contract, params.tokenId, params.buyer);
}

// Offline artifact helpers. These intentionally expose stable consumer operations,
// while the representation-specific planners remain internal implementation details.
export const parseUtilsTreeInput = parseBatchTokenListArtifactOrBuild;
export const parseUtilsTreeProof = parseBatchTokenProofInput;
export const validateUtilsTreeProofTarget = validateBatchTokenProofInputMatchesTarget;
export const normalizeUtilsMerkleRoot = normalizeBytes32;
export const normalizeUtilsTokenId = normalizeTokenId;
export const parseUtilsBatchListingArtifact = parseBatchListingCreateRootArtifactInput;
/**
 * Builds and validates a portable batch-listing root artifact.
 *
 * @throws When overrides are incomplete, splits are invalid, or the resulting
 * artifact cannot be registered by the batch-listing contract.
 */
export function buildUtilsBatchListingArtifact(
  params: UtilsBuildBatchListingArtifactParams,
): UtilsBuildBatchListingArtifactResult {
  return params.source === 'root-artifact'
    ? planBatchListingCreateArtifact({
        kind: 'root-artifact',
        artifact: params.artifact,
        currencyOverride: params.currency,
        amountOverride: params.price,
        splitAddresses: params.splitAddresses,
        splitRatios: params.splitRatios,
      })
    : planBatchListingCreateArtifact({
        kind: 'token-tree',
        artifact: params.artifact,
        currency: params.currency,
        amount: params.price,
        splitAddresses: params.splitAddresses,
        splitRatios: params.splitRatios,
      });
}
export const validateUtilsMerkleRootArtifact = validateRootArtifact;
export const validateUtilsMerkleProofArtifact = validateProofArtifact;

export const buildUtilsReleaseAllowlist = buildReleaseAllowlistArtifactFromInput;
export const getUtilsReleaseAllowlistProof = getReleaseAllowlistProof;
export const normalizeUtilsReleaseAllowlistProof = normalizeReleaseAllowlistProof;
export const normalizeUtilsReleasePrice = normalizeReleasePrice;
export const normalizeUtilsReleaseStartTime = normalizeReleaseStartTime;
/**
 * Validates and normalizes a release allowlist configuration without I/O.
 *
 * @throws When neither a root nor artifact is supplied, the root is malformed,
 * or `endTime` is not a valid positive timestamp.
 */
export function validateUtilsReleaseAllowlistConfig(
  params: UtilsValidateReleaseAllowlistParams,
): UtilsValidatedReleaseAllowlist {
  return planReleaseAllowlistConfig(params);
}
export const parseUtilsReleaseAllowlistArtifact = parseReleaseAllowlistArtifactJson;
