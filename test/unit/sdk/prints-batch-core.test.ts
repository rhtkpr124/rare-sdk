import { describe, expect, it } from 'vitest';
import { previousPrintSuccess, validatePrintBatch } from '../../../src/sdk/prints-batch-core.js';

describe('print batch planning', () => {
  it('rejects duplicate, empty, and unrelated retry keys before execution', () => {
    expect(() => validatePrintBatch([{ key: 'same', input: 1 }, { key: 'same', input: 2 }], {})).toThrow('unique');
    expect(() => validatePrintBatch([{ key: ' ', input: 1 }], {})).toThrow('nonempty');
    expect(() => validatePrintBatch([{ key: 'a', input: 1 }], {
      previousResults: [{ key: 'other', status: 'fulfilled', value: 1 }],
    })).toThrow('belonging');
  });

  it('reuses successful items but not failures', () => {
    const success = { key: 'a', status: 'fulfilled', value: 1 } satisfies NonNullable<Parameters<typeof previousPrintSuccess<number>>[1]>[number];
    expect(previousPrintSuccess('a', [success])).toBe(success);
    expect(previousPrintSuccess('b', [{ key: 'b', status: 'rejected', error: 'offline' }])).toBeUndefined();
  });
});
