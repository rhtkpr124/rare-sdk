import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadDotEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}
