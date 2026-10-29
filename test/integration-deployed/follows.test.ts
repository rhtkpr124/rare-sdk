import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../src/sdk/client.js';

const fixture = (name: string) => {
  const key = process.env[name];
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error(`Missing dedicated test wallet ${name}`);
  return privateKeyToAccount(key as `0x${string}`);
};
const origin = () => {
  const value = process.env.RARE_ACCOUNT_TEST_API_URL;
  if (!value) throw new Error('Missing RARE_ACCOUNT_TEST_API_URL');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use a non-production HTTPS API origin');
  return url.origin;
};
const noEmail = (value: unknown): void => {
  if (Array.isArray(value)) value.forEach(noEmail);
  else if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    expect(key.toLowerCase()).not.toContain('email');
    noEmail(child);
  }
};

describe('user follows against deployed services', () => {
  it('resolves every selector publicly and follows/unfollows only as the signed-in account', async () => {
    const apiBaseUrl = origin();
    const owner = fixture('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const targetWallet = fixture('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(owner.address.toLowerCase()).not.toBe(targetWallet.address.toLowerCase());
    const client = createRareClient({ apiBaseUrl });
    const target = createRareClient({ apiBaseUrl });
    const api = createRareClient({ apiBaseUrl: apiBaseUrl });
    try {
      for (const [account, wallet] of [[client, owner], [target, targetWallet]] as const) {
        await account.auth.loginWithWallet({ address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }) });
      }
      const own = await client.profile.get();
      const other = await target.profile.get();
      const targetFollowing = await api.user.following({ address: targetWallet.address });
      const absentAddress = privateKeyToAccount(generatePrivateKey()).address;
      await expect(api.user.followers({ address: absentAddress })).rejects.toMatchObject({ status: 404 });
      await expect(client.following.follow({ address: absentAddress })).rejects.toMatchObject({ status: 404 });
      const selectors = [{ address: targetWallet.address }, { username: other.username }, { userId: Number(other.accountId) }];
      const before = await api.user.followers(selectors[0]!, { perPage: 100 });
      // Disposable fixtures must not have a pre-existing relationship to destroy.
      expect(before.data.some(user => user.userId === Number(own.accountId))).toBe(false);
      try {
        for (const selector of selectors) {
          const profile = await api.user.get(selector);
          expect(profile.userId).toBe(Number(other.accountId));
          noEmail(profile);
        }
        const concurrent = await Promise.allSettled(selectors.map(selector => client.following.follow(selector)));
        for (const result of concurrent) if (result.status === 'rejected') throw result.reason;
        await client.following.follow({ username: other.username });
        const followers = await api.user.followers({ userId: Number(other.accountId) }, { perPage: 100 });
        expect(followers.pagination.totalCount).toBe(before.pagination.totalCount + 1);
        expect(followers.data.some(user => user.userId === Number(own.accountId))).toBe(true);
        noEmail(followers);
        for (const selector of selectors) expect(await api.user.followers(selector, { perPage: 100 })).toEqual(followers);
        const following = await api.user.following({ userId: Number(own.accountId) });
        expect(following.data.some(user => user.userId === Number(other.accountId))).toBe(true);
        noEmail(following);
        const page = await api.user.followers({ username: other.username }, { page: 1, perPage: 1 });
        expect(page.data.length).toBeLessThanOrEqual(1);
        expect(page.pagination).toMatchObject({ page: 1, perPage: 1, totalCount: followers.pagination.totalCount });
        for (const authorization of [undefined, 'Bearer forged']) {
          const response = await fetch(`${apiBaseUrl}/v1/me/following?userId=${other.accountId}`, {
            method: 'DELETE', headers: authorization ? { authorization } : {}, signal: AbortSignal.timeout(30_000),
          });
          expect(response.status).toBe(401);
        }
        const session = await client.auth.getSession();
        if (!session) throw new Error('Missing session');
        const headers = { authorization: `Bearer ${session.accessToken}` };
        const self = await fetch(`${apiBaseUrl}/v1/me/following?userId=${own.accountId}`, { method: 'POST', headers, signal: AbortSignal.timeout(30_000) });
        expect(self.status).toBe(400);
        const ambiguous = await fetch(`${apiBaseUrl}/v1/users/followers?userId=${other.accountId}&username=${other.username}`, { signal: AbortSignal.timeout(30_000) });
        expect(ambiguous.status).toBe(400);
        expect(await target.profile.get()).toEqual(other);
        expect(await api.user.following({ address: targetWallet.address })).toEqual(targetFollowing);
        await client.following.unfollow({ address: targetWallet.address });
        expect(await api.user.followers({ username: other.username }, { perPage: 100 })).toEqual(before);
        expect((await api.user.following({ address: owner.address })).data.some(user => user.userId === Number(other.accountId))).toBe(false);
      } finally {
        await client.following.unfollow({ userId: Number(other.accountId) });
      }
    } finally {
      await Promise.all([client.auth.logout(), target.auth.logout()]);
    }
  }, 240_000);
});
