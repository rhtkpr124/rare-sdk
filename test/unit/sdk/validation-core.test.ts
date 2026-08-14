import { describe, expect, it } from 'vitest';
import {
  requireConfiguredAddress,
  requireInput,
  toUnixTimestamp,
  validateRouterPayload,
} from '../../../src/sdk/validation-core.js';

describe('SDK validation core', () => {
  it('requires present inputs and configured contract addresses', () => {
    expect(requireInput('value', 'field')).toBe('value');
    expect(() => requireInput(undefined, 'field')).toThrow('field is required.');

    expect(requireConfiguredAddress(
      '0x1000000000000000000000000000000000000000',
      'Batch marketplace',
      'sepolia',
    )).toBe('0x1000000000000000000000000000000000000000');
    expect(() => requireConfiguredAddress(undefined, 'Batch marketplace', 'base')).toThrow(
      'Batch marketplace is not configured for "base". Supported chains: mainnet, sepolia',
    );
  });

  it('normalizes timestamp inputs from dates, ISO strings, and integer strings', () => {
    expect(toUnixTimestamp(new Date('2026-05-21T12:34:56.789Z'), 'startTime')).toBe(1_779_366_896n);
    expect(toUnixTimestamp('2026-05-21T12:34:56Z', 'startTime')).toBe(1_779_366_896n);
    expect(toUnixTimestamp('2026-05-21T12:34:56', 'startTime')).toBe(1_779_366_896n);
    expect(toUnixTimestamp('2026-05-21T12:34', 'startTime')).toBe(1_779_366_840n);
    expect(toUnixTimestamp('1779366896', 'startTime')).toBe(1_779_366_896n);
  });

  it('rejects invalid dates and non-positive timestamp fallbacks', () => {
    expect(() => toUnixTimestamp(new Date(Number.NaN), 'startTime')).toThrow(
      'startTime must be a valid date.',
    );
    expect(() => toUnixTimestamp('2026-99-99', 'startTime')).toThrow(
      'startTime must be a unix timestamp or ISO date.',
    );
    expect(() => toUnixTimestamp('0', 'startTime')).toThrow('startTime must be greater than 0.');
  });

  it('validates raw router command and input payload shape', () => {
    expect(() => validateRouterPayload('0x12', ['0xab'])).not.toThrow();
    expect(() => validateRouterPayload('0xzz', ['0xab'])).toThrow(
      'Router commands must be an even-length hex string.',
    );
    expect(() => validateRouterPayload('0x', [])).toThrow(
      'Router commands must not be empty.',
    );
    expect(() => validateRouterPayload('0x12', ['0xabc'])).toThrow(
      'Router input at index 0 must be an even-length hex string.',
    );
    expect(() => validateRouterPayload('0x1234', ['0xab'])).toThrow(
      'Router commands/input mismatch: commands has 2 byte(s) but 1 input(s) were provided.',
    );
  });
});
