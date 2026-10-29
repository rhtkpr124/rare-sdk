import { describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { createRareClient } from '../../dist/sdk/index.js';
import { loadDotEnv } from '../helpers/env.js';

loadDotEnv();

describe('deployed public print products', () => {
  it('returns the eight public print presets with provider guidance before authentication', async () => {
    const apiBaseUrl = process.env.RARE_ACCOUNT_TEST_API_URL ?? process.env.RARE_API_BASE_URL;
    if (!apiBaseUrl) throw new Error('Set RARE_API_BASE_URL to a deployment with the print product API.');
    const rare = createRareClient({ apiBaseUrl, publicClient: createPublicClient({ chain: sepolia, transport: http() }) });
    const products = await rare.prints.products.list();
    expect(products.map(product => product.id).sort((left, right) => left.localeCompare(right))).toEqual([
      'GLOBAL-FAP-8X12', 'GLOBAL-FAP-12X18', 'GLOBAL-FAP-16X24', 'GLOBAL-FAP-24X36',
      'GLOBAL-FAP-8X8', 'GLOBAL-FAP-12X12', 'GLOBAL-FAP-16X16', 'GLOBAL-FAP-24X24',
    ].sort((left, right) => left.localeCompare(right)));
    for (const product of products) {
      expect(product.automaticOrientation).toBe(true);
      expect(product.fileRequirements).toEqual({ acceptedContentTypes: ['image/jpeg', 'image/png'], maximumBytes: 250 * 1024 * 1024 });
      expect(product).not.toHaveProperty('destinationCountries');
      expect(product).not.toHaveProperty('price');
      expect(product).not.toHaveProperty('shipping');
      expect(await rare.prints.products.get(product.id)).toEqual(product);
    }
    expect(products.find(product => product.id === 'GLOBAL-FAP-8X12')?.printAreas).toContainEqual({
      name: 'default', required: true, recommendedWidthPixels: 2400, recommendedHeightPixels: 3600,
    });
    expect(products.find(product => product.id === 'GLOBAL-FAP-8X8')?.printAreas).toContainEqual({
      name: 'default', required: true, recommendedWidthPixels: 2400, recommendedHeightPixels: 2400,
    });
    await expect(rare.prints.products.get('unsupported')).rejects.toMatchObject({ status: 404 });
  });

});
