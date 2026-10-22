import { describe, expect, it } from 'vitest';
import { userQuery } from '../src/sdk/user-core.js';

describe('user query planning', () => {
  it('normalizes usernames and preserves user IDs', () => {
    expect(userQuery({ username: ' Artist ' })).toEqual({ username: 'artist' });
    expect(userQuery({ userId: 42 }, { page: 2, perPage: 10 })).toEqual({ userId: 42, page: 2, perPage: 10 });
  });
  it('keeps the legacy address argument and rejects invalid inputs before HTTP', () => {
    expect(userQuery('0x0000000000000000000000000000000000000001')).toEqual({ address: '0x0000000000000000000000000000000000000001' });
    expect(() => userQuery('artist')).toThrow('invalid_address');
    expect(() => userQuery({ userId: 0 })).toThrow('invalid_user_id');
    expect(() => userQuery({ username: 'artist' }, { page: 0 })).toThrow('invalid_pagination');
    expect(() => userQuery({ username: 'artist' }, { perPage: 101 })).toThrow('invalid_pagination');
  });
});
