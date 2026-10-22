import { randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { parseSiweMessage } from 'viem/siwe';
import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../src/sdk/client.js';

const configuration = () => {
  const apiBaseUrl = process.env.RARE_ACCOUNT_TEST_API_URL?.replace(/\/$/u, '');
  const key = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY;
  if (!apiBaseUrl || new URL(apiBaseUrl).protocol !== 'https:' || new URL(apiBaseUrl).hostname === 'api.superrare.com') throw new Error('Use RARE_ACCOUNT_TEST_API_URL with a non-production HTTPS deployment');
  if (!key || !/^0x[0-9a-f]{64}$/iu.test(key)) throw new Error('Set the existing dedicated RARE_ACCOUNT_TEST_PRIVATE_KEY');
  return { apiBaseUrl, wallet: privateKeyToAccount(key as `0x${string}`) };
};

// These exercise real HTTP origin admission. Browser enforcement is verified separately.
const browserOriginFetch = (origin: string): typeof fetch => (input, init = {}) => fetch(input, {
  ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), Origin: origin },
});

describe('deployed third-party wallet authentication', () => {
  it('admits unregistered origins and keeps their bearer sessions independent', async () => {
    const { apiBaseUrl, wallet } = configuration();
    const clients = [1, 2].map(index => {
      const origin = `https://sdk-${index}-${randomUUID()}.example`;
      return { origin, client: createRareClient({ apiBaseUrl, apiFetch: browserOriginFetch(origin) }) };
    });
    try {
      for (const { origin, client } of clients) {
        await client.auth.loginWithWallet({ address: wallet.address, chainId: 1, signingOrigin: origin,
          signMessage: message => {
            const parsed = parseSiweMessage(message);
            expect(parsed.domain).toBe(new URL(origin).host);
            expect(parsed.uri).toBe(origin);
            expect(parsed.statement).toMatch(/SuperRare.*account|account.*SuperRare/iu);
            return wallet.signMessage({ message });
          },
        });
        expect((await client.profile.get()).address.toLowerCase()).toBe(wallet.address.toLowerCase());
      }
      const [first, second] = clients;
      if (!first || !second) throw new Error('Missing origin clients');
      await first.client.auth.logout();
      await expect(first.client.profile.get()).rejects.toMatchObject({ code: 'authentication_required' });
      await second.client.auth.refresh();
      expect((await second.client.profile.get()).address.toLowerCase()).toBe(wallet.address.toLowerCase());
    } finally {
      await Promise.all(clients.map(({ client }) => client.auth.logout()));
    }
  }, 120_000);

  it('rejects a browser requesting a challenge for a different signing origin', async () => {
    const { apiBaseUrl, wallet } = configuration();
    const response = await browserOriginFetch(`https://sdk-${randomUUID()}.example`)(`${apiBaseUrl}/auth/v2/wallet/challenge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: 'rare-sdk', address: wallet.address, chain_id: 1, origin: `https://different-${randomUUID()}.example` }),
      signal: AbortSignal.timeout(30_000),
    });
    expect(response.status).toBe(403);
    const value = await response.json() as Record<string, unknown>;
    expect(value).not.toHaveProperty('message');
    expect(value).not.toHaveProperty('access_token');
  });
});
