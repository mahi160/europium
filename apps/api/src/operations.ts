import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

const magic = Buffer.from('OFFICE01');
const identity = ['root.crt', 'root.key', 'intermediate.crt', 'intermediate.key'];

export function verifyDatabase(path: string) {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const violations = sqlite.pragma('foreign_key_check');
    if (
      sqlite.pragma('integrity_check', { simple: true }) !== 'ok' ||
      !Array.isArray(violations) ||
      violations.length !== 0
    ) {
      throw new Error('SQLite verification failed');
    }
  } finally {
    sqlite.close();
  }
}

export async function snapshot(source: string, destination: string) {
  if (existsSync(destination)) throw new Error('Snapshot destination already exists');
  const sqlite = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await sqlite.backup(destination);
    chmodSync(destination, 0o600);
    verifyDatabase(destination);
  } finally {
    sqlite.close();
  }
}

export function protectedPassphrase(path: string) {
  const info = lstatSync(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size < 32 || info.size > 4096) {
    throw new Error('Passphrase must be a regular mode-600/400 file of 32–4096 bytes');
  }
  return readFileSync(path);
}

export async function encryptArchive(source: string, destination: string, passfile: string) {
  const header = Buffer.concat([magic, randomBytes(16), randomBytes(12)]);
  const cipher = createCipheriv(
    'aes-256-gcm',
    scryptSync(protectedPassphrase(passfile), header.subarray(8, 24), 32),
    header.subarray(24),
  );
  cipher.setAAD(header);
  const output = createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  output.write(header);
  await pipeline(createReadStream(source), cipher, output);
  appendFileSync(destination, cipher.getAuthTag());
}

export async function decryptArchive(source: string, destination: string, passfile: string) {
  const size = statSync(source).size;
  if (size < 53) throw new Error('Invalid encrypted bundle');
  const fd = openSync(source, 'r');
  const header = Buffer.alloc(36);
  const tag = Buffer.alloc(16);
  try {
    readSync(fd, header, 0, 36, 0);
    readSync(fd, tag, 0, 16, size - 16);
  } finally {
    closeSync(fd);
  }
  if (!header.subarray(0, 8).equals(magic)) throw new Error('Unsupported backup format');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    scryptSync(protectedPassphrase(passfile), header.subarray(8, 24), 32),
    header.subarray(24),
  );
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const output = createWriteStream(destination, { fd: openSync(destination, 'wx', 0o600) });
  try {
    await pipeline(createReadStream(source, { start: 36, end: size - 17 }), decipher, output);
  } catch {
    rmSync(destination, { force: true });
    throw new Error('Bundle authentication failed; no installation data changed');
  }
}

function treeDigest(directory: string): string {
  const hash = createHash('sha256');
  function visit(path: string, relative: string) {
    const info = lstatSync(path);
    if (info.isDirectory()) {
      hash.update(`d:${relative}\0`);
      for (const name of readdirSync(path).sort()) visit(join(path, name), `${relative}/${name}`);
    } else if (info.isFile()) {
      hash.update(`f:${relative}\0`).update(readFileSync(path));
    } else {
      throw new Error('Persistent storage contains a link or special file');
    }
  }
  visit(directory, '');
  return hash.digest('hex');
}

export function copyCaddy(source: string, destination: string) {
  const before = treeDigest(source);
  cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
  if (before !== treeDigest(source) || before !== treeDigest(destination)) {
    throw new Error('Caddy storage changed during snapshot; retry backup');
  }
}

export function verifyIdentity(directory: string) {
  for (const name of identity) {
    const path = join(directory, 'caddy/pki/authorities/local', name);
    if (!lstatSync(path).isFile() || statSync(path).size === 0)
      throw new Error('Caddy CA identity is incomplete');
  }
}

export function pack(directory: string, archive: string) {
  execFileSync(
    'tar',
    ['-cf', archive, '-C', directory, 'office.sqlite', '.env', 'caddy-data', 'caddy-config'],
    { stdio: 'ignore' },
  );
}

export function unpack(archive: string, directory: string) {
  const names = execFileSync('tar', ['-tf', archive], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
    .trim()
    .split('\n');
  const details = execFileSync('tar', ['-tvf', archive], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
    .trim()
    .split('\n');
  if (
    names.length !== details.length ||
    new Set(names).size !== names.length ||
    names.some((name, index) => {
      const parts = name.replace(/\/$/, '').split('/');
      return (
        !/^[-d]/.test(details[index]) ||
        parts.some((part) => !/^[a-zA-Z0-9_.@-]+$/.test(part) || part === '.' || part === '..') ||
        !['office.sqlite', '.env', 'caddy-data', 'caddy-config'].includes(parts[0]) ||
        (['office.sqlite', '.env'].includes(parts[0]) && parts.length !== 1)
      );
    })
  )
    throw new Error('Unsafe archive entries');
  mkdirSync(directory, { mode: 0o700 });
  execFileSync(
    'tar',
    ['-xf', archive, '--no-same-owner', '--no-same-permissions', '-C', directory],
    { stdio: 'ignore' },
  );
  treeDigest(directory);
  verifyDatabase(join(directory, 'office.sqlite'));
  verifyIdentity(join(directory, 'caddy-data'));
  if (
    !lstatSync(join(directory, '.env')).isFile() ||
    !lstatSync(join(directory, 'caddy-config')).isDirectory()
  )
    throw new Error('Incomplete bundle');
  chmodSync(join(directory, '.env'), 0o600);
}

export function restoreVolumes(directory: string, destinations: string[]) {
  if (destinations.length !== 3 || destinations.some((path) => readdirSync(path).length !== 0))
    throw new Error('Restore requires three empty volumes');
  copyFileSync(join(directory, 'office.sqlite'), join(destinations[0], 'office.sqlite'));
  chmodSync(join(destinations[0], 'office.sqlite'), 0o600);
  cpSync(join(directory, 'caddy-data'), destinations[1], { recursive: true });
  cpSync(join(directory, 'caddy-config'), destinations[2], { recursive: true });
}
