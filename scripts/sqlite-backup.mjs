import { createRequire } from 'node:module';
import { createReadStream, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';

const Database = createRequire('/app/apps/api/package.json')('better-sqlite3');
const directory = mkdtempSync(join(tmpdir(), 'office-backup-'));
let sqlite;
try {
  sqlite = new Database('/data/office.sqlite', { readonly: true, fileMustExist: true });
  const path = join(directory, 'office.sqlite');
  await sqlite.backup(path);
  sqlite.close();
  sqlite = new Database(path, { readonly: true });
  if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok' || sqlite.pragma('foreign_key_check').length) throw new Error();
  sqlite.close();
  await pipeline(createReadStream(path), process.stdout);
} catch {
  process.stderr.write('SQLite online backup failed; retry after checking storage and API availability.\n');
  process.exitCode = 1;
} finally {
  if (sqlite?.open) sqlite.close();
  rmSync(directory, { recursive: true, force: true });
}
