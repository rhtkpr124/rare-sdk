import { test } from 'vitest';
import assert from 'node:assert/strict';
import { decodeAbiParameters, parseAbiParameters } from 'viem';
import { ETH_ADDRESS } from '../../../src/contracts/addresses.js';
import {
  buildCanonicalTokenBuyRoute,
  buildCanonicalTokenSellRoute,
  buildExactInputSingleRoute,
} from '../../../src/swap/build-route.js';
import { encodeBuyRareRoute, encodeRoute } from '../../../src/swap/route-encoding.js';

const rareAddress = '0xba5BDe662c17e2aDFF1075610382B9B691296350' as const;
const wethAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const;
const liquidEditionAddress = '0xf100000000000000000000000000000000000001' as const;
const rarePoolKey = {
  currency0: ETH_ADDRESS,
  currency1: rareAddress,
  fee: 3000,
  tickSpacing: 60,
  hooks: ETH_ADDRESS,
};
const wethLiquidPoolKey = {
  currency0: wethAddress,
  currency1: liquidEditionAddress,
  fee: 0,
  tickSpacing: 60,
  hooks: '0x1111111111111111111111111111111111111111' as const,
};

test('buildExactInputSingleRoute creates an ETH -> RARE step', () => {
  const [step] = buildExactInputSingleRoute(ETH_ADDRESS, rareAddress, rarePoolKey);
  assert.ok(step);
  assert.equal(step?.zeroForOne, true);
  assert.equal(step?.tokenIn, ETH_ADDRESS);
  assert.equal(step?.tokenOut, rareAddress);
});

test('buildCanonicalTokenBuyRoute wraps ETH when the canonical base token is WETH', () => {
  const route = buildCanonicalTokenBuyRoute('mainnet', liquidEditionAddress, wethLiquidPoolKey, 'liquid-edition');
  assert.ok(route);
  assert.equal(route?.steps.length, 2);
  assert.equal(route?.steps[0]?.kind, 'wrapEth');
  assert.equal(route?.steps[1]?.kind, 'v4Swap');
});

test('buildCanonicalTokenSellRoute unwraps WETH when the canonical base token is WETH', () => {
  const route = buildCanonicalTokenSellRoute('mainnet', liquidEditionAddress, wethLiquidPoolKey, 'liquid-edition');
  assert.ok(route);
  assert.equal(route?.steps.length, 2);
  assert.equal(route?.steps[0]?.kind, 'v4Swap');
  assert.equal(route?.steps[1]?.kind, 'unwrapWeth');
});

test('encodeBuyRareRoute emits one V4 command with swap/settle/take actions', () => {
  const [step] = buildExactInputSingleRoute(ETH_ADDRESS, rareAddress, rarePoolKey);
  if (!step) {
    throw new Error('Expected ETH -> RARE route step.');
  }

  const encoded = encodeBuyRareRoute(
    {
      amountOut: 1000n,
      minAmountOut: 950n,
      steps: [step],
    },
    1_000n,
    ETH_ADDRESS,
    rareAddress,
  );

  assert.equal(encoded.commands, '0x10');
  assert.equal(encoded.inputs.length, 1);

  const [actions] = decodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), getInput(encoded.inputs, 0));
  assert.equal(actions, '0x070c0f');
});

test('encodeRoute emits WRAP_ETH then a single-hop V4 swap block', () => {
  const route = buildCanonicalTokenBuyRoute('mainnet', liquidEditionAddress, wethLiquidPoolKey, 'liquid-edition');
  if (!route) {
    throw new Error('Expected canonical buy route.');
  }

  const encoded = encodeRoute(
    {
      amountOut: 500n,
      minAmountOut: 475n,
      steps: route.steps,
    },
    1_000n,
    ETH_ADDRESS,
    liquidEditionAddress,
  );

  assert.equal(encoded.commands, '0x0b10');
  assert.equal(encoded.inputs.length, 2);

  const [actions, params] = decodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), getInput(encoded.inputs, 1));
  assert.equal(actions, '0x0b060f');

  const [swapExactInSingle] = decodeAbiParameters(
    parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,bytes)'),
    getInput(params, 1),
  );
  assert.equal(swapExactInSingle[2], 0n);
});

test('encodeRoute emits a V4 swap block followed by UNWRAP_WETH', () => {
  const route = buildCanonicalTokenSellRoute('mainnet', liquidEditionAddress, wethLiquidPoolKey, 'liquid-edition');
  if (!route) {
    throw new Error('Expected canonical sell route.');
  }

  const encoded = encodeRoute(
    {
      amountOut: 500n,
      minAmountOut: 475n,
      steps: route.steps,
    },
    1_000n,
    liquidEditionAddress,
    ETH_ADDRESS,
  );

  assert.equal(encoded.commands, '0x100c');
  assert.equal(encoded.inputs.length, 2);
});

function getInput(inputs: readonly `0x${string}`[], index: number): `0x${string}` {
  const input = inputs[index];
  if (!input) {
    throw new Error(`Expected encoded input at index ${index}.`);
  }
  return input;
}
