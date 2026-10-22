import { isAddress } from 'viem';
import { featureError } from './feature-error.js';
import { normalizeProfileUsername } from './account-profile-core.js';

export type UserSelector =
  | { address: string; username?: never; userId?: never }
  | { username: string; address?: never; userId?: never }
  | { userId: number; address?: never; username?: never };
export type UserListOptions = { page?: number; perPage?: number };

export function userQuery(input: UserSelector | string, pagination?: UserListOptions): { address?: string; username?: string; userId?: number; page?: number; perPage?: number } {
  const selector = typeof input === 'string' ? { address: input } : input;
  if (!selector || typeof selector !== 'object' || Object.keys(selector).some(key => !['address', 'username', 'userId'].includes(key)) ||
      [selector.address, selector.username, selector.userId].filter(value => value !== undefined).length !== 1) throw featureError('invalid_user_selector');
  const query = selector.address !== undefined ? { address: validAddress(selector.address) }
    : selector.userId !== undefined ? { userId: validUserId(selector.userId) }
      : { username: normalizeProfileUsername(selector.username ?? '') };
  if (pagination?.page !== undefined && (!Number.isSafeInteger(pagination.page) || pagination.page < 1)) throw featureError('invalid_pagination');
  if (pagination?.perPage !== undefined && (!Number.isInteger(pagination.perPage) || pagination.perPage < 1 || pagination.perPage > 100)) throw featureError('invalid_pagination');
  return { ...query, ...(pagination?.page === undefined ? {} : { page: pagination.page }), ...(pagination?.perPage === undefined ? {} : { perPage: pagination.perPage }) };
}
function validAddress(address: string): string {
  if (!isAddress(address, { strict: false })) throw featureError('invalid_address');
  return address.toLowerCase();
}
function validUserId(userId: number): number {
  if (!Number.isInteger(userId) || userId < 1 || userId > 2147483647) throw featureError('invalid_user_id');
  return userId;
}
