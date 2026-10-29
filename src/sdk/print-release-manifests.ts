import type { ApiClient } from '../data-access/client.js';
import { featureError } from './feature-error.js';
import { planPrintReleaseManifestLookup, planPrintReleaseManifestRead, planPrintReleaseManifestSave } from './print-release-manifests-core.js';
import type { PrintReleaseManifestsNamespace } from './types/prints.js';
import { planPrintReleaseAssociationVerification } from './print-release-associations-core.js';

export function createPrintReleaseManifestsNamespace(client: ApiClient): PrintReleaseManifestsNamespace {
  return {
    associations: {
      async verify(id, input, options = {}) {
        const plan = planPrintReleaseAssociationVerification(id, input);
        if (!plan.success) throw featureError('invalid_print_release_association_verification');
        const result = await client.POST('/v1/prints/release-manifests/{id}/associations/verify', {
          params: { path: { id: plan.data.id } }, body: plan.data.input, signal: options.signal,
        });
        if (result.data === undefined) throw featureError('invalid_print_release_association_response');
        return result.data.data;
      },
    },
    async save(id, input, options = {}) {
      const plan = planPrintReleaseManifestSave(id, input);
      if (!plan.success) throw featureError('invalid_print_release_manifest');
      const result = await client.PUT('/v1/prints/release-manifests/{id}', {
        params: { path: { id: plan.data.id } }, body: plan.data.input, signal: options.signal,
      });
      if (result.data === undefined) throw featureError('invalid_print_release_manifest_response');
      return result.data.data;
    },
    async get(id, query = {}, options = {}) {
      const plan = planPrintReleaseManifestRead(id, query);
      if (!plan.success) throw featureError('invalid_print_release_manifest_query');
      const result = await client.GET('/v1/prints/release-manifests/{id}', {
        params: { path: { id: plan.data.id }, query: plan.data.query }, signal: options.signal,
      });
      if (result.data === undefined) throw featureError('invalid_print_release_manifest_response');
      return result.data;
    },
    async lookup(query, options = {}) {
      const plan = planPrintReleaseManifestLookup(query);
      if (!plan.success) throw featureError('invalid_print_release_manifest_query');
      const result = await client.GET('/v1/prints/release-manifests/lookup', {
        params: { query: plan.data }, signal: options.signal,
      });
      if (result.data === undefined) throw featureError('invalid_print_release_manifest_response');
      return result.data.data;
    },
  };
}
