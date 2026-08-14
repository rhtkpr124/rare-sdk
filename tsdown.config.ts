import { defineConfig } from 'tsdown';

export default defineConfig({
  // Transpile modules separately so the intentional public entry points can
  // share implementations without duplicating classes such as RareApiError.
  // Package exports, rather than emitted file presence, define accessibility.
  entry: ['src/**/*.ts', '!src/**/*.d.ts'],
  unbundle: true,
  // Dual output so both `import` and `require` consumers work: .js/.d.ts for
  // ESM and .cjs/.d.cts for CommonJS, selected via the exports map.
  format: ['esm', 'cjs'],
  platform: 'node',
  // Match the oldest runtime declared in package.json. Newer Node releases can
  // consume this output, while Node 20 must not receive Node 22-only syntax.
  target: 'node20.19',
  fixedExtension: false,
  dts: true,
  clean: true,
});
