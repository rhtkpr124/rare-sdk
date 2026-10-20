import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareAccountClient } from '../../src/sdk/account-client.js';
import { createRareApi } from '../../src/sdk/api.js';
import { parseMessagingPublicContext, parseMessagingPublicMessage } from '../../src/sdk/messaging-core.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';
import type { RareNotification } from '../../src/sdk/types/notifications.js';
import { messagingOrigin, required, withMessagingActors, type MessagingActor } from './messaging-live.js';

const notifications = async (actor: MessagingActor, room: string, cursor?: string, pages = 0): Promise<RareNotification[]> => {
  if (pages >= 100) throw new Error('Notification traversal exceeded 100 pages');
  const page = await actor.account.notifications.list({ cursor, limit: 50 });
  const matches = page.data.filter(row => row.category === 'messagingActivity' && row.payload.conversationId === room);
  return page.nextCursor === null ? matches : [...matches, ...await notifications(actor, room, page.nextCursor, pages + 1)];
};
const delivered = async (actor: MessagingActor, room: string, excluded: readonly string[], deadline = Date.now() + 90_000): Promise<RareNotification> => {
  const match = (await notifications(actor, room)).find(row => !excluded.includes(row.id));
  if (match) return match;
  if (Date.now() >= deadline) throw new Error('Public chat notification did not reach the inbox within 90 seconds');
  await delay(2000);
  return delivered(actor, room, excluded, deadline);
};
const stableNotifications = async (actor: MessagingActor, room: string, ids: readonly string[]): Promise<void> => {
  for (const milliseconds of Array.from({ length: 15 }, () => 2000)) {
    await delay(milliseconds);
    expect((await notifications(actor, room)).map(row => row.id).sort()).toEqual([...ids].sort());
  }
};

describe('public room notification delivery and trusted system messages', () => {
  it.each(['auction', 'liquid-edition', 'drop-announcement'])('delivers %s subscriptions and verifies the persisted public thread', async type => {
    const apiBaseUrl = messagingOrigin();
    const api = createRareApi({ baseUrl: apiBaseUrl });
    const rawContexts: unknown = JSON.parse(required('RARE_MESSAGING_TEST_PUBLIC_CONTEXTS'));
    if (!Array.isArray(rawContexts)) throw new Error('Provide all three deployed room contexts');
    const fixture = rawContexts.map(parseMessagingPublicContext).find(context => context.type === type);
    if (!fixture) throw new Error(`Missing ${type} fixture`);
    const creatorKey = required('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    if (!isPrivateKeyString(creatorKey)) throw new Error('Invalid dedicated creator key');
    const creatorWallet = privateKeyToAccount(creatorKey);
    const creator = createRareAccountClient({ apiBaseUrl });
    try {
      // Give system-message fixtures their own announcement instead of leaving
      // durable synthetic events on an existing auction or edition's history.
      const drop = type === 'drop-announcement' ? await (async () => {
        await creator.auth.loginWithWallet({ address: creatorWallet.address, chainId: 11155111, signMessage: message => creatorWallet.signMessage({ message }) });
        const image = await creator.uploads.upload(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), 'public-delivery.gif', { contentType: 'image/gif' });
        return creator.drops.create({ type: 'NONE', startsAt: new Date(Date.now() + 86400000).toISOString(), metadata: { headline: `SDK public delivery ${randomUUID()}`, description: 'Temporary live notification fixture', destinationUrl: '', imageUrl: image.url } });
      })() : null;
      try {
        const room = await api.messaging.resolveRoom(drop === null ? fixture : { type: 'drop-announcement', id: drop.id });
        await withMessagingActors(async (owner, recipient) => {
          const sent: { actor: MessagingActor; id: string }[] = [];
          const send = async (actor: MessagingActor, body: string, mentionUserIds: string[] = []) => {
            const input = { clientMessageId: randomUUID(), body, mentionUserIds };
            const message = await actor.account.messaging.sendPublic(room.id, input);
            // eslint-disable-next-line functional/immutable-data
            sent.push({ actor, id: message.id });
            expect((await api.messaging.history(room.id)).messages.find(row => row.id === message.id)).toMatchObject({ body, type: 'user', author: { id: actor.user.id } });
            return { message, input };
          };
          try {
            await send(owner, 'SDK sender joins the public room');
            await send(recipient, 'SDK recipient subscribes by sending');
            // Reused auction/edition fixtures retain their earlier preferences.
            // Only the new drop room proves the initial subscription default.
            if (type !== 'drop-announcement') await recipient.account.messaging.command(room.id, { action: 'preferences', notification: 'all' });
            expect((await recipient.account.messaging.inbox()).conversations.find(row => row.id === room.id)?.notification).toBe('all');
            // Rejoining preserves the old read cursor. Read through fixture setup
            // so a delayed join message cannot masquerade as a duplicate notice.
            await recipient.account.messaging.command(room.id, { action: 'read', sequence: (await api.messaging.history(room.id)).room.latestSequence });
            const before = (await notifications(recipient, room.id)).map(row => row.id);
            const ordinary = await send(owner, `SDK public delivery ${randomUUID()}`);
            await owner.account.messaging.sendPublic(room.id, ordinary.input);
            const notice = await delivered(recipient, room.id, before);
            expect(notice.readAt).toBeNull();
            expect((await notifications(recipient, room.id)).filter(row => !before.includes(row.id))).toHaveLength(1);
            await recipient.account.notifications.markRead(notice.id);
            expect((await notifications(recipient, room.id)).find(row => row.id === notice.id)?.readAt).not.toBeNull();
            if (type === 'drop-announcement') {
              await recipient.account.messaging.command(room.id, { action: 'preferences', notification: 'mentions' });
              expect((await recipient.account.messaging.inbox()).conversations.find(row => row.id === room.id)?.notification).toBe('mentions');
              const mentionsBefore = (await notifications(recipient, room.id)).map(row => row.id);
              await send(owner, 'A message without a mention');
              await send(owner, 'A message mentioning the recipient', [recipient.user.id]);
              const mention = await delivered(recipient, room.id, mentionsBefore);
              expect(mention.id).not.toBe(notice.id);
              await stableNotifications(recipient, room.id, [...mentionsBefore, mention.id]);

              await recipient.account.messaging.command(room.id, { action: 'preferences', notification: 'muted' });
              expect((await recipient.account.messaging.inbox()).conversations.find(row => row.id === room.id)?.notification).toBe('muted');
              const mutedBefore = (await notifications(recipient, room.id)).map(row => row.id);
              await send(owner, 'A muted mention', [recipient.user.id]);
              const control = await owner.account.messaging.createRoom({ type: 'group', title: `SDK delivery control ${randomUUID()}`, description: '', guidelines: '', clientOperationId: randomUUID(), inviteeUserIds: [recipient.user.id] });
              try {
                await recipient.account.messaging.command(control.id, { action: 'accept' });
                const previous = (await notifications(recipient, control.id)).map(row => row.id);
                const body = `Unmuted worker control ${randomUUID()}`;
                const controlMessage = await owner.account.messaging.send(control.id, { clientMessageId: randomUUID(), body, attachmentIds: [], mentionUserIds: [] });
                expect((await recipient.account.messaging.history(control.id)).messages.find(row => row.id === controlMessage.id)?.body).toBe(body);
                await delivered(recipient, control.id, previous);
                await stableNotifications(recipient, room.id, mutedBefore);
              } finally { await owner.account.messaging.command(control.id, { action: 'close' }); }

              await recipient.account.messaging.command(room.id, { action: 'preferences', notification: 'all' });
              expect((await recipient.account.messaging.inbox()).conversations.find(row => row.id === room.id)?.notification).toBe('all');
              const systemBefore = (await notifications(recipient, room.id)).map(row => row.id);
              const system = { sourceId: randomUUID(), type: 'integration.notice', summary: 'Live SDK system notification fixture', payload: { fixture: true, values: [1, 2] }, occurredAt: new Date().toISOString() };
              const endpoint = `${apiBaseUrl}/v1/messaging/internal/public/rooms/${room.id}/system`;
              const append = (token?: string, body: unknown = system) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
              const session = await owner.account.auth.getSession();
              if (!session) throw new Error('Missing owner session');
              for (const token of [undefined, 'forged', session.accessToken]) expect((await append(token)).status).toBe(401);
              expect((await api.messaging.history(room.id)).messages.some(row => row.type === 'system' && row.system.sourceId === system.sourceId)).toBe(false);
              const key = required('RARE_MESSAGING_TEST_INTERNAL_API_KEY');
              const response = await append(key); expect(response.status).toBe(200);
              const stored = parseMessagingPublicMessage(await response.json());
              const retry = await append(key); expect(retry.status).toBe(200);
              expect(parseMessagingPublicMessage(await retry.json()).id).toBe(stored.id);
              expect((await append(key, { ...system, summary: 'Conflicting producer payload' })).status).toBe(409);
              const thread = await api.messaging.history(room.id);
              expect(thread.messages.filter(row => row.id === stored.id)).toHaveLength(1);
              expect(thread.messages.find(row => row.id === stored.id)).toMatchObject({ type: 'system', author: null, body: system.summary, system });
              const systemNotice = await delivered(recipient, room.id, systemBefore);
              await stableNotifications(recipient, room.id, [...systemBefore, systemNotice.id]);
              for (const action of [{ action: 'edit', body: 'Forged edit' }, { action: 'delete' }] as const) {
                await expect(owner.account.messaging.messageCommand(room.id, stored.id, action)).rejects.toMatchObject({ status: 404 });
              }
              expect((await api.messaging.history(room.id)).messages.find(row => row.id === stored.id)).toMatchObject({ body: system.summary, system });
            }
          } finally {
            for (const message of sent) await message.actor.account.messaging.messageCommand(room.id, message.id, { action: 'delete' });
            const thread = await api.messaging.history(room.id);
            for (const message of sent) expect(thread.messages.some(row => row.id === message.id)).toBe(false);
            for (const actor of [owner, recipient]) {
              await actor.account.messaging.command(room.id, { action: 'leave' });
              expect((await actor.account.messaging.inbox()).conversations.some(row => row.id === room.id)).toBe(false);
            }
          }
        });
      } finally { if (drop) await creator.drops.delete(drop.id); }
    } finally { await creator.auth.logout(); }
  }, 420_000);
});
