import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { config } from '../config.ts';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`);

/** Runs every .sql file in migrations/ once, in name order. */
export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map(row => String(row.name))
  );

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.sql') && !applied.has(file))
    .sort();

  for (const file of pending) {
    transaction(() => {
      db.exec(readFileSync(`${MIGRATIONS_DIR}${file}`, 'utf8'));

      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    });

    console.log(`[db] applied ${file}`);
  }
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');

  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
