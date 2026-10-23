import type { PrintBatchItem, PrintBatchOptions, PrintBatchResult } from './types/prints.js';
import { PrintPublicationError } from './prints-errors.js';

export function findPrintPublicationError(error: unknown, seen: readonly unknown[] = []): PrintPublicationError | undefined {
  if (error instanceof PrintPublicationError) return error;
  if (seen.includes(error)) return undefined;
  return error instanceof Error && error.cause !== undefined
    ? findPrintPublicationError(error.cause, [...seen, error]) : undefined;
}

export function isPrintBatch<T>(input: unknown): input is readonly PrintBatchItem<T>[] {
  return Array.isArray(input);
}

/** Validate the whole batch before any item can create durable state. */
export function validatePrintBatch<T, R>(items: readonly PrintBatchItem<T>[], options: PrintBatchOptions<R>): void {
  const keys = items.map(item => item.key);
  if (keys.some(key => key.trim().length === 0) || new Set(keys).size !== keys.length) {
    throw new Error('Print batch keys must be nonempty and unique.');
  }
  const previousKeys = options.previousResults?.map(result => result.key) ?? [];
  if (new Set(previousKeys).size !== previousKeys.length || previousKeys.some(key => !keys.includes(key))) {
    throw new Error('Previous print results must have unique keys belonging to this batch.');
  }
}

export function previousPrintSuccess<R>(key: string, previous: readonly PrintBatchResult<R>[] = []): PrintBatchResult<R> | undefined {
  return previous.find(result => result.key === key && result.status === 'fulfilled');
}
