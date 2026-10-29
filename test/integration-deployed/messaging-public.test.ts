import { retryPublicSend } from './messaging-live.js';
import { appendSystemFixture } from './messaging-system-fixture.js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createRareClient } from '../../src/sdk/client.js';
import { parseMessagingPublicContext } from '../../src/sdk/messaging-core.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';
const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const origin = () => { const url = new URL(required('RARE_ACCOUNT_TEST_API_URL')); if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use a non-production HTTPS API origin'); return url.origin; };

describe('public durable messaging against deployed services', () => {
  it('deduplicates semantically identical producer payloads despite nested object key order', async () => {
    const apiBaseUrl = origin();
    const key = required('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    if (!isPrivateKeyString(key)) throw new Error('Invalid dedicated test wallet');
    const wallet = privateKeyToAccount(key);
    const account = createRareClient({ apiBaseUrl });
    const api = createRareClient({ apiBaseUrl: apiBaseUrl });
    try {
      await account.auth.loginWithWallet({ address: wallet.address, chainId: 11155111, signMessage: message => wallet.signMessage({ message }) });
      const upload = await account.upload(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), 'system-message-fixture.gif', { contentType: 'image/gif' });
      const imageUrl = upload.url;
      const drop = await account.drops.create({ type: 'NONE', startsAt: new Date(Date.now() + 86400000).toISOString(), metadata: { headline: `Producer retry fixture ${randomUUID()}`, description: 'Dedicated SDK integration fixture', destinationUrl: '', imageUrl } });
      try {
        const room = await api.messaging.public.resolveRoom({ type: 'drop-announcement', id: drop.id });
        const input = { sourceId: `integration:${randomUUID()}`, type: 'integration.notice', summary: 'Producer retry fixture', payload: { z: 1, nested: { b: 2, a: 1 }, values: [1, 2] }, occurredAt: new Date().toISOString() };
        const message = await appendSystemFixture(room.context, input);
        const retry = await appendSystemFixture(room.context, { ...input, payload: { values: [1, 2], nested: { a: 1, b: 2 }, z: 1 } });
        expect(retry.id).toBe(message.id);
        await expect(appendSystemFixture(room.context, { ...input, payload: { ...input.payload, values: [2, 1] } })).rejects.toThrow('reused');
        expect((await api.messaging.public.history(room.id)).messages.filter(row => row.id === message.id)).toHaveLength(1);
      } finally { await account.drops.delete(drop.id); }
    } finally { await account.auth.logout(); }
  }, 240_000);

  it.each(['auction', 'liquid-edition', 'drop-announcement'])('round-trips %s public history while protecting system messages', async type => {
    const apiBaseUrl = origin();
    const contexts: unknown = JSON.parse(required('RARE_MESSAGING_TEST_PUBLIC_CONTEXTS'));
    if (!Array.isArray(contexts)) throw new Error('RARE_MESSAGING_TEST_PUBLIC_CONTEXTS must be an array with all three room contexts');
    const context = contexts.map(parseMessagingPublicContext).find(context => context.type === type);
    if (context === undefined) throw new Error(`Missing ${type} fixture context`);
    const key = required('RARE_ACCOUNT_TEST_PRIVATE_KEY'); if (!isPrivateKeyString(key)) throw new Error('Invalid RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const signer = privateKeyToAccount(key);
    const account = createRareClient({ apiBaseUrl });
    const api = createRareClient({ apiBaseUrl: apiBaseUrl });
    const room = await api.messaging.public.resolveRoom(context);
    expect((await api.messaging.public.resolveRoom(context)).id).toBe(room.id);
    if (context.type === 'liquid-edition') expect((await api.messaging.public.resolveRoom({ ...context, contractAddress: `0x${context.contractAddress.slice(2).toUpperCase()}` })).id).toBe(room.id);
    const initial = await api.messaging.public.history(room.id, { limit: 1 });
    expect(initial.room.id).toBe(room.id);
    try {
      const session = await account.auth.loginWithWallet({ address: signer.address, chainId: 1, signMessage: message => signer.signMessage({ message }) });
      const input = { clientMessageId: randomUUID(), body: `SDK public integration ${randomUUID()}`, mentionUserIds: [] };
      const sent = await retryPublicSend(() => account.messaging.public.send(room.id, input));
      try {
        expect(sent.type).toBe('user');
        const nextInput = { clientMessageId: randomUUID(), body: `SDK cooldown retry ${randomUUID()}`, mentionUserIds: [] };
        const next = await account.messaging.public.send(room.id, nextInput).catch(async (error: unknown) => {
          expect(error).toMatchObject({ status: 429, code: 'rate_limited' });
          return retryPublicSend(() => account.messaging.public.send(room.id, nextInput));
        });
        try {
          // A slow request may naturally arrive after the cooldown expires.
          expect(Date.parse(next.createdAt) - Date.parse(sent.createdAt)).toBeGreaterThanOrEqual(1000);
          expect((await retryPublicSend(() => account.messaging.public.send(room.id, nextInput))).id).toBe(next.id);
          const thread = await api.messaging.public.history(room.id);
          for (const id of [sent.id, next.id]) expect(thread.messages.filter(row => row.id === id)).toHaveLength(1);
        } finally { await account.messaging.messageCommand(room.id, next.id, { action: 'delete' }); }

        expect((await retryPublicSend(() => account.messaging.public.send(room.id, input))).id).toBe(sent.id);
        const forward = async (after: string): Promise<boolean> => {
          const page = await api.messaging.public.history(room.id, { after, limit: 1 });
          if (page.messages.some(row => row.id === sent.id && row.body === input.body)) return true;
          if (page.nextCursor === null) return false;
          expect(BigInt(page.nextCursor)).toBeGreaterThan(BigInt(after));
          return forward(page.nextCursor);
        };
        expect(await forward(initial.room.latestSequence)).toBe(true);
        const edited = await account.messaging.messageCommand(room.id, sent.id, { action: 'edit', body: 'Updated public SDK message' });
        expect(edited.body).toBe('Updated public SDK message');
        expect((await api.messaging.public.history(room.id)).messages.find(message => message.id === sent.id)?.body).toBe('Updated public SDK message');
        await account.messaging.messageCommand(room.id, sent.id, { action: 'reaction', emoji: '❤️', active: true });
        expect((await api.messaging.public.history(room.id)).messages.find(message => message.id === sent.id)?.reactions).toContainEqual({ emoji: '❤️', count: 1, reacted: false });
        expect((await account.messaging.public.history(room.id, { authenticated: true })).messages.find(message => message.id === sent.id)?.reactions).toContainEqual({ emoji: '❤️', count: 1, reacted: true });
        await account.messaging.messageCommand(room.id, sent.id, { action: 'reaction', emoji: '❤️', active: false });
        expect((await api.messaging.public.history(room.id)).messages.find(message => message.id === sent.id)?.reactions.some(reaction => reaction.emoji === '❤️')).toBe(false);
        const inbox = await account.messaging.inbox();
        expect(inbox.conversations.some(row => row.id === room.id)).toBe(true);
        const request = (token: string | undefined, body: unknown) => fetch(`${apiBaseUrl}/v1/messaging/public/rooms/${room.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-messaging-request': '1', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
        expect((await request(undefined, input)).status).toBe(401);
        expect((await request(session.accessToken, { ...input, clientMessageId: randomUUID(), type: 'system', system: { sourceId: randomUUID(), type: 'auction.bid', summary: 'Forged', payload: {}, occurredAt: new Date().toISOString() } })).status).toBe(400);
        const otherKey = required('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
        if (!isPrivateKeyString(otherKey)) throw new Error('Invalid second dedicated test wallet');
        const otherSigner = privateKeyToAccount(otherKey);
        const other = createRareClient({ apiBaseUrl });
        try {
          await other.auth.loginWithWallet({ address: otherSigner.address, chainId: 1, signMessage: message => otherSigner.signMessage({ message }) });
          const joined = await other.messaging.public.send(room.id, { clientMessageId: randomUUID(), body: 'SDK report-and-hide fixture', mentionUserIds: [] });
          try {
            await other.messaging.messageCommand(room.id, sent.id, { action: 'report', reason: 'Dedicated SDK integration fixture', hide: true });
            expect((await other.messaging.public.history(room.id, { authenticated: true })).messages.find(message => message.id === sent.id)).toMatchObject({ reported: true, collapsed: true });
            expect((await account.messaging.public.history(room.id, { authenticated: true })).messages.find(message => message.id === sent.id)).toMatchObject({ reported: false, collapsed: false });
            expect((await api.messaging.public.history(room.id)).messages.find(message => message.id === sent.id)).toMatchObject({ reported: false, collapsed: false });
          } finally {
            await other.messaging.messageCommand(room.id, joined.id, { action: 'delete' });
            await other.messaging.command(room.id, { action: 'leave' });
          }
        } finally { await other.auth.logout(); }
        await account.messaging.command(room.id, { action: 'preferences', notification: 'muted' });
        expect((await account.messaging.inbox()).conversations.find(row => row.id === room.id)?.notification).toBe('muted');
      } finally {
        await account.messaging.messageCommand(room.id, sent.id, { action: 'delete' });
        expect((await api.messaging.public.history(room.id)).messages.some(row => row.id === sent.id)).toBe(false);
      }
      await account.messaging.command(room.id, { action: 'leave' });
      expect((await account.messaging.inbox()).conversations.some(row => row.id === room.id)).toBe(false);
    } finally { await account.auth.logout(); }
  }, 240_000);
});
