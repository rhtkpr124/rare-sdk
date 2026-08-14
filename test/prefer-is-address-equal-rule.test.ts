import parser from '@typescript-eslint/parser';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';
import { preferIsAddressEqual } from '../eslint-local-rules/prefer-is-address-equal.js';

RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: { projectService: { allowDefaultProject: ['*.ts'] }, tsconfigRootDir: process.cwd() },
  },
});

ruleTester.run('prefer-is-address-equal', preferIsAddressEqual, {
  valid: [
    { code: 'type Hex = `0x${string}`; declare const txHash: Hex; const key = txHash.toLowerCase();' },
    { code: "import type { Address } from 'viem'; declare const address: Address; const normalized = address.toLowerCase();" },
  ],
  invalid: [
    {
      code: "import type { Address } from 'viem'; declare const left: Address; declare const right: Address; left.toLowerCase() === right.toLowerCase();",
      errors: [{ messageId: 'useIsAddressEqual' }, { messageId: 'useIsAddressEqual' }],
    },
    {
      code: "import type { Address } from 'viem'; declare const left: Address; declare const right: Address; left.toLowerCase() !== right.toLowerCase();",
      errors: [{ messageId: 'useIsAddressEqual' }, { messageId: 'useIsAddressEqual' }],
    },
  ],
});
