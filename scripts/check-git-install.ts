import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const revision = execFileSync('git', ['rev-parse', '--verify', `${process.argv[2] ?? 'HEAD'}^{commit}`], {
  cwd: sourceDirectory,
  encoding: 'utf8',
}).trim();
const workspace = mkdtempSync(join(tmpdir(), 'rare-sdk-git-install-'));
const repository = join(workspace, 'source.git');
const consumer = join(workspace, 'consumer');

const run = (command: string, arguments_: readonly string[], cwd: string): void => {
  execFileSync(command, arguments_, { cwd, stdio: 'inherit' });
};

try {
  // Push only the revision under test into a disposable local Git remote.
  run('git', ['init', '--bare', '--quiet', repository], sourceDirectory);
  run('git', ['push', '--quiet', repository, `${revision}:refs/heads/install-fixture`], sourceDirectory);
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    name: 'rare-sdk-install-consumer',
    private: true,
    dependencies: {
      '@rareprotocol/rare-sdk': `git+${pathToFileURL(repository).href}#${revision}`,
    },
  }, null, 2) + '\n');

  // CI prepares Git packages inside a pnpm store below node_modules. Native
  // Node type stripping refuses to load tsdown.config.ts from that location.
  run('pnpm', [
    'install',
    '--store-dir', join(consumer, 'node_modules', 'store'),
    '--reporter=append-only',
  ], consumer);
  run(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { createRareClient } from '@rareprotocol/rare-sdk';
    const require = createRequire(import.meta.url);
    assert.equal(typeof createRareClient, 'function');
    assert.equal(typeof require('@rareprotocol/rare-sdk').createRareClient, 'function');
    console.log('Git dependency installed and exported ESM/CommonJS clients successfully.');
  `], consumer);
} catch (error) {
  console.error(`Git install failed; fixture retained at ${workspace}`);
  throw error;
}

rmSync(workspace, { recursive: true, force: true });
