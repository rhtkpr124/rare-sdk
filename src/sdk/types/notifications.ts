import type { RareAuthRequestOptions } from './account.js';

/** One delivered app notification. Conversation unread state is independent. */
export type RareNotification = {
  id: string;
  category: string;
  notificationId: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};
export type RareNotificationPage = { data: RareNotification[]; nextCursor: string | null };
export type RareNotificationsClient = {
  list: (options?: RareAuthRequestOptions & { cursor?: string; limit?: number }) => Promise<RareNotificationPage>;
  unreadCount: (options?: RareAuthRequestOptions) => Promise<number>;
  markRead: (notificationId: string, options?: RareAuthRequestOptions) => Promise<RareNotification>;
  markAllRead: (options?: RareAuthRequestOptions) => Promise<{ markedReadCount: number }>;
};
