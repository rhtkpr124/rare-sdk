import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const source = process.argv[2];
if (!source) throw new Error('Pass the Rare API source OpenAPI JSON document path.');
const document: unknown = JSON.parse(readFileSync(source, 'utf8'));
if (!isRecord(document) || !isRecord(document.paths) || !isRecord(document.components) || !isRecord(document.components.schemas)) {
  throw new Error('The source is not an OpenAPI document with paths and schemas.');
}
const schemas = document.components.schemas;
const paths = Object.fromEntries(Object.entries(document.paths).filter(([path]) =>
  path.startsWith('/v1/prints/') || path.startsWith('/v1/account/shipping-addresses') || path.startsWith('/v1/account/orders')));
const referenced = new Set<string>();
const collectReferences = (value: unknown): void => {
  if (Array.isArray(value)) value.forEach(collectReferences);
  else if (isRecord(value)) {
    if (typeof value.$ref === 'string' && value.$ref.startsWith('#/components/schemas/')) {
      const name = value.$ref.slice('#/components/schemas/'.length);
      if (!referenced.has(name)) {
        referenced.add(name);
        collectReferences(schemas[name]);
      }
    }
    Object.values(value).forEach(collectReferences);
  }
};
collectReferences(paths);
const output = join(mkdtempSync(join(tmpdir(), 'rare-commerce-openapi-')), 'openapi.json');
writeFileSync(output, JSON.stringify({ ...document, paths, components: {
  schemas: Object.fromEntries([...referenced].map(name => [name, schemas[name]])),
} }));
const result = spawnSync('openapi-typescript', [output, '-o', 'src/data-access/commerce-schema.d.ts'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
