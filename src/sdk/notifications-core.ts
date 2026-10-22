import { isRecord } from './account-auth-core.js';
import { featureError, requireFeatureString as requireString } from './feature-error.js';
import type { RareNotification, RareNotificationPage } from './types/notifications.js';

export const notificationId = (value: string): string => {
  if (!/^[1-9][0-9]{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) throw featureError('invalid_notification_id');
  return value;
};
export const notificationQuery = (options: { cursor?: string; limit?: number }): string => {
  if (options.limit !== undefined && (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 50)) throw featureError('invalid_notification_limit');
  if (options.cursor !== undefined && (!options.cursor || options.cursor.length > 512)) throw featureError('invalid_notification_cursor');
  return new URLSearchParams({ ...(options.cursor === undefined ? {} : { cursor: options.cursor }), ...(options.limit === undefined ? {} : { limit: String(options.limit) }) }).toString();
};
const timestamp = (value: unknown): string => {
  const text = requireString(value, 'notification_timestamp');
  if (!Number.isFinite(Date.parse(text))) throw featureError('invalid_notification_response');
  return text;
};
export const parseNotification = (value: unknown): RareNotification => {
  if (!isRecord(value) || !isRecord(value.payload)) throw featureError('invalid_notification_response');
  return {
    id: notificationId(requireString(value.id, 'notification_id')),
    category: requireString(value.category, 'notification_category'),
    notificationId: requireString(value.notificationId, 'notification_source_id'),
    payload: value.payload,
    readAt: value.readAt === null ? null : timestamp(value.readAt), createdAt: timestamp(value.createdAt),
  };
};
export const notificationData = (value: unknown): unknown => {
  if (!isRecord(value) || !('data' in value)) throw featureError('invalid_notification_response');
  return value.data;
};
export const parseNotificationPage = (value: unknown): RareNotificationPage => {
  if (!isRecord(value) || !Array.isArray(value.data) || !(value.nextCursor === null || typeof value.nextCursor === 'string')) throw featureError('invalid_notification_response');
  return { data: value.data.map(parseNotification), nextCursor: value.nextCursor };
};
export const parseNotificationCount = (value: unknown, field: string): number => {
  const data = notificationData(value);
  if (!isRecord(data) || typeof data[field] !== 'number' || !Number.isSafeInteger(data[field]) || data[field] < 0) throw featureError('invalid_notification_response');
  return data[field];
};
