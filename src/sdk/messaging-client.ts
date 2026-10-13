import { RareAuthError } from './account-auth-core.js';
import { messagingAccountId, messagingErrorCode, messagingId, messagingSequence, messagingQuery, parseMessagingAttachment, parseMessagingChanges, parseMessagingConversation, parseMessagingCreatedDirect, parseMessagingInbox, parseMessagingMessage, parseMessagingPage, parseMessagingParticipants, parseMessagingPeople, parseMessagingPreview, parseMessagingSession, parseMessagingSuccess, parseMessagingUsers, parseMessagingPublicMessage } from './messaging-core.js';
import type { RareAuthRequestOptions } from './types/account.js';
import type { RareMessagingClient } from './types/messaging.js';

export type MessagingTransport = (method: 'GET' | 'POST', path: string, body: BodyInit | undefined, headers: Readonly<Record<string, string>>, options?: RareAuthRequestOptions) => Promise<Response>;
/** The shell supplies authenticated transport; this module only maps the HTTP contract. */
export function createMessagingClient(request: MessagingTransport, json: (response: Response) => Promise<unknown>): RareMessagingClient {
  const messagingJson = async (response: Response): Promise<unknown> => {
    if (response.ok) return json(response);
    const value: unknown = await response.json().catch(() => undefined);
    throw new RareAuthError(messagingErrorCode(value), response.status);
  };
  const call = async (method: 'GET' | 'POST', path: string, input: unknown, options?: RareAuthRequestOptions): Promise<unknown> => messagingJson(await request(method, `v1/messaging/${path}`, input === undefined ? undefined : JSON.stringify(input), { ...(method === 'POST' ? { 'x-messaging-request': '1' } : {}), ...(input === undefined ? {} : { 'Content-Type': 'application/json' }) }, options));
  const conversation = (id: string) => `conversations/${messagingId(id)}`;
  const changeBlock = async (id: string, blocked: boolean, options?: RareAuthRequestOptions) => parseMessagingSuccess(await call('POST', `blocks/${messagingAccountId(id)}`, { blocked }, options));
  return {
    async sendPublic(roomId, input, options) { return parseMessagingPublicMessage(await call('POST', `public/rooms/${messagingId(roomId)}/messages`, input, options)); },
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
    async uploadImage(id, file, options) {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(options.contentType) || !Number.isSafeInteger(options.width) || options.width <= 0 || !Number.isSafeInteger(options.height) || options.height <= 0) throw new RareAuthError('invalid_messaging_image');
      const blob = file instanceof Blob ? file : new Blob([new Uint8Array(file)], { type: options.contentType });
      return parseMessagingAttachment(await messagingJson(await request('POST', `v1/messaging/${conversation(id)}/attachments`, blob, { 'x-messaging-request': '1', 'Content-Type': options.contentType, 'x-messaging-image-width': String(options.width), 'x-messaging-image-height': String(options.height), ...(options.uploadId === undefined ? {} : { 'x-messaging-upload-id': messagingId(options.uploadId) }) }, options)));
    },
    async readImage(id, options) { const response = await request('GET', `v1/messaging/attachments/${messagingId(id)}`, undefined, {}, options); if (!response.ok) await messagingJson(response); return response.blob(); },
  };
}
