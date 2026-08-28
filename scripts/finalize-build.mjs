import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const bundledTransportPackage = 'dist/node_modules/openapi-fetch/package.json';

await mkdir(dirname(bundledTransportPackage), { recursive: true });
await writeFile(bundledTransportPackage, '{"type":"module"}\n', 'utf8');
