import { findPrintPublicationError, previousPrintSuccess, printBatchInputDigest, validatePrintBatch } from './prints-batch-core.js';
import type { PrintBatchItem, PrintBatchOptions, PrintBatchResult } from './types/prints.js';

export async function runPrintBatch<T, R>(items: readonly PrintBatchItem<T>[], options: PrintBatchOptions<R>, operation: (input: T) => Promise<R>, identity: (input: T) => unknown = input => input): Promise<PrintBatchResult<R>[]> {
  validatePrintBatch(items, options, identity);
  // Keep wallet prompts and dependent API writes sequential. Never retry an uncertain write here.
  return items.reduce<Promise<PrintBatchResult<R>[]>>(async (pending, item) => {
    const results = await pending;
    const previous = previousPrintSuccess(item.key, options.previousResults);
    if (previous !== undefined) return [...results, previous];
    const inputDigest = printBatchInputDigest(identity(item.input));
    try {
      return [...results, { key: item.key, inputDigest, status: 'fulfilled', value: await operation(item.input) }];
    } catch (error) {
      const recovery = findPrintPublicationError(error);
      return [...results, { key: item.key, inputDigest, status: 'rejected', error,
        ...(recovery === undefined ? {} : { signedArtifact: recovery.signedArtifact }) }];
    }
  }, Promise.resolve([]));
}
