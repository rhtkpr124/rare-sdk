import { isAddress } from 'viem';
import { isRecord } from './account-auth-core.js';
import { featureError, requireFeatureString as requireString } from './feature-error.js';
import type { RareAccountProfile, RareAccountProfilePatch } from './types/account.js';

function nullableText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw featureError(`invalid_${field}`);
  return value;
}

export function parseAccountProfile(value: unknown): RareAccountProfile {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.data.profile)) {
    throw featureError('invalid_profile_response');
  }
  const data = value.data;
  const profile = value.data.profile;
  const accountId = requireString(data.accountId, 'account_id');
  const address = requireString(data.address, 'address');
  if (!/^[1-9]\d*$/.test(accountId) || !isAddress(address, { strict: false })) {
    throw featureError('invalid_profile_identity');
  }
  return {
    accountId,
    address,
    username: requireString(data.username, 'username'),
    email: nullableText(data.email, 'email'),
    profile: {
      fullName: nullableText(profile.fullName, 'full_name'),
      bio: nullableText(profile.bio, 'bio'),
      avatar: nullableText(profile.avatar, 'avatar'),
      ...(profile.website === undefined ? {} : { website: nullableText(profile.website, 'website') }),
      ...(profile.twitterlink === undefined ? {} : { twitterLink: nullableText(profile.twitterlink, 'twitterlink') }),
      ...(profile.discordlink === undefined ? {} : { discordLink: nullableText(profile.discordlink, 'discordlink') }),
      ...(profile.instagramlink === undefined ? {} : { instagramLink: nullableText(profile.instagramlink, 'instagramlink') }),
      ...(profile.youtubelink === undefined ? {} : { youtubeLink: nullableText(profile.youtubelink, 'youtubelink') }),
      ...(profile.masthead_universal_token_id === undefined ? {} : { mastheadUniversalTokenId: nullableText(profile.masthead_universal_token_id, 'masthead_universal_token_id') }),
    },
  };
}

/** Checks the public patch shape; backend remains authoritative for field constraints. */
export function validateAccountProfilePatch(value: unknown): asserts value is RareAccountProfilePatch {
  if (!isRecord(value) || Object.keys(value).length === 0 ||
      Object.keys(value).some(key => key !== 'username' && key !== 'email' && key !== 'profile')) {
    throw featureError('invalid_profile_patch');
  }
  if ('username' in value && (typeof value.username !== 'string' || value.username.trim().length === 0)) {
    throw featureError('invalid_username');
  }
  if ('email' in value && (typeof value.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))) {
    throw featureError('invalid_email');
  }
  if ('profile' in value) {
    if (!isRecord(value.profile) || Object.keys(value.profile).length === 0 ||
        Object.entries(value.profile).some(([key, field]) =>
          !['fullName', 'bio', 'avatar', 'website', 'twitterLink', 'discordLink', 'instagramLink', 'youtubeLink', 'mastheadUniversalTokenId'].includes(key) || typeof field !== 'string')) {
      throw featureError('invalid_profile_patch');
    }
    if (typeof value.profile.bio === 'string' && value.profile.bio.length > 180) throw featureError('invalid_bio');
  }
}

/** Validate before any session refresh, upload or profile write. */
export function planAvatarUpload(buffer: Uint8Array, filename: string): { filename: string; contentType: string } {
  if (buffer.length === 0 || buffer.length > 5 * 1024 * 1024 ||
      !/^[^/\\]+\.(png|jpe?g|gif)$/i.test(filename) || filename.length > 255) {
    throw featureError('invalid_avatar_file');
  }
  const suffix = filename.split('.').at(-1)?.toLowerCase();
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => buffer[index] === byte);
  const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const gif = buffer[0] === 71 && buffer[1] === 73 && buffer[2] === 70 && buffer[3] === 56 &&
    (buffer[4] === 55 || buffer[4] === 57) && buffer[5] === 97;
  if (suffix === 'png' && png) return { filename, contentType: 'image/png' };
  if ((suffix === 'jpg' || suffix === 'jpeg') && jpeg) return { filename, contentType: 'image/jpeg' };
  if (suffix === 'gif' && gif) return { filename, contentType: 'image/gif' };
  throw featureError('invalid_avatar_file');
}

export function normalizeProfileUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 30) throw featureError('invalid_username');
  return normalized;
}

/** An uploaded avatar can be reused if the subsequent profile update fails. */
export class AvatarProfileUpdateError extends Error {
  readonly avatar: string;
  constructor(avatar: string, cause: unknown) {
    super('Avatar uploaded, but the profile update failed. Retry profile.update with the uploaded avatar URL.', { cause });
    this.name = 'AvatarProfileUpdateError';
    this.avatar = avatar;
  }
}

/** Translate SDK profile names at the HTTP boundary. */
export function profilePatchBody(patch: RareAccountProfilePatch): unknown {
  const { profile, ...account } = patch;
  if (profile === undefined) return account;
  const { twitterLink, discordLink, instagramLink, youtubeLink, mastheadUniversalTokenId, ...fields } = profile;
  return { ...account, profile: { ...fields,
    ...(twitterLink === undefined ? {} : { twitterlink: twitterLink }),
    ...(discordLink === undefined ? {} : { discordlink: discordLink }),
    ...(instagramLink === undefined ? {} : { instagramlink: instagramLink }),
    ...(youtubeLink === undefined ? {} : { youtubelink: youtubeLink }),
    ...(mastheadUniversalTokenId === undefined ? {} : { masthead_universal_token_id: mastheadUniversalTokenId }),
  } };
}
