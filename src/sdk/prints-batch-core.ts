import type { PrintBatchItem, PrintBatchOptions, PrintBatchResult } from './types/prints.js';
import { PrintPublicationError } from './prints-errors.js';
import { keccak256, toHex } from 'viem';

const canonicalInput = (input: unknown): unknown => {
  if (typeof input === 'bigint') return input.toString();
  if (Array.isArray(input)) return input.map(canonicalInput);
  if (typeof input === 'object' && input !== null) return Object.fromEntries(
    Object.entries(input).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, value]) => [key, canonicalInput(value)]),
  );
  return input;
};

export const printBatchInputDigest = (input: unknown): string => keccak256(toHex(JSON.stringify(canonicalInput(input))));

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
export function validatePrintBatch<T, R>(items: readonly PrintBatchItem<T>[], options: PrintBatchOptions<R>, identity: (input: T) => unknown = input => input): void {
  const keys = items.map(item => item.key);
  if (keys.some(key => key.trim().length === 0) || new Set(keys).size !== keys.length) {
    throw new Error('Print batch keys must be nonempty and unique.');
  }
  const previousKeys = options.previousResults?.map(result => result.key) ?? [];
  if (new Set(previousKeys).size !== previousKeys.length || previousKeys.some(key => !keys.includes(key))) {
    throw new Error('Previous print results must have unique keys belonging to this batch.');
  }
  for (const previous of options.previousResults ?? []) {
    const item = items.find(candidate => candidate.key === previous.key);
    if (item === undefined || previous.inputDigest !== printBatchInputDigest(identity(item.input))) {
      throw new Error('Previous print results do not match this batch input. Use a new key for changed terms.');
    }
  }
}

export function previousPrintSuccess<R>(key: string, previous: readonly PrintBatchResult<R>[] = []): PrintBatchResult<R> | undefined {
  return previous.find(result => result.key === key && result.status === 'fulfilled');
}
