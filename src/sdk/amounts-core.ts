import type { AmountInput, IntegerInput } from './types/common.js';

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_INTEGER_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

export function toInteger(value: IntegerInput, field: string): bigint {
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${field} must be an integer.`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error(`${field} is too large to pass as a number. Pass it as a string or bigint to avoid precision loss.`);
    }
    return BigInt(value);
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${field} must be an integer.`);
  }

  try {
    return BigInt(normalized);
  } catch {
    throw new Error(`${field} must be an integer.`);
  }
}

export function toSafeIntegerNumber(value: IntegerInput, field: string): number {
  const integer = toInteger(value, field);
  if (integer < MIN_SAFE_INTEGER_BIGINT || integer > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${field} must fit in a safe JavaScript integer.`);
  }
  return Number(integer);
}

export function toNonNegativeInteger(value: IntegerInput, field: string): bigint {
  const normalized = toInteger(value, field);
  if (normalized < 0n) {
    throw new Error(`${field} must be greater than or equal to 0.`);
  }
  return normalized;
}

export function toPositiveInteger(value: IntegerInput, field: string): bigint {
  const normalized = toInteger(value, field);
  if (normalized <= 0n) {
    throw new Error(`${field} must be greater than 0.`);
  }
  return normalized;
}

export function toWei(value: AmountInput): bigint {
  return value;
}

export function toNonNegativeWei(value: AmountInput, field: string): bigint {
  const normalized = toWei(value);
  if (normalized < 0n) {
    throw new Error(`${field} must be greater than or equal to 0.`);
  }
  return normalized;
}

export function toPositiveWei(value: AmountInput, field: string): bigint {
  const normalized = toWei(value);
  if (normalized <= 0n) {
    throw new Error(`${field} must be greater than 0.`);
  }
  return normalized;
}
