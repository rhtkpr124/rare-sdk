import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    fileParallelism: true,
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    testTimeout: 30_000,
    hookTimeout: 10_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/runtime-env.ts',
        'src/contracts/addresses.ts',
        'src/data-access/**/*.ts',
        'src/liquid/**/*.ts',
        'src/sdk/**/*.ts',
        'src/swap/**/*.ts',
      ],
      exclude: [
        'src/contracts/abis/**',
        'src/data-access/schema.d.ts',
        'src/sdk/types/**',
      ],
      thresholds: {
        statements: 64,
        branches: 63,
        functions: 74,
        lines: 64,
      },
    },
  },
});
