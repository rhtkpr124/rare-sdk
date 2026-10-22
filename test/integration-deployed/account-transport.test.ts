import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../src/sdk/client.js';

describe('external account transport with deployed services', () => {
  it('uses application-owned credentials for profile and messaging without an SDK session store', async () => {
    const apiBaseUrl = process.env.RARE_ACCOUNT_TEST_API_URL?.replace(/\/$/u, '');
    const key = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY;
    if (process.env.RARE_API_BASE_URL && process.env.RARE_API_BASE_URL.replace(/\/$/u, '') !== apiBaseUrl) throw new Error('RARE_API_BASE_URL must match RARE_ACCOUNT_TEST_API_URL');
    if (!apiBaseUrl || new URL(apiBaseUrl).protocol !== 'https:' || new URL(apiBaseUrl).hostname === 'api.superrare.com') throw new Error('Set a non-production HTTPS RARE_ACCOUNT_TEST_API_URL');
    if (!key || !/^0x[0-9a-f]{64}$/iu.test(key)) throw new Error('Set the existing dedicated RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const wallet = privateKeyToAccount(key as `0x${string}`);
    const managed = createRareClient({ apiBaseUrl, apiFetch: async (input, init) => {
      const response = await fetch(input, init);
      if (!response.ok) console.warn(`[live SDK transport] ${init?.method ?? 'GET'} ${new URL(String(input)).pathname} returned ${response.status}`);
      return response;
    } });
    try {
      const session = await managed.auth.loginWithWallet({ address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }) });
      const expected = await managed.profile.get();
      const external = createRareClient({ transport: (path, init) => fetch(`${apiBaseUrl}${path}`, {
        ...init, credentials: 'omit', redirect: 'error',
        headers: { ...Object.fromEntries(new Headers(init.headers)), Authorization: `Bearer ${session.accessToken}` },
      }) });
      expect('auth' in external).toBe(false);
      const profile = await external.profile.get();
      const messaging = await external.messaging.session();
      expect(profile).toEqual(expected);
      expect(messaging.user.id).toBe(expected.accountId);
      expect(messaging.address.toLowerCase()).toBe(wallet.address.toLowerCase());
      await managed.auth.logout();
      await expect(external.profile.get()).rejects.toMatchObject({ status: 401 });
      await expect(external.messaging.session()).rejects.toMatchObject({ status: 401 });
    } finally { await managed.auth.logout(); }
  }, 120_000);
});
