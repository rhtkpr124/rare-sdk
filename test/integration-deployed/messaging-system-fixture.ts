import { execFile } from 'node:child_process';
import { required } from './messaging-live.js';

/** Invoke the production Pipelines writer against the deployment's real database. */
export const appendSystemFixture = async (context: unknown, system: unknown): Promise<{ id: string; conversationId: string; sequence: string }> => {
  required('RARE_MESSAGING_TEST_DATABASE_URL');
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile('pnpm', ['exec', 'tsx', '--tsconfig', 'tsconfig.json', 'scripts/messaging-system-fixture.ts'], {
      cwd: required('RARE_MESSAGING_TEST_PIPELINES_DIR'),
      env: { ...process.env, NODE_ENV: 'test' },
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout));
    child.stdin?.end(JSON.stringify({ context, system }));
  });
  const value: unknown = JSON.parse(output);
  if (value === null || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string' || !('conversationId' in value) || typeof value.conversationId !== 'string' || !('sequence' in value) || typeof value.sequence !== 'string') throw new Error('Unexpected Pipelines fixture result');
  return { id: value.id, conversationId: value.conversationId, sequence: value.sequence };
};
