import { describe, expect, it } from 'vitest';
import { tokenAbi } from '../../../src/contracts/abis/token.js';

type TokenAbiEntry = (typeof tokenAbi)[number];
type TokenAbiFunction = Extract<TokenAbiEntry, { type: 'function' }>;
type TokenAbiFunctionName = TokenAbiFunction['name'];

function getFunction<Name extends TokenAbiFunctionName>(
  name: Name,
): Extract<TokenAbiFunction, { name: Name }> {
  const entry = tokenAbi.find(
    (abiEntry): abiEntry is Extract<TokenAbiFunction, { name: Name }> =>
      abiEntry.type === 'function' && 'name' in abiEntry && abiEntry.name === name,
  );

  if (entry === undefined) {
    throw new Error(`Missing token ABI function: ${name}`);
  }

  return entry;
}

function hasFunction(name: string): boolean {
  return tokenAbi.some(
    (abiEntry) => abiEntry.type === 'function' && 'name' in abiEntry && abiEntry.name === name,
  );
}

describe('token ABI', () => {
  it('matches Sovereign royalty getter names from ERC2981Upgradeable', () => {
    expect(getFunction('getDefaultRoyaltyPercentage')).toMatchObject({
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
    });
    expect(getFunction('getDefaultRoyaltyReceiver')).toMatchObject({
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      stateMutability: 'view',
    });

    expect(hasFunction('defaultRoyaltyPercentage')).toBe(false);
    expect(hasFunction('defaultRoyaltyReceiver')).toBe(false);
  });

  it('marks Ownable ownership operations as writes', () => {
    expect(getFunction('renounceOwnership').stateMutability).toBe('nonpayable');
    expect(getFunction('transferOwnership').stateMutability).toBe('nonpayable');
  });
});
