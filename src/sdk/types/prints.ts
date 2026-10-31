import type { paths } from '../../data-access/commerce-schema.js';
import type { CartListingRootArtifact } from './cart.js';
import type { Hex } from 'viem';
import type { SearchPageResponse } from '../api.js';
import type { RareAuthRequestOptions } from './account.js';

export type CreatePrintEstimate = paths['/v1/prints/estimates']['post']['requestBody']['content']['application/json'];
/** Provider totals for every requested copy. Artwork price, taxes and checkout fees are excluded. */
export type PrintEstimate = paths['/v1/prints/estimates']['post']['responses'][200]['content']['application/json']['data'];
export type SavePrintReleaseManifest = paths['/v1/prints/release-manifests/{id}']['put']['requestBody']['content']['application/json'];
export type PrintReleaseManifestMutation = paths['/v1/prints/release-manifests/{id}']['put']['responses'][200]['content']['application/json']['data'];
export type PrintReleaseManifestEntry = PrintReleaseManifestMutation['entries'][number];
export type PrintReleaseManifestQuery = NonNullable<paths['/v1/prints/release-manifests/{id}']['get']['parameters']['query']>;
export type PrintReleaseManifestPage = paths['/v1/prints/release-manifests/{id}']['get']['responses'][200]['content']['application/json'];
export type LookupPrintReleaseManifest = NonNullable<paths['/v1/prints/release-manifests/lookup']['get']['parameters']['query']>;
export type PrintReleaseManifestHeader = NonNullable<paths['/v1/prints/release-manifests/lookup']['get']['responses'][200]['content']['application/json']['data']>;

/** Private preparation only. Saving a manifest never signs, publishes, or associates a token by row order. */
export type PrintReleaseManifestsNamespace = {
  save: (id: string, input: SavePrintReleaseManifest, options?: RareAuthRequestOptions) => Promise<PrintReleaseManifestMutation>;
  get: (id: string, query?: PrintReleaseManifestQuery, options?: RareAuthRequestOptions) => Promise<PrintReleaseManifestPage>;
  lookup: (query: LookupPrintReleaseManifest, options?: RareAuthRequestOptions) => Promise<PrintReleaseManifestHeader | null>;
};

/** Every draft requires a chain and private production file. NFT source attribution is optional. */
export type CreatePrintDrop = paths['/v1/prints/drops']['post']['requestBody']['content']['application/json'];
export type PrintDrop = paths['/v1/prints/drops/mine/{id}']['get']['responses'][200]['content']['application/json']['data'];
export type PublicPrintDrop = paths['/v1/prints/drops/{id}']['get']['responses'][200]['content']['application/json']['data'];
export type PrintOption = paths['/v1/prints/drops/{id}/options/standard']['put']['responses'][200]['content']['application/json']['data'];
export type ConfigurePrintOption = paths['/v1/prints/drops/{id}/options/standard']['put']['requestBody']['content']['application/json'];
/** Creators may replace the private production file after configuration or publication. Existing order snapshots remain unchanged; specification edits still require an unconfigured draft. */
export type UpdatePrintDrop = paths['/v1/prints/drops/{id}']['patch']['requestBody']['content']['application/json'];
export type PreparePrintListing = paths['/v1/prints/listings/prepare']['post']['requestBody']['content']['application/json'];
export type PrintListingPreparation = paths['/v1/prints/listings/prepare']['post']['responses'][201]['content']['application/json']['data'];
export type PrintActivity = paths['/v1/prints/drops/{id}/activity']['get']['responses'][200]['content']['application/json']['data'];
export type PrintProduct = paths['/v1/prints/products/{id}']['get']['responses'][200]['content']['application/json']['data'];
/** Request cancellation is separate from the product identifier and response. */
export type PrintProductRequestOptions = { signal?: AbortSignal };

export type SignedPrintListingArtifact = CartListingRootArtifact & { signature: Hex };
export type PrintBatchItem<T> = { key: string; input: T };
export type PrintBatchResult<T> = { key: string; inputDigest: string; status: 'fulfilled'; value: T } |
  { key: string; inputDigest: string; status: 'rejected'; error: unknown; signedArtifact?: SignedPrintListingArtifact };
/** Keep keys and operation inputs unchanged when reusing previous results. */
export type PrintBatchOptions<T> = { previousResults?: readonly PrintBatchResult<T>[] };
export type PrintDropCreation = Omit<PrintDrop, 'options'>;
export type PrintPublication = { preparation: PrintListingPreparation; signedArtifact: SignedPrintListingArtifact };
export type PrintOptionConfiguration = { dropId: string; input: ConfigurePrintOption };
export type PrintListingPublication = { preparationId: string; artifact: SignedPrintListingArtifact };
export type PrintListingSigning = { preparation: PrintListingPreparation; signedArtifact?: SignedPrintListingArtifact };

export type PrintCreateOperation = {
  (input: CreatePrintDrop): Promise<PrintDropCreation>;
  (items: readonly PrintBatchItem<CreatePrintDrop>[], options?: PrintBatchOptions<PrintDropCreation>): Promise<PrintBatchResult<PrintDropCreation>[]>;
};
export type PrintConfigureOperation = {
  (input: PrintOptionConfiguration): Promise<PrintOption>;
  (items: readonly PrintBatchItem<PrintOptionConfiguration>[], options?: PrintBatchOptions<PrintOption>): Promise<PrintBatchResult<PrintOption>[]>;
};
export type PrintPrepareOperation = {
  (input: PreparePrintListing): Promise<PrintListingPreparation>;
  (items: readonly PrintBatchItem<PreparePrintListing>[], options?: PrintBatchOptions<PrintListingPreparation>): Promise<PrintBatchResult<PrintListingPreparation>[]>;
};
export type PrintSubmitSignedOperation = {
  (input: PrintListingPublication): Promise<PrintListingPreparation>;
  (items: readonly PrintBatchItem<PrintListingPublication>[], options?: PrintBatchOptions<PrintListingPreparation>): Promise<PrintBatchResult<PrintListingPreparation>[]>;
};
export type PrintPublishOperation = {
  (input: PrintListingSigning): Promise<PrintPublication>;
  (items: readonly PrintBatchItem<PrintListingSigning>[], options?: PrintBatchOptions<PrintPublication>): Promise<PrintBatchResult<PrintPublication>[]>;
};

/** Print authoring uses the account session; purchasing uses rare.cart.checkout. */
export type PrintsNamespace = {
  estimates: {
    create: (input: CreatePrintEstimate, options?: RareAuthRequestOptions) => Promise<PrintEstimate>;
  };
  releaseManifests: PrintReleaseManifestsNamespace;
  products: {
    list: (options?: PrintProductRequestOptions) => Promise<PrintProduct[]>;
    get: (id: string, options?: PrintProductRequestOptions) => Promise<PrintProduct>;
  };
  drops: {
    create: PrintCreateOperation;
    update: (id: string, input: UpdatePrintDrop) => Promise<Omit<PrintDrop, 'options'>>;
    listMine: (options?: { page?: number; perPage?: number }) => Promise<SearchPageResponse<PrintDrop>>;
    getMine: (id: string) => Promise<PrintDrop>;
    get: (id: string) => Promise<PublicPrintDrop>;
    archive: (id: string) => Promise<Omit<PrintDrop, 'options'>>;
    activity: (id: string, options?: { page?: number; perPage?: number }) => Promise<PrintActivity>;
  };
  releases: { list: (input: { universalTokenId: string }) => Promise<PublicPrintDrop[]> };
  options: { configure: PrintConfigureOperation };
  listings: {
    prepare: PrintPrepareOperation;
    submitSigned: PrintSubmitSignedOperation;
    publish: PrintPublishOperation;
  };
};
