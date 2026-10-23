import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../src/sdk/client.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';
const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const signer = (name: string) => { const value = required(name); if (!isPrivateKeyString(value)) throw new Error(`Invalid ${name}`); return privateKeyToAccount(value); };
const apiOrigin = (): string => {
  const url = new URL(required('RARE_ACCOUNT_TEST_API_URL'));
  if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use a non-production HTTPS API origin');
  return url.origin;
};
const noEmail = (value: unknown): void => {
  if (Array.isArray(value)) value.forEach(noEmail);
  else if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) { expect(key.toLowerCase()).not.toContain('email'); noEmail(child); }
};
describe('drops against deployed services', () => {
  it('uploads, creates, publicly lists by each selector, patches and deletes an owned announcement', async () => {
    const apiBaseUrl = apiOrigin();
    const wallet = signer('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const account = createRareClient({ apiBaseUrl });
    const publicApi = createRareClient({ apiBaseUrl: apiBaseUrl });
    try {
      await account.auth.loginWithWallet({ address: wallet.address, chainId: 11155111, signMessage: message => wallet.signMessage({ message }) });
      const profile = await account.profile.get();
      const bytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      const upload = await account.upload(bytes, 'drop.gif', { contentType: 'image/gif' });
      const startsAt = new Date(Date.now() + 86400000).toISOString();
      const drop = await account.drops.create({ type: 'NONE', startsAt, metadata: { headline: `SDK drop ${Date.now()}`, description: 'Dedicated integration announcement', destinationUrl: '', imageUrl: upload.url } });
      try {
        expect(drop.userId).toBe(profile.accountId);
        expect(drop.metadata.imageObjectKey).toBe(upload.key);
        expect(await publicApi.drops.get(drop.id)).toEqual(drop);
        for (const user of [{ address: wallet.address }, { username: profile.username }, { userId: Number(profile.accountId) }]) {
          const page = await publicApi.drops.list({ from: new Date(Date.parse(startsAt) - 1000).toISOString(), to: new Date(Date.parse(startsAt) + 1000).toISOString(), user, perPage: 100 });
          expect(page.data.some(row => row.id === drop.id)).toBe(true);
          expect(page.pagination.totalCount).toBeGreaterThanOrEqual(1); noEmail(page);
        }
        const updated = await account.drops.update(drop.id, { metadata: { headline: 'Updated by SDK' } });
        expect(updated.metadata.description).toBe(drop.metadata.description);
        expect(updated.metadata.imageUrl).toBe(upload.url);
        expect(updated.metadata.slug).toBe(drop.metadata.slug);
        expect(updated.startsAt).toBe(drop.startsAt);
        const persisted = await publicApi.drops.get(drop.id);
        expect(persisted).toMatchObject({ id: drop.id, userId: profile.accountId, type: drop.type, startsAt, metadata: { ...drop.metadata, headline: 'Updated by SDK' } });
        expect(Date.parse(persisted.updatedAt)).toBeGreaterThanOrEqual(Date.parse(drop.updatedAt));
        const calendar = await publicApi.drops.list({ from: new Date(Date.parse(startsAt) - 1000).toISOString(), to: new Date(Date.parse(startsAt) + 1000).toISOString(), user: { userId: Number(profile.accountId) }, perPage: 100 });
        expect(calendar.data.find(row => row.id === drop.id)).toEqual(persisted);
        noEmail(persisted);
      } finally { await account.drops.delete(drop.id); }
      await expect(publicApi.drops.get(drop.id)).rejects.toMatchObject({ status: 404 });
    } finally { await account.auth.logout(); }
  }, 180_000);
  it('rejects another account’s edits/deletes, forged actors, flags and foreign image URLs', async () => {
    const apiBaseUrl = apiOrigin();
    const ownerWallet = signer('RARE_ACCOUNT_TEST_PRIVATE_KEY'); const otherWallet = signer('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(ownerWallet.address.toLowerCase()).not.toBe(otherWallet.address.toLowerCase());
    const owner = createRareClient({ apiBaseUrl }); const other = createRareClient({ apiBaseUrl });
    try {
      for (const [account, wallet] of [[owner, ownerWallet], [other, otherWallet]] as const) await account.auth.loginWithWallet({ address: wallet.address, chainId: 11155111, signMessage: message => wallet.signMessage({ message }) });
      const upload = await owner.upload(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), 'drop.gif', { contentType: 'image/gif' });
      const input = { type: 'NONE' as const, startsAt: new Date(Date.now() + 86400000).toISOString(), metadata: { headline: `Adversarial SDK drop ${Date.now()}`, description: 'Owned by the first test account', destinationUrl: '', imageUrl: upload.url } };
      const drop = await owner.drops.create(input);
      try {
        await expect(other.drops.update(drop.id, { metadata: { headline: 'Hijacked' } })).rejects.toMatchObject({ status: 404 });
        await expect(other.drops.delete(drop.id)).rejects.toMatchObject({ status: 404 });
        const session = await owner.auth.getSession(); if (!session) throw new Error('Login did not install a session');
        for (const extra of [{ userId: '2' }, { creatorAddress: otherWallet.address }, { isCurated: true }, { isFeatured: true }, { chainId: 11155111 }]) {
          const response = await fetch(`${apiBaseUrl}/v1/drops`, { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, ...extra }) });
          expect(response.status).toBe(400);
        }
        await expect(owner.drops.create({ ...input, metadata: { ...input.metadata, imageUrl: 'https://example.com/untrusted.png' } })).rejects.toMatchObject({ status: 400 });
        const publicApi = createRareClient({ apiBaseUrl: apiBaseUrl }); expect((await publicApi.drops.get(drop.id)).metadata.headline).toBe(input.metadata.headline);
        for (const method of ['PATCH', 'DELETE']) {
          const response = await fetch(`${apiBaseUrl}/v1/drops/${drop.id}`, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'PATCH' ? { body: JSON.stringify({ metadata: { headline: 'Unauthenticated' } }) } : {}) });
          expect(response.status).toBe(401);
        }
      } finally { await owner.drops.delete(drop.id); }
    } finally { await Promise.all([owner.auth.logout(), other.auth.logout()]); }
  }, 180_000);
  it('requires mainnet artist approval for creation and updates, but permits owned deletion', async () => {
    // This dedicated test account must not be an approved mainnet artist.
    const apiBaseUrl = apiOrigin();
    const wallet = signer('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const account = createRareClient({ apiBaseUrl });
    try {
      await account.auth.loginWithWallet({ address: wallet.address, chainId: 11155111, signMessage: message => wallet.signMessage({ message }) });
      const upload = await account.upload(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), 'drop.gif', { contentType: 'image/gif' });
      const input = { type: 'NONE' as const, startsAt: new Date(Date.now() + 86400000).toISOString(), metadata: { headline: `Artist policy ${Date.now()}`, description: 'Dedicated unapproved test artist', destinationUrl: '', imageUrl: upload.url } };
      const drop = await account.drops.create(input);
      try {
        await account.auth.logout();
        await account.auth.loginWithWallet({ address: wallet.address, chainId: 1, signMessage: message => wallet.signMessage({ message }) });
        await expect(account.drops.create(input)).rejects.toMatchObject({ status: 403 });
        await expect(account.drops.update(drop.id, { metadata: { headline: 'Mainnet edit' } })).rejects.toMatchObject({ status: 403 });
      } finally { await account.drops.delete(drop.id); }
    } finally { await account.auth.logout(); }
  }, 180_000);

});
