import parser from '@typescript-eslint/parser';
import { RuleTester } from '@typescript-eslint/rule-tester';
import { afterAll, describe, it } from 'vitest';
import { onlyParseUnknown } from '../eslint-local-rules/only-parse-unknown.js';

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

ruleTester.run('only-parse-unknown', onlyParseUnknown, {
  valid: [
    { code: 'declare const schema: { parse(value: unknown): string }; declare const input: unknown; schema.parse(input);' },
    { code: 'declare const text: string; JSON.parse(text);' },
  ],
  invalid: [
    {
      code: 'declare const schema: { parse(value: unknown): string }; declare const input: string; schema.parse(input);',
      errors: [{ messageId: 'knownInput' }],
    },
    {
      code: 'declare const schema: { safeParse(value: unknown): string }; declare const input: any; schema.safeParse(input);',
      errors: [{ messageId: 'knownInput' }],
    },
  ],
});
