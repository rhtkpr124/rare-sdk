import type { ApiClient } from '../data-access/client.js';
import type { PublicMessagingClient } from './types/messaging.js';
import { messagingId, messagingPublicHistoryQuery, parseMessagingPublicPage, parseMessagingPublicRoom } from './messaging-core.js';

export function createPublicMessagingClient(client: ApiClient): PublicMessagingClient {
  return {
    async resolveRoom(context, options) {
      const { data } = await client.POST('/v1/messaging/public/rooms/resolve', { body: { context }, credentials: 'omit', signal: options?.signal });
      return parseMessagingPublicRoom(data);
    },
    async history(roomId, input = {}, options) {
      const { data } = await client.GET('/v1/messaging/public/rooms/{conversationId}/messages', { params: { path: { conversationId: messagingId(roomId) }, query: messagingPublicHistoryQuery(input) }, credentials: 'omit', signal: options?.signal });
      return parseMessagingPublicPage(data);
    },
  };
}
