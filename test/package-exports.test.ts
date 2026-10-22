import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

/**
 * Packaging smoke tests: resolve the package through its own exports map
 * (Node self-reference) in both module systems, covering the named entry
 * points and the deep-subpath patterns.
 */
describe('package exports', () => {
  it('resolves the ESM entry points', async () => {
    const root = await import('@rareprotocol/rare-sdk');
    const contracts = await import('@rareprotocol/rare-sdk/contracts');
    const validation = await import('@rareprotocol/rare-sdk/validation');
    const addresses = await import('@rareprotocol/rare-sdk/contracts/addresses');

    expect(typeof root.createRareClient).toBe('function');
    expect('createRareAccountClient' in root).toBe(false);
    expect(typeof root.RareAuthError).toBe('function');
    expect(typeof contracts.getContractAddresses).toBe('function');
    expect(typeof validation.parseAddress).toBe('function');
    expect(typeof addresses.resolveCurrency).toBe('function');
  });

  it('resolves the CommonJS entry points', () => {
    const root = require('@rareprotocol/rare-sdk');
    const dataAccess = require('@rareprotocol/rare-sdk/data-access');
    const validation = require('@rareprotocol/rare-sdk/validation');

    expect(typeof root.createRareClient).toBe('function');
    expect('createRareAccountClient' in root).toBe(false);
    expect(typeof root.RareAuthError).toBe('function');
    expect(typeof dataAccess.createApiClient).toBe('function');
    expect(typeof validation.parseAddress).toBe('function');
  });

  it('exposes package.json for tooling', () => {
    const pkg = require('@rareprotocol/rare-sdk/package.json') as { name: string };
    expect(pkg.name).toBe('@rareprotocol/rare-sdk');
  });
});
