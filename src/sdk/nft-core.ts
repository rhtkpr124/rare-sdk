import { getAddress, type Address } from 'viem';
import { chainIds, isSupportedChain, type SupportedChain } from '../contracts/addresses.js';
import type { IntegerInput } from './types/common.js';
import { toInteger } from './amounts-core.js';

export type NftIdentityParams = {
  chain?: SupportedChain;
  chainId?: IntegerInput;
  contract: Address;
  tokenId: IntegerInput;
}

export function buildNftUniversalTokenId(params: NftIdentityParams): string {
  const chainId = resolveIdentityChainId(params);
  const tokenId = toInteger(params.tokenId, 'tokenId');
  if (tokenId < 0n) {
    throw new Error('tokenId must be greater than or equal to 0.');
  }

  return `${chainId.toString()}-${getAddress(params.contract)}-${tokenId.toString()}`;
}

export function resolveIdentityChainId(params: Pick<NftIdentityParams, 'chain' | 'chainId'>): bigint {
  if (params.chainId !== undefined) {
    const chainId = toInteger(params.chainId, 'chainId');
    if (chainId <= 0n) {
      throw new Error('chainId must be greater than 0.');
    }
    return chainId;
  }

  if (params.chain !== undefined) {
    if (!isSupportedChain(params.chain)) {
      throw new Error(`Unsupported chain: ${params.chain}`);
    }
    return BigInt(chainIds[params.chain]);
  }

  throw new Error('Pass chainId or chain.');
}
