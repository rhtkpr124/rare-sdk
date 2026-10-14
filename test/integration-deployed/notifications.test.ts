import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareAccountClient } from '../../src/sdk/account-client.js';
import type { RareNotification, RareAccountClient } from '../../src/sdk/index.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const signer = (name: string) => { const key = required(name); if (!isPrivateKeyString(key)) throw new Error(`Invalid ${name}`); return privateKeyToAccount(key); };
const listAll = async (client: RareAccountClient, cursor?: string, pages = 0): Promise<RareNotification[]> => {
  if (pages >= 100) throw new Error('Notification traversal exceeded 100 pages');
  const page = await client.notifications.list({ limit: 1, cursor });
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
    const owner = createRareAccountClient({ apiBaseUrl: url.origin }); const recipient = createRareAccountClient({ apiBaseUrl: url.origin });
    expect((await fetch(`${url.origin}/v1/me/notifications`)).status, 'Deploy the notification inbox routes before running this suite').toBe(401);
    try {
      const ownerSession = await owner.auth.loginWithWallet({ address: ownerSigner.address, chainId: 1, signMessage: message => ownerSigner.signMessage({ message }) });
      const recipientSession = await recipient.auth.loginWithWallet({ address: recipientSigner.address, chainId: 1, signMessage: message => recipientSigner.signMessage({ message }) });
      const actor = await recipient.messaging.session();
      const room = await owner.messaging.createRoom({ type: 'group', title: `SDK notification ${randomUUID()}`, description: '', guidelines: '', inviteeUserIds: [actor.user.id], clientOperationId: randomUUID() });
      try {
        await recipient.messaging.command(room.id, { action: 'accept' });
        const invitationIds = (await recipient.notifications.list({ limit: 50 })).data.filter(row => row.payload.conversationId === room.id).map(row => row.id);
        const input = { clientMessageId: randomUUID(), body: 'Notification delivery test', mentionUserIds: [], attachmentIds: [] };
        const sent = await owner.messaging.send(room.id, input);
        expect((await owner.messaging.send(room.id, input)).id).toBe(sent.id);
        const first = await waitForDelivery(recipient, room.id, invitationIds);
        expect(first.readAt).toBeNull();
        await owner.messaging.send(room.id, { ...input, clientMessageId: randomUUID(), body: 'Second notification for pagination' });
        const second = await waitForDelivery(recipient, room.id, [...invitationIds, first.id]);
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
      } finally { await owner.messaging.command(room.id, { action: 'close' }); }
    } finally { await Promise.all([owner.auth.logout(), recipient.auth.logout()]); }
  }, 240_000);
});
