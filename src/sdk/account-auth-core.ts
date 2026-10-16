/** Authentication transport helpers; no network or storage side effects. */
export function normalizeAuthBaseUrl(value: string): string {
  const url = new URL(value);
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('Authentication requires HTTPS (HTTP is allowed only on loopback).');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Authentication URLs cannot contain credentials, query parameters, or fragments.');
  }
  return url.href.replace(/\/+$/, '');
}

export function joinAuthPath(baseUrl: string, path: string): string {
  return `${baseUrl}/${path.replace(/^\/+/, '')}`;
}

/** The trailing slash prevents an /api credential from reaching /api-other. */
export function isAccountRequestAuthority(target: URL, authority: URL): boolean {
  const basePath = `${authority.pathname.replace(/\/+$/, '')}/`;
  return target.origin === authority.origin && target.pathname.startsWith(basePath) &&
    target.username === '' && target.password === '';
}

export function resolveSigningOrigin(apiBaseUrl: string, requested?: string, browserOrigin?: string): string {
  const origin = requested ?? browserOrigin ?? new URL(apiBaseUrl).origin;
  normalizeAuthBaseUrl(origin);
  if (origin !== new URL(origin).origin ||
      (browserOrigin !== undefined && origin !== browserOrigin)) {
    throw new RareAuthError('invalid_signing_origin');
  }
  return origin;
}

export class RareAuthError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 0) {
    // Do not interpolate server descriptions: they can echo submitted secrets.
    super(code === 'account_required'
      ? 'This wallet is authenticated but has no SuperRare account. Complete signup before using account features.'
      : `SuperRare authentication failed (${code}).`);
    this.name = 'RareAuthError';
    this.code = code;
    this.status = status;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new RareAuthError(`invalid_${field}`);
  return value;
}

export function requirePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RareAuthError(`invalid_${field}`);
  }
  return value;
}

/** Stable, allowlisted codes prevent an arbitrary server response from leaking credentials in errors. */
export function parseAuthErrorCode(value: unknown): string {
  const known = [
    'invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client',
    'unsupported_grant_type', 'invalid_scope', 'access_denied', 'expired_token',
    'authorization_pending', 'slow_down', 'temporarily_unavailable', 'server_error',
    'invalid_token', 'insufficient_scope', 'account_required',
    'authentication_required', 'forbidden', 'not_found', 'conflict',
    'payload_too_large', 'service_unavailable', 'internal_error',
  ];
  if (isRecord(value) && typeof value.code === 'string' && known.includes(value.code)) return value.code;
  return isRecord(value) && typeof value.error === 'string' && known.includes(value.error)
    ? value.error
    : 'request_failed';
}
