import { describe, expect, it } from 'vitest';
import { messagingAccountId, messagingErrorCode, messagingId, messagingQuery, messagingSequence, parseMessagingConversation, parseMessagingMessage, parseMessagingPeople, parseMessagingPreview, parseMessagingPublicMessage, parseMessagingPublicPage, messagingPublicHistoryQuery } from '../src/sdk/messaging-core.js';
const id = '08000000-0000-4000-8000-000000000001';
const user = { id: '42', username: 'artist' };
const conversation = { id, type: 'group', contextId: null, access: 'private', publicContext: null, title: 'Room', description: '', guidelines: '', owner: user, counterpart: null, lifecycle: 'open', capabilities: { read: true, send: true, accept: false, reopen: false, moderate: true, leave: true, state: 'active' }, notification: 'all', unreadCount: 0, latestSequence: '9223372036854775807', readSequence: '0', changeSequence: '1', updatedAt: '2026-10-13T00:00:00Z', lastMessage: null };
const message = { id, conversationId: id, sequence: '1', clientMessageId: id, author: user, body: 'Hi', createdAt: conversation.updatedAt, editedAt: null, deleted: false, version: 1, replyToId: null, reference: null, linkPreview: null, attachments: [], reactions: [], mentionUserIds: [], mentions: [], pinned: false, collapsed: false, reported: false, canEdit: true, canDelete: true };
describe('messaging pure contract parsing', () => {
  it('preserves bigint sequences as strings and strips unrelated response fields', () => {
    expect(parseMessagingConversation({ ...conversation, email: 'private@example.com' })).toEqual(conversation);
    expect(parseMessagingMessage({ ...message, author: { ...user, email: 'private@example.com' } })).toEqual(message);
  });
  it.each(['../room', 'a/b', '?id=other', '', '00000000-0000-0000-0000-000000000000'])('rejects unsafe conversation identifiers %s', value => expect(() => messagingId(value)).toThrow('invalid_messaging_id'));
  it('validates identifier ranges without number conversion', () => {
    expect(messagingAccountId('9223372036854775807')).toBe('9223372036854775807');
    expect(messagingSequence('0')).toBe('0');
    for (const value of ['9223372036854775808', '-1', '1e3']) { expect(() => messagingSequence(value)).toThrow(); expect(() => messagingAccountId(value)).toThrow(); }
    expect(() => messagingAccountId('0')).toThrow();
  });
  it('encodes opaque cursor/search values and excludes omitted options', () => expect(messagingQuery({ cursor: 'a+b/=c', search: 'a & b', pinned: false, before: undefined })).toBe('cursor=a%2Bb%2F%3Dc&search=a+%26+b&pinned=false'));
  it('rejects malformed responses rather than silently trusting JSON', () => {
    expect(() => parseMessagingConversation({ ...conversation, capabilities: { ...conversation.capabilities, send: 'true' } })).toThrow('invalid_messaging_response');
    expect(() => parseMessagingMessage({ ...message, sequence: 1 })).toThrow();
    expect(() => parseMessagingPeople([{ ...user, blocked: false }])).toThrow();
  });
  it('parses user and flexible trusted system entries without inventing authors', () => {
    const base = { id, conversationId: id, sequence: '1', body: 'Bid received', createdAt: conversation.updatedAt, replyToId: null };
    const system = { ...base, kind: 'system', author: null, system: { sourceId: 'tx:1', type: 'auction.bid', summary: 'Bid received', payload: { amount: '123', future: { field: true } }, occurredAt: conversation.updatedAt } };
    expect(parseMessagingPublicMessage(system)).toEqual(system);
    expect(() => parseMessagingPublicMessage({ ...system, author: user })).toThrow();
    const userMessage = { ...base, kind: 'user', author: user, mentions: [], replyTo: null };
    expect(parseMessagingPublicMessage(userMessage)).toEqual(userMessage);
    const page = { room: { id, context: { type: 'auction', id: 'auction-1', universalTokenId: '1-0x1234567890123456789012345678901234567890-1' }, title: 'Auction', latestSequence: '1' }, messages: [userMessage, system], nextCursor: null };
    expect(parseMessagingPublicPage(page)).toEqual(page);
  });
  it('keeps public inbox context and nullable system ownership', () => {
    const room = { ...conversation, access: 'public', contextId: 'auction:1', publicContext: { type: 'auction', id: '1' }, owner: null };
    expect(parseMessagingConversation(room)).toEqual(room);
  });
  it('validates public cursor direction and page bounds', () => {
    expect(messagingPublicHistoryQuery({ after: '0', limit: 100 })).toEqual({ after: '0', limit: 100 });
    expect(() => messagingPublicHistoryQuery({ before: '1', after: '0' })).toThrow();
    for (const limit of [0, 101, 1.5]) expect(() => messagingPublicHistoryQuery({ limit })).toThrow();
  });
  it('preserves structured error codes without accepting arbitrary error payloads', () => {
    expect(messagingErrorCode({ error: { code: 'idempotency_conflict', message: 'Private text' } })).toBe('idempotency_conflict');
    expect(messagingErrorCode({ error: { code: 'message contains private text' } })).toBe('request_failed');
  });
  it('preserves both first-party and external draft preview contracts', () => {
    const reference = { kind: 'reference', reference: { kind: 'post', id: '1', state: 'available', title: 'Post', href: '/posts/1' } };
    expect(parseMessagingPreview(reference)).toEqual(reference);
    const external = { kind: 'external', preview: { id, url: 'https://example.com', domain: 'example.com', title: null, description: null } };
    expect(parseMessagingPreview(external)).toEqual(external);
  });
});
