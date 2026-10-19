import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// Keep these runtime smoke tests independent of a pre-existing dist directory.
// TypeScript otherwise tries to resolve the package's self-reference to files
// which are intentionally created only by `npm run build`.
const packageNames = {
  root: '@rareprotocol/rare-sdk',
  client: '@rareprotocol/rare-sdk/client',
  contracts: '@rareprotocol/rare-sdk/contracts',
  utils: '@rareprotocol/rare-sdk/utils',
  dataAccess: '@rareprotocol/rare-sdk/data-access',
  wallet: '@rareprotocol/rare-sdk/wallet',
  packageJson: '@rareprotocol/rare-sdk/package.json',
} as const;

/**
 * Packaging smoke tests: resolve the package through its own exports map
 * (Node self-reference) in both module systems, covering the named entry
 * points and rejection of private implementation modules.
 */
describe('package exports', () => {
  it('resolves the ESM entry points', async () => {
    const root = await import(packageNames.root);
    const client = await import(packageNames.client);
    const contracts = await import(packageNames.contracts);
    const utils = await import(packageNames.utils);
    const wallet = await import(packageNames.wallet);

    expect(typeof root.createRareClient).toBe('function');
    expect('createRareAccountClient' in root).toBe(false);
    expect(typeof root.RareAuthError).toBe('function');
    expect(client.createRareClient).toBe(root.createRareClient);
    expect(typeof root.MinterApprovalRequiredError).toBe('function');
    expect(typeof contracts.getContractAddresses).toBe('function');
    expect(typeof utils.getCurvePresetDefinition).toBe('function');
    expect(typeof utils.parseCurveConfig).toBe('function');
    expect(typeof wallet.createRareWalletClient).toBe('function');
    expect(typeof (await import(packageNames.dataAccess)).createApiClient).toBe('function');
  });

  it('resolves the CommonJS entry points', () => {
    const root = require(packageNames.root);
    const client = require(packageNames.client);
    const dataAccess = require(packageNames.dataAccess);
    const utils = require(packageNames.utils);
    const wallet = require(packageNames.wallet);

    expect(typeof root.createRareClient).toBe('function');
    expect('createRareAccountClient' in root).toBe(false);
    expect(typeof root.RareAuthError).toBe('function');
    expect(client.createRareClient).toBe(root.createRareClient);
    expect(typeof root.MinterApprovalRequiredError).toBe('function');
    expect(typeof dataAccess.createApiClient).toBe('function');
    expect(typeof utils.getCurvePresetDefinition).toBe('function');
    expect(typeof utils.parseCurveConfig).toBe('function');
    expect(typeof wallet.createRareWalletClient).toBe('function');

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(),
    });
    expect(() => root.createRareClient({ publicClient })).not.toThrow();
  });

  it('exposes package.json for tooling', () => {
    const pkg = require(packageNames.packageJson) as { name: string };
    expect(pkg.name).toBe('@rareprotocol/rare-sdk');
  });

  it.each([
    'marketplace-core',
    'collection-core',
    'payments-shell',
    'transaction-fallback-shell',
    'swap/trade-core',
    'contracts/addresses',
    'contracts/abis/auction',
    'data-access/errors',
  ])('rejects private runtime subpath %s', async (subpath) => {
    const specifier = `@rareprotocol/rare-sdk/${subpath}`;
    expect(() => require(specifier)).toThrow(/not (?:defined by "exports"|exported)|Package subpath/);
    await expect(import(specifier)).rejects.toThrow(/not (?:defined by "exports"|exported)|Package subpath/);
  });

  it('exposes only intentional subpaths to TypeScript resolution', () => {
    const containingFile = join(dirname(fileURLToPath(import.meta.url)), 'package-resolution-smoke.ts');
    const options: ts.CompilerOptions = {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
    };
    const resolve = (specifier: string): string | undefined =>
      ts.resolveModuleName(specifier, containingFile, options, ts.sys).resolvedModule?.resolvedFileName;

    for (const specifier of Object.values(packageNames)) {
      expect(resolve(specifier), specifier).toBeDefined();
    }
    for (const subpath of [
      'marketplace-core',
      'collection-core',
      'payments-shell',
      'transaction-fallback-shell',
      'swap/trade-core',
      'contracts/addresses',
      'contracts/abis/auction',
      'data-access/errors',
    ]) {
      const specifier = `@rareprotocol/rare-sdk/${subpath}`;
      expect(resolve(specifier), specifier).toBeUndefined();
    }
  });
});
