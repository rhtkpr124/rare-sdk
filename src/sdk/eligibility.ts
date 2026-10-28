import { createApiClient } from '../data-access/client.js';
import { favoritePageQuery } from './favorites-core.js';
import type { RareClientConfig } from './types/client.js';
import type { PurchaseEligibilityNamespace } from './types/eligibility.js';

/** SKU purchase rights use the same authenticated account as Cart checkout. */
export function createEligibilityNamespace(config: RareClientConfig, authenticatedFetch?: typeof globalThis.fetch): PurchaseEligibilityNamespace {
  const client = createApiClient(config.apiBaseUrl, authenticatedFetch ?? config.apiFetch);
  return {
    rules: {
      async create(input) {
        const result = await client.POST('/v1/eligibility/rules', { body: input });
        if (result.data === undefined) throw new Error('Rare API did not return the purchase eligibility rule.');
        return result.data.data;
      },
      async list(options = {}) {
        const result = await client.GET('/v1/eligibility/rules', { params: { query: favoritePageQuery(options) } });
        if (result.data === undefined) throw new Error('Rare API did not return purchase eligibility rules.');
        return result.data;
      },
      async disable(ruleId) {
        const result = await client.POST('/v1/eligibility/rules/{ruleId}/disable', { params: { path: { ruleId } } });
        if (result.data === undefined) throw new Error('Rare API did not confirm the disabled purchase eligibility rule.');
      },
    },
    claims: {
      async list(options = {}) {
        const result = await client.GET('/v1/eligibility/claims', { params: { query: { ...options, ...favoritePageQuery(options) } } });
        if (result.data === undefined) throw new Error('Rare API did not return purchase eligibility claims.');
        return result.data;
      },
    },
    listingRequirements: {
      async set(input) {
        const result = await client.PUT('/v1/eligibility/listings/{listingDigest}/requirement', {
          params: { path: { listingDigest: input.listingDigest } },
          body: { chainId: input.chainId, cartAddress: input.cartAddress, ruleId: input.ruleId },
        });
        if (result.data === undefined) throw new Error('Rare API did not confirm the Listing purchase requirement.');
      },
      async clear(input) {
        const result = await client.DELETE('/v1/eligibility/listings/{listingDigest}/requirement', {
          params: { path: { listingDigest: input.listingDigest }, query: { chainId: input.chainId, cartAddress: input.cartAddress } },
        });
        if (result.data === undefined) throw new Error('Rare API did not confirm removal of the Listing purchase requirement.');
      },
    },
  };
}
