import { ESLintUtils, AST_NODE_TYPES } from '@typescript-eslint/utils';

const createRule = ESLintUtils.RuleCreator(
  (ruleName) => `https://github.com/superrare/rare-sdk/tree/main/eslint-local-rules/${ruleName}`,
);

function isLikelyEvmAddressType(checker, type, tsNode) {
  if (type.isUnion()) return type.types.some((member) => isLikelyEvmAddressType(checker, member, tsNode));
  if (type.aliasSymbol?.escapedName === 'Address') return true;

  const str = checker.typeToString(type);
  return str === 'Address' || (str === '`0x${string}`' && hasAddressTypeAnnotation(checker, tsNode));
}

function hasAddressTypeAnnotation(checker, tsNode) {
  return checker.getSymbolAtLocation(tsNode)?.declarations?.some((declaration) => {
    const typeNode = declaration.type;
    return typeNode ? /\bAddress\b/u.test(typeNode.getText()) : false;
  }) ?? false;
}

function isEqualityComparisonCall(node) {
  const operator = node.parent?.type === AST_NODE_TYPES.BinaryExpression ? node.parent.operator : undefined;
  return operator === '===' || operator === '!==' || operator === '==' || operator === '!=';
}

export const preferIsAddressEqual = createRule({
  name: 'prefer-is-address-equal',
  meta: {
    type: 'suggestion',
    docs: { description: 'Prefer viem `isAddressEqual` instead of lowercasing addresses for comparison.' },
    messages: {
      useIsAddressEqual: 'Compare addresses with viem `isAddressEqual(a, b)` instead of `.toLowerCase()`.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    return {
      CallExpression(node) {
        const { callee } = node;
        if (
          node.arguments.length !== 0 ||
          callee.type !== AST_NODE_TYPES.MemberExpression ||
          callee.computed ||
          callee.property.type !== AST_NODE_TYPES.Identifier ||
          callee.property.name !== 'toLowerCase' ||
          !isEqualityComparisonCall(node)
        ) return;

        const tsObject = services.esTreeNodeToTSNodeMap.get(callee.object);
        if (isLikelyEvmAddressType(checker, checker.getTypeAtLocation(tsObject), tsObject)) {
          context.report({ node, messageId: 'useIsAddressEqual' });
        }
      },
    };
  },
});

export default { rules: { 'prefer-is-address-equal': preferIsAddressEqual } };
