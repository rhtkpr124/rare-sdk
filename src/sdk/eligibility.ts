import { createApiClient } from '../data-access/client.js';
import type { RareClientConfig } from './types/client.js';
import type { EligibilityNamespace } from './types/eligibility.js';

/** Claims are private account data. Use the same authenticated session as Cart checkout. */
export function createEligibilityNamespace(config: RareClientConfig): EligibilityNamespace {
  const client = createApiClient(config.apiBaseUrl, config.accountClient?.authenticatedFetch ?? config.apiFetch);
  return {
    async createRule(input) {
      const result = await client.POST('/v1/eligibility/rules', { body: input });
      if (result.data === undefined) throw new Error('Rare API did not return the eligibility rule.');
      return result.data.data;
    },
    async listRules(options = {}) {
      const result = await client.GET('/v1/eligibility/rules', { params: { query: options } });
      if (result.data === undefined) throw new Error('Rare API did not return eligibility rules.');
      return result.data.data;
    },
    async disableRule(ruleId) {
      const result = await client.POST('/v1/eligibility/rules/{ruleId}/disable', { params: { path: { ruleId } } });
      if (result.data === undefined) throw new Error('Rare API did not confirm the disabled eligibility rule.');
    },
    async listClaims(options = {}) {
      const result = await client.GET('/v1/eligibility/claims', { params: { query: options } });
      if (result.data === undefined) throw new Error('Rare API did not return eligibility claims.');
      return result.data.data;
    },
    async setListingRequirement(input) {
      const result = await client.PUT('/v1/eligibility/listings/{listingDigest}/requirement', {
        params: { path: { listingDigest: input.listingDigest } },
        body: { chainId: input.chainId, cartAddress: input.cartAddress, ruleId: input.ruleId },
      });
      if (result.data === undefined) throw new Error('Rare API did not confirm the Listing eligibility requirement.');
    },
    async clearListingRequirement(input) {
      const result = await client.DELETE('/v1/eligibility/listings/{listingDigest}/requirement', {
        params: { path: { listingDigest: input.listingDigest }, query: { chainId: input.chainId, cartAddress: input.cartAddress } },
      });
      if (result.data === undefined) throw new Error('Rare API did not confirm removal of the Listing eligibility requirement.');
    },
  };
}
