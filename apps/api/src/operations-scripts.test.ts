import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture(scenario = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'office-script-'));
  directories.push(root);
  for (const path of ['scripts', 'bin', 'apps/api/src', 'apps/api/migrations'])
    mkdirSync(join(root, path), { recursive: true });
  for (const name of [
    'operations.sh',
    'backup.sh',
    'upgrade.sh',
    'restore.sh',
    'sqlite-backup.mjs',
  ])
    copyFileSync(resolve('scripts', name), join(root, 'scripts', name));
  writeFileSync(join(root, 'compose.yaml'), 'name: office-service\n');
  writeFileSync(join(root, 'apps/api/src/operations-cli.ts'), '');
  const env =
    'APP_IMAGE=old-api\nWEB_IMAGE=old-web\nIMAGE_SOURCE=local\nAUTH_SECRET=never-log-this-auth-secret\nSETUP_TOKEN=never-log-this-setup-token\nVAPID_PRIVATE_KEY=never-log-this-vapid-key\n';
  writeFileSync(join(root, '.env'), env, { mode: 0o600 });
  writeFileSync(join(root, 'pass'), 'never-log-this-encryption-key-at-least-32-bytes', {
    mode: 0o600,
  });
  writeFileSync(
    join(root, '.backup.conf'),
    `BACKUP_HOST=operator@backup.example\nBACKUP_DIRECTORY=/protected/office\nBACKUP_PASSFILE=${root}/pass\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    join(root, 'bin/docker'),
    `#!/bin/sh
set -eu
printf 'docker %s\n' "$*" >> "$BOUNDARY_LOG"
case "$1" in
  info) exit 0 ;;
  volume|container) [ "$SCENARIO" = existing-volume ] && exit 0; exit 1 ;;
  run)
    work=
    operation=
    previous=
    for argument; do
      case "$argument" in type=bind,src=*,dst=/work) work=\${argument#type=bind,src=}; work=\${work%,dst=/work} ;; esac
      if [ "$previous" = apps/api/src/operations-cli.ts ]; then operation=$argument; fi
      previous=$argument
    done
    case "$operation" in
      images) cp "$work/.env" "$work/next.env" ;;
      snapshot) printf 'consistent fixture' > "$work/office.sqlite" ;;
      bundle) printf 'encrypted-fixture' > "$work/backup.office" ;;
      migrate) [ "$SCENARIO" != migrate ] || exit 1 ;;
      cleanup) rm -rf "$work" ;;
    esac
    ;;
esac
exit 0
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(root, 'bin/ssh'),
    `#!/bin/sh
printf 'ssh %s\n' "$*" >> "$BOUNDARY_LOG"
case "$*" in
  *sha256sum*)
    [ "$SCENARIO" != mismatch ] || { printf 'bad-checksum\n'; exit 0; }
    [ "$SCENARIO" != checksum-failure ] || exit 1
    printf '%s artifact\n' "$BACKUP_HASH"
    ;;
esac
`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(root, 'bin/scp'),
    `#!/bin/sh
printf 'scp %s\n' "$*" >> "$BOUNDARY_LOG"
[ "$SCENARIO" != transfer ]
`,
    { mode: 0o700 },
  );
  const api = `ghcr.io/example/api@sha256:${'a'.repeat(64)}`;
  const web = `ghcr.io/example/web@sha256:${'b'.repeat(64)}`;
  const run = (script = 'upgrade.sh', args = [api, web]) =>
    spawnSync('sh', [join('scripts', script), ...args], {
      cwd: root,
      encoding: 'utf8',
      input: 'yes\n',
      env: {
        ...process.env,
        PATH: `${root}/bin:${process.env.PATH}`,
        SCENARIO: scenario,
        BOUNDARY_LOG: join(root, 'boundary.log'),
        BACKUP_HASH: createHash('sha256').update('encrypted-fixture').digest('hex'),
      },
    });
  return { root, env, run, log: () => readFileSync(join(root, 'boundary.log'), 'utf8') };
}

test('upgrade requires remote checksum success before pull, migration and startup; preserves secrets', () => {
  const f = fixture();
  const result = f.run();
  expect(result.status).toBe(0);
  const log = f.log();
  const transfer = log.indexOf('scp ');
  const checksum = log.indexOf('sha256sum');
  const pull = log.indexOf(' pull');
  const migration = log.indexOf('operations-cli.ts migrate');
  const startup = log.indexOf(' up -d');
  expect(transfer).toBeGreaterThan(log.indexOf(' stop api'));
  expect(checksum).toBeGreaterThan(transfer);
  expect(pull).toBeGreaterThan(checksum);
  expect(migration).toBeGreaterThan(pull);
  expect(startup).toBeGreaterThan(migration);
  expect(readFileSync(join(f.root, '.env'), 'utf8')).toBe(f.env);
  expect(result.stdout).toContain('Off-server backup verified');
  for (const secret of [
    'never-log-this-auth-secret',
    'never-log-this-setup-token',
    'never-log-this-vapid-key',
    'never-log-this-encryption-key',
  ])
    expect(log + result.stdout + result.stderr).not.toContain(secret);
});

for (const scenario of ['transfer', 'mismatch', 'checksum-failure']) {
  test(`upgrade blocks image changes and migrations after ${scenario} failure`, () => {
    const f = fixture(scenario);
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(f.log()).not.toContain(' pull');
    expect(f.log()).not.toContain('operations-cli.ts migrate');
    expect(f.log()).not.toContain(' up -d');
    expect(result.stdout).not.toContain('Off-server backup verified');
    expect(readFileSync(join(f.root, '.env'), 'utf8')).toBe(f.env);
  });
}

test('migration failure retains configuration and stops before startup, with clean-replacement recovery instructions', () => {
  const f = fixture('migrate');
  const result = f.run();
  expect(result.status).not.toBe(0);
  expect(f.log()).toContain('operations-cli.ts migrate');
  expect(f.log()).not.toContain(' up -d');
  expect(result.stderr).toContain('API remains stopped');
  expect(result.stderr).toContain('clean replacement');
  expect(readFileSync(join(f.root, '.env'), 'utf8')).toBe(f.env);
});

test('restore refuses existing configuration and existing volumes without invoking restore or deleting originals', () => {
  const f = fixture('existing-volume');
  const backup = join(f.root, 'explicit.office');
  writeFileSync(backup, 'fixture backup');
  const args = [backup, join(f.root, 'pass'), 'old-api'];
  expect(f.run('restore.sh', args).status).not.toBe(0);
  expect(readFileSync(join(f.root, '.env'), 'utf8')).toBe(f.env);
  rmSync(join(f.root, '.env'));
  const result = f.run('restore.sh', args);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('refuses existing volumes');
  expect(f.log()).not.toContain('operations-cli.ts restore');
  expect(readFileSync(backup, 'utf8')).toBe('fixture backup');
});
