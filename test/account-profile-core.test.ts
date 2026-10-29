import { describe, expect, it } from 'vitest';
import { planAvatarUpload, profilePatchBody, validateAccountProfilePatch } from '../src/sdk/account-profile-core.js';

describe('profile patch and avatar planning', () => {
  it('accepts private email, camelCase social metadata names and explicit clearing', () => {
    expect(() => validateAccountProfilePatch({ email: 'owner@example.com', profile: {
      website: 'https://example.com', twitterLink: 'https://x.com/owner',
      avatar: '', mastheadUniversalTokenId: '',
    } })).not.toThrow();
    expect(() => validateAccountProfilePatch({ email: '' })).toThrow();
  });
  it('maps camelCase fields to the existing API wire contract and retains clearing', () => {
    expect(profilePatchBody({ profile: { fullName: 'Artist', twitterLink: '', mastheadUniversalTokenId: '1-0xabc-1' } })).toEqual({ profile: { fullName: 'Artist', twitterlink: '', masthead_universal_token_id: '1-0xabc-1' } });
    expect(() => validateAccountProfilePatch({ profile: { twitterlink: 'old' } })).toThrow();
  });
  it('rejects empty patches, privileged keys and bios longer than website limits', () => {
    expect(() => validateAccountProfilePatch({})).toThrow();
    expect(() => validateAccountProfilePatch({ profile: { isCreator: true } })).toThrow();
    expect(() => validateAccountProfilePatch({ profile: { bio: 'x'.repeat(181) } })).toThrow();
    expect(() => validateAccountProfilePatch({ email: 'invalid' })).toThrow();
    expect(() => validateAccountProfilePatch({ profile: { bio: 'x'.repeat(180) } })).not.toThrow();
  });
  it('requires an allowed filename, matching image header and bounded bytes', () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(planAvatarUpload(png, 'avatar.png')).toEqual({ filename: 'avatar.png', contentType: 'image/png' });
    expect(() => planAvatarUpload(png, '../avatar.png')).toThrow();
    expect(() => planAvatarUpload(png, 'avatar.gif')).toThrow();
    expect(() => planAvatarUpload(new Uint8Array(0), 'avatar.png')).toThrow();
    expect(() => planAvatarUpload(new Uint8Array(5 * 1024 * 1024 + 1), 'avatar.png')).toThrow();
  });
});
