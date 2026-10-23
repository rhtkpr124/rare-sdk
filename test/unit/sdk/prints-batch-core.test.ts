import { describe, expect, it } from 'vitest';
import { previousPrintSuccess, printBatchInputDigest, validatePrintBatch } from '../../../src/sdk/prints-batch-core.js';

describe('print batch planning', () => {
  it('rejects duplicate, empty, and unrelated retry keys before execution', () => {
    expect(() => validatePrintBatch([{ key: 'same', input: 1 }, { key: 'same', input: 2 }], {})).toThrow('unique');
    expect(() => validatePrintBatch([{ key: ' ', input: 1 }], {})).toThrow('nonempty');
    expect(() => validatePrintBatch([{ key: 'a', input: 1 }], {
      previousResults: [{ key: 'other', inputDigest: printBatchInputDigest(1), status: 'fulfilled', value: 1 }],
    })).toThrow('belonging');
  });

  it('reuses successful items but not failures', () => {
    const success = { key: 'a', inputDigest: printBatchInputDigest(1), status: 'fulfilled', value: 1 } satisfies NonNullable<Parameters<typeof previousPrintSuccess<number>>[1]>[number];
    expect(previousPrintSuccess('a', [success])).toBe(success);
    expect(previousPrintSuccess('b', [{ key: 'b', inputDigest: printBatchInputDigest(2), status: 'rejected', error: 'offline' }])).toBeUndefined();
  });

  it('binds previous results to canonical inputs rather than keys alone', () => {
    const input = { quantity: 1n, configuration: { name: 'Original', price: '25' } };
    const previous = { key: 'a', inputDigest: printBatchInputDigest(input), status: 'fulfilled', value: 1 } satisfies NonNullable<Parameters<typeof previousPrintSuccess<number>>[1]>[number];
    expect(() => validatePrintBatch([{ key: 'a', input }], { previousResults: [previous] })).not.toThrow();
    expect(() => validatePrintBatch([{ key: 'a', input: { ...input, quantity: 2n } }], { previousResults: [previous] })).toThrow('changed terms');
    expect(printBatchInputDigest({ configuration: { price: '25', name: 'Original' }, quantity: 1n })).toBe(previous.inputDigest);
  });
});
