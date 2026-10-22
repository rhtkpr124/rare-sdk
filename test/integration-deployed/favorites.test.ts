import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareClient, type RareAccountClient } from '../../src/sdk/index.js';
import { getAddress } from 'viem';
import { normalizeFavoriteId } from '../../src/sdk/favorites-core.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const wallet = (name: string) => {
  const key = required(name);
  if (!isPrivateKeyString(key)) throw new Error(`Invalid dedicated test key ${name}`);
  return privateKeyToAccount(key);
};
const login = async (client: RareAccountClient, owner: ReturnType<typeof wallet>): Promise<void> => {
  await client.auth.loginWithWallet({ address: owner.address, chainId: 1, signMessage: message => owner.signMessage({ message }) });
};
const nftIdentity = (id: string) => {
  const [chainId, contract, tokenId] = normalizeFavoriteId(id).split('-');
  if (!chainId || !contract || !tokenId) throw new Error('Invalid dedicated artwork ID');
  return { chainId, contract: getAddress(contract), tokenId };
};
// Successful index reads may lag the database write. Service errors fail immediately.
const waitFavoriteCount = async (api: ReturnType<typeof createRareClient>, id: string, expected: number, deadline = Date.now() + 30_000): Promise<number> => {
  const count = await api.nft.favoriteCount(nftIdentity(id));
  if (count === expected) return count;
  if (Date.now() >= deadline) throw new Error(`Favorite index did not reach ${expected} within 30 seconds; observed ${count}`);
  await new Promise(resolve => setTimeout(resolve, 500));
  return waitFavoriteCount(api, id, expected, deadline);
};
describe('artwork favorites against deployed services', () => {
  it('restricts list access to its account, exposes only aggregate counts, and applies writes only to the signed-in account', async () => {
    const url = new URL(required('RARE_ACCOUNT_TEST_API_URL'));
    if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.username || url.password || url.search || url.hash) throw new Error('Use a non-production HTTPS API origin');
    const id = normalizeFavoriteId(required('RARE_ACCOUNT_TEST_ARTWORK_ID'));
    const owner = wallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const otherOwner = wallet('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(owner.address.toLowerCase()).not.toBe(otherOwner.address.toLowerCase());
    const account = createRareClient({ apiBaseUrl: url.origin });
    const other = createRareClient({ apiBaseUrl: url.origin });
    const api = createRareClient({ apiBaseUrl: url.origin });
    const resource = `/v1/me/favorites/${id}`;
    const call = (path: string, method = 'GET', token?: string) => fetch(`${url.origin}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(30_000) });
    const beforeCount = await api.nft.favoriteCount(nftIdentity(id));
    const absentId = `1-${privateKeyToAccount(generatePrivateKey()).address.toLowerCase()}-9223372036854775807`;
    await expect(api.nft.favoriteCount(nftIdentity(absentId))).rejects.toMatchObject({ status: 404 });
    for (const token of [undefined, 'forged']) {
      expect((await call('/v1/me/favorites', 'GET', token)).status).toBe(401);
      for (const method of ['GET', 'PUT', 'DELETE']) expect((await call(resource, method, token)).status).toBe(401);
    }
    try {
      await login(account, owner);
      await login(other, otherOwner);
      await expect(account.favorites.add(absentId)).rejects.toMatchObject({ status: 404 });
      const before = await account.favorites.list();
      const otherBefore = await other.favorites.list();
      expect(await account.favorites.has(id)).toBe(false);
      expect(await other.favorites.has(id)).toBe(false);
      try {
        await account.favorites.add(id);
        await account.favorites.add(id);
        expect(await account.favorites.has(id)).toBe(true);
        expect(await other.favorites.has(id)).toBe(false);
        const list = await account.favorites.list({ perPage: 1 });
        expect(list.pagination.totalCount).toBe(before.pagination.totalCount + 1);
        expect(list.data).toHaveLength(1);
        expect(list.data[0]?.universalTokenId).toBe(id);
        const visible = await account.favorites.list({ perPage: 100 });
        for (const favorite of visible.data) {
          await expect(api.nft.favoriteCount(nftIdentity(favorite.universalTokenId))).resolves.toBeGreaterThanOrEqual(0);
        }
        const afterLast = await account.favorites.list({ page: visible.pagination.totalPages + 1, perPage: 100 });
        expect(afterLast.data).toEqual([]);
        expect(afterLast.pagination.totalCount).toBe(visible.pagination.totalCount);
        expect(JSON.stringify(list)).not.toContain('email');
        expect(await waitFavoriteCount(api, id, beforeCount + 1)).toBe(beforeCount + 1);
        const count = await call(`/v1/nfts/${id}/favorites/count`);
        expect(await count.json()).toEqual({ data: { count: beforeCount + 1 } });
        expect((await call(`/v1/nfts/${id}/favorites`)).status).toBe(404);
        expect((await call(`/v1/users/${otherOwner.address}/favorites`)).status).toBe(404);
        const session = await account.auth.getSession();
        if (!session) throw new Error('Missing session');
        const otherProfile = await other.profile.get();
        for (const query of [`userId=${otherProfile.accountId}`, `address=${otherOwner.address}`, `username=${otherProfile.username}`]) {
          expect((await call(`/v1/me/favorites?${query}`, 'GET', session.accessToken)).status).toBe(400);
          expect((await call(`${resource}?${query}`, 'DELETE', session.accessToken)).status).toBe(400);
        }
        const privateResponse = await call('/v1/me/favorites', 'GET', session.accessToken);
        expect(privateResponse.headers.get('cache-control')).toContain('no-store');
        expect(await other.favorites.list()).toEqual(otherBefore);
        await account.favorites.remove(id);
        await account.favorites.remove(id);
        expect(await account.favorites.has(id)).toBe(false);
        expect(await account.favorites.list()).toEqual(before);
        expect(await waitFavoriteCount(api, id, beforeCount)).toBe(beforeCount);
      } finally {
        await account.favorites.remove(id);
      }
    } finally {
      await Promise.all([account.auth.logout(), other.auth.logout()]);
    }
  }, 240_000);
});
