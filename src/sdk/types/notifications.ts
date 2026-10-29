import type { RareAuthRequestOptions } from './account.js';
import type { NotificationWire } from '../notification-schema.js';
import type { SearchPageResponse } from '../api.js';

/** One delivered app notification. Conversation unread state is independent. */
export type RareNotification = NotificationWire;
export type RareNotificationPage = SearchPageResponse<RareNotification>;
export type RareNotificationsClient = {
  list: (input?: { page?: number; perPage?: number }, options?: RareAuthRequestOptions) => Promise<RareNotificationPage>;
  unreadCount: (options?: RareAuthRequestOptions) => Promise<number>;
  markRead: (notificationId: string, options?: RareAuthRequestOptions) => Promise<RareNotification>;
  markAllRead: (options?: RareAuthRequestOptions) => Promise<{ markedReadCount: number }>;
};
