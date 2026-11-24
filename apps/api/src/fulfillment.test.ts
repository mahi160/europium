import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, expect, test } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  apiErrorSchema,
  menuItemResponseSchema,
  orderResponseSchema,
  ordersResponseSchema,
  publicUserSchema,
} from '@office-service/shared';
import { createApp } from './app';
import { openDatabase } from './database';
import { orderHistory, orders, session, user } from './schema';

const origin = 'http://localhost:5173';
const password = 'fulfillment-initial-password-123';
const pin = '1234';
const personalPin = '5678';
const setupToken = 'fulfillment-setup-token-at-least-32-characters';
const profile = { name: 'অফিস কর্মী', floor: '৩', desk: 'D12', language: 'en' } as const;
const userResponse = z.object({ user: publicUserSchema });
const resources: Array<() => void> = [];
afterEach(() => {
  for (const dispose of resources.splice(0).reverse()) dispose();
});
function request(
  backend: ReturnType<typeof createApp>,
  path: string,
  method = 'GET',
  body?: unknown,
  cookie?: string,
) {
  return backend.app.request('/api' + path, {
    method,
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}
async function failure(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe(code);
}
async function login(backend: ReturnType<typeof createApp>, username: string, secret = password) {
  const response = await request(backend, '/auth/login', 'POST', { username, password: secret });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'office-fulfillment-'));
  resources.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    APP_ORIGIN: origin,
    AUTH_SECRET: 'fulfillment-auth-secret-at-least-32-characters',
    SETUP_TOKEN: setupToken,
    DATABASE_PATH: join(directory, 'orders.sqlite'),
  };
  const backend = createApp(config);
  resources.push(backend.close);
  expect(
    (
      await request(backend, '/setup', 'POST', {
        ...profile,
        username: 'admin',
        password,
        setupToken,
      })
    ).status,
  ).toBe(201);
  const admin = await login(backend, 'admin');
  async function person(role: 'staff' | 'employee', username: string) {
    const created = await request(
      backend,
      '/users',
      'POST',
      { ...profile, name: username, username, role, password: pin },
      admin,
    );
    expect(created.status).toBe(201);
    const value = userResponse.parse(await created.json()).user;
    const cookie = await login(backend, username, pin);
    expect(
      (
        await request(
          backend,
          '/auth/change-password',
          'POST',
          { currentPassword: pin, newPassword: personalPin },
          cookie,
        )
      ).status,
    ).toBe(200);
    return { ...value, cookie };
  }
  const employee = await person('employee', 'employee');
  const staff = await person('staff', 'staff_one');
  const second = await person('staff', 'staff_two');
  const created = await request(
    backend,
    '/menu',
    'POST',
    { name: 'দুধ চা', category: 'tea', unit: 'কাপ', available: true, archived: false },
    admin,
  );
  const item = menuItemResponseSchema.parse(await created.json()).item;
  async function place(cookie = employee.cookie) {
    const response = await request(
      backend,
      '/orders',
      'POST',
      { idempotencyKey: randomUUID(), items: [{ itemId: item.id, quantity: 2 }], note: 'চিনি ছাড়া' },
      cookie,
    );
    expect(response.status).toBe(201);
    return orderResponseSchema.parse(await response.json()).order;
  }
  async function list(cookie: string, work = true) {
    const response = await request(
      backend,
      work ? '/work/orders' : '/orders',
      'GET',
      undefined,
      cookie,
    );
    expect(response.status).toBe(200);
    return ordersResponseSchema.parse(await response.json()).orders;
  }
  async function command(id: string, action: string, cookie: string, reason?: string) {
    const response = await request(
      backend,
      '/orders/' + id + '/' + action,
      'POST',
      reason === undefined ? {} : { reason },
      cookie,
    );
    expect(response.status).toBe(200);
    return orderResponseSchema.parse(await response.json()).order;
  }
  return { backend, config, admin, employee, staff, second, place, list, command };
}

test('independent SQLite connections allow exactly one claim, with one assignment and audit', async () => {
  const { backend, config, employee, staff, second, place } = await fixture();
  const other = createApp(config);
  resources.push(other.close);
  const pending = await place();
  const responses = await Promise.all([
    request(backend, '/orders/' + pending.id + '/accept', 'POST', {}, staff.cookie),
    request(other, '/orders/' + pending.id + '/accept', 'POST', {}, second.cookie),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const winnerIndex = responses[0].status === 200 ? 0 : 1;
  const accepted = orderResponseSchema.parse(await responses[winnerIndex].json()).order;
  await failure(responses[1 - winnerIndex], 409, 'ORDER_CONFLICT');
  expect(accepted.assignee?.id).toBe([staff.id, second.id][winnerIndex]);
  expect(accepted.acceptedAt).toBeTypeOf('number');
  expect(accepted.completedAt).toBeNull();
  expect(accepted.audit.map((entry) => entry.action)).toEqual(['create', 'accept']);
  expect(accepted.audit[0]).toMatchObject({
    actor: { id: employee.id, name: employee.name },
    fromStatus: null,
    toStatus: 'PENDING',
    assignee: null,
  });
  expect(accepted.audit[1]).toMatchObject({
    actor: accepted.assignee,
    fromStatus: 'PENDING',
    toStatus: 'ACCEPTED',
    fromAssigneeId: null,
    assignee: accepted.assignee,
  });
  expect(backend.db.select().from(orderHistory).all()).toHaveLength(2);
  expect(Object.keys(accepted.audit[1].actor).sort()).toEqual(['id', 'name']);
});

test('pending accept/cancel/reject races have one authoritative outcome and no losing audit', async () => {
  const { backend, config, employee, staff, second, place } = await fixture();
  const other = createApp(config);
  resources.push(other.close);
  for (const pair of [
    ['accept', 'cancel'],
    ['accept', 'reject'],
    ['reject', 'cancel'],
  ] as const) {
    for (const reverse of [false, true]) {
      const pending = await place();
      const actions = reverse ? [pair[1], pair[0]] : [...pair];
      const responses = await Promise.all(
        actions.map((action, index) =>
          request(
            index === 0 ? backend : other,
            '/orders/' + pending.id + '/' + action,
            'POST',
            action === 'accept' ? {} : { reason: 'পরিকল্পনা বদলেছে' },
            action === 'cancel' ? employee.cookie : index === 0 ? staff.cookie : second.cookie,
          ),
        ),
      );
      expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
      const detail = await request(
        backend,
        '/orders/' + pending.id,
        'GET',
        undefined,
        employee.cookie,
      );
      const persisted = orderResponseSchema.parse(await detail.json()).order;
      expect(persisted.audit).toHaveLength(2);
      const winner = responses.findIndex((response) => response.status === 200);
      expect(persisted.audit[1].action).toBe(actions[winner]);
      expect(persisted.assignee === null).toBe(actions[winner] !== 'accept');
      expect(persisted.completedAt === null).toBe(actions[winner] === 'accept');
    }
  }
});

test('delivery and requeue race against fresh accepted state', async () => {
  const { backend, config, admin, staff, place, command } = await fixture();
  const other = createApp(config);
  resources.push(other.close);
  for (const actions of [
    ['deliver', 'requeue'],
    ['requeue', 'deliver'],
  ] as const) {
    const pending = await place();
    await command(pending.id, 'accept', staff.cookie);
    const responses = await Promise.all(
      actions.map((action, index) =>
        request(
          index === 0 ? backend : other,
          '/orders/' + pending.id + '/' + action,
          'POST',
          action === 'deliver' ? {} : { reason: 'কাজ পরিবর্তন' },
          staff.cookie,
        ),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const value = orderResponseSchema.parse(
      await (await request(backend, '/orders/' + pending.id, 'GET', undefined, admin)).json(),
    ).order;
    expect(value.audit).toHaveLength(3);
    expect(value.audit[2].action).toBe(
      actions[responses.findIndex((response) => response.status === 200)],
    );
  }
});

test('permissions, reasons, private detail and personal ordering are independent of work queues', async () => {
  const { backend, admin, employee, staff, second, place, command, list } = await fixture();
  const pending = await place();
  await place(staff.cookie);
  expect((await list(employee.cookie, false)).map((order) => order.id)).toEqual([pending.id]);
  expect(await list(admin, false)).toEqual([]);
  expect(await list(staff.cookie, false)).toHaveLength(1);
  await failure(
    await request(backend, '/work/orders', 'GET', undefined, employee.cookie),
    403,
    'FORBIDDEN',
  );
  await failure(await request(backend, '/work/orders'), 401, 'UNAUTHORIZED');
  for (const action of ['accept', 'reject', 'cancel'] as const) {
    await failure(
      await request(
        backend,
        '/orders/' + pending.id + '/' + action,
        'POST',
        action === 'accept' ? {} : { reason: 'কারণ' },
        admin,
      ),
      403,
      'FORBIDDEN',
    );
  }
  for (const action of ['accept', 'deliver', 'reject', 'requeue']) {
    await failure(
      await request(
        backend,
        '/orders/' + pending.id + '/' + action,
        'POST',
        action === 'reject' || action === 'requeue' ? { reason: 'কারণ' } : {},
        employee.cookie,
      ),
      403,
      'FORBIDDEN',
    );
  }
  for (const reason of ['', ' ', 'x'.repeat(501)]) {
    await failure(
      await request(
        backend,
        '/orders/' + pending.id + '/reject',
        'POST',
        { reason },
        second.cookie,
      ),
      400,
      'VALIDATION_ERROR',
    );
  }
  await failure(
    await request(
      backend,
      '/orders/' + pending.id + '/cancel',
      'POST',
      { reason: 'কারণ' },
      second.cookie,
    ),
    404,
    'NOT_FOUND',
  );
  expect(
    (await request(backend, '/orders/' + pending.id, 'GET', undefined, second.cookie)).status,
  ).toBe(200);
  await command(pending.id, 'accept', staff.cookie);
  await failure(
    await request(backend, '/orders/' + pending.id, 'GET', undefined, second.cookie),
    404,
    'NOT_FOUND',
  );
  expect((await list(second.cookie)).some((order) => order.id === pending.id)).toBe(false);
  for (const action of ['deliver', 'cancel', 'requeue']) {
    await failure(
      await request(
        backend,
        '/orders/' + pending.id + '/' + action,
        'POST',
        action === 'deliver' ? {} : { reason: 'কারণ' },
        second.cookie,
      ),
      403,
      'FORBIDDEN',
    );
  }
  await failure(
    await request(
      backend,
      '/orders/' + pending.id + '/cancel',
      'POST',
      { reason: '' },
      employee.cookie,
    ),
    409,
    'ORDER_NOT_PENDING',
  );
  for (const cookie of [staff.cookie, admin]) {
    await failure(
      await request(backend, '/orders/' + pending.id + '/cancel', 'POST', { reason: ' ' }, cookie),
      403,
      'FORBIDDEN',
    );
  }
  await failure(
    await request(backend, '/orders/' + pending.id + '/requeue', 'POST', {}, admin),
    403,
    'FORBIDDEN',
  );
  await failure(
    await request(backend, '/orders/' + pending.id + '/deliver', 'POST', {}, admin),
    403,
    'FORBIDDEN',
  );
  await failure(
    await request(
      backend,
      '/orders/' + pending.id + '/requeue',
      'POST',
      { reason: 'x'.repeat(501) },
      staff.cookie,
    ),
    400,
    'VALIDATION_ERROR',
  );
  await failure(
    await request(
      backend,
      '/orders/' + pending.id + '/accept',
      'POST',
      { assigneeId: second.id },
      staff.cookie,
    ),
    400,
    'VALIDATION_ERROR',
  );
  const delivered = await command(pending.id, 'deliver', staff.cookie);
  expect(delivered.status).toBe('DELIVERED');
  expect((await list(staff.cookie)).some((order) => order.id === pending.id)).toBe(true);
  expect((await list(second.cookie)).some((order) => order.id === pending.id)).toBe(false);
});

test('requeue clears assignment but preserves snapshots and subsequent whole-order fulfillment', async () => {
  const { backend, employee, staff, second, place, command } = await fixture();
  const pending = await place();
  const accepted = await command(pending.id, 'accept', staff.cookie);
  await request(backend, '/me', 'PATCH', { name: 'নতুন নাম' }, staff.cookie);
  const requeued = await command(pending.id, 'requeue', staff.cookie, 'অন্য কর্মী প্রয়োজন');
  expect(requeued).toMatchObject({
    status: 'PENDING',
    assignee: null,
    acceptedAt: null,
    completedAt: null,
    reason: 'অন্য কর্মী প্রয়োজন',
    items: pending.items,
  });
  expect(requeued.audit[1].actor.name).toBe(staff.name);
  expect(requeued.audit[1].assignee).toEqual(accepted.assignee);
  expect(requeued.audit[2]).toMatchObject({
    fromStatus: 'ACCEPTED',
    toStatus: 'PENDING',
    fromAssigneeId: staff.id,
    assignee: null,
    reason: 'অন্য কর্মী প্রয়োজন',
  });
  const ownerView = orderResponseSchema.parse(
    await (
      await request(backend, '/orders/' + pending.id, 'GET', undefined, employee.cookie)
    ).json(),
  ).order;
  expect(ownerView).toEqual(requeued);
  await command(pending.id, 'accept', second.cookie);
  await failure(
    await request(backend, '/orders/' + pending.id, 'GET', undefined, staff.cookie),
    404,
    'NOT_FOUND',
  );
  await failure(
    await request(backend, '/orders/' + pending.id + '/deliver', 'POST', {}, staff.cookie),
    403,
    'FORBIDDEN',
  );
  const delivered = await command(pending.id, 'deliver', second.cookie);
  expect(delivered).toMatchObject({
    status: 'DELIVERED',
    assignee: { id: second.id },
    items: pending.items,
  });
  expect(delivered.completedAt).toBeTypeOf('number');
  expect(delivered.audit.map((entry) => entry.action)).toEqual([
    'create',
    'accept',
    'requeue',
    'accept',
    'deliver',
  ]);
});

test('terminal orders are immutable and owner cancellation/rejection remain visible in history', async () => {
  const { backend, employee, staff, second, place, command, list } = await fixture();
  for (const terminal of ['DELIVERED', 'REJECTED', 'CANCELLED'] as const) {
    const pending = await place();
    const done =
      terminal === 'REJECTED'
        ? await command(pending.id, 'reject', second.cookie, 'চা শেষ')
        : terminal === 'CANCELLED'
          ? await command(pending.id, 'cancel', employee.cookie, 'মিটিং শেষ')
          : (await command(pending.id, 'accept', staff.cookie),
            await command(pending.id, 'deliver', staff.cookie));
    expect(done.status).toBe(terminal);
    expect(done.audit.at(-1)?.reason).toBe(done.reason);
    for (const action of ['accept', 'deliver', 'reject', 'cancel', 'requeue']) {
      await failure(
        await request(
          backend,
          '/orders/' + done.id + '/' + action,
          'POST',
          ['accept', 'deliver'].includes(action) ? {} : { reason: 'পরিবর্তন' },
          action === 'cancel' ? employee.cookie : staff.cookie,
        ),
        409,
        action === 'cancel' ? 'ORDER_NOT_PENDING' : 'ORDER_CONFLICT',
      );
    }
    const detail = orderResponseSchema.parse(
      await (
        await request(backend, '/orders/' + done.id, 'GET', undefined, employee.cookie)
      ).json(),
    ).order;
    expect(detail).toEqual(done);
    if (terminal === 'REJECTED')
      expect((await list(second.cookie)).some((order) => order.id === done.id)).toBe(true);
  }
  const pending = await place();
  await command(pending.id, 'accept', staff.cookie);
  const returned = await command(pending.id, 'requeue', staff.cookie);
  expect(returned).toMatchObject({ status: 'PENDING', reason: null, assignee: null });
  const cancelled = await command(pending.id, 'cancel', employee.cookie, '');
  expect(cancelled.audit.at(-1)).toMatchObject({
    actor: { id: employee.id },
    reason: null,
    assignee: null,
  });
});

test('queue is oldest first and a revoked session cannot persist a transition', async () => {
  const { backend, staff, place, list } = await fixture();
  const first = await place();
  const second = await place();
  backend.db
    .update(orders)
    .set({ createdAt: first.createdAt - 60000 })
    .where(eq(orders.id, first.id))
    .run();
  expect((await list(staff.cookie)).map((order) => order.id)).toEqual([first.id, second.id]);
  const pendingWrite = request(
    backend,
    '/orders/' + first.id + '/accept',
    'POST',
    {},
    staff.cookie,
  );
  backend.db.delete(session).where(eq(session.userId, staff.id)).run();
  await failure(await pendingWrite, 401, 'UNAUTHORIZED');
  expect(backend.db.select().from(orders).where(eq(orders.id, first.id)).get()?.status).toBe(
    'PENDING',
  );
  expect(
    backend.db.select().from(orderHistory).where(eq(orderHistory.orderId, first.id)).all(),
  ).toHaveLength(1);
});

test('transition waits for a competing writer and checks the committed actor and status', async () => {
  const { backend, config, staff, place } = await fixture();
  const pending = await place();
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const { Database } = require('bun:sqlite');
    const sqlite = new Database(workerData.path);
    sqlite.exec('PRAGMA busy_timeout = 5000');
    sqlite.exec('BEGIN IMMEDIATE');
    sqlite.prepare('UPDATE user SET role = ? WHERE id = ?').run('employee', workerData.userId);
    parentPort.postMessage('locked');
    setTimeout(() => { sqlite.exec('COMMIT'); sqlite.close(); }, 200);
  `,
    {
      eval: true,
      workerData: {
        path: config.DATABASE_PATH,
        userId: staff.id,
      },
    },
  );
  const finished = new Promise<void>((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Competing writer failed')),
    );
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve());
      worker.once('error', reject);
    });
    await failure(
      await request(backend, '/orders/' + pending.id + '/accept', 'POST', {}, staff.cookie),
      403,
      'FORBIDDEN',
    );
    expect(backend.db.select().from(user).where(eq(user.id, staff.id)).get()?.role).toBe(
      'employee',
    );
    expect(backend.db.select().from(orders).where(eq(orders.id, pending.id)).get()?.status).toBe(
      'PENDING',
    );
    expect(
      backend.db.select().from(orderHistory).where(eq(orderHistory.orderId, pending.id)).all(),
    ).toHaveLength(1);
  } finally {
    await finished;
  }
});

test('a locked competing claim is authoritative when the waiting API transition starts', async () => {
  const { backend, config, staff, second, place } = await fixture();
  const pending = await place();
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const { Database } = require('bun:sqlite');
    const sqlite = new Database(workerData.path);
    sqlite.exec('PRAGMA busy_timeout = 5000');
    sqlite.exec('BEGIN IMMEDIATE');
    const now = Date.now();
    const result = sqlite.prepare("UPDATE orders SET status = 'ACCEPTED', assignee_id = ?, accepted_at = ?, updated_at = ? WHERE id = ? AND status = 'PENDING' AND assignee_id IS NULL").run(workerData.userId, now, now, workerData.orderId);
    if (result.changes !== 1) throw new Error('Competing claim failed');
    sqlite.prepare("INSERT INTO order_history (order_id, action, actor_id, actor_name, at, from_status, to_status, assignee_id, assignee_name) VALUES (?, 'accept', ?, ?, ?, 'PENDING', 'ACCEPTED', ?, ?)").run(workerData.orderId, workerData.userId, workerData.name, now, workerData.userId, workerData.name);
    parentPort.postMessage('locked');
    setTimeout(() => { sqlite.exec('COMMIT'); sqlite.close(); }, 200);
  `,
    {
      eval: true,
      workerData: {
        path: config.DATABASE_PATH,
        userId: second.id,
        name: second.name,
        orderId: pending.id,
      },
    },
  );
  const finished = new Promise<void>((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Competing claim writer failed')),
    );
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve());
      worker.once('error', reject);
    });
    await failure(
      await request(backend, '/orders/' + pending.id + '/accept', 'POST', {}, staff.cookie),
      409,
      'ORDER_CONFLICT',
    );
    expect(
      backend.db.select().from(orders).where(eq(orders.id, pending.id)).get()?.assigneeId,
    ).toBe(second.id);
    expect(
      backend.db.select().from(orderHistory).where(eq(orderHistory.orderId, pending.id)).all(),
    ).toHaveLength(2);
  } finally {
    await finished;
  }
});

test('versioned fulfillment migration preserves legacy orders and backfills history exactly once', () => {
  const directory = mkdtempSync(join(tmpdir(), 'office-fulfillment-migration-'));
  resources.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'legacy.sqlite');
  const legacy = new Database(path);
  const ownerId = randomUUID();
  const pendingId = randomUUID();
  const cancelledId = randomUUID();
  try {
    legacy.exec(
      'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at NUMERIC NOT NULL)',
    );
    const migrations = readMigrationFiles({
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
    for (const migration of migrations.slice(0, 2)) {
      for (const statement of migration.sql) legacy.exec(statement);
      legacy
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(migration.hash, migration.folderMillis);
    }
    legacy
      .prepare(
        'INSERT INTO user (id, name, email, username, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(ownerId, 'পুরোনো অর্ডারকারী', ownerId + '@office.invalid', 'legacy', 1000, 1000);
    for (const [id, status, at, reason] of [
      [pendingId, 'PENDING', 1000, null],
      [cancelledId, 'CANCELLED', 2000, 'মিটিং শেষ'],
    ] as const) {
      legacy
        .prepare(
          'INSERT INTO orders (id, user_id, idempotency_key, request_hash, status, floor, desk, note, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          ownerId,
          randomUUID(),
          'legacy-hash',
          status,
          '৩',
          'D12',
          'চিনি ছাড়া',
          reason,
          1000,
          at,
        );
    }
  } finally {
    legacy.close();
  }
  const migrated = openDatabase(path);
  resources.push(() => migrated.sqlite.close());
  const history = migrated.db.select().from(orderHistory).all();
  expect(history).toHaveLength(3);
  expect(history.filter((entry) => entry.action === 'create')).toHaveLength(2);
  expect(history.find((entry) => entry.action === 'cancel')).toMatchObject({
    orderId: cancelledId,
    actorId: ownerId,
    actorName: 'পুরোনো অর্ডারকারী',
    fromStatus: 'PENDING',
    toStatus: 'CANCELLED',
    reason: 'মিটিং শেষ',
    at: 2000,
  });
  expect(migrated.db.select().from(orders).where(eq(orders.id, pendingId)).get()).toMatchObject({
    status: 'PENDING',
    assigneeId: null,
    acceptedAt: null,
    completedAt: null,
    note: 'চিনি ছাড়া',
  });
  expect(
    migrated.db.select().from(orders).where(eq(orders.id, cancelledId)).get()?.completedAt,
  ).toBe(2000);
  const reopened = openDatabase(path);
  resources.push(() => reopened.sqlite.close());
  expect(reopened.db.select().from(orderHistory).all()).toEqual(history);
});
