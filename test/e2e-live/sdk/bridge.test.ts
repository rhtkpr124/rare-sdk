import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../../src/sdk/client.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';
import { getBridgeInfo } from '../../../src/sdk/bridge-core.js';

const describeLive = hasTestRpcUrl() ? describe : describe.skip;

describeLive('SDK bridge integration', () => {
  it('quotes the Sepolia to Base Sepolia RARE bridge fee through real RPC', async () => {
    const rare = createRareClient({ publicClient: createTestSepoliaPublicClient() });

    const quote = await rare.bridge.quote({
      amount: '1',
      destinationChain: 'base-sepolia',
      recipient: '0x1111111111111111111111111111111111111111',
    });

    expect(quote).toMatchObject({
      sourceChain: 'sepolia',
      sourceBridgeAddress: getBridgeInfo('sepolia').rareBridgeAddress,
      destinationChain: 'base-sepolia',
      destinationBridgeAddress: getBridgeInfo('base-sepolia').rareBridgeAddress,
      rareTokenAddress: getBridgeInfo('sepolia').rareTokenAddress,
      destinationCcipChainSelector: getBridgeInfo('base-sepolia').ccipChainSelector,
      amount: 1000000000000000000n,
      recipient: '0x1111111111111111111111111111111111111111',
    });
    expect(quote.nativeFee).toBeGreaterThanOrEqual(0n);
    expect(quote.estimatedGas).toBeUndefined();
  }, 30_000);
});
