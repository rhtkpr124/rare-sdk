import { normalizeAuthBaseUrl } from './account-auth-core.js';
import { DEFAULT_RARE_API_BASE_URL } from '../data-access/base-url.js';
import { createRareClient } from './client.js';
import type { RareAccountClient, RareAccountClientOptions, RareAccountFeatures, RareAccountTransportOptions } from './types/account.js';

/** @deprecated Use createRareClient for public, account and optional chain features. */
export function createRareAccountClient(options: RareAccountTransportOptions): RareAccountFeatures;
/** @deprecated Use createRareClient for public, account and optional chain features. */
export function createRareAccountClient(options?: RareAccountClientOptions): RareAccountClient;
export function createRareAccountClient(options: RareAccountClientOptions | RareAccountTransportOptions = {}): RareAccountClient | RareAccountFeatures {
  if (!('transport' in options)) normalizeAuthBaseUrl(options.apiBaseUrl ?? DEFAULT_RARE_API_BASE_URL);
  return 'transport' in options
    ? createRareClient({ transport: options.transport, apiFetch: options.fetch })
    : createRareClient({ ...options, apiFetch: options.fetch });
}
