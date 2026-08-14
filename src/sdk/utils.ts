import type { UtilsNamespace } from './types/utils.js';
import {
  buildBatchTokenTreeArtifact,
  getBatchTokenProof,
  verifyBatchTokenProof,
} from './batch-core.js';
import { buildMerkleProofArtifact } from './merkle-core.js';
import { getCurvePresetDefinition, parseCurveConfig } from '../liquid/curve-config.js';

export type * from './types/utils.js';

export function createUtilsNamespace(): UtilsNamespace {
  return {
    tree: {
      build(params): ReturnType<UtilsNamespace['tree']['build']> {
        return buildBatchTokenTreeArtifact(params);
      },

      proof(params): ReturnType<UtilsNamespace['tree']['proof']> {
        return getBatchTokenProof(params);
      },

      verify(params): ReturnType<UtilsNamespace['tree']['verify']> {
        return verifyBatchTokenProof(params);
      },
    },

    merkle: {
      proof(params): ReturnType<UtilsNamespace['merkle']['proof']> {
        return buildMerkleProofArtifact(params.artifact, params.contract, params.tokenId, params.buyer);
      },
    },

    liquidCurve: {
      getPresetDefinition(preset): ReturnType<UtilsNamespace['liquidCurve']['getPresetDefinition']> {
        return getCurvePresetDefinition(preset);
      },

      parseConfig(params): ReturnType<UtilsNamespace['liquidCurve']['parseConfig']> {
        return parseCurveConfig(params.value, params.totalCurveSupplyTokens, params.tickSpacing);
      },
    },
  };
}
