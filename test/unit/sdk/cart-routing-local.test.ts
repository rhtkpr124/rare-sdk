import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, isAddressEqual, parseAbiParameters, zeroAddress } from 'viem';
import { getCartAddress } from '../../../src/contracts/addresses.js';
import { planCartRoutingQuote } from '../../../src/sdk/cart-routing-core.js';
import {
  compileKnownCartRoute,
  exactInputPathKeys,
  exactOutputPathKeys,
  resolveKnownCartRoute,
} from '../../../src/sdk/cart-routing-local-core.js';
import { getRareAddress, getUsdcAddress } from '../../../src/swap/known-pools.js';

const chain = 'sepolia' as const;
const cart = getCartAddress(chain);
const eth = zeroAddress;
const usdc = getUsdcAddress(chain);
const rare = getRareAddress(chain);
const liquidEdition = '0x7AEaB936a2D6217E100b4dcfCFcE14E056B386fA' as const;
const liquidEditionPool = {
  currency0: rare,
  currency1: liquidEdition,
  fee: 0,
  tickSpacing: 60,
  hooks: '0xB32eC4b5eC46fBd8E68a39308b8569538d0620CC' as const,
};

describe('Cart known-pool routing core', () => {
  it('resolves every configured commerce direction using one or two V4 pools', () => {
    for (const input of [eth, usdc, rare]) {
      for (const output of [eth, usdc, rare]) {
        if (isAddressEqual(input, output)) continue;
        const plan = planCartRoutingQuote(chain, cart, {
          paymentCurrency: input,
          obligations: [{ settlementCurrency: output, amount: 5n }],
        });
        const steps = resolveKnownCartRoute(plan, output);
        expect(steps).not.toBeNull();
        expect(steps).toHaveLength(isAddressEqual(input, eth) || isAddressEqual(output, eth) ? 1 : 2);
      }
    }
  });

  it('resolves arbitrary Liquid Edition outputs through their declared base pool', () => {
    for (const [input, expectedCurrencies] of [
      [eth, [rare, liquidEdition]],
      [usdc, [eth, rare, liquidEdition]],
      [rare, [liquidEdition]],
    ] as const) {
      const plan = planCartRoutingQuote(chain, cart, {
        paymentCurrency: input,
        obligations: [{ settlementCurrency: liquidEdition, amount: 5n }],
      });
      const steps = resolveKnownCartRoute(plan, liquidEdition, liquidEditionPool);
      expect(steps?.map((step) => step.tokenOut)).toEqual(expectedCurrencies);
      expect(steps?.at(-1)?.poolKey).toEqual(liquidEditionPool);
    }
  });

  it('compiles single and multi-hop exact-output programs with bounded native value', () => {
    for (const [input, output, expectedActions] of [
      [usdc, eth, '0x080c0f'], [usdc, rare, '0x090c0f'], [eth, rare, '0x080c0f'],
    ] as const) {
      const plan = planCartRoutingQuote(chain, cart, {
        paymentCurrency: input,
        obligations: [{ settlementCurrency: output, amount: 5n }],
      });
      const compiled = compileKnownCartRoute(plan, resolveKnownCartRoute(plan, output)!, 9n, 10n, 5n);
      const [actions] = decodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), compiled.inputs[0]!);
      expect(actions).toBe(expectedActions);
      expect(compiled.commands).toBe('0x10');
      expect(compiled.routerValue).toBe(isAddressEqual(input, eth) ? 10n : 0n);
    }
  });

  it('encodes multi-hop paths in the traversal order required by each swap mode', () => {
    const plan = planCartRoutingQuote(chain, cart, {
      paymentCurrency: usdc,
      obligations: [{ settlementCurrency: rare, amount: 5n }],
    });
    const steps = resolveKnownCartRoute(plan, rare)!;

    expect(exactInputPathKeys(steps).map((key) => key.intermediateCurrency)).toEqual([eth, rare]);
    expect(exactOutputPathKeys(steps).map((key) => key.intermediateCurrency)).toEqual([usdc, eth]);

    const compiled = compileKnownCartRoute(plan, steps, 9n, 10n, 5n);
    const [, params] = decodeAbiParameters(
      parseAbiParameters('bytes actions, bytes[] params'),
      compiled.inputs[0]!,
    );
    const [swap] = decodeAbiParameters(
      parseAbiParameters('(address,(address,uint24,int24,address,bytes)[],uint128,uint128)'),
      params[0]!,
    );
    expect(swap[0]).toBe(rare);
    expect(swap[1].map((key) => key[0])).toEqual([usdc, eth]);
  });

  it('compiles protected exact-input single and multi-hop programs', () => {
    for (const [output, expectedActions] of [[eth, '0x060c0f'], [rare, '0x070c0f']] as const) {
      const plan = planCartRoutingQuote(chain, cart, {
        paymentCurrency: usdc,
        obligations: [{ settlementCurrency: output, amount: 5n }],
        mode: 'exact-input',
      });
      const compiled = compileKnownCartRoute(plan, resolveKnownCartRoute(plan, output)!, 10n, 10n, 5n);
      const [actions] = decodeAbiParameters(parseAbiParameters('bytes actions, bytes[] params'), compiled.inputs[0]!);
      expect(actions).toBe(expectedActions);
    }
  });
});
