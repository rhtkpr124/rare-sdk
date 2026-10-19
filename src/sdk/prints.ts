import { createApiClient } from '../data-access/client.js';
import { toCartListingRootArtifactWire } from './cart-api.js';
import type { RareClientConfig } from './types/client.js';
import type { PrintsNamespace } from './types/prints.js';
import { buildCartListingRootArtifact, cartDomain, hashCartListing } from './cart-core.js';
import { parsePrintListingTerms } from './prints-core.js';
import { requireWallet } from './wallet-shell.js';
import { cartAbi } from '../contracts/abis/cart.js';
import { getAddress, isAddressEqual } from 'viem';
import { getContractAddresses } from '../contracts/addresses.js';
import { resolveChainFromPublicClient } from './wallet-shell.js';
import { approvalAbi, NftApprovalRequiredError } from './approvals-shell.js';

export function createPrintsNamespace(config: RareClientConfig): PrintsNamespace {
  const publicClient = createApiClient(config.apiBaseUrl, config.apiFetch);
  const client = createApiClient(config.apiBaseUrl, config.accountClient?.authenticatedFetch ?? config.apiFetch);
  const data = async <T>(request: Promise<{ data?: { data: T } }>): Promise<T> => {
    const response = await request;
    if (response.data === undefined) throw new Error('Rare API did not return print data.');
    return response.data.data;
  };
  const publish: PrintsNamespace['listings']['publish'] = (id, artifact) => data(client.POST('/v1/prints/listings/{id}/publish', {
    params: { path: { id } }, body: { artifact: toCartListingRootArtifactWire(artifact) },
  }));
  return {
    specifications: { list: () => data(publicClient.GET('/v1/prints/specifications')) },
    drops: {
      create: input => data(client.POST('/v1/prints/drops', { body: input })),
      update: (id, input) => data(client.PATCH('/v1/prints/drops/{id}', { params: { path: { id } }, body: input })),
      listMine: (options = {}) => data(client.GET('/v1/prints/drops/mine', { params: { query: options } })),
      getMine: id => data(client.GET('/v1/prints/drops/mine/{id}', { params: { path: { id } } })),
      get: id => data(publicClient.GET('/v1/prints/drops/{id}', { params: { path: { id } } })),
      archive: id => data(client.POST('/v1/prints/drops/{id}/archive', { params: { path: { id } } })),
      activity: (id, options = {}) => data(publicClient.GET('/v1/prints/drops/{id}/activity', { params: { path: { id }, query: options } })),
    },
    releases: { list: input => data(publicClient.GET('/v1/prints/releases', { params: { query: input } })) },
    options: { configure: (id, input) => data(client.PUT('/v1/prints/drops/{id}/options/standard', { params: { path: { id } }, body: input })) },
    listings: {
      prepare: input => data(client.POST('/v1/prints/listings/prepare', { body: input })),
      publish,
      async signAndPublish(preparation) {
        const { listing, deadline } = parsePrintListingTerms(preparation);
        const { walletClient, account, accountAddress } = requireWallet(config);
        const chainId = config.publicClient.chain?.id;
        if (chainId === undefined || String(chainId) !== preparation.chain_id) throw new Error('Print preparation belongs to another chain.');
        if (!isAddressEqual(listing.seller, accountAddress)) throw new Error('Print preparation seller does not match the connected wallet.');
        const cart = getAddress(preparation.cart_address);
        if (hashCartListing(listing, chainId, cart) !== preparation.listing_digest) throw new Error('Print preparation Listing digest does not match its frozen terms.');
        const expectedCart = getContractAddresses(resolveChainFromPublicClient(config.publicClient)).cart;
        if (expectedCart === undefined || !isAddressEqual(cart, expectedCart)) throw new Error('Print preparation does not use the configured Cart contract.');
        if (listing.fulfillmentKind === 2 || listing.fulfillmentKind === 3) {
          const approved = await config.publicClient.readContract({ address: listing.tokenContract, abi: approvalAbi,
            functionName: 'isApprovedForAll', args: [accountAddress, cart] });
          if (!approved) throw new NftApprovalRequiredError({ nftAddress: listing.tokenContract, operator: cart });
        }
        const nonce = await config.publicClient.readContract({ address: cart, abi: cartAbi, functionName: 'listingNonces', args: [accountAddress] });
        const artifact = buildCartListingRootArtifact({ listings: [listing], chainId, cart, nonce, deadline });
        const signature = await walletClient.signTypedData({ account, domain: cartDomain(chainId, cart), primaryType: 'ListingRoot',
          types: { ListingRoot: [{ name: 'listingsRoot', type: 'bytes32' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
          message: { listingsRoot: artifact.root.listingsRoot, nonce, deadline },
        });
        const signedArtifact = { ...artifact, signature };
        return { preparation: await publish(preparation.id, signedArtifact), signedArtifact };
      },
    },
  };
}
