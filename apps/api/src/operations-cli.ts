import { chownSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { copyCaddy, decryptArchive, encryptArchive, pack, protectedPassphrase, restoreVolumes, snapshot, unpack, verifyDatabase, verifyIdentity } from './operations';

process.umask(0o077);
try {
  const command = process.argv[2];
  if (command === 'passfile') {
    protectedPassphrase('/pass');
  } else if (command === 'snapshot') {
    await snapshot('/data/office.sqlite', '/work/office.sqlite');
  } else if (command === 'bundle') {
    verifyDatabase('/work/office.sqlite');
    copyCaddy('/caddy-data', '/work/caddy-data');
    copyCaddy('/caddy-config', '/work/caddy-config');
    verifyIdentity('/work/caddy-data');
    pack('/work', '/work/archive.tar');
    await encryptArchive('/work/archive.tar', '/work/backup.office', '/pass');
    const owner = statSync('/work');
    chownSync('/work/backup.office', owner.uid, owner.gid);
  } else if (command === 'unbundle') {
    await decryptArchive('/work/backup.office', '/work/archive.tar', '/pass');
    unpack('/work/archive.tar', '/work/restored');
    const owner = statSync('/work');
    chownSync('/work/restored', owner.uid, owner.gid);
    chownSync('/work/restored/.env', owner.uid, owner.gid);
  } else if (command === 'restore') {
    restoreVolumes('/work/restored', ['/data', '/caddy-data', '/caddy-config']);
    chownSync('/data', 1000, 1000);
    chownSync('/data/office.sqlite', 1000, 1000);
  } else if (command === 'migrate') {
    const { openDatabase } = await import('./database');
    if (!existsSync('/data/office.sqlite')) throw new Error('Missing database');
    const database = openDatabase('/data/office.sqlite', { migrate: true });
    database.sqlite.close();
    verifyDatabase('/data/office.sqlite');
  } else if (command === 'images') {
    const [api, web] = process.argv.slice(3);
    const valid = (value: string) => /^ghcr\.io\/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/.test(value);
    if (!api || !web || !valid(api) || !valid(web)) throw new Error('Invalid image references');
    let env = readFileSync('/work/.env', 'utf8');
    for (const [key, value] of [['APP_IMAGE', api], ['WEB_IMAGE', web], ['IMAGE_SOURCE', 'registry']]) {
      const expression = new RegExp(`^${key}=.*$`, 'gm');
      if ([...env.matchAll(expression)].length !== 1) throw new Error('Invalid configuration');
      env = env.replace(expression, `${key}=${value}`);
    }
    writeFileSync('/work/next.env', env, { flag: 'wx', mode: 0o600 });
    const owner = statSync('/work');
    chownSync('/work/next.env', owner.uid, owner.gid);
  } else if (command === 'cleanup') {
    for (const name of readdirSync('/work')) rmSync(join('/work', name), { recursive: true, force: true });
  } else {
    throw new Error('Unknown operation');
  }
} catch {
  process.stderr.write('Operation failed; no backup success is implied. Preserve original data and consult docs/backups.md before retrying.\n');
  process.exitCode = 1;
}
