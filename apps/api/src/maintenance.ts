import { chmodSync, existsSync } from 'node:fs';
import { Database } from 'bun:sqlite';

export function verifyDatabase(path: string) {
  const sqlite = new Database(path, { readonly: true });
  try {
    const integrity = sqlite.query<{ integrity_check: string }, []>('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0]?.integrity_check !== 'ok')
      throw new Error('Database integrity check failed');
    if (sqlite.query('PRAGMA foreign_key_check').all().length)
      throw new Error('Database foreign key check failed');
  } finally {
    sqlite.close();
  }
}

export function snapshot(source: string, destination: string) {
  if (existsSync(destination)) throw new Error('Snapshot destination already exists');
  const sqlite = new Database(source, { readonly: true });
  try {
    sqlite.query<never, [string]>('VACUUM INTO ?').run(destination);
  } finally {
    sqlite.close();
  }
  chmodSync(destination, 0o600);
  verifyDatabase(destination);
}
