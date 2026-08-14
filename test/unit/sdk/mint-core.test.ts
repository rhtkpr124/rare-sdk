import { describe, expect, it } from 'vitest';
import {
  buildMintPinMetadataParams,
  isMintMetadataOptionsError,
  parseMintAttribute,
  planMintTokenUri,
} from '../../../src/sdk/mint-core.js';

const imageMedia = {
  url: 'ipfs://image',
  mimeType: 'image/png',
  size: 123,
};

const videoMedia = {
  url: 'ipfs://video',
  mimeType: 'video/mp4',
  size: 456,
};

describe('mint metadata core', () => {
  it('parses raw mint attributes without shell dependencies', () => {
    expect(parseMintAttribute('Base=Starfish')).toEqual({
      trait_type: 'Base',
      value: 'Starfish',
    });
    expect(parseMintAttribute('Level=3')).toEqual({
      trait_type: 'Level',
      value: 3,
    });
    expect(parseMintAttribute('loose')).toEqual({
      trait_type: 'value',
      value: 'loose',
    });
    expect(parseMintAttribute('{"trait_type":"Boost","value":2,"display_type":"number"}')).toEqual({
      trait_type: 'Boost',
      value: 2,
      display_type: 'number',
    });
  });

  it('rejects JSON attributes without a value', () => {
    expect(() => parseMintAttribute('{"trait_type":"Broken"}')).toThrow(
      'Attribute JSON must include "value"',
    );
  });

  it('rejects non-finite numeric mint attributes', () => {
    expect(() => parseMintAttribute('score=Infinity')).toThrow('finite number');
    expect(() => parseMintAttribute('score=1e309')).toThrow('finite number');
    expect(() => parseMintAttribute('{"trait_type":"score","value":1e309}')).toThrow(
      'finite number',
    );
    expect(() => parseMintAttribute('{"trait_type":"score","value":1,"max_value":1e309}')).toThrow(
      'finite number',
    );
  });

  it('plans direct token URI mints without requiring metadata inputs', () => {
    expect(planMintTokenUri({
      tokenUri: 'ipfs://metadata',
      attributes: ['Level=3'],
    })).toEqual({
      mode: 'provided',
      tokenUri: 'ipfs://metadata',
    });
  });

  it('plans generated metadata mints with upload order and parsed attributes', () => {
    expect(planMintTokenUri({
      name: 'Rare Test',
      description: 'A test NFT',
      image: './image.png',
      video: './video.mp4',
      tags: ['test', 'rare'],
      attributes: ['Level=3'],
    })).toEqual({
      mode: 'metadata',
      metadata: {
        name: 'Rare Test',
        description: 'A test NFT',
        uploads: [
          { role: 'image', path: './image.png' },
          { role: 'video', path: './video.mp4' },
        ],
        tags: ['test', 'rare'],
        attributes: [{ trait_type: 'Level', value: 3 }],
      },
    });
  });

  it('reports missing metadata requirements as typed option errors', () => {
    for (const params of [
      {},
      { name: 'Rare Test' },
      { name: 'Rare Test', description: 'A test NFT' },
    ]) {
      try {
        planMintTokenUri(params);
        throw new Error('Expected planMintTokenUri to throw.');
      } catch (error) {
        expect(isMintMetadataOptionsError(error)).toBe(true);
      }
    }
  });

  it('builds pin metadata params from planned metadata and uploaded media', () => {
    const plan = planMintTokenUri({
      name: 'Rare Test',
      description: 'A test NFT',
      image: './image.png',
      video: './video.mp4',
      tags: ['test'],
      attributes: ['Level=3'],
    });

    if (plan.mode !== 'metadata') {
      throw new Error('Expected metadata plan.');
    }

    expect(buildMintPinMetadataParams(plan.metadata, {
      image: imageMedia,
      video: videoMedia,
    })).toEqual({
      name: 'Rare Test',
      description: 'A test NFT',
      image: imageMedia,
      video: videoMedia,
      tags: ['test'],
      attributes: [{ trait_type: 'Level', value: 3 }],
    });
  });
});
