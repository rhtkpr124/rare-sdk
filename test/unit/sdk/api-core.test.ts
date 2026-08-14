import { describe, expect, it } from 'vitest';
import {
  buildCollectionSearchQuery,
  buildGeneratedMediaEntry,
  buildImportErc721Body,
  buildIpfsJsonUploadPayload,
  buildIpfsUploadPlan,
  buildMediaUploadPlan,
  buildNftSearchQuery,
  buildPinMetadataBody,
} from '../../../src/sdk/api-core.js';

const ownerAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const contractAddress = '0xabc0000000000000000000000000000000000000' as const;

describe('SDK API request planning', () => {
  it('builds NFT search query defaults with supplied filters', () => {
    expect(buildNftSearchQuery({ query: 'rare', ownerAddress, chainId: 11_155_111 })).toEqual({
      q: 'rare',
      page: 1,
      perPage: 24,
      sortBy: 'recentActivity',
      ownerAddress,
      creatorAddress: undefined,
      contractAddress: undefined,
      collectionId: undefined,
      chainId: 11_155_111,
      listingType: undefined,
      hasAuction: undefined,
      auctionState: undefined,
      auctionCreatorAddress: undefined,
      auctionBidderAddress: undefined,
      hasListing: undefined,
      hasOffer: undefined,
      offerBuyerAddress: undefined,
      tags: undefined,
      mediaType: undefined,
    });
  });

  it('builds NFT account market search filters', () => {
    expect(
      buildNftSearchQuery({
        page: 3,
        perPage: 50,
        ownerAddress,
        listingType: 'BATCH_SALE_PRICE',
        hasListing: true,
        hasOffer: true,
        offerBuyerAddress: ownerAddress,
        hasAuction: true,
        auctionCreatorAddress: ownerAddress,
        auctionBidderAddress: ownerAddress,
      }),
    ).toEqual({
      q: undefined,
      page: 3,
      perPage: 50,
      sortBy: 'recentActivity',
      ownerAddress,
      creatorAddress: undefined,
      contractAddress: undefined,
      collectionId: undefined,
      chainId: undefined,
      listingType: 'BATCH_SALE_PRICE',
      hasAuction: true,
      auctionState: undefined,
      auctionCreatorAddress: ownerAddress,
      auctionBidderAddress: ownerAddress,
      hasListing: true,
      hasOffer: true,
      offerBuyerAddress: ownerAddress,
      tags: undefined,
      mediaType: undefined,
    });
  });

  it('infers NFT market presence filters from specific market filters', () => {
    expect(
      buildNftSearchQuery({
        listingType: 'SALE_PRICE',
        auctionState: 'RUNNING',
        offerBuyerAddress: ownerAddress,
      }),
    ).toEqual(expect.objectContaining({
      listingType: 'SALE_PRICE',
      hasListing: true,
      auctionState: 'RUNNING',
      hasAuction: true,
      offerBuyerAddress: ownerAddress,
      hasOffer: true,
    }));

    expect(
      buildNftSearchQuery({
        listingType: 'SALE_PRICE',
        hasListing: false,
        auctionState: 'RUNNING',
        hasAuction: false,
        offerBuyerAddress: ownerAddress,
        hasOffer: false,
      }),
    ).toEqual(expect.objectContaining({
      hasListing: false,
      hasAuction: false,
      hasOffer: false,
    }));
  });

  it('builds collection search query defaults', () => {
    expect(buildCollectionSearchQuery({ query: 'rare', page: 2, perPage: 10, ownerAddress, chainId: 1 })).toEqual({
      q: 'rare',
      page: 2,
      perPage: 10,
      sortBy: 'newest',
      ownerAddress,
      chainId: 1,
    });
  });

  it('validates import inputs and normalizes addresses', () => {
    expect(
      buildImportErc721Body({
        chainId: 11_155_111,
        contract: contractAddress,
        owner: ownerAddress,
      }),
    ).toEqual({
      chainId: 11_155_111,
      contractAddress: contractAddress.toLowerCase(),
      ownerAddress: ownerAddress.toLowerCase(),
    });
  });

  it('rejects invalid import inputs before request execution', () => {
    expect(() =>
      buildImportErc721Body({
        chainId: 0,
        contract: contractAddress,
        owner: ownerAddress,
      }),
    ).toThrow('chainId must be a positive integer');
  });

  it('plans media uploads from safe filenames and MIME types', () => {
    expect(buildMediaUploadPlan(new Uint8Array([1, 2, 3]), 'nested\\path/art.PNG')).toEqual({
      fileSize: 3,
      filename: 'art.PNG',
      mimeType: 'image/png',
    });
  });

  it('plans generic IPFS uploads from safe filenames', () => {
    expect(buildIpfsUploadPlan(new Uint8Array([1, 2, 3]), 'nested/path/metadata.json')).toEqual({
      fileSize: 3,
      filename: 'metadata.json',
    });
  });

  it('builds JSON upload payloads with a default metadata filename', () => {
    const payload = buildIpfsJsonUploadPayload({ name: 'Token' });

    expect(payload.filename).toBe('metadata.json');
    expect(new TextDecoder().decode(payload.buffer)).toBe('{"name":"Token"}');
  });

  it('rejects non-serializable JSON upload values', () => {
    expect(() => buildIpfsJsonUploadPayload(undefined)).toThrow('IPFS JSON upload value must be JSON-serializable.');
  });

  it('rejects empty IPFS uploads before request execution', () => {
    expect(() => buildIpfsUploadPlan(new Uint8Array(), 'empty.json')).toThrow('IPFS upload file must not be empty.');
    expect(() => buildIpfsUploadPlan(new Uint8Array([1]), '')).toThrow('IPFS upload filename must not be empty.');
  });

  it('builds generated media entries with parsed dimensions and fallback size', () => {
    expect(
      buildGeneratedMediaEntry(
        {
          uri: 'ipfs://generated-media',
          mimeType: 'image/png',
          dimensions: '640x480',
        },
        5,
      ),
    ).toEqual({
      url: 'ipfs://generated-media',
      mimeType: 'image/png',
      size: 5,
      dimensions: { width: 640, height: 480 },
    });
  });

  it('builds metadata pin bodies with optional video, tags, and attributes', () => {
    expect(
      buildPinMetadataBody({
        name: 'Rare Token',
        description: 'A test token',
        image: { url: 'ipfs://image', mimeType: 'image/png', size: 10 },
        video: { url: 'ipfs://video', mimeType: 'video/mp4', size: 20 },
        tags: ['test'],
        attributes: [{ trait_type: 'Level', value: 1 }],
      }),
    ).toEqual({
      name: 'Rare Token',
      description: 'A test token',
      nftMedia: {
        image: { url: 'ipfs://image', mimeType: 'image/png', size: 10 },
        video: { url: 'ipfs://video', mimeType: 'video/mp4', size: 20 },
      },
      tags: ['test'],
      attributes: [{ trait_type: 'Level', value: 1 }],
    });
  });
});
