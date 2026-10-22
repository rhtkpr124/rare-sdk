import type { RareNotificationsClient } from './notifications.js';
import type { RareMessagingClient } from './messaging.js';
import type { DropAnnouncement, CreateDropInput, UpdateDropInput } from '../drops-core.js';
import type { CreatorPost, CreatorPostComment, CreatePostInput } from '../posts-core.js';
import type { ArtworkFavorite, FavoriteArtworkInput, FavoritesListOptions } from '../favorites-core.js';
import type { SearchPageResponse } from '../api.js';
import type { UserSelector } from '../user-core.js';
/** Sensitive credentials. Never print this object in logs or status output. */
export type RareAccountSession = {
  revision: string;
  authBaseUrl: string;
  apiBaseUrl: string;
  clientId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  /** A refresh may have consumed its credential; only explicit login can restore renewal. */
  refreshBlocked?: true;
};

/**
 * Storage is bound to the configured authority and client. Persistent implementations
 * must serialize the entire operation across processes (including refresh requests).
 * Values read from storage are validated by the SDK.
 */
export type RareAccountSessionStore = {
  get: () => Promise<unknown>;
  set: (session: RareStoredAccountSession) => Promise<void>;
  clear: () => Promise<void>;
  withLock: <T>(operation: () => Promise<T>) => Promise<T>;
};

export type RareStoredAccountSession = RareAccountSession | {
  authBaseUrl: string; apiBaseUrl: string; clientId: string; revision: string; loggedOut: true;
};

export type RareDeviceAuthorization = {
  sessionRevision: string | null;
  authBaseUrl: string;
  apiBaseUrl: string;
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresAt: number;
  interval: number;
  nextPollAt: number;
};

export type RareDevicePollResult =
  | { status: 'pending'; authorization: RareDeviceAuthorization }
  | { status: 'retry'; authorization: RareDeviceAuthorization }
  | { status: 'slow_down'; authorization: RareDeviceAuthorization }
  | { status: 'authorized'; session: RareAccountSession };

export type RareWalletLoginOptions = {
  address: string;
  chainId: number;
  /** Defaults to the browser origin, or the API origin for non-browser signing. */
  signingOrigin?: string;
  signMessage: (message: string) => Promise<string>;
};

/** Sends API-relative paths using authentication owned by the application. */
export type RareAccountTransport = (path: string, init: RequestInit) => Promise<Response>;

export type RareAccountTransportOptions = {
  transport: RareAccountTransport;
  /** Used only for signed storage transfers, never for authenticated API requests. */
  fetch?: typeof globalThis.fetch;
};

export type RareAccountFeatures = Omit<RareAccountClient, 'auth'>;

export type RareAccountClientOptions = {
  /** Public API base; auth uses its /auth/v2 routes. Defaults to https://api.superrare.com. */
  apiBaseUrl?: string;
  clientId?: string;
  sessionStore?: RareAccountSessionStore;
  fetch?: typeof globalThis.fetch;
};

export type RareAccountProfile = {
  accountId: string;
  address: string;
  username: string;
  email: string | null;
  profile: {
    fullName: string | null;
    bio: string | null;
    avatar: string | null;
    website?: string | null;
    twitterlink?: string | null;
    discordlink?: string | null;
    instagramlink?: string | null;
    youtubelink?: string | null;
    masthead_universal_token_id?: string | null;
  };
};

export type RareAccountProfilePatch = {
  username?: string;
  email?: string;
  profile?: {
    fullName?: string;
    bio?: string;
    avatar?: string;
    website?: string;
    twitterlink?: string;
    discordlink?: string;
    instagramlink?: string;
    youtubelink?: string;
    masthead_universal_token_id?: string;
  };
};

export type RareAuthRequestOptions = { signal?: AbortSignal };

export type RarePublicUpload = { access: 'public'; key: string; url: string; contentType: string; size: number };
export type RarePrivateUpload = { access: 'private'; key: string; contentType: string; size: number };
export type RareUpload = RarePublicUpload | RarePrivateUpload;
export type RareUploadOptions = RareAuthRequestOptions & { contentType?: string; access?: 'public' | 'private' };
export type RareUploadMethod = {
  (file: Uint8Array | Blob, filename: string, options?: RareUploadOptions & { access?: 'public' }): Promise<RarePublicUpload>;
  (file: Uint8Array | Blob, filename: string, options: RareUploadOptions & { access: 'private' }): Promise<RarePrivateUpload>;
  (file: Uint8Array | Blob, filename: string, options: RareUploadOptions): Promise<RareUpload>;
};

export type RareAccountClient = {
  messaging: RareMessagingClient;
  notifications: RareNotificationsClient;
  drops: {
    create: (input: CreateDropInput, options?: RareAuthRequestOptions) => Promise<DropAnnouncement>;
    update: (dropId: string, input: UpdateDropInput, options?: RareAuthRequestOptions) => Promise<DropAnnouncement>;
    delete: (dropId: string, options?: RareAuthRequestOptions) => Promise<void>;
  };
  posts: {
    create: (input: CreatePostInput, options?: RareAuthRequestOptions) => Promise<CreatorPost>;
    comment: (postId: string, body: string, options?: RareAuthRequestOptions & { parentCommentId?: string }) => Promise<CreatorPostComment>;
    delete: (postId: string, options?: RareAuthRequestOptions) => Promise<void>;
    deleteComment: (postId: string, commentId: string, options?: RareAuthRequestOptions) => Promise<void>;
  };
  postFavorites: {
    list: (options?: FavoritesListOptions & RareAuthRequestOptions) => Promise<SearchPageResponse<CreatorPost>>;
    has: (postId: string, options?: RareAuthRequestOptions) => Promise<boolean>;
    add: (postId: string, options?: RareAuthRequestOptions) => Promise<void>;
    remove: (postId: string, options?: RareAuthRequestOptions) => Promise<void>;
  };
  favorites: {
    list: (options?: FavoritesListOptions & RareAuthRequestOptions) => Promise<SearchPageResponse<ArtworkFavorite>>;
    has: (input: FavoriteArtworkInput, options?: RareAuthRequestOptions) => Promise<boolean>;
    add: (input: FavoriteArtworkInput, options?: RareAuthRequestOptions) => Promise<void>;
    remove: (input: FavoriteArtworkInput, options?: RareAuthRequestOptions) => Promise<void>;
  };
  following: {
    follow: (input: UserSelector | string, options?: RareAuthRequestOptions) => Promise<void>;
    unfollow: (input: UserSelector | string, options?: RareAuthRequestOptions) => Promise<void>;
  };
  uploads: {
    upload: RareUploadMethod;
  };
  auth: {
    startDeviceAuthorization: (options?: RareAuthRequestOptions) => Promise<RareDeviceAuthorization>;
    pollDeviceAuthorization: (authorization: RareDeviceAuthorization, options?: RareAuthRequestOptions) => Promise<RareDevicePollResult>;
    waitForDeviceAuthorization: (authorization: RareDeviceAuthorization, options?: RareAuthRequestOptions) => Promise<RareAccountSession>;
    loginWithWallet: (options: RareWalletLoginOptions & RareAuthRequestOptions) => Promise<RareAccountSession>;
    getSession: () => Promise<RareAccountSession | null>;
    refresh: (options?: RareAuthRequestOptions) => Promise<RareAccountSession>;
    logout: (options?: RareAuthRequestOptions) => Promise<void>;
    clearSession: () => Promise<void>;
  };
  profile: {
    get: (options?: RareAuthRequestOptions) => Promise<RareAccountProfile>;
    uploadAvatar: (buffer: Uint8Array, filename: string, options?: RareAuthRequestOptions) => Promise<RareAccountProfile>;
    update: (patch: RareAccountProfilePatch, options?: RareAuthRequestOptions) => Promise<RareAccountProfile>;
  };
};
