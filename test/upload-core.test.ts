import { describe, expect, it } from 'vitest';
import { parseUpload, planUpload, parseUploadSession, uploadedOffset } from '../src/sdk/upload-core.js';

describe('shared uploads', () => {
  it('accepts arbitrary binary files and Blob content types', () => {
    expect(planUpload(new Uint8Array([0, 1, 2]), 'asset.bin').file.type).toBe('application/octet-stream');
    expect(planUpload(new Blob(['hello'], { type: 'text/plain' }), 'notes.txt').file.type).toBe('text/plain');
  });
  it('rejects unsafe names, empty files and oversized files before I/O', () => {
    expect(() => planUpload(new Uint8Array(), 'empty')).toThrow();
    expect(() => planUpload(new Uint8Array([1]), '../asset')).toThrow();
    expect(() => planUpload(new Uint8Array(250 * 1024 * 1024 + 1), 'large')).toThrow();
  });
  it('parses private references without exposing URLs', () => {
    const result = { access: 'private', key: 'a'.repeat(64), contentType: 'application/pdf', size: 3 };
    expect(parseUpload(result)).toEqual(result);
    expect(() => parseUpload({ ...result, url: 'https://storage.googleapis.com/bucket/key' })).toThrow();
    expect(() => parseUpload({ ...result, access: 'unknown' })).toThrow();
  });
  it('parses stored metadata and rejects malformed results', () => {
    const result = { access: 'public', key: 'a'.repeat(64), url: 'https://storage.googleapis.com/bucket/key', contentType: 'application/octet-stream', size: 3 };
    expect(parseUpload(result)).toEqual(result);
    expect(() => parseUpload({ ...result, size: -1 })).toThrow();
    expect(() => parseUpload({ ...result, url: 'javascript:alert(1)' })).toThrow();
  });
});

describe('resumable upload boundaries', () => {
  it('validates GCS session URLs and committed offsets', () => {
    const session = { id: '00000000-0000-4000-8000-000000000001', uploadUrl: 'https://storage.googleapis.com/upload/storage/v1/b/bucket/o?upload_id=secret', expiresAt: '2026-10-15T12:00:00Z' };
    expect(parseUploadSession(session)).toEqual(session);
    expect(() => parseUploadSession({ ...session, uploadUrl: 'https://example.com/upload' })).toThrow();
    expect(uploadedOffset('bytes=0-8388607', 250 * 1024 * 1024)).toBe(8 * 1024 * 1024);
    expect(uploadedOffset(null, 1024)).toBe(0);
    for (const range of ['bytes=1-10', 'bytes=0-1023', 'bytes=0-1024', 'invalid']) expect(() => uploadedOffset(range, 1024)).toThrow();
  });
});
