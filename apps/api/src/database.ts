import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import * as schema from './schema';

export function openDatabase(path: string, options: { migrate?: boolean } = {}) {
  const existing = path !== ':memory:' && existsSync(path);
  const allowMigrations = options.migrate ?? (process.env.NODE_ENV !== 'production' || !existing);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  try {
    const migrations = readMigrationFiles({
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
    if (!allowMigrations) {
      const table = sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
        )
        .get();
      const applied = table
        ? sqlite.prepare('SELECT hash FROM __drizzle_migrations WHERE created_at = ?')
        : null;
      if (migrations.some((migration) => !applied?.get(migration.folderMillis))) {
        throw new Error(
          'Production migrations blocked; run sh scripts/upgrade.sh after configuring off-server backups.',
        );
      }
      sqlite.pragma('busy_timeout = 5000');
      sqlite.pragma('foreign_keys = ON');
      return { sqlite, db: drizzle(sqlite, { schema }) };
    }
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
    sqlite
      .transaction(() => {
        sqlite.exec(
          'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC NOT NULL)',
        );
        const applied = sqlite.prepare(
          'SELECT hash FROM __drizzle_migrations WHERE created_at = ?',
        );
        const record = sqlite.prepare(
          'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
        );
        for (const migration of migrations) {
          if (applied.get(migration.folderMillis)) continue;
          for (const statement of migration.sql) sqlite.exec(statement);
          record.run(migration.hash, migration.folderMillis);
        }
      })
      .immediate();
    return { sqlite, db: drizzle(sqlite, { schema }) };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
