import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { menuItemResponseSchema, orderResponseSchema } from '@office-service/shared';
import { createApp } from './app';
import { openDatabase } from './database';
import {
  copyCaddy,
  decryptArchive,
  encryptArchive,
  pack,
  protectedPassphrase,
  restoreVolumes,
  snapshot,
  unpack,
  verifyDatabase,
} from './operations';

const resources: Array<() => void> = [];
afterEach(() => {
  for (const dispose of resources.splice(0).reverse()) dispose();
  vi.unstubAllEnvs();
});
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), 'office-operations-'));
  resources.push(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function directory(parent: string, name: string) {
  const path = join(parent, name);
  mkdirSync(path, { recursive: true });
  return path;
}
function passfile(parent: string, name = 'pass') {
  const path = join(parent, name);
  writeFileSync(path, 'backup-only-strong-passphrase-at-least-32-bytes', { mode: 0o600 });
  return path;
}

test('online backup during real order creation restores login, contents, status, audit, secrets and CA bytes after restart', async () => {
  const root = temporary();
  const origin = 'http://localhost:5173';
  const password = 'backup-account-password-123';
  const config = {
    APP_ORIGIN: origin,
    AUTH_SECRET: 'backup-auth-secret-at-least-32-characters',
    SETUP_TOKEN: 'backup-setup-token-at-least-32-characters',
    DATABASE_PATH: join(root, 'live.sqlite'),
  };
  const backend = createApp(config);
  resources.push(backend.close);
  function request(app: ReturnType<typeof createApp>, path: string, body?: unknown, cookie = '') {
    return app.app.request('/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  expect(
    (
      await request(backend, '/setup', {
        username: 'admin',
        password,
        setupToken: config.SETUP_TOKEN,
        name: 'Admin',
        language: 'en',
        floor: '1',
        desk: 'A',
      })
    ).status,
  ).toBe(201);
  const login = await request(backend, '/auth/login', { username: 'admin', password });
  expect(login.status).toBe(200);
  const cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const menu = menuItemResponseSchema.parse(
    await (
      await request(
        backend,
        '/menu',
        { name: 'Tea', category: 'tea', unit: 'কাপ', available: true, archived: false },
        cookie,
      )
    ).json(),
  ).item;
  expect(
    (
      await request(
        backend,
        '/users',
        {
          username: 'requester',
          password: '0007',
          name: 'Requester',
          role: 'employee',
          language: 'en',
          floor: '1',
          desk: 'A',
        },
        cookie,
      )
    ).status,
  ).toBe(201);
  const employeeLogin = await request(backend, '/auth/login', {
    username: 'requester',
    password: '0007',
  });
  expect(employeeLogin.status).toBe(200);
  const employeeCookie = employeeLogin.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  expect(
    (
      await request(
        backend,
        '/auth/change-password',
        { currentPassword: '0007', newPassword: '0042' },
        employeeCookie,
      )
    ).status,
  ).toBe(200);
  const place = async (requester = cookie) => {
    const response = await request(
      backend,
      '/orders',
      {
        idempotencyKey: randomUUID(),
        items: [{ itemId: menu.id, quantity: 2 }],
        note: 'Keep contents',
      },
      requester,
    );
    expect(response.status).toBe(201);
    return orderResponseSchema.parse(await response.json()).order;
  };
  const order = await place(employeeCookie);
  const cancelled = await request(
    backend,
    `/orders/${order.id}/cancel`,
    { reason: 'Changed plans' },
    employeeCookie,
  );
  expect(cancelled.status).toBe(200);
  const expected = orderResponseSchema.parse(await cancelled.json()).order;
  backend.sqlite.exec('CREATE TABLE backup_load (payload BLOB)');
  backend.sqlite.transaction(() => {
    const insert = backend.sqlite.prepare('INSERT INTO backup_load VALUES (randomblob(4096))');
    for (let index = 0; index < 1200; index++) insert.run();
  })();
  const bundle = directory(root, 'bundle');
  let copying = true;
  let concurrentWrites = 0;
  const writing = (async () => {
    for (let index = 0; index < 20; index++) {
      await place();
      if (copying) concurrentWrites++;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  })();
  try {
    await snapshot(config.DATABASE_PATH, join(bundle, 'office.sqlite'));
  } finally {
    copying = false;
    await writing;
  }
  expect(concurrentWrites).toBeGreaterThan(0);
  verifyDatabase(join(bundle, 'office.sqlite'));
  const captured = new Database(join(bundle, 'office.sqlite'), { readonly: true });
  expect(captured.prepare('SELECT COUNT(*) AS count FROM orders').get()).toEqual(
    expect.objectContaining({ count: expect.any(Number) }),
  );
  expect(
    captured
      .prepare(
        'SELECT COUNT(*) AS count FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_item i WHERE i.order_id = o.id)',
      )
      .get(),
  ).toEqual({ count: 0 });
  captured.close();
  backend.close();
  const restarted = createApp(config);
  expect((await request(restarted, '/auth/login', { username: 'admin', password })).status).toBe(
    200,
  );
  restarted.close();
  writeFileSync(
    join(bundle, '.env'),
    Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\nVAPID_PRIVATE_KEY=preserve-vapid-private\n',
    { mode: 0o600 },
  );
  const ca = directory(bundle, 'caddy-data/caddy/pki/authorities/local');
  for (const name of ['root.crt', 'root.key', 'intermediate.crt', 'intermediate.key'])
    writeFileSync(join(ca, name), `original-${name}`, { mode: 0o600 });
  writeFileSync(join(directory(bundle, 'caddy-config'), 'autosave.json'), '{}');
  const pass = passfile(root);
  const archive = join(root, 'archive.tar');
  const encrypted = join(root, 'backup.office');
  pack(bundle, archive);
  await encryptArchive(archive, encrypted, pass);
  expect(readFileSync(encrypted).includes(Buffer.from(config.AUTH_SECRET))).toBe(false);
  const decrypted = join(root, 'decrypted.tar');
  await decryptArchive(encrypted, decrypted, pass);
  const restored = join(root, 'restored');
  unpack(decrypted, restored);
  const volumes = ['app', 'caddy-data', 'caddy-config'].map((name) =>
    directory(root, `replacement/${name}`),
  );
  restoreVolumes(restored, volumes);
  expect(readFileSync(join(restored, '.env'))).toEqual(readFileSync(join(bundle, '.env')));
  for (const name of ['root.crt', 'root.key', 'intermediate.crt', 'intermediate.key']) {
    expect(readFileSync(join(volumes[1], 'caddy/pki/authorities/local', name))).toEqual(
      readFileSync(join(ca, name)),
    );
  }
  const replacement = createApp({ ...config, DATABASE_PATH: join(volumes[0], 'office.sqlite') });
  resources.push(replacement.close);
  const restoredLogin = await request(replacement, '/auth/login', { username: 'admin', password });
  expect(restoredLogin.status).toBe(200);
  const restoredCookie = restoredLogin.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const detail = orderResponseSchema.parse(
    await (await request(replacement, `/orders/${order.id}`, undefined, restoredCookie)).json(),
  ).order;
  expect(detail).toEqual(expected);
  const beforeRefusal = readFileSync(join(volumes[0], 'office.sqlite'));
  expect(() => restoreVolumes(restored, volumes)).toThrow('empty volumes');
  expect(readFileSync(join(volumes[0], 'office.sqlite'))).toEqual(beforeRefusal);
});

test('authenticated bundles reject wrong keys and altered headers, ciphertext and tags before extraction', async () => {
  const root = temporary();
  const pass = passfile(root);
  const wrong = passfile(root, 'wrong');
  writeFileSync(wrong, 'different-passphrase-at-least-32-bytes');
  const input = join(root, 'input');
  const encrypted = join(root, 'encrypted');
  writeFileSync(input, 'private configuration and CA keys');
  await encryptArchive(input, encrypted, pass);
  await expect(decryptArchive(encrypted, join(root, 'wrong-output'), wrong)).rejects.toThrow(
    'authentication failed',
  );
  expect(existsSync(join(root, 'wrong-output'))).toBe(false);
  for (const position of [10, 40, readFileSync(encrypted).length - 1]) {
    const modified = readFileSync(encrypted);
    modified[position] ^= 1;
    const path = join(root, `modified-${position}`);
    writeFileSync(path, modified);
    const output = join(root, `output-${position}`);
    await expect(decryptArchive(path, output, pass)).rejects.toThrow();
    expect(existsSync(output)).toBe(false);
  }
  const existing = join(root, 'existing-output');
  writeFileSync(existing, 'keep original');
  await expect(decryptArchive(encrypted, existing, pass)).rejects.toThrow();
  expect(readFileSync(existing, 'utf8')).toBe('keep original');
  chmodSync(pass, 0o644);
  expect(() => protectedPassphrase(pass)).toThrow('mode-600');
  symlinkSync(wrong, join(root, 'symlink'));
  expect(() => protectedPassphrase(join(root, 'symlink'))).toThrow();
});

test('archive extraction refuses traversal, symlinks and hardlinks without touching targets', () => {
  const root = temporary();
  const input = directory(root, 'input');
  writeFileSync(join(input, 'office.sqlite'), 'not a database');
  const traversal = join(root, 'traversal.tar');
  execFileSync('tar', ['-cf', traversal, '-C', input, 'office.sqlite']);
  const malicious = readFileSync(traversal);
  malicious.fill(0, 0, 100);
  malicious.write('../outside', 0);
  malicious.fill(32, 148, 156);
  const checksum = malicious.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
  malicious.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  writeFileSync(traversal, malicious);
  expect(() => unpack(traversal, join(root, 'traversal-output'))).toThrow();
  expect(existsSync(join(root, 'outside'))).toBe(false);
  symlinkSync('/etc/passwd', join(input, '.env'));
  const linked = join(root, 'linked.tar');
  execFileSync('tar', ['-cf', linked, '-C', input, '.env']);
  expect(() => unpack(linked, join(root, 'linked-output'))).toThrow('Unsafe archive');
  expect(existsSync(join(root, 'linked-output'))).toBe(false);
  expect(() => copyCaddy(input, join(root, 'copy'))).toThrow('link or special file');
  rmSync(join(input, '.env'));
  linkSync(join(input, 'office.sqlite'), join(input, '.env'));
  const hardlinked = join(root, 'hardlinked.tar');
  execFileSync('tar', ['-cf', hardlinked, '-C', input, 'office.sqlite', '.env']);
  expect(() => unpack(hardlinked, join(root, 'hardlinked-output'))).toThrow('Unsafe archive');
});

test('production startup blocks existing pending schemas without modifying data; explicit upgrade migration and clean initialization work', () => {
  const root = temporary();
  vi.stubEnv('NODE_ENV', 'production');
  const fresh = openDatabase(join(root, 'fresh.sqlite'));
  fresh.sqlite.close();
  const path = join(root, 'pending.sqlite');
  const old = new Database(path);
  old.exec("CREATE TABLE original (value TEXT); INSERT INTO original VALUES ('keep')");
  old.close();
  const original = readFileSync(path);
  expect(() => openDatabase(path)).toThrow('Production migrations blocked');
  expect(readFileSync(path)).toEqual(original);
  const migrated = openDatabase(path, { migrate: true });
  expect(migrated.sqlite.prepare('SELECT value FROM original').get()).toEqual({ value: 'keep' });
  migrated.sqlite.close();
  const reopened = openDatabase(path);
  expect(reopened.sqlite.prepare('SELECT value FROM original').get()).toEqual({ value: 'keep' });
  reopened.sqlite.close();
});
