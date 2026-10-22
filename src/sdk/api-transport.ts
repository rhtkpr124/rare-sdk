import type { RareAccountTransport } from './types/account.js';

/** Public API requests share the application transport; signed storage URLs do not. */
export function createPublicApiTransport(baseUrl: string, transport: RareAccountTransport, fetchImpl: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input));
    const api = new URL(baseUrl);
    const prefix = api.pathname.replace(/\/+$/u, '');
    if (target.origin !== api.origin || !target.pathname.startsWith(`${prefix}/`)) {
      return fetchImpl(input, { ...init, credentials: 'omit' });
    }
    const request = new Request(input, init);
    return transport(`${target.pathname.slice(prefix.length)}${target.search}`, {
      method: request.method, headers: request.headers, signal: request.signal,
      ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: await request.arrayBuffer() }),
    });
  };
}
