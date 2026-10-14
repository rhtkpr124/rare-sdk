import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createRareAccountClient } from '../../src/sdk/account-client.js';
import { createRareApi } from '../../src/sdk/api.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';
const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const signer = (name: string) => { const value = required(name); if (!isPrivateKeyString(value)) throw new Error(`Invalid ${name}`); return privateKeyToAccount(value); };
const origin = () => { const url = new URL(required('RARE_ACCOUNT_TEST_API_URL')); if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use a non-production HTTPS API origin'); return url.origin; };

describe('durable messaging against deployed services', () => {
  it('uses account bearer sessions, protects private rooms, and round-trips messages, replies, reactions, changes and membership', async () => {
    const apiBaseUrl = origin();
    const owner = createRareAccountClient({ apiBaseUrl });
    const other = createRareAccountClient({ apiBaseUrl });
    const ownerSigner = signer('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const otherSigner = signer('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(ownerSigner.address.toLowerCase()).not.toBe(otherSigner.address.toLowerCase());
    try {
      const ownerSession = await owner.auth.loginWithWallet({ address: ownerSigner.address, chainId: 1, signMessage: message => ownerSigner.signMessage({ message }) });
      const otherSession = await other.auth.loginWithWallet({ address: otherSigner.address, chainId: 1, signMessage: message => otherSigner.signMessage({ message }) });
      const actor = await owner.messaging.session(); const recipient = await other.messaging.session();
      const operationId = randomUUID();
      const roomInput = { type: 'group', title: `SDK messaging ${operationId}`, clientOperationId: operationId, description: '', guidelines: '', inviteeUserIds: [] } as const;
      const room = await owner.messaging.createRoom({ ...roomInput, inviteeUserIds: [] });
      const cleanupMessages: { account: typeof owner; id: string }[] = [];
      try {
        expect((await owner.messaging.createRoom({ ...roomInput, inviteeUserIds: [] })).id).toBe(room.id);
        expect((await owner.messaging.inbox({ search: room.title })).conversations.some(row => row.id === room.id)).toBe(true);
        await expect(other.messaging.history(room.id)).rejects.toMatchObject({ status: 404 });
        const publicApi = createRareApi({ baseUrl: apiBaseUrl });
        await expect(publicApi.messaging.history(room.id)).rejects.toMatchObject({ status: 404 });
        const anonymous = await fetch(`${apiBaseUrl}/v1/messaging/conversations/${room.id}`); expect(anonymous.status).toBe(401);
        const forged = await fetch(`${apiBaseUrl}/v1/messaging/conversations/${room.id}/commands`, { method: 'POST', headers: { Authorization: `Bearer ${ownerSession.accessToken}`, 'Content-Type': 'application/json', 'x-messaging-request': '1', 'x-messaging-actor': recipient.user.id }, body: JSON.stringify({ action: 'leave' }) }); expect(forged.status).toBe(409);
        const input = { clientMessageId: randomUUID(), body: 'Live SDK durable message', attachmentIds: [], mentionUserIds: [] };
        const sent = await owner.messaging.send(room.id, input);
        // eslint-disable-next-line functional/immutable-data
        cleanupMessages.push({ account: owner, id: sent.id });
        expect((await owner.messaging.send(room.id, input)).id).toBe(sent.id);
        expect(sent.author.id).toBe(actor.user.id);
        await owner.messaging.command(room.id, { action: 'invite', userId: recipient.user.id });
        await other.messaging.command(room.id, { action: 'accept' });
        const reply = await other.messaging.send(room.id, { clientMessageId: randomUUID(), body: 'Reply', replyToId: sent.id, mentionUserIds: [actor.user.id], attachmentIds: [] });
        // eslint-disable-next-line functional/immutable-data
        cleanupMessages.push({ account: other, id: reply.id });
        expect(reply.replyToId).toBe(sent.id);
        await expect(other.messaging.messageCommand(room.id, sent.id, { action: 'edit', body: 'Forged', version: sent.version })).rejects.toMatchObject({ status: 403 });
        const edited = await owner.messaging.messageCommand(room.id, sent.id, { action: 'edit', body: 'Edited live SDK message' });
        expect(edited.body).toBe('Edited live SDK message');
        await expect(owner.messaging.messageCommand(room.id, sent.id, { action: 'edit', body: 'Stale edit', version: sent.version })).rejects.toMatchObject({ status: 409 });
        const reacted = await other.messaging.messageCommand(room.id, sent.id, { action: 'reaction', emoji: '❤️', active: true }); expect(reacted.reactions.some(row => row.emoji === '❤️' && row.reacted)).toBe(true);
        await other.messaging.messageCommand(room.id, sent.id, { action: 'reaction', emoji: '❤️', active: false });
        await owner.messaging.messageCommand(room.id, sent.id, { action: 'pin', pinned: true });
        expect((await other.messaging.history(room.id, { pinned: true })).messages.some(row => row.id === sent.id)).toBe(true);
        expect((await owner.messaging.participants(room.id)).participants.some(row => row.user.id === recipient.user.id && row.state === 'joined')).toBe(true);
        expect((await other.messaging.changes(room.id, '0')).messages.some(row => row.id === reply.id)).toBe(true);
        await other.messaging.command(room.id, { action: 'preferences', notification: 'muted' });
        await other.messaging.command(room.id, { action: 'read', sequence: reply.sequence });
        const history = await other.messaging.history(room.id); expect(history.conversation.notification).toBe('muted'); expect(history.messages.some(row => row.id === sent.id)).toBe(true);
        const mismatchedActor = await fetch(`${apiBaseUrl}/v1/messaging/conversations/${room.id}/messages`, { method: 'POST', headers: { Authorization: `Bearer ${otherSession.accessToken}`, 'Content-Type': 'application/json', 'x-messaging-request': '1', 'x-messaging-actor': actor.user.id }, body: JSON.stringify({ ...input, clientMessageId: randomUUID() }) }); expect(mismatchedActor.status).toBe(409);
      } finally {
        const results = await Promise.allSettled(cleanupMessages.map(row => row.account.messaging.messageCommand(room.id, row.id, { action: 'delete' })));
        await owner.messaging.command(room.id, { action: 'close' });
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      }
    } finally { await Promise.all([owner.auth.logout(), other.auth.logout()]); }
  }, 240_000);
});
