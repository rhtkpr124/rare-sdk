import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { messagingOrigin } from './messaging-live.js';

describe('deployed messaging browser upload contract', () => {
  it('allows the actual SDK upload headers in a cross-origin bearer preflight', async () => {
    const headers = ['authorization', 'content-type', 'x-messaging-request', 'x-messaging-actor', 'x-messaging-image-width', 'x-messaging-image-height', 'x-messaging-image-purpose', 'x-messaging-upload-id'];
    const response = await fetch(`${messagingOrigin()}/v1/messaging/conversations/${randomUUID()}/attachments`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://sdk-integration.superrare.test',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': headers.join(', '),
      },
      signal: AbortSignal.timeout(30_000),
    });
    expect(response.status).toBe(204);
    expect(['*', 'https://sdk-integration.superrare.test']).toContain(response.headers.get('access-control-allow-origin'));
    const allowedHeaders = response.headers.get('access-control-allow-headers')?.toLowerCase().split(',').map(value => value.trim()) ?? [];
    for (const header of headers) expect(allowedHeaders).toContain(header);
    expect(response.headers.get('access-control-allow-methods')?.split(',').map(value => value.trim())).toContain('POST');
    expect(response.headers.get('access-control-allow-credentials')).not.toBe('true');
  });
});
