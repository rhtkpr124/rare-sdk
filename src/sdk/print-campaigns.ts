import { createApiClient } from '../data-access/client.js';
import type { RareClientConfig } from './types/client.js';
import type { PrintCampaignsNamespace } from './types/prints.js';

/** Public campaign information never uses the account transport; source rights do. */
export function createPrintCampaignsNamespace(config: RareClientConfig): PrintCampaignsNamespace {
  const publicClient = createApiClient(config.apiBaseUrl, config.apiFetch);
  const client = createApiClient(config.apiBaseUrl, config.accountClient?.authenticatedFetch ?? config.apiFetch);
  const response = async <T>(request: Promise<{ data?: T }>): Promise<T> => {
    const result = await request;
    if (result.data === undefined) throw new Error('Rare API did not return print campaign data.');
    return result.data;
  };
  const data = async <T>(request: Promise<{ data?: { data: T } }>): Promise<T> =>
    (await response(request)).data;
  return {
    create: input => data(client.POST('/v1/prints/campaigns', { body: input })),
    list: options => response(publicClient.GET('/v1/prints/campaigns', { params: { query: options } })),
    get: id => data(publicClient.GET('/v1/prints/campaigns/{id}', { params: { path: { id } } })),
    getMine: id => data(client.GET('/v1/prints/campaigns/mine/{id}', { params: { path: { id } } })),
    listMine: (options = {}) => response(client.GET('/v1/prints/campaigns/mine', { params: { query: options } })),
    listSources: (id, options = {}) => response(client.GET('/v1/prints/campaigns/{id}/sources', {
      params: { path: { id }, query: options },
    })),
    getSourceArtwork: (id, tokenId) => data(client.GET('/v1/prints/campaigns/mine/{id}/sources/{tokenId}/artwork', {
      params: { path: { id, tokenId } },
    })),
    setSource: (id, tokenId, input) => data(client.PUT('/v1/prints/campaigns/{id}/sources/{tokenId}', {
      params: { path: { id, tokenId } }, body: input,
    })),
    prepare: (id, input) => data(client.POST('/v1/prints/campaigns/{id}/prepare', {
      params: { path: { id } }, body: input,
    })),
  };
}
