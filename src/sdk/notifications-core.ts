import { isRecord } from './account-auth-core.js';
import { featureError } from './feature-error.js';
import type { RareNotification, RareNotificationPage } from './types/notifications.js';
import { rareNotificationSchema } from './notification-schema.js';
import { favoritePageQuery } from './favorites-core.js';
import { parsePostPage } from './posts-core.js';

export const notificationId = (value: string): string => {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw featureError('invalid_notification_id');
  return value;
};
export const notificationQuery = (options: { page?: number; perPage?: number }): string =>
  new URLSearchParams(Object.entries(favoritePageQuery(options)).map(([key, value]) => [key, String(value)])).toString();
export const parseNotification = (value: unknown): RareNotification => {
  const result = rareNotificationSchema.safeParse(value);
  if (!result.success) throw featureError('invalid_notification_response');
  notificationId(result.data.id);
  return result.data;
};
export const notificationData = (value: unknown): unknown => {
  if (!isRecord(value) || !('data' in value)) throw featureError('invalid_notification_response');
  return value.data;
};
export const parseNotificationPage = (value: unknown): RareNotificationPage => {
  return parsePostPage(value, parseNotification);
};
export const parseNotificationCount = (value: unknown, field: string): number => {
  const data = notificationData(value);
  if (!isRecord(data) || typeof data[field] !== 'number' || !Number.isSafeInteger(data[field]) || data[field] < 0) throw featureError('invalid_notification_response');
  return data[field];
};
