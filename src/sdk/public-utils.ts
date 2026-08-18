import {
  buildBatchTokenTreeArtifact as buildBatchTokenTreeInternal,
  getBatchTokenProof as getBatchTokenProofInternal,
  normalizeBytes32,
  normalizeTokenId as normalizeTokenIdInternal,
  parseBatchTokenListArtifactOrBuild,
  parseBatchTokenProofInput,
  validateBatchTokenProofInputMatchesTarget,
  verifyBatchTokenProof as verifyBatchTokenProofInternal,
} from './batch-core.js';
import type { Hex } from 'viem';
import { buildMerkleProofArtifact, validateProofArtifact, validateRootArtifact } from './merkle-core.js';
import {
  parseBatchListingCreateRootArtifactInput,
  planBatchListingCreateArtifact,
} from './batch-listing-core.js';
import {
  buildReleaseAllowlistArtifactFromInput,
  getReleaseAllowlistProof as getReleaseAllowlistProofInternal,
  normalizeReleaseAllowlistProof as normalizeReleaseAllowlistProofInternal,
  normalizeReleasePrice as normalizeReleasePriceInternal,
  normalizeReleaseStartTime as normalizeReleaseStartTimeInternal,
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
  BatchTokenTreeArtifact,
  BatchTokenTreeProofArtifact,
  BatchTokenTreeProofParams,
  BatchTokenTreeProofVerifyParams,
  BuildBatchListingArtifactParams,
  BuildBatchListingArtifactResult,
  BuildBatchTokenTreeParams,
  NormalizedReleaseAllowlistConfig,
  NormalizeReleaseAllowlistConfigParams,
} from './types/utils.js';
import type { UtilsMerkleProofArtifact, UtilsMerkleProofParams } from './types/utils.js';
import { applyCartQuoteSpread, buildCartListingAuthorization, buildCartListingRootArtifact, buildCartOrder, buildCartPayoutRoute, getCartListingArtifactEntry, parseCartListingRootArtifact, validateCartListingRootArtifact } from './cart-core.js';
import type { BuildCartListingRootParams, BuildCartOrderParams, BuildCartRouteParams, CartListingAuthorizationBundle, CartListingRootArtifact, CartListingRootArtifactEntry, CartListingSelection, CartPayoutRoute, CartSignedOrder } from './types/cart.js';

export type {
  BuildBatchTokenTreeParams,
  BatchTokenTreeArtifact,
  BatchTokenTreeProofArtifact,
  BatchTokenTreeProofParams,
  BatchTokenTreeProofVerifyParams,
  UtilsMerkleProofArtifact,
  UtilsMerkleProofParams,
  ParseCurveConfigParams,
  BuildBatchListingArtifactParams,
  BuildBatchListingArtifactResult,
  NormalizeReleaseAllowlistConfigParams,
  NormalizedReleaseAllowlistConfig,
} from './types/utils.js';
export type { BuildCartListingRootParams, BuildCartOrderParams, BuildCartRouteParams, CartListingAuthorizationBundle, CartListingRootArtifact, CartListingRootArtifactEntry, CartListingSelection } from './types/cart.js';

export function buildBatchTokenTree(params: BuildBatchTokenTreeParams): BatchTokenTreeArtifact {
  return buildBatchTokenTreeInternal(params);
}

export function getBatchTokenProof(params: BatchTokenTreeProofParams): BatchTokenTreeProofArtifact {
  return getBatchTokenProofInternal(params);
}

export function verifyBatchTokenProof(params: BatchTokenTreeProofVerifyParams): boolean {
  return verifyBatchTokenProofInternal(params);
}

export function buildMerkleProof(params: UtilsMerkleProofParams): UtilsMerkleProofArtifact {
  return buildMerkleProofArtifact(params.artifact, params.contract, params.tokenId, params.buyer);
}

// Offline artifact helpers. These intentionally expose stable consumer operations,
// while the representation-specific planners remain internal implementation details.
export const parseBatchTokenTreeInput = parseBatchTokenListArtifactOrBuild;
export const parseBatchTokenProof = parseBatchTokenProofInput;
export const validateBatchTokenProofTarget = validateBatchTokenProofInputMatchesTarget;
export const normalizeMerkleRoot = normalizeBytes32;
export const normalizeTokenId = normalizeTokenIdInternal;
export const parseBatchListingArtifact = parseBatchListingCreateRootArtifactInput;
/**
 * Builds and validates a portable batch-listing root artifact.
 *
 * @throws When overrides are incomplete, splits are invalid, or the resulting
 * artifact cannot be registered by the batch-listing contract.
 */
export function buildBatchListingArtifact(
  params: BuildBatchListingArtifactParams,
): BuildBatchListingArtifactResult {
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
export const validateMerkleRootArtifact = validateRootArtifact;
export const validateMerkleProofArtifact = validateProofArtifact;

export const buildReleaseAllowlistArtifact = buildReleaseAllowlistArtifactFromInput;
export const getReleaseAllowlistProof = getReleaseAllowlistProofInternal;
export const normalizeReleaseAllowlistProof = normalizeReleaseAllowlistProofInternal;
export const normalizeReleasePrice = normalizeReleasePriceInternal;
export const normalizeReleaseStartTime = normalizeReleaseStartTimeInternal;
/**
 * Validates and normalizes a release allowlist configuration without I/O.
 *
 * @throws When neither a root nor artifact is supplied, the root is malformed,
 * or `endTime` is not a valid positive timestamp.
 */
export function normalizeReleaseAllowlistConfig(
  params: NormalizeReleaseAllowlistConfigParams,
): NormalizedReleaseAllowlistConfig {
  return planReleaseAllowlistConfig(params);
}
export const parseReleaseAllowlistArtifact = parseReleaseAllowlistArtifactJson;

export function buildCartListingRoot(params: BuildCartListingRootParams): CartListingRootArtifact {
  return buildCartListingRootArtifact(params);
}
export function parseCartListingArtifact(content: string): CartListingRootArtifact { return parseCartListingRootArtifact(content); }
export const validateCartListingArtifact = validateCartListingRootArtifact;
export function getCartListingEntry(artifact: CartListingRootArtifact, listingDigest: Hex): CartListingRootArtifactEntry | undefined {
  return getCartListingArtifactEntry(artifact, listingDigest);
}
export function buildCartListingPurchaseAuthorization(selections: readonly CartListingSelection[]): CartListingAuthorizationBundle {
  return buildCartListingAuthorization(selections);
}

export function buildCartPurchaseOrder(params: BuildCartOrderParams): Omit<CartSignedOrder, 'platformSignature'> {
  return buildCartOrder(params);
}

export { applyCartQuoteSpread };

export function buildCartRoute(params: BuildCartRouteParams): CartPayoutRoute {
  return buildCartPayoutRoute(params);
}
