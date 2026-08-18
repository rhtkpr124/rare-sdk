import type { RareUtilsNamespace } from './types/utils.js';
import {
  buildBatchTokenTreeArtifact,
  getBatchTokenProof,
  verifyBatchTokenProof,
} from './batch-core.js';
import { buildMerkleProofArtifact } from './merkle-core.js';
import { getCurvePresetDefinition, parseCurveConfig } from '../liquid/curve-config.js';
import { applyCartQuoteSpread, buildCartListingRootArtifact, buildCartOrder, buildCartPayoutRoute } from './cart-core.js';

export type * from './types/utils.js';

export function createUtilsNamespace(): RareUtilsNamespace {
  return {
    cart: {
      buildListingRoot: buildCartListingRootArtifact,
      buildOrder: buildCartOrder,
      applyQuoteSpread: applyCartQuoteSpread,
      buildRoute: buildCartPayoutRoute,
    },
    tree: {
      build(params): ReturnType<RareUtilsNamespace['tree']['build']> {
        return buildBatchTokenTreeArtifact(params);
      },

      proof(params): ReturnType<RareUtilsNamespace['tree']['proof']> {
        return getBatchTokenProof(params);
      },

      verify(params): ReturnType<RareUtilsNamespace['tree']['verify']> {
        return verifyBatchTokenProof(params);
      },
    },

    merkle: {
      proof(params): ReturnType<RareUtilsNamespace['merkle']['proof']> {
        return buildMerkleProofArtifact(params.artifact, params.contract, params.tokenId, params.buyer);
      },
    },

    liquidCurve: {
      getPresetDefinition(preset): ReturnType<RareUtilsNamespace['liquidCurve']['getPresetDefinition']> {
        return getCurvePresetDefinition(preset);
      },

      parseConfig(params): ReturnType<RareUtilsNamespace['liquidCurve']['parseConfig']> {
        return parseCurveConfig(params.value, params.totalCurveSupplyTokens, params.tickSpacing);
      },
    },
  };
}
