import { describe, expect, it } from 'vitest';
import { notificationId, notificationQuery, parseNotification, parseNotificationCount, parseNotificationPage } from '../src/sdk/notifications-core.js';

const notification = { id: '1', category: 'messagingActivity', notificationId: 'messaging:test', payload: { conversationId: '00000000-0000-4000-8000-000000000001' }, readAt: null, createdAt: '2026-10-14T12:00:00.000Z' };
const pagination = { page: 1, perPage: 20, totalCount: 1, totalPages: 1 };
describe('notification contract', () => {
  it('preserves payload and string IDs while excluding internal delivery fields', () => {
    expect(parseNotification({ ...notification, userId: '2', metadata: { email: 'private' } })).toEqual(notification);
    expect(parseNotificationPage({ data: [notification], pagination })).toEqual({ data: [notification], pagination });
  });
  it('rejects invalid input before a request and malformed responses', () => {
    for (const id of ['0', '-1', 'abc', '1/other']) expect(() => notificationId(id)).toThrow();
    for (const perPage of [0, 101, 1.5, NaN]) expect(() => notificationQuery({ perPage })).toThrow();
    expect(notificationQuery({ perPage: 1, page: 2 })).toBe('page=2&perPage=1');
    expect(() => parseNotification({ ...notification, readAt: 'bad' })).toThrow();
    expect(() => parseNotificationPage({ data: [], nextCursor: 1 })).toThrow();
    expect(parseNotificationCount({ data: { unreadCount: 0 } }, 'unreadCount')).toBe(0);
    expect(() => parseNotificationCount({ data: { unreadCount: -1 } }, 'unreadCount')).toThrow();
  });
  it('rejects payloads that do not match their category and narrows valid payloads', () => {
    expect(() => parseNotification({ ...notification, category: 'newFollower' })).toThrow();
    const value = parseNotification({ ...notification, category: 'newFollower', payload: { followerUserId: '1', followedUserId: '2' } });
    if (value.category !== 'newFollower') throw new Error('Wrong notification category');
    expect(value.payload.followerUserId).toBe('1');
    expect(() => parseNotification({ ...notification, category: 'unknown' })).toThrow();
  });
});
