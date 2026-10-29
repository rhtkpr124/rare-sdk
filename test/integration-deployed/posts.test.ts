import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { isPrivateKeyString } from '../../src/sdk/validation.js';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';
import { createRareClient } from '../../src/sdk/client.js';

const required = (name: string): string => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };
const wallet = (name: string) => { const key = required(name); if (!isPrivateKeyString(key)) throw new Error(`Invalid ${name}`); return privateKeyToAccount(key); };
const origin = () => {
  const url = new URL(required('RARE_ACCOUNT_TEST_API_URL'));
  if (url.protocol !== 'https:' || url.hostname === 'api.superrare.com' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Use a non-production HTTPS API origin');
  return url.origin;
};
const noEmail = (value: unknown): void => {
  if (Array.isArray(value)) value.forEach(noEmail);
  else if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) { expect(key.toLowerCase()).not.toContain('email'); noEmail(child); }
};

describe('creator posts against deployed services', () => {
  it('creates and reads publicly, comments across accounts, and favorites privately', async () => {
    const apiBaseUrl = origin();
    const ownerWallet = wallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const otherWallet = wallet('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    expect(ownerWallet.address.toLowerCase()).not.toBe(otherWallet.address.toLowerCase());
    const owner = createRareClient({ apiBaseUrl });
    const other = createRareClient({ apiBaseUrl });
    const api = createRareClient({ apiBaseUrl: apiBaseUrl });
    try {
    for (const [account, signer] of [[owner, ownerWallet], [other, otherWallet]] as const) await account.auth.loginWithWallet({ address: signer.address, chainId: 1, signMessage: message => signer.signMessage({ message }) });
    const profile = await owner.profile.get();
    const before = await other.postFavorites.list();
    const postInput = { title: `SDK integration ${Date.now()}`, body: '**Markdown** body', imageUrls: [] };
    const post = await owner.posts.create(postInput);
    try {
      expect(post.creatorUserId).toBe(profile.accountId);
      expect(await api.posts.get(post.id)).toMatchObject({ ...postInput, creatorUserId: profile.accountId });
      for (const selector of [{ address: ownerWallet.address }, { username: profile.username }, { userId: Number(profile.accountId) }]) {
        const page = await api.posts.list(selector, { perPage: 100 });
        expect(page.data.find(row => row.id === post.id)).toMatchObject({ ...postInput, creatorUserId: profile.accountId }); noEmail(page);
      }
      const comment = await other.posts.comment(post.id, { body: 'A public comment' });
      const comments = await api.posts.comments(post.id);
      expect(comments.data.find(row => row.id === comment.id)).toMatchObject({ postId: post.id, body: 'A public comment', authorUserId: (await other.profile.get()).accountId }); noEmail(comments);
      await Promise.all([other.postFavorites.add(post.id), other.postFavorites.add(post.id)]);
      expect(await other.postFavorites.has(post.id)).toBe(true);
      expect(await owner.postFavorites.has(post.id)).toBe(false);
      expect((await api.posts.get(post.id)).likeCount).toBe(1);
      expect((await other.postFavorites.list()).data.some(row => row.id === post.id)).toBe(true);
      await other.postFavorites.remove(post.id);
      await other.postFavorites.remove(post.id);
      expect(await other.postFavorites.list()).toEqual(before);
      expect(await other.postFavorites.has(post.id)).toBe(false);
      expect((await api.posts.get(post.id)).likeCount).toBe(0);
      await other.posts.deleteComment(post.id, comment.id);
      expect((await api.posts.comments(post.id)).data).toEqual([]);
    } finally { await owner.posts.delete(post.id); }
    await expect(api.posts.get(post.id)).rejects.toMatchObject({ status: 404 });
    await expect(api.posts.comments(post.id)).rejects.toMatchObject({ status: 404 });
    } finally { await Promise.all([owner.auth.logout(), other.auth.logout()]); }
  }, 180_000);

  it('rejects forged actors, other-account deletes, and private favorite selectors', async () => {
    const apiBaseUrl = origin();
    const ownerWallet = wallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const otherWallet = wallet('RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY');
    const owner = createRareClient({ apiBaseUrl });
    const other = createRareClient({ apiBaseUrl });
    try {
    const ownerSession = await owner.auth.loginWithWallet({ address: ownerWallet.address, chainId: 1, signMessage: message => ownerWallet.signMessage({ message }) });
    const otherSession = await other.auth.loginWithWallet({ address: otherWallet.address, chainId: 1, signMessage: message => otherWallet.signMessage({ message }) });
    const post = await owner.posts.create({ title: 'Authorization integration', body: 'Body' });
    try {
      const comment = await owner.posts.comment(post.id, { body: 'Owned comment' });
      await expect(other.posts.delete(post.id)).rejects.toMatchObject({ status: 403 });
      await expect(other.posts.deleteComment(post.id, comment.id)).rejects.toMatchObject({ status: 403 });
      const request = (path: string, method: string, token?: string, body?: unknown) => fetch(`${apiBaseUrl}${path}`, { method, signal: AbortSignal.timeout(30_000), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      for (const token of [undefined, 'invalid-token']) {
        expect((await request('/v1/posts', 'POST', token, { title: 'Forged', body: 'Body' })).status).toBe(401);
        expect((await request('/v1/me/post-favorites', 'GET', token)).status).toBe(401);
        expect((await request(`/v1/posts/${post.id}/comments`, 'POST', token, { body: 'Forged' })).status).toBe(401);
        expect((await request(`/v1/me/post-favorites/${post.id}`, 'PUT', token)).status).toBe(401);
      }
      expect((await request('/v1/posts', 'POST', otherSession.accessToken, { title: 'Forged', body: 'Body', creatorUserId: post.creatorUserId })).status).toBe(400);
      expect((await request(`/v1/posts/${post.id}/comments`, 'POST', otherSession.accessToken, { body: 'Forged', authorUserId: post.creatorUserId })).status).toBe(400);
      for (const query of ['userId=1', 'username=other', `address=${otherWallet.address}`]) expect((await request(`/v1/me/post-favorites?${query}`, 'GET', ownerSession.accessToken)).status).toBe(400);
      expect((await request(`/v1/posts/${post.id}/favorites`, 'GET')).status).toBe(404);
      await owner.posts.deleteComment(post.id, comment.id);
    } finally { await owner.posts.delete(post.id); }
    } finally { await Promise.all([owner.auth.logout(), other.auth.logout()]); }
  }, 180_000);
});


describe('creator post images and pagination against deployed services', () => {
  it('round-trips an uploaded image and traverses posts, comments and favorites without missing or repeating records', async () => {
    const apiBaseUrl = origin();
    const signer = wallet('RARE_ACCOUNT_TEST_PRIVATE_KEY');
    const account = createRareClient({ apiBaseUrl });
    const api = createRareClient({ apiBaseUrl: apiBaseUrl });
    const postIds: string[] = [];
    const commentIds: string[] = [];
    const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const comment = Buffer.from(randomBytes(16).toString('hex'));
    const bytes = Buffer.concat([gif.subarray(0, -1), Buffer.from([0x21, 0xfe, comment.length]), comment, Buffer.from([0, 0x3b])]);
    const key = createHash('sha256').update(bytes).digest('hex');
    execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'buckets', 'describe', 'gs://rare-api-public-upload-dev', '--format=value(name)'], { stdio: 'pipe' });
    try {
      await account.auth.loginWithWallet({ address: signer.address, chainId: 1, signMessage: message => signer.signMessage({ message }) });
      const profile = await account.profile.get();
      const upload = await account.upload(bytes, 'post.gif', { contentType: 'image/gif' });
      expect(Buffer.from(await (await fetch(upload.url)).arrayBuffer())).toEqual(bytes);
      for (const index of [0, 1, 2]) {
        const post = await account.posts.create({ title: `Image pagination ${Date.now()} ${index}`, body: 'Live pagination fixture', imageUrls: [upload.url] });
        // eslint-disable-next-line functional/immutable-data
        postIds.push(post.id);
        expect((await api.posts.get(post.id)).imageUrls).toEqual([upload.url]);
        await account.postFavorites.add(post.id);
      }
      const firstPostId = postIds[0];
      if (!firstPostId) throw new Error('Missing created post');
      for (const index of [0, 1, 2]) {
        const row = await account.posts.comment(firstPostId, { body: `Pagination comment ${index}` });
        // eslint-disable-next-line functional/immutable-data
        commentIds.push(row.id);
      }
      const verifyPages = async (read: (page: number) => Promise<{ data: { id: string }[]; pagination: { totalCount: number; totalPages: number } }>, expectedIds: string[]): Promise<void> => {
        const first = await read(1);
        expect(first.data).toHaveLength(2);
        expect(first.pagination.totalPages).toBeGreaterThanOrEqual(2);
        const pages = await Promise.all(Array.from({ length: first.pagination.totalPages }, (_, index) => read(index + 1)));
        const ids = pages.flatMap(page => page.data.map(row => row.id));
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toHaveLength(first.pagination.totalCount);
        for (const id of expectedIds) expect(ids).toContain(id);
        for (const page of pages) expect(page.pagination.totalCount).toBe(first.pagination.totalCount);
        const beyond = await read(first.pagination.totalPages + 1);
        expect(beyond.data).toEqual([]);
        expect(beyond.pagination.totalCount).toBe(first.pagination.totalCount);
      };
      await verifyPages(page => api.posts.list({ userId: Number(profile.accountId) }, { page, perPage: 2 }), postIds);
      await verifyPages(page => api.posts.comments(firstPostId, { page, perPage: 2 }), commentIds);
      await verifyPages(page => account.postFavorites.list({ page, perPage: 2 }), postIds);
    } finally {
      for (const id of postIds) {
        await account.postFavorites.remove(id);
        await account.posts.delete(id);
      }
      await account.auth.logout();
      try {
        execFileSync('gcloud', ['--project=superrare-dev', 'storage', 'rm', `gs://rare-api-public-upload-dev/${key}`], { stdio: 'pipe' });
      } catch (error) {
        const stderr = error !== null && typeof error === 'object' && 'stderr' in error && error.stderr instanceof Uint8Array ? Buffer.from(error.stderr).toString('utf8') : '';
        if (!/No URLs matched|URLs matched no objects or files|NotFoundException|HTTPError 404|does not exist/.test(stderr)) throw error;
      }
    }
  }, 240_000);
});


describe('threaded post replies against deployed services', () => {
  it('retrieves saved replies, verifies cursor pages and counts, and cascades root deletion', async () => {
    const apiBaseUrl = origin();
    const owner = createRareClient({ apiBaseUrl });
    const other = createRareClient({ apiBaseUrl });
    const api = createRareClient({ apiBaseUrl: apiBaseUrl });
    try {
      for (const [account, name] of [[owner, 'RARE_ACCOUNT_TEST_PRIVATE_KEY'], [other, 'RARE_ACCOUNT_TEST_SECOND_PRIVATE_KEY']] as const) {
        const signer = wallet(name);
        await account.auth.loginWithWallet({ address: signer.address, chainId: 1, signMessage: message => signer.signMessage({ message }) });
      }
      const post = await owner.posts.create({ title: 'Reply integration', body: 'Threads' });
      try {
        const root = await other.posts.comment(post.id, { body: 'Root' });
        const secondRoot = await owner.posts.comment(post.id, { body: 'Other root' });
        const first = await owner.posts.comment(post.id, { body: 'First reply', parentCommentId: root.id });
        const second = await owner.posts.comment(post.id, { body: 'Second reply', parentCommentId: root.id });
        const third = await owner.posts.comment(post.id, { body: 'Third reply', parentCommentId: root.id });
        expect(first).toMatchObject({ parentCommentId: root.id, replyCount: 0 });
        expect((await api.posts.get(post.id)).commentCount).toBe(5);
        const roots = await api.posts.comments(post.id);
        expect(roots.data).toMatchObject([{ id: root.id, parentCommentId: null, replyCount: 3 }, { id: secondRoot.id, replyCount: 0 }]);
        expect(roots.pagination.totalCount).toBe(2);
        const page = await api.posts.comments(post.id, { parentCommentId: root.id, perPage: 2 });
        expect(page.data.map(row => row.id)).toEqual([first.id, second.id]);
        expect(page.pagination.totalCount).toBe(3);
        expect(page.nextCursor).toBe(second.id);
        const last = await api.posts.comments(post.id, { parentCommentId: root.id, afterCommentId: second.id, perPage: 2 });
        expect(last.data.map(row => row.id)).toEqual([third.id]);
        expect(last.nextCursor).toBeNull();
        await expect(owner.posts.comment(post.id, { body: 'Nested', parentCommentId: first.id })).rejects.toMatchObject({ status: 404 });
        await expect(owner.posts.deleteComment(post.id, root.id)).rejects.toMatchObject({ status: 403 });
        await owner.posts.deleteComment(post.id, second.id);
        expect((await api.posts.comments(post.id)).data[0]?.replyCount).toBe(2);
        expect((await api.posts.comments(post.id, { parentCommentId: root.id, afterCommentId: second.id, perPage: 2 })).data.map(row => row.id)).toEqual([third.id]);
        await other.posts.deleteComment(post.id, root.id);
        expect((await api.posts.get(post.id)).commentCount).toBe(1);
        expect((await api.posts.comments(post.id)).data.map(row => row.id)).toEqual([secondRoot.id]);
        await expect(api.posts.comments(post.id, { parentCommentId: root.id })).rejects.toMatchObject({ status: 404 });
      } finally { await owner.posts.delete(post.id); }
    } finally { await owner.auth.logout(); await other.auth.logout(); }
  }, 180_000);
});
