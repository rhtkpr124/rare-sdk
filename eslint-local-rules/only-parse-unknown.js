import ts from 'typescript';
import { ESLintUtils, AST_NODE_TYPES } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (ruleName) => `https://github.com/superrare/rare-sdk/tree/main/eslint-local-rules/${ruleName}`,
);

const parseMethodNames = new Set(['parse', 'safeParse', 'parseAsync', 'safeParseAsync']);
const ignoredBuiltInObjects = new Set(['JSON', 'Date', 'Number', 'BigInt', 'URL']);

function isUnknownType(type) {
  return (type.flags & ts.TypeFlags.Unknown) !== 0;
}

function isAnyType(type) {
  return (type.flags & ts.TypeFlags.Any) !== 0;
}

function memberPropertyName(callee) {
  if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.computed) return undefined;
  return callee.property.type === AST_NODE_TYPES.Identifier ? callee.property.name : undefined;
}

function isIgnoredObjectByName(objectNode) {
  return objectNode.type === AST_NODE_TYPES.Identifier && ignoredBuiltInObjects.has(objectNode.name);
}

export const onlyParseUnknown = createRule({
  name: 'only-parse-unknown',
  meta: {
    type: 'problem',
    docs: { description: 'Require schema parser inputs to be unknown before runtime parsing.' },
    messages: { knownInput: '{{method}} should only parse unknown input, but received {{type}}.' },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      CallExpression(node) {
        const method = memberPropertyName(node.callee);
        if (!method || !parseMethodNames.has(method) || node.callee.type !== AST_NODE_TYPES.MemberExpression) return;
        if (isIgnoredObjectByName(node.callee.object)) return;

        const [input] = node.arguments;
        if (!input) return;

        const inputType = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(input));
        if (isUnknownType(inputType) && !isAnyType(inputType)) return;

        context.report({
          node: input,
          messageId: 'knownInput',
          data: { method, type: checker.typeToString(inputType) },
        });
      },
    };
  },
});

export default { rules: { 'only-parse-unknown': onlyParseUnknown } };
