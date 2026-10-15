import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { parseUploadSession } from '../../src/sdk/upload-core.js';
import { isPrivateKeyString } from '../../src/sdk/validation.js';
import { createRareAccountClient } from '../../src/sdk/account-client.js';

const deployedAccount = () => {
  const api = process.env.RARE_ACCOUNT_TEST_API_URL;
  const secret = process.env.RARE_ACCOUNT_TEST_PRIVATE_KEY;
  if (!api || !secret || !/^0x[0-9a-fA-F]{64}$/.test(secret)) throw new Error('Configure deployed account test API and wallet');
  const origin = new URL(api);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password || origin.hostname === 'api.superrare.com') throw new Error('Use a dev feature API origin');
  const wallet = privateKeyToAccount(secret as `0x${string}`);
  return { api: origin.origin, wallet, client: createRareAccountClient({ apiBaseUrl: origin.origin }) };
};

const objectKey = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const removeObject = (key: string, access: 'public' | 'private'): void => {
  if (!/^(?:[a-f0-9]{64}|pending\/rare-api\/[0-9a-f-]{36})$/.test(key)) throw new Error('Invalid test object key');
  try {
    execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'rm', `gs://rare-api-${access}-upload-dev/${key}`], { stdio: 'pipe' });
  } catch (error) {
    // Rejected requests and failures before storage have no object to delete.
    const stderr = error !== null && typeof error === 'object' && 'stderr' in error && error.stderr instanceof Uint8Array
      ? Buffer.from(error.stderr).toString('utf8') : '';
    if (!/No URLs matched|URLs matched no objects or files|NotFoundException|HTTPError 404|does not exist/.test(stderr)) throw error;
  }
};

const withLiveAccount = async (operation: (account: ReturnType<typeof deployedAccount>, track: (bytes: Uint8Array) => void) => Promise<void>): Promise<void> => {
  const account = deployedAccount();
  // Fail before writes if cleanup access is unavailable.
  execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'buckets', 'describe', 'gs://rare-api-public-upload-dev', '--format=value(name)'], { stdio: 'pipe' });
  execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'buckets', 'describe', 'gs://rare-api-private-upload-dev', '--format=value(name)'], { stdio: 'pipe' });
  const keys = new Set<string>();
  const track = (bytes: Uint8Array): void => {
    // Register the intended key before transmission, including ambiguous failures.
    // eslint-disable-next-line functional/immutable-data
    keys.add(objectKey(bytes));
  };
  try {
    await account.client.auth.loginWithWallet({ address: account.wallet.address, chainId: 1, signMessage: message => account.wallet.signMessage({ message }) });
    await operation(account, track);
  } finally {
    const cleanup = await Promise.allSettled([
      account.client.auth.logout(),
      ...[...keys].flatMap(key => [Promise.resolve().then(() => removeObject(key, 'public')), Promise.resolve().then(() => removeObject(key, 'private'))]),
    ]);
    const failed = cleanup.filter(result => result.status === 'rejected');
    if (failed.length > 0) throw new AggregateError(failed.map(result => result.reason), 'Live upload cleanup failed');
  }
};

const uploadRequest = (api: string, bytes: Uint8Array, authorization?: string, fields?: Record<string, unknown>) => fetch(`${api}/v1/uploads`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { authorization } : {}) },
  body: JSON.stringify({ size: bytes.length, contentType: 'application/octet-stream', ...fields }), signal: AbortSignal.timeout(60_000),
});

describe('uploads through deployed API and real GCS', () => {
  it('deduplicates concurrent uploads, preserves stored metadata, and does not edit profiles', async () => {
    await withLiveAccount(async ({ client }, track) => {
      const bytes = randomBytes(1024);
      track(bytes);
      const before = await client.profile.get();
      const results = await Promise.all([client.uploads.upload(bytes, 'first.bin'), client.uploads.upload(bytes, 'second.bin')]);
      expect(results[0]).toEqual(results[1]);
      expect(results[0]).toMatchObject({ key: objectKey(bytes), size: bytes.length, contentType: 'application/octet-stream' });
      expect(await client.uploads.upload(bytes, 'pretend.png', { contentType: 'image/png' })).toEqual(results[0]);
      expect(await client.profile.get()).toEqual(before);
      const downloaded = await fetch(results[0]!.url, { signal: AbortSignal.timeout(30_000) });
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get('content-disposition')).toContain('attachment');
      expect(downloaded.headers.get('cache-control')).toContain('immutable');
      expect(downloaded.headers.get('content-type')).toContain('application/octet-stream');
      expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
    });
  }, 180_000);

  it('uploads beyond Cloud Run request limits using multiple direct GCS chunks', async () => {
    await withLiveAccount(async ({ client }, track) => {
      const bytes = randomBytes(33 * 1024 * 1024); track(bytes);
      const result = await client.uploads.upload(bytes, 'video.mp4', { contentType: 'video/mp4' });
      expect(result).toMatchObject({ key: objectKey(bytes), size: bytes.length, contentType: 'video/mp4' });
      const downloaded = new Uint8Array(await (await fetch(result.url)).arrayBuffer());
      expect(downloaded.byteLength).toBe(bytes.length);
      expect(objectKey(downloaded)).toBe(objectKey(bytes));
    });
  }, 240_000);

  it('binds finalization to the initiating account and keeps pending objects private', async () => {
    await withLiveAccount(async ({ api, client }, track) => {
      const bytes = randomBytes(1024); track(bytes);
      const session = await client.auth.getSession(); if (!session) throw new Error('Missing live session');
      const started = await uploadRequest(api, bytes, `Bearer ${session.accessToken}`); expect(started.status).toBe(201);
      const input: unknown = await started.json(); const pending = parseUploadSession(input);
      const otherKey = process.env.RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY;
      if (!otherKey || !isPrivateKeyString(otherKey)) throw new Error('Configure the second existing account wallet');
      const otherWallet = privateKeyToAccount(otherKey); const other = createRareAccountClient({ apiBaseUrl: api });
      const complete = (authorization?: string) => fetch(`${api}/v1/uploads/${pending.id}/complete`, { method: 'POST', headers: authorization ? { authorization } : {} });
      try {
        const otherSession = await other.auth.loginWithWallet({ address: otherWallet.address, chainId: 1, signMessage: message => otherWallet.signMessage({ message }) });
        expect((await complete()).status).toBe(401);
        expect((await complete(`Bearer ${otherSession.accessToken}`)).status).toBe(404);
        expect((await complete(`Bearer ${session.accessToken}`)).status).toBe(409);
        const uploaded = await fetch(pending.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes 0-${bytes.length - 1}/${bytes.length}` }, body: bytes });
        expect([200, 201]).toContain(uploaded.status);
        const staged = `https://storage.googleapis.com/rare-api-private-upload-dev/pending/rare-api/${pending.id}`;
        expect((await fetch(staged)).status).toBe(403);
        const completed = await complete(`Bearer ${session.accessToken}`); expect(completed.status).toBe(200);
        const result: unknown = await completed.json(); expect(await (await complete(`Bearer ${session.accessToken}`)).json()).toEqual(result);
      } finally { await other.auth.logout(); removeObject(`pending/rare-api/${pending.id}`, 'private'); }
    });
  }, 180_000);

  it('isolates private files from public storage and denies anonymous private downloads', async () => {
    await withLiveAccount(async ({ client }, track) => {
      const bytes = randomBytes(1024);
      track(bytes);
      const privateAsset = await client.uploads.upload(bytes, 'document.bin', { access: 'private' });
      expect(privateAsset).toEqual({ access: 'private', key: objectKey(bytes), contentType: 'application/octet-stream', size: bytes.length });
      const privateUrl = `https://storage.googleapis.com/rare-api-private-upload-dev/${privateAsset.key}`;
      const denied = await fetch(privateUrl, { signal: AbortSignal.timeout(30_000) });
      expect(denied.status).toBe(403);
      const publicUrl = `https://storage.googleapis.com/rare-api-public-upload-dev/${privateAsset.key}`;
      expect((await fetch(publicUrl, { signal: AbortSignal.timeout(30_000) })).status).toBe(404);
      const publicAsset = await client.uploads.upload(bytes, 'document.bin', { access: 'public' });
      expect(publicAsset.key).toBe(privateAsset.key);
      expect(publicAsset.url).toBe(publicUrl);
      expect(Buffer.from(await (await fetch(publicAsset.url)).arrayBuffer())).toEqual(bytes);
      expect((await fetch(privateUrl)).status).toBe(403);
      expect(await client.uploads.upload(bytes, 'duplicate.bin', { access: 'private' })).toEqual(privateAsset);
      const metadata: unknown = JSON.parse(execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'objects', 'describe', `gs://rare-api-private-upload-dev/${privateAsset.key}`, '--format=json'], { encoding: 'utf8' }));
      if (metadata === null || typeof metadata !== 'object' || !('cache_control' in metadata)) throw new Error('Missing private storage cache metadata');
      expect(metadata.cache_control).toBe('private, no-store');
    });
  }, 180_000);

  it('uploads an avatar through shared storage, attaches it, and clears it without changing other fields', async () => {
    await withLiveAccount(async ({ client }, track) => {
      const before = await client.profile.get();
      // Add a valid GIF comment extension before the trailer to give this run unique bytes.
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      const comment = Buffer.from(randomBytes(16).toString('hex'));
      const bytes = Buffer.concat([gif.subarray(0, -1), Buffer.from([0x21, 0xfe, comment.length]), comment, Buffer.from([0, 0x3b])]);
      track(bytes);
      try {
        const updated = await client.profile.uploadAvatar(bytes, 'avatar.gif');
        expect(updated.profile.avatar).toBe(`https://storage.googleapis.com/rare-api-public-upload-dev/${objectKey(bytes)}`);
        expect(updated).toEqual({ ...before, profile: { ...before.profile, avatar: updated.profile.avatar } });
        expect(await client.profile.get()).toEqual(updated);
        const downloaded = await fetch(updated.profile.avatar!, { signal: AbortSignal.timeout(30_000) });
        expect(downloaded.status).toBe(200);
        expect(Buffer.from(await downloaded.arrayBuffer())).toEqual(bytes);
        const cleared = await client.profile.update({ profile: { avatar: '' } });
        expect(cleared).toEqual({ ...before, profile: { ...before.profile, avatar: '' } });
        expect(await client.profile.get()).toEqual(cleared);
      } finally {
        await client.profile.update({ profile: { avatar: before.profile.avatar ?? '' } });
      }
    });
  }, 180_000);

  it('rejects unauthenticated, empty, oversized and unexpected-field uploads at the live HTTP boundary', async () => {
    await withLiveAccount(async ({ api, client }, track) => {
      const session = await client.auth.getSession();
      if (!session) throw new Error('Missing live session');
      const authorization = `Bearer ${session.accessToken}`;
      const bytes = randomBytes(1024);
      track(bytes);
      for (const credential of [undefined, 'Bearer forged']) expect((await uploadRequest(api, bytes, credential)).status).toBe(401);
      expect((await uploadRequest(api, bytes, authorization, { accountId: 'another-account' })).status).toBe(400);
      expect((await uploadRequest(api, bytes, authorization, { access: 'invalid' })).status).toBe(400);
      expect((await uploadRequest(api, new Uint8Array(), authorization)).status).toBe(400);
      const tooLarge = 250 * 1024 * 1024 + 1;
      // Bypass SDK prevalidation so the deployed server must reject the request.
      expect((await uploadRequest(api, bytes, authorization, { size: tooLarge })).status).toBe(400);
    });
  }, 180_000);
});
