import js from '@eslint/js';
import functional from 'eslint-plugin-functional';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import localRules from './eslint-local-rules/plugin.js';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'src/data-access/schema.d.ts',
      'eslint-local-rules/**/*.d.ts',
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      functional,
      local: localRules,
    },
    // Mirrors the functional-core rules this code was written under in
    // rare-cli (same options), so its eslint-disable directives stay valid.
    rules: {
      'functional/immutable-data': [
        'error',
        {
          ignoreClasses: 'fieldsOnly',
          ignoreImmediateMutation: true,
          ignoreNonConstDeclarations: false,
          ignoreAccessorPattern: ['RuleTester.*'],
        },
      ],
      'functional/no-let': ['error', { allowInForLoopInit: true }],
      // SDK-owned runtime boundaries should validate untrusted values and use
      // viem's checksum-aware address comparison helper.
      'local/only-parse-unknown': 'error',
      'local/prefer-is-address-equal': 'error',
      // Adopt high-signal typed checks incrementally. Expanding to the complete
      // strictTypeChecked preset is deferred until existing findings can be
      // handled in focused changes.
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    rules: {
      // Tests may use reassigned setup handles and mutable framework hooks;
      // production functional-core rules remain unchanged.
      'functional/immutable-data': 'off',
      'functional/no-let': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts'],
    rules: {
      // Build and release scripts are imperative shells around filesystem and
      // child-process APIs, not SDK functional-core modules.
      'functional/immutable-data': 'off',
    },
  },
);
