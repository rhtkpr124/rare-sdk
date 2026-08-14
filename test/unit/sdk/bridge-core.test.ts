import { describe, expect, it } from 'vitest';
import {
  buildBridgeSendArgs,
  encodeBridgeDistribution,
  getBridgeInfo,
  validateBridgeRoute,
} from '../../../src/sdk/bridge-core.js';

const recipient = '0x1111111111111111111111111111111111111111' as const;

describe('bridge core', () => {
  it('allows the four configured RARE bridge routes', () => {
    expect(validateBridgeRoute({ sourceChain: 'mainnet', destinationChain: 'base' })).toEqual({ isValid: true });
    expect(validateBridgeRoute({ sourceChain: 'base', destinationChain: 'mainnet' })).toEqual({ isValid: true });
    expect(validateBridgeRoute({ sourceChain: 'sepolia', destinationChain: 'base-sepolia' })).toEqual({ isValid: true });
    expect(validateBridgeRoute({ sourceChain: 'base-sepolia', destinationChain: 'sepolia' })).toEqual({ isValid: true });
  });

  it('rejects same-chain and mixed-environment routes', () => {
    expect(validateBridgeRoute({ sourceChain: 'mainnet', destinationChain: 'mainnet' })).toEqual({
      isValid: false,
      error: 'unsupported_bridge_route',
      errorMessage: 'Unsupported RARE bridge route "mainnet" -> "mainnet". Supported routes: mainnet <-> base, sepolia <-> base-sepolia.',
    });
    expect(validateBridgeRoute({ sourceChain: 'mainnet', destinationChain: 'base-sepolia' })).toMatchObject({
      isValid: false,
      error: 'unsupported_bridge_route',
    });
    expect(validateBridgeRoute({ sourceChain: 'sepolia', destinationChain: 'base' })).toMatchObject({
      isValid: false,
      error: 'unsupported_bridge_route',
    });
  });

  it('encodes bridge recipient and amount arrays exactly', () => {
    expect(encodeBridgeDistribution({ recipient, amount: 5n })).toBe(
      '0x0000000000000000000000000000000000000000000000000000000000000040' +
      '0000000000000000000000000000000000000000000000000000000000000080' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000001111111111111111111111111111111111111111' +
      '0000000000000000000000000000000000000000000000000000000000000001' +
      '0000000000000000000000000000000000000000000000000000000000000005',
    );
  });

  it('resolves bridge addresses, RARE token addresses, and CCIP selectors', () => {
    expect(getBridgeInfo('mainnet')).toMatchObject({
      chain: 'mainnet',
      chainId: 1,
      rareBridgeAddress: '0x88135DD0e7a8a2e42272DdA89849a997CE2e83f7',
      rareTokenAddress: '0xba5BDe662c17e2aDFF1075610382B9B691296350',
      ccipChainSelector: 5009297550715157269n,
    });
    expect(getBridgeInfo('base-sepolia')).toMatchObject({
      chain: 'base-sepolia',
      chainId: 84532,
      rareBridgeAddress: '0xca491bb62A7730E97F500510132C47633DDD0229',
      rareTokenAddress: '0x8b21bC8571d11F7AdB705ad8F6f6BD1deb79cE01',
      ccipChainSelector: 10344971235874465080n,
    });
  });

  it('builds RareBridge send args for the destination bridge', () => {
    const destination = getBridgeInfo('base');
    const distributionData = encodeBridgeDistribution({ recipient, amount: 5n });

    expect(buildBridgeSendArgs({ destinationBridgeInfo: destination, distributionData })).toEqual([
      15971525489660198786n,
      '0x3b41e21094611D152a08d3691a70837F1A077dAE',
      distributionData,
      '0x',
      false,
    ]);
  });
});
