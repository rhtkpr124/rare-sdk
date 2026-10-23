import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { messagingOrigin, withMessagingActors } from './messaging-live.js';

const input = (body: string, attachmentIds: string[] = []) => ({ clientMessageId: randomUUID(), body, attachmentIds, mentionUserIds: [] });
const roomInput = () => ({ type: 'group' as const, title: `SDK authorization ${randomUUID()}`, description: '', guidelines: '', clientOperationId: randomUUID(), inviteeUserIds: [] });

describe('messaging authorization against deployed services', () => {
  it('enforces invitations, owner-only moderation, bans and paused rooms through persisted membership and history', async () => {
    await withMessagingActors(async (owner, member, outsider) => {
      const room = await owner.account.messaging.createRoom(roomInput());
      try {
        const first = input('Owner-only message');
        const sent = await owner.account.messaging.send(room.id, first);
        await expect(outsider.account.messaging.history(room.id)).rejects.toMatchObject({ status: 404 });
        await owner.account.messaging.command(room.id, { action: 'invite', userId: member.user.id });
        expect((await member.account.messaging.history(room.id)).messages).toEqual([]);
        await expect(member.account.messaging.send(room.id, input('Before acceptance'))).rejects.toMatchObject({ status: 403 });
        await member.account.messaging.command(room.id, { action: 'decline' });
        expect((await owner.account.messaging.participants(room.id)).participants.find(row => row.user.id === member.user.id)?.state).toBe('left');
        await owner.account.messaging.command(room.id, { action: 'invite', userId: member.user.id });
        await member.account.messaging.command(room.id, { action: 'accept' });
        expect((await member.account.messaging.history(room.id)).messages.find(row => row.id === sent.id)).toMatchObject({ body: first.body, author: { id: owner.user.id } });
        for (const command of [{ action: 'settings', settings: { title: 'Hijacked' } }, { action: 'ban', userId: owner.user.id }, { action: 'pause' }, { action: 'close' }] as const) {
          await expect(member.account.messaging.command(room.id, command)).rejects.toMatchObject({ status: 403 });
        }
        expect((await owner.account.messaging.history(room.id)).conversation).toMatchObject({ title: room.title, lifecycle: 'open' });
        await owner.account.messaging.command(room.id, { action: 'settings', settings: { title: 'Updated by owner' } });
        expect((await member.account.messaging.history(room.id)).conversation.title).toBe('Updated by owner');
        await owner.account.messaging.command(room.id, { action: 'ban', userId: member.user.id });
        expect((await owner.account.messaging.participants(room.id)).participants.find(row => row.user.id === member.user.id)?.state).toBe('removed');
        expect((await member.account.messaging.history(room.id)).messages).toEqual([]);
        await expect(member.account.messaging.send(room.id, input('Banned write'))).rejects.toMatchObject({ status: 403 });
        await owner.account.messaging.command(room.id, { action: 'unban', userId: member.user.id });
        expect((await member.account.messaging.history(room.id)).messages).toEqual([]);
        await expect(member.account.messaging.send(room.id, input('Unban is not membership'))).rejects.toMatchObject({ status: 403 });
        await owner.account.messaging.command(room.id, { action: 'invite', userId: member.user.id });
        await member.account.messaging.command(room.id, { action: 'accept' });
        await owner.account.messaging.command(room.id, { action: 'pause' });
        expect((await member.account.messaging.history(room.id)).conversation.lifecycle).toBe('paused');
        await expect(member.account.messaging.send(room.id, input('Paused write'))).rejects.toMatchObject({ status: 403 });
        await owner.account.messaging.command(room.id, { action: 'resume' });
        const resumed = input('Sending resumes after owner approval');
        const message = await member.account.messaging.send(room.id, resumed);
        const history = await owner.account.messaging.history(room.id);
        expect(history.messages.find(row => row.id === message.id)).toMatchObject({ body: resumed.body, author: { id: member.user.id } });
        for (const body of ['Before acceptance', 'Banned write', 'Unban is not membership', 'Paused write']) expect(history.messages.some(row => row.body === body)).toBe(false);
      } finally {
        await owner.account.messaging.command(room.id, { action: 'close' });
        expect((await owner.account.messaging.history(room.id)).conversation.lifecycle).toBe('closed');
      }
    });
  }, 240_000);

  it('keeps declined direct requests read-only and enforces persisted blocks in both directions', async () => {
    await withMessagingActors(async (owner, recipient, peer) => {
      const requestInput = { recipientUserId: recipient.user.id, clientMessageId: '85e318d1-62ba-4e1b-aa35-7f8a63939fc4', body: 'SDK repeatable direct request fixture' };
      const request = await owner.account.messaging.createDirect(requestInput);
      expect(request.capabilities.state, 'Reserve this account pair for declined requests; do not accept its request').toBe('request');
      expect((await owner.account.messaging.history(request.id)).messages.find(row => row.clientMessageId === requestInput.clientMessageId)?.body).toBe(requestInput.body);
      await expect(owner.account.messaging.send(request.id, input('Sender cannot bypass request'))).rejects.toMatchObject({ status: 403 });
      await recipient.account.messaging.command(request.id, { action: 'decline' });
      expect((await recipient.account.messaging.history(request.id)).messages).toEqual([]);
      expect((await owner.account.messaging.history(request.id)).conversation.capabilities.send).toBe(false);
      await expect(owner.account.messaging.command(request.id, { action: 'reopen' })).rejects.toMatchObject({ status: 403 });

      const beforeBlocks = await owner.account.messaging.blocks();
      expect(beforeBlocks.some(row => row.id === peer.user.id)).toBe(false);
      expect((await peer.account.messaging.blocks()).some(row => row.id === owner.user.id)).toBe(false);
      const direct = await owner.account.messaging.createDirect({ recipientUserId: peer.user.id, clientMessageId: 'e8ff5af2-9932-4745-b630-f0ae960d238a', body: 'SDK accepted direct fixture' });
      const peerState = (await peer.account.messaging.history(direct.id)).conversation;
      // Setup an existing durable pair without changing an already accepted request.
      if (peerState.capabilities.accept) await peer.account.messaging.command(direct.id, { action: 'accept' });
      else if (peerState.capabilities.reopen) await peer.account.messaging.command(direct.id, { action: 'reopen' });
      expect((await peer.account.messaging.history(direct.id)).conversation.capabilities.send).toBe(true);
      const delivered = input(`SDK direct ${randomUUID()}`);
      const message = await owner.account.messaging.send(direct.id, delivered);
      try {
        expect((await peer.account.messaging.history(direct.id)).messages.find(row => row.id === message.id)).toMatchObject({ body: delivered.body, author: { id: owner.user.id } });
        await owner.account.messaging.block(peer.user.id);
        expect((await owner.account.messaging.blocks()).map(row => row.id)).toContain(peer.user.id);
        for (const actor of [owner, peer]) {
          expect((await actor.account.messaging.history(direct.id)).conversation.capabilities.send).toBe(false);
          await expect(actor.account.messaging.send(direct.id, input('Blocked write'))).rejects.toMatchObject({ status: 403 });
        }
        await expect(peer.account.messaging.createDirect({ recipientUserId: owner.user.id, clientMessageId: randomUUID(), body: 'Blocked first contact' })).rejects.toMatchObject({ status: 403 });
        expect((await peer.account.messaging.history(direct.id)).messages.some(row => row.body === 'Blocked write' || row.body === 'Blocked first contact')).toBe(false);
      } finally { await owner.account.messaging.unblock(peer.user.id); }
      expect(await owner.account.messaging.blocks()).toEqual(beforeBlocks);
      const resumed = input('Unblocked direct reply');
      const reply = await peer.account.messaging.send(direct.id, resumed);
      expect((await owner.account.messaging.history(direct.id)).messages.find(row => row.id === reply.id)?.body).toBe(resumed.body);
      await owner.account.messaging.messageCommand(direct.id, message.id, { action: 'delete' });
      await peer.account.messaging.messageCommand(direct.id, reply.id, { action: 'delete' });
      expect((await owner.account.messaging.history(direct.id)).messages.find(row => row.id === reply.id)).toMatchObject({ deleted: true, body: '' });
    });
  }, 240_000);

  it('authorizes attachment bytes independently and rejects cross-room reuse, nonmembers and revoked membership', async () => {
    const bucket = 'rare-api-private-upload-dev';
    if (bucket.includes('prod') || !/^[a-z0-9-]+$/.test(bucket)) throw new Error('Use the non-production messaging bucket');
    execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'buckets', 'describe', `gs://${bucket}`, '--format=value(name)'], { stdio: 'pipe' });
    await withMessagingActors(async (owner, member, outsider) => {
      const room = await owner.account.messaging.createRoom(roomInput());
      const second = await owner.account.messaging.createRoom(roomInput());
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      const marker = Buffer.from(randomUUID());
      // A valid GIF comment makes this test's content-addressed object unique.
      const bytes = Buffer.concat([gif.subarray(0, -1), Buffer.from([0x21, 0xfe, marker.length]), marker, Buffer.from([0, 0x3b])]);
      const uploadId = randomUUID();
      const object = `gs://${bucket}/${createHash('sha256').update(bytes).digest('hex')}`;
      try {
        await owner.account.messaging.command(room.id, { action: 'invite', userId: member.user.id });
        await member.account.messaging.command(room.id, { action: 'accept' });
        const upload = await owner.account.upload(bytes, 'private.gif', { contentType: 'image/gif', access: 'private' });
        const image = await owner.account.messaging.attachImage(room.id, upload.uploadId, { width: 1, height: 1, attachmentId: uploadId });
        const secondImage = await owner.account.messaging.attachImage(second.id, upload.uploadId, { width: 1, height: 1, attachmentId: randomUUID() });
        expect(Buffer.from(await (await owner.account.messaging.readImage(secondImage.id)).arrayBuffer())).toEqual(bytes);
        await expect(member.account.messaging.attachImage(room.id, upload.uploadId, { width: 1, height: 1 })).rejects.toMatchObject({ status: 404 });
        expect(Buffer.from(await (await owner.account.messaging.readImage(image.id)).arrayBuffer())).toEqual(bytes);
        await expect(member.account.messaging.readImage(image.id)).rejects.toMatchObject({ status: 403 });
        await expect(owner.account.messaging.send(second.id, input('Cross-room attachment', [image.id]))).rejects.toMatchObject({ status: 400 });
        expect((await owner.account.messaging.history(second.id)).messages).toEqual([]);
        const sent = await owner.account.messaging.send(room.id, input('Private image', [image.id]));
        expect((await member.account.messaging.history(room.id)).messages.find(row => row.id === sent.id)?.attachments).toContainEqual(image);
        expect(Buffer.from(await (await member.account.messaging.readImage(image.id)).arrayBuffer())).toEqual(bytes);
        await expect(outsider.account.messaging.readImage(image.id)).rejects.toMatchObject({ status: 404 });
        expect((await fetch(`${messagingOrigin()}/v1/messaging/attachments/${image.id}`)).status).toBe(401);
        await owner.account.messaging.command(room.id, { action: 'ban', userId: member.user.id });
        await expect(member.account.messaging.readImage(image.id)).rejects.toMatchObject({ status: 403 });
        await owner.account.messaging.messageCommand(room.id, sent.id, { action: 'delete' });
        expect((await owner.account.messaging.history(room.id)).messages.find(row => row.id === sent.id)).toMatchObject({ deleted: true, attachments: [] });
        await expect(owner.account.messaging.readImage(image.id)).rejects.toMatchObject({ status: 404 });
      } finally {
        await owner.account.messaging.command(room.id, { action: 'close' });
        await owner.account.messaging.command(second.id, { action: 'close' });
        try { execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'rm', object], { stdio: 'pipe' }); }
        catch (error) {
          const stderr = error !== null && typeof error === 'object' && 'stderr' in error && error.stderr instanceof Uint8Array ? Buffer.from(error.stderr).toString('utf8') : '';
          if (!/No URLs matched|URLs matched no objects or files|HTTPError 404|does not exist/.test(stderr)) throw error;
        }
      }
    });
  }, 240_000);
});
