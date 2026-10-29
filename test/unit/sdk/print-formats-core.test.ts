import { describe, expect, it } from 'vitest';
import { validatePrintFormatConfiguration, validatePrintOptionSelections } from '../../../src/sdk/print-formats-core.js';
import { planPrintReleaseAssociationVerification } from '../../../src/sdk/print-release-associations-core.js';

const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

describe('collector format input validation', () => {
  it('validates all-format artwork pricing without accepting caller-supplied catalog choices', () => {
    expect(validatePrintFormatConfiguration({ dropId: id, input: { displayPriceUsdCents: '1200' } }).success).toBe(true);
    for (const displayPriceUsdCents of ['-1', '1.5', '01', '1000000000000000000']) {
      expect(validatePrintFormatConfiguration({ dropId: id, input: { displayPriceUsdCents } }).success).toBe(false);
    }
    expect(validatePrintFormatConfiguration({ dropId: id, input: { displayPriceUsdCents: '1200', products: ['arbitrary'] } }).success).toBe(false);
  });

  it('allows legacy omission but requires one unambiguous format per preparation when present', () => {
    expect(validatePrintOptionSelections(undefined).success).toBe(true);
    expect(validatePrintOptionSelections([{ preparationId: id, optionId: otherId }]).success).toBe(true);
    expect(validatePrintOptionSelections([]).success).toBe(false);
    expect(validatePrintOptionSelections([{ preparationId: id, optionId: id }, { preparationId: id, optionId: otherId }]).success).toBe(false);
    const alphabeticId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(validatePrintOptionSelections([{ preparationId: alphabeticId, optionId: id }, { preparationId: alphabeticId.toUpperCase(), optionId: otherId }]).success).toBe(false);
    expect(validatePrintOptionSelections([{ preparationId: id, optionId: 'invalid' }]).success).toBe(false);
    expect(validatePrintOptionSelections(Array.from({ length: 6 }, (_, index) => ({ preparationId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, optionId: id }))).success).toBe(false);
  });
});

describe('release association verification input validation', () => {
  it('supports token zero and the largest uint256 while rejecting out-of-range and noncanonical identifiers', () => {
    expect(planPrintReleaseAssociationVerification(id, { expectedVersion: 1, tokenIds: ['0', String((1n << 256n) - 1n)] }).success).toBe(true);
    for (const tokenId of ['-1', '01', '1.5', '0x1', String(1n << 256n)]) {
      expect(planPrintReleaseAssociationVerification(id, { expectedVersion: 1, tokenIds: [tokenId] }).success).toBe(false);
    }
  });

  it('rejects ambiguous, unbounded, and stale verification inputs', () => {
    expect(planPrintReleaseAssociationVerification(id, { expectedVersion: 0, tokenIds: ['1'] }).success).toBe(false);
    expect(planPrintReleaseAssociationVerification(id, { expectedVersion: 1, tokenIds: ['1', '1'] }).success).toBe(false);
    expect(planPrintReleaseAssociationVerification(id, { expectedVersion: 1, tokenIds: [] }).success).toBe(false);
    expect(planPrintReleaseAssociationVerification(id, { expectedVersion: 1, tokenIds: Array.from({ length: 101 }, (_, index) => String(index)) }).success).toBe(false);
    expect(planPrintReleaseAssociationVerification(id, { expectedVersion: 1, tokenIds: ['1'], entryId: otherId }).success).toBe(false);
  });
});
