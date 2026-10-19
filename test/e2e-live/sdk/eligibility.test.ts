import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRareClient } from '../../../src/sdk/client.js';
import { createCreatorCartScenario } from '../../helpers/cart-creator-fixture.js';
import { loadDotEnv } from '../../helpers/env.js';

loadDotEnv();

describe.sequential('SDK eligibility against the deployed Rare API', () => {
  let scenario: Awaited<ReturnType<typeof createCreatorCartScenario>>;

  beforeAll(async () => { scenario = await createCreatorCartScenario(); }, 360_000);
  afterAll(async () => { await scenario?.accountClient.auth.logout(); });

  it('creates an owned rule, opts a Listing in and out, and disables the rule', async () => {
    const listing = scenario.listings[0];
    const created = scenario.createdListings[0];
    if (listing === undefined || created === undefined) throw new Error('Eligibility fixture requires a Listing.');
    const rule = await scenario.rare.eligibility.createRule({ definition: {
      kind: 'PRIMARY_SALE',
      source: { chainId: String(scenario.chainId), tokenContract: listing.tokenContract },
      targets: [{ sku: listing.sku }],
    } });
    try {
      expect(rule.enabled).toBe(true);
      expect(rule.definition.kind).toBe('PRIMARY_SALE');
      expect((await scenario.rare.eligibility.listRules()).some(candidate => candidate.id === rule.id)).toBe(true);
      const scope = { chainId: String(scenario.chainId), cartAddress: scenario.cart,
        listingDigest: created.listingDigest };
      await scenario.rare.eligibility.setListingRequirement({ ...scope, ruleId: rule.id });
      await scenario.rare.eligibility.clearListingRequirement(scope);
      expect(Array.isArray(await scenario.rare.eligibility.listClaims())).toBe(true);
      const anonymous = createRareClient({ publicClient: scenario.publicClient, apiBaseUrl: scenario.apiBaseUrl });
      await expect(anonymous.eligibility.listRules()).rejects.toThrow();
      await expect(anonymous.eligibility.listClaims()).rejects.toThrow();
    } finally {
      await scenario.rare.eligibility.disableRule(rule.id);
    }
    expect((await scenario.rare.eligibility.listRules()).find(candidate => candidate.id === rule.id)?.enabled).toBe(false);
  }, 90_000);
});
