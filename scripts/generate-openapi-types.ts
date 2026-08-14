import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_RARE_API_BASE_URL = 'https://api.superrare.com';
const ENV_FILE = '.env';
const SCHEMA_OUTPUT = 'src/data-access/schema.d.ts';

export function readRareApiBaseUrlFromEnvFile(content: string): string | undefined {
  return content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(parseEnvLine)
    .find((entry) => entry?.key === 'RARE_API_BASE_URL')
    ?.value;
}

export function resolveRareApiBaseUrlForTypeGeneration(params: {
  envFileContent?: string;
  processEnvValue?: string;
}): string {
  const candidate = normalizeBaseUrlCandidate(params.processEnvValue) ??
    normalizeBaseUrlCandidate(
      params.envFileContent === undefined
        ? undefined
        : readRareApiBaseUrlFromEnvFile(params.envFileContent),
    ) ??
    DEFAULT_RARE_API_BASE_URL;

  const url = new URL(candidate);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('RARE_API_BASE_URL must use http: or https:');
  }

  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function buildOpenApiTypesArguments(baseUrl: string): readonly string[] {
  return [`${baseUrl}/doc`, '-o', SCHEMA_OUTPUT];
}

function parseEnvLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return undefined;

  const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
  if (match === null || match[1] === undefined) return undefined;

  return { key: match[1], value: unquoteEnvValue(match[2]?.trim() ?? '') };
}

function unquoteEnvValue(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value.split(/\s+#/, 1)[0]?.trim() ?? '';
}

function normalizeBaseUrlCandidate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function main(): void {
  const baseUrl = resolveRareApiBaseUrlForTypeGeneration({
    envFileContent: existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : undefined,
    processEnvValue: process.env.RARE_API_BASE_URL,
  });
  const result = spawnSync('openapi-typescript', buildOpenApiTypesArguments(baseUrl), {
    shell: false,
    stdio: 'inherit',
  });

  if (result.error !== undefined) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
