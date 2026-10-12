import { isRecord, RareAuthError, requireString } from './account-auth-core.js';
import type { RareUpload } from './types/account.js';

export function planUpload(file: Uint8Array | Blob, filename: string, contentType?: string): { file: Blob; filename: string } {
  const size = file instanceof Blob ? file.size : file.byteLength;
  const type = (contentType ?? (file instanceof Blob ? file.type : '')) || 'application/octet-stream';
  if (size === 0 || size > 20 * 1024 * 1024 || filename.length === 0 || filename.length > 255 ||
      /[/\\\r\n]/.test(filename) || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(type)) throw new RareAuthError('invalid_upload');
  return { file: file instanceof Blob ? file.slice(0, size, type) : new Blob([new Uint8Array(file)], { type }), filename };
}

export function parseUpload(value: unknown): RareUpload {
  if (!isRecord(value)) throw new RareAuthError('invalid_upload_response');
  const key = requireString(value.key, 'upload_key');
  const contentType = requireString(value.contentType, 'upload_content_type');
  if (!/^[a-f0-9]{64}$/.test(key) || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0)
    throw new RareAuthError('invalid_upload_response');
  const metadata = { key, contentType, size: value.size };
  if (value.access === 'private') {
    if ('url' in value) throw new RareAuthError('invalid_upload_response');
    return { ...metadata, access: 'private' };
  }
  if (value.access !== undefined && value.access !== 'public') throw new RareAuthError('invalid_upload_response');
  const url = requireString(value.url, 'upload_url');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new RareAuthError('invalid_upload_response');
  return { ...metadata, access: 'public', url };
}
