import type { paths } from '../../data-access/commerce-schema.js';
import type { CartListingRootArtifact } from './cart.js';
import type { Hex } from 'viem';

export type CreatePrintDrop = paths['/v1/prints/drops']['post']['requestBody']['content']['application/json'];
export type PrintDrop = paths['/v1/prints/drops/mine/{id}']['get']['responses'][200]['content']['application/json']['data'];
export type PublicPrintDrop = paths['/v1/prints/drops/{id}']['get']['responses'][200]['content']['application/json']['data'];
export type PrintOption = paths['/v1/prints/drops/{id}/options/standard']['put']['responses'][200]['content']['application/json']['data'];
export type ConfigurePrintOption = paths['/v1/prints/drops/{id}/options/standard']['put']['requestBody']['content']['application/json'];
export type UpdatePrintDrop = paths['/v1/prints/drops/{id}']['patch']['requestBody']['content']['application/json'];
export type PreparePrintListing = paths['/v1/prints/listings/prepare']['post']['requestBody']['content']['application/json'];
export type PrintListingPreparation = paths['/v1/prints/listings/prepare']['post']['responses'][201]['content']['application/json']['data'];
export type PrintActivity = paths['/v1/prints/drops/{id}/activity']['get']['responses'][200]['content']['application/json']['data'];
export type PrintSpecification = paths['/v1/prints/specifications']['get']['responses'][200]['content']['application/json']['data'][number];

/** Print authoring uses the account session; purchasing uses rare.cart.checkout. */
export type PrintsNamespace = {
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
    signAndPublish: (preparation: PrintListingPreparation) => Promise<{ preparation: PrintListingPreparation; signedArtifact: CartListingRootArtifact & { signature: Hex } }>;
  };
};
