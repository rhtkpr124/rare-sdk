import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createRareAccountClient } from '../../src/sdk/account-client.js';
import { createRareApi } from '../../src/sdk/api.js';
import { parseMessagingPublicContext } from '../../src/sdk/messaging-core.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';
const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const origin = () => { const url = new URL(required('RARE_ACCOUNT_TEST_API_URL')); if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use a non-production HTTPS API origin'); return url.origin; };

describe('public durable messaging against deployed services', () => {
  it.each(['auction', 'liquid-edition', 'drop-announcement'])('round-trips %s public history while protecting system messages', async type => {
    const apiBaseUrl = origin();
    const contexts: unknown = JSON.parse(required('RARE_MESSAGING_TEST_PUBLIC_CONTEXTS'));
    if (!Array.isArray(contexts)) throw new Error('RARE_MESSAGING_TEST_PUBLIC_CONTEXTS must be an array with all three room contexts');
    const context = contexts.map(parseMessagingPublicContext).find(context => context.type === type);
    if (context === undefined) throw new Error(`Missing ${type} fixture context`);
    const key = required('RARE_ACCOUNT_TEST_PRIVATE_KEY'); if (!isPrivateKeyString(key)) throw new Error('Invalid RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const signer = privateKeyToAccount(key);
    const account = createRareAccountClient({ apiBaseUrl });
    const api = createRareApi({ baseUrl: apiBaseUrl });
    const room = await api.messaging.resolveRoom(context);
    expect((await api.messaging.resolveRoom(context)).id).toBe(room.id);
    const initial = await api.messaging.history(room.id, { limit: 1 });
    expect(initial.room.id).toBe(room.id);
    try {
      const session = await account.auth.loginWithWallet({ address: signer.address, chainId: 1, signMessage: message => signer.signMessage({ message }) });
      const input = { clientMessageId: randomUUID(), body: `SDK public integration ${randomUUID()}`, mentionUserIds: [] };
      const sent = await account.messaging.sendPublic(room.id, input);
      try {
        expect(sent.type).toBe('user');
        expect((await account.messaging.sendPublic(room.id, input)).id).toBe(sent.id);
        const forward = async (after: string): Promise<boolean> => {
          const page = await api.messaging.history(room.id, { after, limit: 1 });
          if (page.messages.some(row => row.id === sent.id && row.body === input.body)) return true;
          if (page.nextCursor === null) return false;
          expect(BigInt(page.nextCursor)).toBeGreaterThan(BigInt(after));
          return forward(page.nextCursor);
        };
        expect(await forward(initial.room.latestSequence)).toBe(true);
        const edited = await account.messaging.messageCommand(room.id, sent.id, { action: 'edit', body: 'Updated public SDK message' });
        expect(edited.body).toBe('Updated public SDK message');
        expect((await api.messaging.history(room.id)).messages.find(message => message.id === sent.id)?.body).toBe('Updated public SDK message');
        const inbox = await account.messaging.inbox();
        expect(inbox.conversations.some(row => row.id === room.id)).toBe(true);
        const request = (token: string | undefined, body: unknown) => fetch(`${apiBaseUrl}/v1/messaging/public/rooms/${room.id}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-messaging-request': '1', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
        expect((await request(undefined, input)).status).toBe(401);
        expect((await request(session.accessToken, { ...input, clientMessageId: randomUUID(), type: 'system', system: { sourceId: randomUUID(), type: 'auction.bid', summary: 'Forged', payload: {}, occurredAt: new Date().toISOString() } })).status).toBe(400);
        await account.messaging.command(room.id, { action: 'preferences', notification: 'muted' });
        expect((await account.messaging.inbox()).conversations.find(row => row.id === room.id)?.notification).toBe('muted');
      } finally {
        await account.messaging.messageCommand(room.id, sent.id, { action: 'delete' });
        expect((await api.messaging.history(room.id)).messages.some(row => row.id === sent.id)).toBe(false);
      }
      await account.messaging.command(room.id, { action: 'leave' });
      expect((await account.messaging.inbox()).conversations.some(row => row.id === room.id)).toBe(false);
    } finally { await account.auth.logout(); }
  }, 240_000);
});
