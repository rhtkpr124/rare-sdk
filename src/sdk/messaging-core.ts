import type { components, operations } from '../data-access/schema.js';
import { isRecord, RareAuthError } from './account-auth-core.js';

export type MessagingConversation = components['schemas']['MessagingConversation'];
export type MessagingMessage = components['schemas']['MessagingMessage'];
export type MessagingPage = components['schemas']['MessagingPage'];
export type MessagingChanges = components['schemas']['MessagingChanges'];
export type MessagingInbox = components['schemas']['MessagingInbox'];
export type MessagingParticipant = components['schemas']['MessagingParticipant'];
export type MessagingUser = components['schemas']['MessagingUser'];
export type MessagingSearchPerson = components['schemas']['MessagingSearchPerson'];
export type MessagingAttachment = components['schemas']['MessagingAttachment'];
export type MessagingDraftPreview = components['schemas']['MessagingDraftPreview'];
export type MessagingSend = components['schemas']['MessagingSend'];
export type MessagingCreateDirect = components['schemas']['MessagingCreateDirect'];
export type MessagingCreateRoom = components['schemas']['MessagingCreateRoom'];
export type MessagingCommand = components['schemas']['MessagingCommand'];
export type MessagingMessageCommand = components['schemas']['MessagingMessageCommand'];
export type MessagingCreatedDirect = operations['createMessagingDirect']['responses'][200]['content']['application/json'];
export type MessagingSession = operations['getMessagingSession']['responses'][200]['content']['application/json'];
export type MessagingParticipants = operations['listMessagingParticipants']['responses'][200]['content']['application/json'];

const invalid = (): never => { throw new RareAuthError('invalid_messaging_response'); };
export function messagingId(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new RareAuthError('invalid_messaging_id');
  return value;
}
export function messagingAccountId(value: string): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw new RareAuthError('invalid_messaging_account_id');
  return value;
}
export function messagingSequence(value: string): string {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value) || BigInt(value) > 9223372036854775807n) throw new RareAuthError('invalid_messaging_sequence');
  return value;
}
function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : invalid(); }
function text(value: unknown): string { return typeof value === 'string' ? value : invalid(); }
function boolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function number(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
function nullable(value: unknown): string | null { return value === null ? null : text(value); }
function list<T>(value: unknown, parse: (value: unknown) => T): T[] { return Array.isArray(value) ? value.map(parse) : invalid(); }
function choice<const T extends readonly string[]>(value: unknown, choices: T): T[number] { const found = choices.find(choice => choice === value); return found ?? invalid(); }
export function parseMessagingUser(value: unknown): MessagingUser {
  const row = record(value);
  return { id: messagingAccountId(text(row.id)), username: text(row.username), ...(row.address === undefined ? {} : { address: text(row.address) }), ...(row.avatar === undefined ? {} : { avatar: text(row.avatar) }) };
}
export function parseMessagingConversation(value: unknown): MessagingConversation {
  const row = record(value);
  const capabilities = record(row.capabilities);
  return {
    id: messagingId(text(row.id)), type: choice(row.type, ['direct', 'group']), contextId: row.contextId === null ? null : text(row.contextId), access: row.access === undefined ? 'private' : choice(row.access, ['private', 'public']), publicContext: row.publicContext == null ? null : parseMessagingPublicContext(row.publicContext),
    title: text(row.title), description: text(row.description), guidelines: text(row.guidelines), owner: row.owner === null ? null : parseMessagingUser(row.owner), counterpart: row.counterpart === null ? null : parseMessagingUser(row.counterpart),
    lifecycle: choice(row.lifecycle, ['open', 'paused', 'closed']),
    capabilities: { read: boolean(capabilities.read), send: boolean(capabilities.send), accept: boolean(capabilities.accept), reopen: boolean(capabilities.reopen), moderate: boolean(capabilities.moderate), leave: boolean(capabilities.leave), state: choice(capabilities.state, ['active', 'request', 'invited', 'banned', 'left', 'closed', 'read_only', 'unavailable']) },
    notification: choice(row.notification, ['all', 'mentions', 'muted']), unreadCount: number(row.unreadCount), latestSequence: messagingSequence(text(row.latestSequence)), readSequence: messagingSequence(text(row.readSequence)), changeSequence: messagingSequence(text(row.changeSequence)), updatedAt: text(row.updatedAt), lastMessage: nullable(row.lastMessage),
  };
}
export function parseMessagingAttachment(value: unknown): MessagingAttachment {
  const row = record(value);
  const width = number(row.width); const height = number(row.height);
  if (!width || !height) return invalid();
  return { id: messagingId(text(row.id)), contentType: text(row.contentType), sizeBytes: number(row.sizeBytes), width, height };
}
function reference(value: unknown): NonNullable<MessagingMessage['reference']> {
  const row = record(value);
  return { kind: choice(row.kind, ['post', 'artwork']), id: text(row.id), state: choice(row.state, ['available', 'unavailable']), title: nullable(row.title), href: nullable(row.href) };
}
function preview(value: unknown): NonNullable<MessagingMessage['linkPreview']> {
  const row = record(value);
  return { id: messagingId(text(row.id)), url: text(row.url), domain: text(row.domain), title: nullable(row.title), description: nullable(row.description) };
}
export function parseMessagingMessage(value: unknown): MessagingMessage {
  const row = record(value);
  return {
    id: messagingId(text(row.id)), conversationId: messagingId(text(row.conversationId)), sequence: messagingSequence(text(row.sequence)), clientMessageId: messagingId(text(row.clientMessageId)), author: parseMessagingUser(row.author), body: text(row.body), createdAt: text(row.createdAt), editedAt: nullable(row.editedAt), deleted: boolean(row.deleted), version: number(row.version), replyToId: row.replyToId === null ? null : messagingId(text(row.replyToId)),
    reference: row.reference == null ? null : reference(row.reference), linkPreview: row.linkPreview == null ? null : preview(row.linkPreview), attachments: list(row.attachments, parseMessagingAttachment),
    reactions: list(row.reactions, value => { const reaction = record(value); return { emoji: text(reaction.emoji), count: number(reaction.count), reacted: boolean(reaction.reacted) }; }),
    mentionUserIds: list(row.mentionUserIds, value => messagingAccountId(text(value))), mentions: list(row.mentions, parseMessagingUser), pinned: boolean(row.pinned), collapsed: boolean(row.collapsed), reported: boolean(row.reported), canEdit: boolean(row.canEdit), canDelete: boolean(row.canDelete),
  };
}
export function parseMessagingInbox(value: unknown): MessagingInbox { const row = record(value); return { conversations: list(row.conversations, parseMessagingConversation), nextCursor: nullable(row.nextCursor) }; }
export function parseMessagingPage(value: unknown): MessagingPage { const row = record(value); return { viewerPolicyVersion: text(row.viewerPolicyVersion), conversation: parseMessagingConversation(row.conversation), messages: list(row.messages, parseMessagingMessage), nextCursor: row.nextCursor === null ? null : messagingSequence(text(row.nextCursor)), changeCursor: messagingSequence(text(row.changeCursor)) }; }
export function parseMessagingChanges(value: unknown): MessagingChanges { const row = record(value); return { viewerPolicyVersion: text(row.viewerPolicyVersion), conversation: parseMessagingConversation(row.conversation), messages: list(row.messages, parseMessagingMessage), nextCursor: messagingSequence(text(row.nextCursor)), hasMore: boolean(row.hasMore), resynchronize: boolean(row.resynchronize) }; }
export function parseMessagingParticipants(value: unknown): MessagingParticipants {
  const row = record(value);
  return { participants: list(row.participants, value => { const participant = record(value); return { user: parseMessagingUser(participant.user), state: choice(participant.state, ['invited', 'joined', 'left', 'removed']), owner: boolean(participant.owner), banned: boolean(participant.banned) }; }), nextCursor: row.nextCursor === null ? null : messagingAccountId(text(row.nextCursor)) };
}
export function parseMessagingPeople(value: unknown): MessagingSearchPerson[] { return list(value, value => { const row = record(value); return { ...parseMessagingUser(value), followsYou: boolean(row.followsYou), blocked: boolean(row.blocked), ...(row.fullName === undefined ? {} : { fullName: text(row.fullName) }) }; }); }
export function parseMessagingUsers(value: unknown): MessagingUser[] { return list(value, parseMessagingUser); }
export function parseMessagingSession(value: unknown): MessagingSession { const row = record(value); return { user: parseMessagingUser(row.user), address: text(row.address), mediaEnabled: boolean(row.mediaEnabled) }; }
export function parseMessagingCreatedDirect(value: unknown): MessagingCreatedDirect { const row = record(value); return { ...parseMessagingConversation(value), ...(row.acceptedClientMessageId === undefined ? {} : { acceptedClientMessageId: messagingId(text(row.acceptedClientMessageId)) }) }; }
export function parseMessagingPreview(value: unknown): MessagingDraftPreview { const row = record(value); return row.kind === 'reference' ? { kind: 'reference', reference: reference(row.reference) } : row.kind === 'external' ? { kind: 'external', preview: preview(row.preview) } : invalid(); }
export function parseMessagingSuccess(value: unknown): void { if (record(value).success !== true) invalid(); }

/** Query planning preserves opaque cursors and omits absent options. */
export function messagingQuery(input: Readonly<Record<string, string | number | boolean | undefined>>): string {
  return new URLSearchParams(Object.entries(input).flatMap(([key, value]) => value === undefined ? [] : [[key, String(value)]])).toString();
}

export function messagingErrorCode(value: unknown): string {
  return isRecord(value) && isRecord(value.error) && typeof value.error.code === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value.error.code) ? value.error.code : 'request_failed';
}

export type MessagingPublicResolveContext = components['schemas']['MessagingPublicResolveContext'];
export type MessagingPublicContext = components['schemas']['MessagingPublicContext'];
export type MessagingPublicRoom = components['schemas']['MessagingPublicRoom'];
export type MessagingPublicMessage = components['schemas']['MessagingPublicMessage'];
export type MessagingPublicPage = components['schemas']['MessagingPublicPage'];
export type MessagingPublicSend = components['schemas']['MessagingPublicSend'];
export type MessagingSystem = components['schemas']['MessagingSystem'];

export function parseMessagingPublicContext(value: unknown): MessagingPublicContext {
  const row = record(value);
  if (row.type === 'auction') return { type: 'auction', id: text(row.id), ...(row.universalTokenId === undefined ? {} : { universalTokenId: text(row.universalTokenId) }) };
  if (row.type === 'drop-announcement') return { type: 'drop-announcement', id: messagingAccountId(text(row.id)) };
  if (row.type === 'liquid-edition') { const chainId = number(row.chainId); if (!chainId) return invalid(); return { type: 'liquid-edition', chainId, contractAddress: text(row.contractAddress) }; }
  return invalid();
}
export function parseMessagingPublicRoom(value: unknown): MessagingPublicRoom {
  const row = record(value);
  return { id: messagingId(text(row.id)), context: parseMessagingPublicContext(row.context), title: text(row.title), latestSequence: messagingSequence(text(row.latestSequence)) };
}
export function parseMessagingPublicMessage(value: unknown): MessagingPublicMessage {
  const row = record(value);
  const base = { id: messagingId(text(row.id)), conversationId: messagingId(text(row.conversationId)), sequence: messagingSequence(text(row.sequence)), body: text(row.body), createdAt: text(row.createdAt), replyToId: row.replyToId === null ? null : messagingId(text(row.replyToId)), reactions: row.reactions === undefined ? [] : list(row.reactions, value => { const reaction = record(value); return { emoji: text(reaction.emoji), count: number(reaction.count), reacted: boolean(reaction.reacted) }; }), collapsed: row.collapsed === undefined ? false : boolean(row.collapsed), reported: row.reported === undefined ? false : boolean(row.reported) };
  if (row.type === 'user') {
    const reply = row.replyTo == null ? null : record(row.replyTo);
    return { ...base, type: 'user', author: parseMessagingUser(row.author), mentions: list(row.mentions, parseMessagingUser), replyTo: reply === null ? null : { id: messagingId(text(reply.id)), authorUsername: nullable(reply.authorUsername), authorAddress: text(reply.authorAddress), bodySnippet: text(reply.bodySnippet) } };
  }
  if (row.type === 'system' && row.author === null) {
    const system = record(row.system);
    return { ...base, type: 'system', author: null, system: { sourceId: text(system.sourceId), type: text(system.type), summary: text(system.summary), payload: record(system.payload), occurredAt: text(system.occurredAt) } };
  }
  return invalid();
}
export function parseMessagingPublicPage(value: unknown): MessagingPublicPage {
  const row = record(value);
  return { room: parseMessagingPublicRoom(row.room), messages: list(row.messages, parseMessagingPublicMessage), nextCursor: row.nextCursor === null ? null : messagingSequence(text(row.nextCursor)) };
}
export function messagingPublicHistoryQuery(options: { before?: string; after?: string; limit?: number }): { before?: string; after?: string; limit?: number } {
  if (options.before !== undefined && options.after !== undefined) throw new RareAuthError('invalid_messaging_cursor');
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)) throw new RareAuthError('invalid_messaging_limit');
  return { ...(options.before === undefined ? {} : { before: messagingSequence(options.before) }), ...(options.after === undefined ? {} : { after: messagingSequence(options.after) }), ...(options.limit === undefined ? {} : { limit: options.limit }) };
}
