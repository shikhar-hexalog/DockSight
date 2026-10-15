// Deletes the local database so the next start backfills from scratch.
// Use before a demo run, or when switching between mock and live data.

import { rmSync } from 'node:fs';

import { config } from '../config.ts';

for (const suffix of ['', '-wal', '-shm']) {
  rmSync(`${config.dbPath}${suffix}`, { force: true });
}

console.log(`[db] removed ${config.dbPath}`);
