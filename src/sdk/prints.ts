import { createApiClient } from '../data-access/client.js';
import { toCartListingRootArtifactWire } from './cart-api.js';
import type { RareClientConfig } from './types/client.js';
import type { PrintsNamespace, CreatePrintDrop, PrintDropCreation, PrintBatchItem, PrintBatchOptions, PrintBatchResult,
  PrintOptionConfiguration, PrintOption, ConfigurePrintOption, PreparePrintListing, PrintListingPreparation,
  PrintListingPublication, SignedPrintListingArtifact, PrintListingSigning, PrintPublication } from './types/prints.js';
import { isPrintBatch } from './prints-batch-core.js';
import { runPrintBatch } from './prints-batch-shell.js';
import { PrintPublicationError } from './prints-errors.js';
import { buildCartListingRootArtifact, cartDomain, hashCartListing } from './cart-core.js';
import { parsePrintListingTerms, validatePrintListingQuantityLimit, validatePrintOptionConfiguration, validatePrintPublicationArtifact } from './prints-core.js';
import { requireWallet } from './wallet-shell.js';
import { cartAbi } from '../contracts/abis/cart.js';
import { getAddress, isAddressEqual } from 'viem';
import { getContractAddresses } from '../contracts/addresses.js';
import { resolveChainFromPublicClient } from './wallet-shell.js';

export function createPrintsNamespace(config: RareClientConfig, authenticatedFetch?: typeof globalThis.fetch): PrintsNamespace {
  const publicClient = createApiClient(config.apiBaseUrl, config.apiFetch);
  const client = createApiClient(config.apiBaseUrl, authenticatedFetch ?? config.apiFetch);
  const data = async <T>(request: Promise<{ data?: { data: T } }>): Promise<T> => {
    const response = await request;
    if (response.data === undefined) throw new Error('Rare API did not return print data.');
    return response.data.data;
  };
  const publishOne = (id: string, artifact: SignedPrintListingArtifact) => data(client.POST('/v1/prints/listings/{id}/publish', {
    params: { path: { id } }, body: { artifact: toCartListingRootArtifactWire(artifact) },
  }));
  function create(input: CreatePrintDrop): Promise<PrintDropCreation>;
  function create(input: readonly PrintBatchItem<CreatePrintDrop>[], options?: PrintBatchOptions<PrintDropCreation>): Promise<PrintBatchResult<PrintDropCreation>[]>;
  function create(input: CreatePrintDrop | readonly PrintBatchItem<CreatePrintDrop>[], options: PrintBatchOptions<PrintDropCreation> = {}) {
    const operation = (value: CreatePrintDrop) => data(client.POST('/v1/prints/drops', { body: value }));
    if (!isPrintBatch<CreatePrintDrop>(input)) return operation(input);
    if (input.some(item => !item.input.idempotencyKey?.trim())) throw new Error('Batch print creation requires a stable idempotencyKey for every item.');
    return runPrintBatch(input, options, operation);
  }
  function configure(dropId: string, input: ConfigurePrintOption): Promise<PrintOption>;
  function configure(items: readonly PrintBatchItem<PrintOptionConfiguration>[], options?: PrintBatchOptions<PrintOption>): Promise<PrintBatchResult<PrintOption>[]>;
  function configure(input: string | readonly PrintBatchItem<PrintOptionConfiguration>[], options?: ConfigurePrintOption | PrintBatchOptions<PrintOption>) {
    const operation = (value: PrintOptionConfiguration) => {
      const validation = validatePrintOptionConfiguration(value.input);
      if (!validation.valid) return Promise.reject(new Error(validation.message));
      return data(client.PUT('/v1/prints/drops/{id}/options/standard', { params: { path: { id: value.dropId } }, body: value.input }));
    };
    if (typeof input === 'string') {
      if (options === undefined || !('displayPriceUsdCents' in options)) throw new Error('Print configuration is required.');
      return operation({ dropId: input, input: options });
    }
    if (options !== undefined && 'displayPriceUsdCents' in options) throw new Error('Batch configuration expects batch options.');
    return runPrintBatch(input, options ?? {}, operation);
  }
  function prepare(input: PreparePrintListing): Promise<PrintListingPreparation>;
  function prepare(input: readonly PrintBatchItem<PreparePrintListing>[], options?: PrintBatchOptions<PrintListingPreparation>): Promise<PrintBatchResult<PrintListingPreparation>[]>;
  function prepare(input: PreparePrintListing | readonly PrintBatchItem<PreparePrintListing>[], options: PrintBatchOptions<PrintListingPreparation> = {}) {
    const operation = (value: PreparePrintListing) => {
      const validation = validatePrintListingQuantityLimit(value);
      if (!validation.valid) return Promise.reject(new Error(validation.message));
      return data(client.POST('/v1/prints/listings/prepare', { body: value }));
    };
    return isPrintBatch<PreparePrintListing>(input) ? runPrintBatch(input, options, operation) : operation(input);
  }
  function publish(id: string, artifact: SignedPrintListingArtifact): Promise<PrintListingPreparation>;
  function publish(input: readonly PrintBatchItem<PrintListingPublication>[], options?: PrintBatchOptions<PrintListingPreparation>): Promise<PrintBatchResult<PrintListingPreparation>[]>;
  function publish(input: string | readonly PrintBatchItem<PrintListingPublication>[], options?: SignedPrintListingArtifact | PrintBatchOptions<PrintListingPreparation>) {
    if (typeof input === 'string') {
      if (options === undefined || !('signature' in options)) throw new Error('A signed artifact is required for publication.');
      return publishOne(input, options);
    }
    if (options !== undefined && 'signature' in options) throw new Error('Batch publication expects batch options.');
    return runPrintBatch(input, options ?? {}, item => publishOne(item.preparationId, item.artifact));
  }
  function signAndPublish(preparation: PrintListingPreparation): Promise<PrintPublication>;
  function signAndPublish(items: readonly PrintBatchItem<PrintListingSigning>[], options?: PrintBatchOptions<PrintPublication>): Promise<PrintBatchResult<PrintPublication>[]>;
  function signAndPublish(input: PrintListingPreparation | readonly PrintBatchItem<PrintListingSigning>[], options: PrintBatchOptions<PrintPublication> = {}) {
    if (!isPrintBatch<PrintListingSigning>(input)) return signOne(input);
    return runPrintBatch(input, options, async item => {
      if (item.signedArtifact === undefined) return signOne(item.preparation);
      validatePrintPublicationArtifact(item.preparation, item.signedArtifact);
      try {
        return { preparation: await publishOne(item.preparation.id, item.signedArtifact), signedArtifact: item.signedArtifact };
      } catch (cause) {
        throw new PrintPublicationError(item.preparation.id, item.signedArtifact, cause);
      }
    }, item => item.preparation);
  }
  const signOne = async (preparation: PrintListingPreparation): Promise<PrintPublication> => {
    const { listing, deadline, dropId } = parsePrintListingTerms(preparation);
    const { walletClient, account, accountAddress } = requireWallet(config);
    const chainId = config.publicClient.chain?.id;
    if (chainId === undefined || String(chainId) !== preparation.chain_id) throw new Error('Print preparation belongs to another chain.');
    if (!isAddressEqual(listing.seller, accountAddress)) throw new Error('Print preparation seller does not match the connected wallet.');
    const cart = getAddress(preparation.cart_address);
    if (hashCartListing(listing, chainId, cart) !== preparation.listing_digest) throw new Error('Print preparation Listing digest does not match its frozen terms.');
    const chain = resolveChainFromPublicClient(config.publicClient);
    const expectedCart = getContractAddresses(chain).cart;
    if (expectedCart === undefined || !isAddressEqual(cart, expectedCart)) throw new Error('Print preparation does not use the configured Cart contract.');
    if (deadline <= BigInt(Math.floor(Date.now() / 1000))) throw new Error('Print Listing terms have expired. Prepare fresh terms before publishing.');
    const drop = await data(client.GET('/v1/prints/drops/mine/{id}', { params: { path: { id: dropId } } }));
    if (drop.status === 'ARCHIVED') throw new Error('This print drop is archived.');
    const nonce = await config.publicClient.readContract({ address: cart, abi: cartAbi, functionName: 'listingNonces', args: [accountAddress] });
    const artifact = buildCartListingRootArtifact({ listings: [listing], chainId, cart, nonce, deadline });
    const signature = await walletClient.signTypedData({ account, domain: cartDomain(chainId, cart), primaryType: 'ListingRoot',
      types: { ListingRoot: [{ name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
      message: { listingsRoot: artifact.root.listingsRoot, nonce, deadline },
    });
    const signedArtifact = { ...artifact, signature };
    try {
      return { preparation: await publishOne(preparation.id, signedArtifact), signedArtifact };
    } catch (cause) {
      throw new PrintPublicationError(preparation.id, signedArtifact, cause);
    }
  };
  return {
    specifications: { list: () => data(publicClient.GET('/v1/prints/specifications')) },
    drops: {
      create,
      update: (id, input) => data(client.PATCH('/v1/prints/drops/{id}', { params: { path: { id } }, body: input })),
      listMine: (options = {}) => data(client.GET('/v1/prints/drops/mine', { params: { query: options } })),
      getMine: id => data(client.GET('/v1/prints/drops/mine/{id}', { params: { path: { id } } })),
      get: id => data(publicClient.GET('/v1/prints/drops/{id}', { params: { path: { id } } })),
      archive: id => data(client.POST('/v1/prints/drops/{id}/archive', { params: { path: { id } } })),
      activity: (id, options = {}) => data(publicClient.GET('/v1/prints/drops/{id}/activity', { params: { path: { id }, query: options } })),
    },
    releases: { list: input => data(publicClient.GET('/v1/prints/releases', { params: { query: input } })) },
    options: { configure },
    listings: { prepare, publish, signAndPublish },
  };
}
