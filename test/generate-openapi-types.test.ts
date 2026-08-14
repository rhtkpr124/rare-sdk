import { describe, expect, it } from 'vitest';
import {
  buildOpenApiTypesArguments,
  readRareApiBaseUrlFromEnvFile,
  resolveRareApiBaseUrlForTypeGeneration,
} from '../scripts/generate-openapi-types.js';

describe('generate OpenAPI types script', () => {
  it('reads dotenv text without evaluating shell syntax', () => {
    const value = readRareApiBaseUrlFromEnvFile([
      '# comment',
      'OTHER=value',
      'RARE_API_BASE_URL="$(touch /tmp/rare-sdk-should-not-run)"',
    ].join('\n'));

    expect(value).toBe('$(touch /tmp/rare-sdk-should-not-run)');
  });

  it('prefers the process environment, then dotenv, then the production default', () => {
    expect(resolveRareApiBaseUrlForTypeGeneration({
      envFileContent: 'RARE_API_BASE_URL="https://api.env-file.test/"',
      processEnvValue: ' https://api.process-env.test/prefix/ ',
    })).toBe('https://api.process-env.test/prefix');

    expect(resolveRareApiBaseUrlForTypeGeneration({
      envFileContent: 'RARE_API_BASE_URL=https://api.env-file.test/',
      processEnvValue: ' ',
    })).toBe('https://api.env-file.test');

    expect(resolveRareApiBaseUrlForTypeGeneration({})).toBe('https://api.superrare.com');
  });

  it('rejects non-HTTP URLs and passes the schema URL as a literal argument', () => {
    expect(() => resolveRareApiBaseUrlForTypeGeneration({
      processEnvValue: 'file:///tmp/schema.json',
    })).toThrow('must use http: or https:');

    expect(buildOpenApiTypesArguments('https://api.example/$(touch nope)')).toEqual([
      'https://api.example/$(touch nope)/doc',
      '-o',
      'src/data-access/schema.d.ts',
    ]);
  });
});
