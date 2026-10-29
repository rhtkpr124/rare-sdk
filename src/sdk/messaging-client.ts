import { featureError, featureResponse } from './feature-error.js';
import { messagingAccountId, messagingId, messagingSequence, messagingQuery, parseMessagingAttachment, parseMessagingChanges, parseMessagingConversation, parseMessagingCreatedDirect, parseMessagingInbox, parseMessagingMessage, parseMessagingPage, parseMessagingParticipants, parseMessagingPeople, parseMessagingPreview, parseMessagingSession, parseMessagingSuccess, parseMessagingUsers, parseMessagingPublicMessage, parseMessagingPublicPage, messagingPublicHistoryQuery } from './messaging-core.js';
import type { RareAuthRequestOptions } from './types/account.js';
import type { RareMessagingClient } from './types/messaging.js';

export type MessagingTransport = (method: 'GET' | 'POST', path: string, body: BodyInit | undefined, headers: Readonly<Record<string, string>>, options?: RareAuthRequestOptions) => Promise<Response>;
/** The shell supplies authenticated transport; this module only maps the HTTP contract. */
export function createMessagingClient(request: MessagingTransport): RareMessagingClient {
  const call = async (method: 'GET' | 'POST', path: string, input: unknown, options?: RareAuthRequestOptions): Promise<unknown> => {
    const target = `v1/messaging/${path}`;
    return featureResponse(await request(method, target, input === undefined ? undefined : JSON.stringify(input), { ...(method === 'POST' ? { 'x-messaging-request': '1' } : {}), ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, options), target);
  };
  const conversation = (id: string) => `conversations/${messagingId(id)}`;
  const changeBlock = async (id: string, blocked: boolean, options?: RareAuthRequestOptions) => parseMessagingSuccess(await call('POST', `blocks/${messagingAccountId(id)}`, { blocked }, options));
  return {
    public: {
    async history(roomId, options = {}) { return parseMessagingPublicPage(await call('GET', `public/rooms/${messagingId(roomId)}/messages?${messagingQuery(messagingPublicHistoryQuery(options))}`, undefined, options)); },
    async send(roomId, input, options) { return parseMessagingPublicMessage(await call('POST', `public/rooms/${messagingId(roomId)}/messages`, input, options)); },
    },
    async session(options) { return parseMessagingSession(await call('GET', 'session', undefined, options)); },
    async inbox(options = {}) { return parseMessagingInbox(await call('GET', `conversations?${messagingQuery({ includePublic: true, search: options.search, cursor: options.cursor })}`, undefined, options)); },
    async people(search, options) { return parseMessagingPeople(await call('GET', `people?${messagingQuery({ search })}`, undefined, options)); },
    async createDirect(input, options) { return parseMessagingCreatedDirect(await call('POST', 'direct', input, options)); },
    async createRoom(input, options) { return parseMessagingConversation(await call('POST', 'rooms', input, options)); },
    async history(id, options = {}) { return parseMessagingPage(await call('GET', `${conversation(id)}?${messagingQuery({ before: options.before === undefined ? undefined : messagingSequence(options.before), pinned: options.pinned })}`, undefined, options)); },
    async changes(id, after, options) { return parseMessagingChanges(await call('GET', `${conversation(id)}/changes?${messagingQuery({ after: messagingSequence(after) })}`, undefined, options)); },
    async participants(id, options = {}) { return parseMessagingParticipants(await call('GET', `${conversation(id)}/participants?${messagingQuery({ after: options.after === undefined ? undefined : messagingAccountId(options.after), search: options.search })}`, undefined, options)); },
    async send(id, input, options) { return parseMessagingMessage(await call('POST', `${conversation(id)}/messages`, input, options)); },
    async command(id, input, options) { return parseMessagingConversation(await call('POST', `${conversation(id)}/commands`, input, options)); },
    async messageCommand(id, messageId, input, options) { return parseMessagingMessage(await call('POST', `${conversation(id)}/messages/${messagingId(messageId)}/commands`, input, options)); },
    blocks: async options => parseMessagingUsers(await call('GET', 'blocks', undefined, options)),
    block: (id, options) => changeBlock(id, true, options),
    unblock: (id, options) => changeBlock(id, false, options),
    async preview(id, url, options) { return parseMessagingPreview(await call('POST', `${conversation(id)}/previews`, { url }, options)); },
    async attachImage(id, uploadId, options) {
      if (!Number.isSafeInteger(options.width) || options.width <= 0 || !Number.isSafeInteger(options.height) || options.height <= 0 || (options.purpose !== undefined && !['message', 'conversation'].includes(options.purpose))) throw featureError('invalid_messaging_image');
      return parseMessagingAttachment(await call('POST', `${conversation(id)}/attachments/from-upload`, {
        uploadId: messagingId(uploadId), width: options.width, height: options.height,
        ...(options.attachmentId === undefined ? {} : { attachmentId: messagingId(options.attachmentId) }),
        ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
      }, options));
    },
    async readImage(id, options) { const path = `v1/messaging/attachments/${messagingId(id)}`; const response = await request('GET', path, undefined, {}, options); if (!response.ok) await featureResponse(response, path); return response.blob(); },
  };
}
