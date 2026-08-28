import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

type PackageJson = {
  name?: string;
  version?: string;
  description?: string;
  license?: string;
  repository?: unknown;
  homepage?: string;
  bugs?: unknown;
  engines?: { node?: string };
  main?: string;
  module?: string;
  types?: string;
  exports?: unknown;
};

type PackResult = { files?: Array<{ path?: string }> };

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;
const requiredMetadata: Array<[string, unknown]> = [
  ['name', packageJson.name],
  ['version', packageJson.version],
  ['description', packageJson.description],
  ['license', packageJson.license],
  ['repository', packageJson.repository],
  ['homepage', packageJson.homepage],
  ['bugs', packageJson.bugs],
  ['engines.node', packageJson.engines?.node],
];

for (const [name, value] of requiredMetadata) {
  if (value === undefined || value === '') throw new Error(`Missing package metadata: ${name}`);
}

const packed = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  encoding: 'utf8',
  shell: false,
});
if (packed.error !== undefined) throw packed.error;
if (packed.status !== 0) throw new Error(packed.stderr || 'npm pack --dry-run failed');

const [result] = JSON.parse(packed.stdout) as PackResult[];
const paths = new Set(result?.files?.flatMap((file) => file.path ? [file.path] : []) ?? []);
const packageTargets = new Set<string>();

function collectPackageTargets(value: unknown): void {
  if (typeof value === 'string') {
    if (value.startsWith('./')) packageTargets.add(value.slice(2));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const target of Object.values(value)) collectPackageTargets(target);
}

collectPackageTargets(packageJson.main);
collectPackageTargets(packageJson.module);
collectPackageTargets(packageJson.types);
collectPackageTargets(packageJson.exports);

const requiredFiles = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'package.json',
  'dist/sdk/index.js',
  'dist/sdk/index.cjs',
  'dist/sdk/index.d.ts',
  'dist/sdk/index.d.cts',
  'dist/sdk/contracts.js',
  'dist/sdk/public-utils.js',
  'dist/data-access/index.js',
  'dist/node_modules/openapi-fetch/package.json',
];

const isPatternTarget = (path: string): boolean => path.includes('*');
const missingFiles = [...requiredFiles, ...packageTargets]
  .filter((path) => !isPatternTarget(path) && !paths.has(path));
if (missingFiles.length > 0) throw new Error(`Package is missing required files: ${missingFiles.join(', ')}`);

console.log(`Validated ${paths.size} packed files for ${packageJson.name}@${packageJson.version}.`);
