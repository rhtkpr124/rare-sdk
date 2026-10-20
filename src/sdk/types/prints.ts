import type { paths } from '../../data-access/commerce-schema.js';
import type { CartListingRootArtifact } from './cart.js';
import type { Hex } from 'viem';

export type CreatePrintDrop = paths['/v1/prints/drops']['post']['requestBody']['content']['application/json'];
export type PrintDrop = paths['/v1/prints/drops/mine/{id}']['get']['responses'][200]['content']['application/json']['data'];
export type PublicPrintDrop = paths['/v1/prints/drops/{id}']['get']['responses'][200]['content']['application/json']['data'];
export type PrintOption = paths['/v1/prints/drops/{id}/options/standard']['put']['responses'][200]['content']['application/json']['data'];
export type ConfigurePrintOption = paths['/v1/prints/drops/{id}/options/standard']['put']['requestBody']['content']['application/json'];
export type PrintReceipt = NonNullable<PublicPrintDrop['options'][number]['receipt']>;
export type UpdatePrintDrop = paths['/v1/prints/drops/{id}']['patch']['requestBody']['content']['application/json'];
export type PreparePrintListing = paths['/v1/prints/listings/prepare']['post']['requestBody']['content']['application/json'];
export type PrintListingPreparation = paths['/v1/prints/listings/prepare']['post']['responses'][201]['content']['application/json']['data'];
export type PrintActivity = paths['/v1/prints/drops/{id}/activity']['get']['responses'][200]['content']['application/json']['data'];
export type PrintSpecification = paths['/v1/prints/specifications']['get']['responses'][200]['content']['application/json']['data'][number];
export type CreatePrintCampaign = paths['/v1/prints/campaigns']['post']['requestBody']['content']['application/json'];
export type PrintCampaign = paths['/v1/prints/campaigns/{id}']['get']['responses'][200]['content']['application/json']['data'];
export type PrintCampaignPage = paths['/v1/prints/campaigns/mine']['get']['responses'][200]['content']['application/json'];
export type PrintCampaignSourcePage = paths['/v1/prints/campaigns/{id}/sources']['get']['responses'][200]['content']['application/json'];
export type PrintCampaignSource = PrintCampaignSourcePage['data'][number];
export type ConfigurePrintCampaignSource = paths['/v1/prints/campaigns/{id}/sources/{tokenId}']['put']['requestBody']['content']['application/json'];
export type PreparePrintCampaign = paths['/v1/prints/campaigns/{id}/prepare']['post']['requestBody']['content']['application/json'];
export type PrintCampaignPreparation = paths['/v1/prints/campaigns/{id}/prepare']['post']['responses'][200]['content']['application/json']['data'];
export type PublicPrintCampaignListOptions = NonNullable<paths['/v1/prints/campaigns']['get']['parameters']['query']>;
export type PrintCampaignListOptions = NonNullable<paths['/v1/prints/campaigns/mine']['get']['parameters']['query']>;
export type PrintCampaignSourceListOptions = NonNullable<paths['/v1/prints/campaigns/{id}/sources']['get']['parameters']['query']>;

export type PrintCampaignsNamespace = {
  create: (input: CreatePrintCampaign) => Promise<PrintCampaign>;
  /** Published benefits associated with an artwork; does not reveal account claim status. */
  list: (options: PublicPrintCampaignListOptions) => Promise<PrintCampaignPage>;
  get: (id: string) => Promise<PrintCampaign>;
  getMine: (id: string) => Promise<PrintCampaign>;
  listMine: (options?: PrintCampaignListOptions) => Promise<PrintCampaignPage>;
  /** Account-specific source rights, including unavailable and previously consumed claims. */
  listSources: (id: string, options?: PrintCampaignSourceListOptions) => Promise<PrintCampaignSourcePage>;
  setSource: (id: string, tokenId: string, input: ConfigurePrintCampaignSource) => Promise<PrintCampaignSource>;
  /** Publish returned preparations with prints.listings.signAndPublish; checkout remains Cart. */
  prepare: (id: string, input: PreparePrintCampaign) => Promise<PrintCampaignPreparation>;
};

/** Print authoring uses the account session; purchasing uses rare.cart.checkout. */
export type PrintsNamespace = {
  campaigns: PrintCampaignsNamespace;
  specifications: { list: () => Promise<PrintSpecification[]> };
  drops: {
    create: (input: CreatePrintDrop) => Promise<Omit<PrintDrop, 'options'>>;
    update: (id: string, input: UpdatePrintDrop) => Promise<Omit<PrintDrop, 'options'>>;
    listMine: (options?: { after?: string; take?: number }) => Promise<PrintDrop[]>;
    getMine: (id: string) => Promise<PrintDrop>;
    get: (id: string) => Promise<PublicPrintDrop>;
    archive: (id: string) => Promise<Omit<PrintDrop, 'options'>>;
    activity: (id: string, options?: { after?: string }) => Promise<PrintActivity>;
  };
  releases: { list: (input: { universalTokenId: string }) => Promise<PublicPrintDrop[]> };
  options: { configure: (dropId: string, input: ConfigurePrintOption) => Promise<PrintOption> };
  listings: {
    prepare: (input: PreparePrintListing) => Promise<PrintListingPreparation>;
    publish: (preparationId: string, artifact: CartListingRootArtifact & { signature: Hex }) => Promise<PrintListingPreparation>;
    signAndPublish: (preparation: PrintListingPreparation, options?: { autoApprove?: boolean }) => Promise<{
      preparation: PrintListingPreparation; signedArtifact: CartListingRootArtifact & { signature: Hex }; approvalTxHash?: Hex;
    }>;
  };
};
