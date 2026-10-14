import { describe, expect, it } from 'vitest';
import { notificationId, notificationQuery, parseNotification, parseNotificationCount, parseNotificationPage } from '../src/sdk/notifications-core.js';

const notification = { id: '1', category: 'messagingActivity', notificationId: 'messaging:test', payload: { conversationId: 'room' }, readAt: null, createdAt: '2026-10-14T12:00:00.000Z' };
describe('notification contract', () => {
  it('preserves payload and string IDs while excluding internal delivery fields', () => {
    expect(parseNotification({ ...notification, userId: '2', metadata: { email: 'private' } })).toEqual(notification);
    expect(parseNotificationPage({ data: [notification], nextCursor: null })).toEqual({ data: [notification], nextCursor: null });
  });
  it('rejects invalid input before a request and malformed responses', () => {
    for (const id of ['0', '-1', 'abc', '1/other']) expect(() => notificationId(id)).toThrow();
    for (const limit of [0, 51, 1.5, NaN]) expect(() => notificationQuery({ limit })).toThrow();
    expect(notificationQuery({ limit: 1, cursor: 'abc+=' })).toBe('cursor=abc%2B%3D&limit=1');
    expect(() => parseNotification({ ...notification, readAt: 'bad' })).toThrow();
    expect(() => parseNotificationPage({ data: [], nextCursor: 1 })).toThrow();
    expect(parseNotificationCount({ data: { unreadCount: 0 } }, 'unreadCount')).toBe(0);
    expect(() => parseNotificationCount({ data: { unreadCount: -1 } }, 'unreadCount')).toThrow();
  });
});
