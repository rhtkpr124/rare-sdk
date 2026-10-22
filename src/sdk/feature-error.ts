import { RareApiError, parseApiError, type ApiErrorField } from '../data-access/errors.js';

/** Application failures share the public API error contract, including local validation. */
export function featureError(code: string, status = 0, path = '', details?: ApiErrorField[]): RareApiError {
  const pathname = path.split('?')[0] ?? '';
  return new RareApiError(code, status, pathname === '' || pathname.startsWith('/') ? pathname : `/${pathname}`, code, details);
}

export function requireFeatureString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw featureError(`invalid_${field}`);
  return value;
}

/** Never interpolate arbitrary upstream descriptions into account or message errors. */
export async function featureResponse(response: Response, path: string): Promise<unknown> {
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const nested = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'object' && value.error !== null ? value.error : value;
    const parsed = parseApiError(nested);
    const code = parsed.code ?? (parsed.error !== undefined && /^[a-z][a-z0-9_]{0,63}$/u.test(parsed.error) ? parsed.error : 'request_failed');
    // Retain structured field diagnostics with bounded lengths; raw descriptions
    // can echo submitted credentials or private content and are not error messages.
    const details = parsed.details?.slice(0, 20).map(({ field, message }) => ({ field: field.slice(0, 128), message: message.slice(0, 512) }));
    throw featureError(code, response.status, path, details);
  }
  if (value === undefined) throw featureError('invalid_response', response.status, path);
  return value;
}
