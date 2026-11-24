import { mkdtempSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { afterEach, expect, test } from 'vite-plus/test';
import { snapshot, verifyDatabase } from './maintenance';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'office-maintenance-'));
  directories.push(directory);
  const source = join(directory, 'source.sqlite');
  const sqlite = new Database(source);
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  sqlite.query('INSERT INTO item (name) VALUES (?)').run('চা');
  sqlite.close();
  return { directory, source };
}

test('snapshot copies a live database with its data and private permissions', () => {
  const { directory, source } = fixture();
  const destination = join(directory, 'snapshot.sqlite');
  snapshot(source, destination);
  const copy = new Database(destination, { readonly: true });
  expect(copy.query('SELECT name FROM item').all()).toEqual([{ name: 'চা' }]);
  copy.close();
  expect(statSync(destination).mode & 0o777).toBe(0o600);
});

test('snapshot refuses an existing destination without touching it', () => {
  const { directory, source } = fixture();
  const destination = join(directory, 'existing.sqlite');
  writeFileSync(destination, 'keep');
  expect(() => snapshot(source, destination)).toThrow('already exists');
  expect(existsSync(destination)).toBe(true);
});

test('verifyDatabase rejects a corrupted file', () => {
  const { directory } = fixture();
  const path = join(directory, 'corrupt.sqlite');
  writeFileSync(path, 'this is not a sqlite database'.repeat(100));
  expect(() => verifyDatabase(path)).toThrow();
});
