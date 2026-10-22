import { isRecord } from './account-auth-core.js';
import { featureError, requireFeatureString as requireString } from './feature-error.js';
import type { RareUpload } from './types/account.js';

export function planUpload(file: Uint8Array | Blob, filename: string, contentType?: string): { file: Blob; filename: string } {
  const size = file instanceof Blob ? file.size : file.byteLength;
  const type = (contentType ?? (file instanceof Blob ? file.type : '')) || 'application/octet-stream';
  if (size === 0 || size > 250 * 1024 * 1024 || filename.length === 0 || filename.length > 255 ||
      /[/\\\r\n]/.test(filename) || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(type)) throw featureError('invalid_upload');
  return { file: file instanceof Blob ? file.slice(0, size, type) : new Blob([new Uint8Array(file)], { type }), filename };
}

export function parseUpload(value: unknown): RareUpload {
  if (!isRecord(value)) throw featureError('invalid_upload_response');
  const key = requireString(value.key, 'upload_key');
  const contentType = requireString(value.contentType, 'upload_content_type');
  if (!/^[a-f0-9]{64}$/.test(key) || typeof value.size !== 'number' || !Number.isSafeInteger(value.size) || value.size <= 0)
    throw featureError('invalid_upload_response');
  const metadata = { key, contentType, size: value.size };
  if (value.access === 'private') {
    if ('url' in value) throw featureError('invalid_upload_response');
    const uploadId = requireString(value.uploadId, 'upload_id');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(uploadId)) throw featureError('invalid_upload_response');
    return { ...metadata, access: 'private', uploadId };
  }
  if (value.access !== undefined && value.access !== 'public') throw featureError('invalid_upload_response');
  const url = requireString(value.url, 'upload_url');
  if (!URL.canParse(url)) throw featureError('invalid_upload_response');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw featureError('invalid_upload_response');
  return { ...metadata, access: 'public', url };
}

export function parseUploadSession(value: unknown): { id: string; uploadUrl: string; expiresAt: string } {
  if (!isRecord(value)) throw featureError('invalid_upload_response');
  const id = requireString(value.id, 'upload_id');
  const uploadUrl = requireString(value.uploadUrl, 'upload_url');
  const expiresAt = requireString(value.expiresAt, 'upload_expiry');
  if (!URL.canParse(uploadUrl)) throw featureError('invalid_upload_response');
  const url = new URL(uploadUrl);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || url.protocol !== 'https:' || url.hostname !== 'storage.googleapis.com' || url.username || url.password || !url.pathname.startsWith('/upload/storage/v1/') || !Number.isFinite(Date.parse(expiresAt))) throw featureError('invalid_upload_response');
  return { id, uploadUrl, expiresAt };
}
export function uploadedOffset(range: string | null, total: number): number {
  if (range === null) return 0;
  const match = /^bytes=0-([0-9]+)$/.exec(range);
  const offset = match === null ? NaN : Number(match[1]) + 1;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total) throw featureError('invalid_upload_progress');
  return offset;
}
