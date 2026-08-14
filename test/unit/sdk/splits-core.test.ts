import { describe, expect, it } from 'vitest';
import {
  planPayoutSplits,
  planProvidedPayoutSplits,
} from '../../../src/sdk/splits-core.js';

const seller = '0x0000000000000000000000000000000000000001' as const;
const collaborator = '0x0000000000000000000000000000000000000002' as const;
const duplicateSeller = '0x0000000000000000000000000000000000000001' as const;

describe('payout split planning', () => {
  it('defaults omitted payout splits to the connected wallet', () => {
    expect(planPayoutSplits(undefined, undefined, seller)).toEqual({
      addresses: [seller],
      ratios: [100],
    });
  });

  it('normalizes and validates provided payout splits', () => {
    expect(planProvidedPayoutSplits([seller, collaborator], [70, 30])).toEqual({
      addresses: [seller, collaborator],
      ratios: [70, 30],
    });
  });

  it('rejects inconsistent or invalid payout splits', () => {
    expect(() => planPayoutSplits([seller], undefined, seller)).toThrow(
      'splitAddresses and splitRatios must both be provided.',
    );
    expect(() => planProvidedPayoutSplits([], [])).toThrow(
      'splitAddresses must include at least 1 address.',
    );
    expect(() => planProvidedPayoutSplits([seller, collaborator], [100])).toThrow(
      'splitAddresses and splitRatios must have the same length.',
    );
    expect(() => planProvidedPayoutSplits([seller, duplicateSeller], [50, 50])).toThrow(
      `Duplicate split address: "${seller}".`,
    );
    expect(() => planProvidedPayoutSplits([seller, collaborator], [0, 100])).toThrow(
      'Invalid split ratio: "0". Must be an integer between 1 and 100.',
    );
    expect(() => planProvidedPayoutSplits([seller, collaborator], [60, 20])).toThrow(
      'splitRatios must sum to 100 (got 80).',
    );
  });
});
