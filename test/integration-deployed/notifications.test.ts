import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../src/sdk/client.js';
import type { RareNotification, RareAccountClient } from '../../src/sdk/index.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const signer = (name: string) => { const key = required(name); if (!isPrivateKeyString(key)) throw new Error(`Invalid ${name}`); return privateKeyToAccount(key); };
const listAll = async (client: RareAccountClient, cursor?: string, pages = 0): Promise<RareNotification[]> => {
  if (pages >= 100) throw new Error('Notification traversal exceeded 100 pages');
  const page = await client.notifications.list({ limit: 50, cursor });
  return page.nextCursor === null ? page.data : [...page.data, ...await listAll(client, page.nextCursor, pages + 1)];
};
const waitForDelivery = async (client: RareAccountClient, roomId: string, excluded: readonly string[], deadline = Date.now() + 90_000): Promise<RareNotification> => {
  const page = await client.notifications.list({ limit: 50 });
  const notification = page.data.find(row => row.category === 'messagingActivity' && row.payload.conversationId === roomId && !excluded.includes(row.id));
  if (notification !== undefined) return notification;
  if (Date.now() >= deadline) throw new Error('The deployed messaging worker did not deliver an app notification within 90 seconds');
  await delay(2000);
  return waitForDelivery(client, roomId, excluded, deadline);
};

describe('notification inbox and real deployed message delivery', () => {
  it('delivers to the recipient, pages real entries, and marks only owned notifications read', async () => {
    const url = new URL(required('RARE_ACCOUNT_TEST_API_URL'));
    if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use a non-production HTTPS API origin');
    const ownerSigner = signer('RARE_ACCOUNT_TEST_PRIVATE_KEY'); const recipientSigner = signer('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(ownerSigner.address.toLowerCase()).not.toBe(recipientSigner.address.toLowerCase());
    const owner = createRareClient({ apiBaseUrl: url.origin }); const recipient = createRareClient({ apiBaseUrl: url.origin });
    expect((await fetch(`${url.origin}/v1/me/notifications`)).status, 'Deploy the notification inbox routes before running this suite').toBe(401);
    try {
      const ownerSession = await owner.auth.loginWithWallet({ address: ownerSigner.address, chainId: 1, signMessage: message => ownerSigner.signMessage({ message }) });
      const recipientSession = await recipient.auth.loginWithWallet({ address: recipientSigner.address, chainId: 1, signMessage: message => recipientSigner.signMessage({ message }) });
      const actor = await recipient.messaging.session();
      const sender = await owner.messaging.session();
      const room = await owner.messaging.createRoom({ type: 'group', title: `SDK notification ${randomUUID()}`, description: '', guidelines: '', inviteeUserIds: [actor.user.id], clientOperationId: randomUUID() });
      try {
        await recipient.messaging.command(room.id, { action: 'accept' });
        const invitationIds = (await recipient.notifications.list({ limit: 50 })).data.filter(row => row.payload.conversationId === room.id).map(row => row.id);
        const input = { clientMessageId: randomUUID(), body: 'Notification delivery test', mentionUserIds: [], attachmentIds: [] };
        const sent = await owner.messaging.send(room.id, input);
        expect((await owner.messaging.send(room.id, input)).id).toBe(sent.id);
        const source = (await recipient.messaging.history(room.id)).messages.find(row => row.id === sent.id);
        expect(source).toMatchObject({ conversationId: room.id, clientMessageId: input.clientMessageId, body: input.body, author: { id: sender.user.id } });
        const first = await waitForDelivery(recipient, room.id, invitationIds);
        expect(first.readAt).toBeNull();
        expect(first.notificationId).toMatch(/^messaging:/);
        const secondInput = { ...input, clientMessageId: randomUUID(), body: 'Second notification for pagination' };
        const secondMessage = await owner.messaging.send(room.id, secondInput);
        expect((await recipient.messaging.history(room.id)).messages.find(row => row.id === secondMessage.id)).toMatchObject({ body: secondInput.body, author: { id: sender.user.id } });
        const second = await waitForDelivery(recipient, room.id, [...invitationIds, first.id]);
        const firstPage = await recipient.notifications.list({ limit: 1 });
        expect(firstPage.data).toHaveLength(1);
        expect(firstPage.nextCursor).not.toBeNull();
        const secondPage = await recipient.notifications.list({ limit: 1, cursor: firstPage.nextCursor ?? '' });
        expect(secondPage.data).toHaveLength(1);
        expect(secondPage.data[0]?.id).not.toBe(firstPage.data[0]?.id);
        const entries = await listAll(recipient);
        expect(new Set(entries.map(row => row.id)).size).toBe(entries.length);
        expect(entries.filter(row => row.payload.conversationId === room.id && !invitationIds.includes(row.id)).map(row => row.id).sort()).toEqual([first.id, second.id].sort());
        expect((await owner.notifications.list({ limit: 50 })).data.some(row => row.id === first.id || row.id === second.id)).toBe(false);
        await expect(owner.notifications.markRead(first.id)).rejects.toMatchObject({ status: 404 });
        const count = await recipient.notifications.unreadCount(); expect(count).toBeGreaterThanOrEqual(2);
        const read = await recipient.notifications.markRead(first.id); expect(read.readAt).not.toBeNull();
        expect((await recipient.notifications.markRead(first.id)).readAt).toBe(read.readAt);
        expect(await recipient.notifications.unreadCount()).toBe(count - 1);
        const after = await listAll(recipient); expect(after.find(row => row.id === first.id)?.readAt).toBe(read.readAt); expect(after.find(row => row.id === second.id)?.readAt).toBeNull();
        const response = await fetch(`${url.origin}/v1/me/notifications?limit=1`, { headers: { Authorization: `Bearer ${recipientSession.accessToken}` } });
        expect(response.headers.get('cache-control')).toContain('no-store');
        for (const query of ['userId=1', 'accountId=1', 'limit=51', 'cursor=bad']) expect((await fetch(`${url.origin}/v1/me/notifications?${query}`, { headers: { Authorization: `Bearer ${ownerSession.accessToken}` } })).status).toBe(400);
        await recipient.notifications.markRead(second.id);
        expect((await listAll(recipient)).find(row => row.id === second.id)?.readAt).not.toBeNull();

        await recipient.messaging.command(room.id, { action: 'preferences', notification: 'muted' });
        expect((await recipient.messaging.history(room.id)).conversation.notification).toBe('muted');
        const beforeMuted = (await listAll(recipient)).filter(row => row.payload.conversationId === room.id).map(row => row.id).sort();
        const mutedInput = { ...input, clientMessageId: randomUUID(), body: `Muted message ${randomUUID()}` };
        const mutedMessage = await owner.messaging.send(room.id, mutedInput);
        expect((await recipient.messaging.history(room.id)).messages.find(row => row.id === mutedMessage.id)).toMatchObject({ body: mutedInput.body, author: { id: sender.user.id } });
        const control = await owner.messaging.createRoom({ type: 'group', title: `SDK notification control ${randomUUID()}`, description: '', guidelines: '', inviteeUserIds: [actor.user.id], clientOperationId: randomUUID() });
        try {
          await recipient.messaging.command(control.id, { action: 'accept' });
          const controlBefore = (await listAll(recipient)).filter(row => row.payload.conversationId === control.id).map(row => row.id);
          await owner.messaging.send(control.id, { ...input, clientMessageId: randomUUID(), body: 'Unmuted worker control' });
          await waitForDelivery(recipient, control.id, controlBefore);
          // Positive delivery above proves the worker is active. Keep the target muted
          // while independently polling for unwanted delivery for another 30 seconds.
          for (const waitMilliseconds of Array.from({ length: 15 }, () => 2000)) {
            await delay(waitMilliseconds);
            expect((await listAll(recipient)).filter(row => row.payload.conversationId === room.id).map(row => row.id).sort()).toEqual(beforeMuted);
          }
        } finally { await owner.messaging.command(control.id, { action: 'close' }); }
        await recipient.messaging.command(room.id, { action: 'read', sequence: mutedMessage.sequence });
        await recipient.messaging.command(room.id, { action: 'preferences', notification: 'all' });
        expect((await recipient.messaging.history(room.id)).conversation.notification).toBe('all');
        const resumedInput = { ...input, clientMessageId: randomUUID(), body: `Resumed message ${randomUUID()}` };
        const resumed = await owner.messaging.send(room.id, resumedInput);
        expect((await recipient.messaging.history(room.id)).messages.find(row => row.id === resumed.id)).toMatchObject({ body: resumedInput.body, author: { id: sender.user.id } });
        const resumedNotification = await waitForDelivery(recipient, room.id, beforeMuted);
        expect((await listAll(recipient)).filter(row => row.payload.conversationId === room.id).map(row => row.id).sort()).toEqual([...beforeMuted, resumedNotification.id].sort());
        await recipient.notifications.markRead(resumedNotification.id);
      } finally { await owner.messaging.command(room.id, { action: 'close' }); }
    } finally { await Promise.all([owner.auth.logout(), recipient.auth.logout()]); }
  }, 420_000);
});
