import { describe, expect, it } from 'vitest';
import { hashDomain, isAddress, isAddressEqual } from 'viem';
import { createRareClient } from '../../../src/sdk/client.js';
import { cartAbi, getCartAddress, getCartLensAddress } from '../../../src/sdk/contracts.js';
import { cartDomain } from '../../../src/sdk/cart-core.js';
import { createTestSepoliaPublicClient, hasTestRpcUrl } from '../../helpers/liveViem.js';

const describeRpc = hasTestRpcUrl() ? describe : describe.skip;

describeRpc('SDK Cart integration', () => {
  it('matches the deployed Sepolia Cart domain and exposes optional Lens configuration', async () => {
    const publicClient = createTestSepoliaPublicClient();
    const rare = createRareClient({ publicClient });
    const cart = getCartAddress('sepolia');
    const [domainSeparator, platformSigner, paused] = await Promise.all([
      publicClient.readContract({ address: cart, abi: cartAbi, functionName: 'DOMAIN_SEPARATOR' }),
      publicClient.readContract({ address: cart, abi: cartAbi, functionName: 'platformSigner' }),
      publicClient.readContract({ address: cart, abi: cartAbi, functionName: 'paused' }),
    ]);

    expect(domainSeparator).toBe(hashDomain({ domain: { ...cartDomain(11_155_111, cart), chainId: 11_155_111n }, types: { EIP712Domain: [
      { name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
    ] } }));
    expect(isAddress(platformSigner)).toBe(true);
    expect(typeof paused).toBe('boolean');
    expect(isAddressEqual(rare.contracts.cart!, cart)).toBe(true);
    expect(isAddressEqual(rare.contracts.cartLens!, getCartLensAddress('sepolia')!)).toBe(true);
    expect(rare.cart.listing).toBeDefined();
    expect(rare.cart.order).toBeDefined();
    expect(rare.cart.checkout).toBeDefined();
  }, 30_000);
});
