import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema.js';
import type { paths as CartPaths } from './cart-schema.js';
import { RareApiError, parseApiError } from './errors.js';
import { resolveRareApiBaseUrl } from './base-url.js';

const errorMiddleware: Middleware = {
  async onResponse({ response, request }) {
    if (response.ok) return;

    const url = new URL(request.url);
    const path = url.pathname;
    const body = await readErrorBody(response);
    const fallback = response.statusText.length > 0 ? response.statusText : 'Request failed';

    throw new RareApiError(
      body.error ?? fallback,
      response.status,
      path,
      body.code,
      body.details,
    );
  },
};

export function createApiClient(
  baseUrl?: string,
  fetch?: typeof globalThis.fetch,
): ReturnType<typeof createClient<paths>> {
  const client = createClient<paths>({
    baseUrl: resolveRareApiBaseUrl(baseUrl),
    ...(fetch === undefined ? {} : { fetch }),
  });

  client.use(errorMiddleware);

  return client;
}

/** Keep Cart request inference separate from unrelated public API paths. */
export function createCartApiClient(
  baseUrl?: string,
  fetch?: typeof globalThis.fetch,
): ReturnType<typeof createClient<CartPaths>> {
  const client = createClient<CartPaths>({
    baseUrl: resolveRareApiBaseUrl(baseUrl),
    ...(fetch === undefined ? {} : { fetch }),
  });
  client.use(errorMiddleware);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

async function readErrorBody(response: Response): Promise<ReturnType<typeof parseApiError>> {
  try {
    const body: unknown = await response.clone().json();
    return parseApiError(body);
  } catch {
    return {};
  }
}
