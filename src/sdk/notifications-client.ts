import { notificationData, notificationId, notificationQuery, parseNotification, parseNotificationCount, parseNotificationPage } from './notifications-core.js';
import type { RareAuthRequestOptions } from './types/account.js';
import type { RareNotificationsClient } from './types/notifications.js';

type NotificationTransport = (method: 'GET' | 'POST', path: string, body: undefined, options?: RareAuthRequestOptions) => Promise<unknown>;
export function createNotificationsClient(request: NotificationTransport): RareNotificationsClient {
  const path = 'v1/me/notifications';
  return {
    async list(input = {}, options) { const query = notificationQuery(input); return parseNotificationPage(await request('GET', `${path}${query ? `?${query}` : ''}`, undefined, options)); },
    async unreadCount(options) { return parseNotificationCount(await request('GET', `${path}/unread-count`, undefined, options), 'unreadCount'); },
    async markRead(id, options) { const normalized = notificationId(id); return parseNotification(notificationData(await request('POST', `${path}/${normalized}/read`, undefined, options))); },
    async markAllRead(options) { return { markedReadCount: parseNotificationCount(await request('POST', `${path}/read`, undefined, options), 'markedReadCount') }; },
  };
}
