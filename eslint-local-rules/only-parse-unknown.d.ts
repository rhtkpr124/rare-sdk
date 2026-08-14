import type { TSESLint } from '@typescript-eslint/utils';

export declare const onlyParseUnknown: TSESLint.RuleModule<'knownInput', []>;
declare const plugin: { rules: { 'only-parse-unknown': typeof onlyParseUnknown } };
export default plugin;
