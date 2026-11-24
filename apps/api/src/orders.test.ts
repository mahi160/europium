import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  apiErrorSchema,
  menuItemResponseSchema,
  menuResponseSchema,
  orderResponseSchema,
  ordersResponseSchema,
  publicUserSchema,
} from '@office-service/shared';
import { createApp } from './app';
import type { AppConfig } from './config';
import { menuItem, orderItem, orders, session } from './schema';

const origin = 'http://localhost:5173';
const password = 'ordering-initial-password-123';
const pin = '1234';
const personalPin = '5678';
const setupToken = 'ordering-setup-token-at-least-32-characters';
const profile = { name: 'অর্ডারকারী', floor: '৩', desk: 'D12', language: 'en' } as const;
const menuData = {
  name: 'দুধ চা',
  category: 'tea',
  unit: 'কাপ',
  available: true,
  archived: false,
} as const;
const userResponse = z.object({ user: publicUserSchema });
const resources: Array<() => void> = [];
afterEach(() => {
  vi.useRealTimers();
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
async function fixture(stats: Pick<AppConfig, 'STATS_TOKEN' | 'OFFICE_TIMEZONE'> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'office-ordering-'));
  resources.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    APP_ORIGIN: origin,
    AUTH_SECRET: 'ordering-auth-secret-at-least-32-characters',
    SETUP_TOKEN: setupToken,
    DATABASE_PATH: join(directory, 'orders.sqlite'),
    ...stats,
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
  const response = await request(backend, '/menu', 'POST', menuData, admin);
  expect(response.status).toBe(201);
  const item = menuItemResponseSchema.parse(await response.json()).item;
  const payload = () => ({
    idempotencyKey: randomUUID(),
    items: [{ itemId: item.id, quantity: 2 }],
    note: 'চিনি ছাড়া',
  });
  return { backend, config, admin, item, payload };
}
async function person(
  backend: ReturnType<typeof createApp>,
  admin: string,
  role: 'employee' | 'staff' | 'admin',
  username: string = role,
) {
  const response = await request(
    backend,
    '/users',
    'POST',
    { ...profile, username, password: pin, role },
    admin,
  );
  expect(response.status).toBe(201);
  const user = userResponse.parse(await response.json()).user;
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
  return { user, cookie };
}
async function place(backend: ReturnType<typeof createApp>, cookie: string, payload: unknown) {
  const response = await request(backend, '/orders', 'POST', payload, cookie);
  expect(response.status).toBe(201);
  return orderResponseSchema.parse(await response.json()).order;
}

test('hub stats are disabled without a token and do not accept user sessions', async () => {
  const disabled = await fixture();
  await failure(await disabled.backend.app.request('/api/stats'), 404, 'NOT_FOUND');
  const token = randomUUID() + randomUUID();
  const { backend, admin } = await fixture({ STATS_TOKEN: token });
  await failure(await request(backend, '/stats', 'GET', undefined, admin), 401, 'UNAUTHORIZED');
  await failure(
    await backend.app.request('/api/stats', {
      headers: { Authorization: 'Bearer ' + token.slice(1) },
    }),
    401,
    'UNAUTHORIZED',
  );
  const response = await backend.app.request('/api/stats', {
    headers: { Authorization: 'Bearer ' + token },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.json()).toEqual({
    generatedAt: expect.any(Number),
    today: { orders: 0, items: 0 },
    week: { items: 0, topItems: [], busiestHour: null },
  });
  await failure(
    await backend.app.request('/api/orders', { headers: { Authorization: 'Bearer ' + token } }),
    401,
    'UNAUTHORIZED',
  );
});

for (const office of [
  {
    timezone: undefined,
    now: '2025-02-04T11:00:00Z',
    week: '2025-02-02T18:00:00Z',
    today: '2025-02-03T18:00:00Z',
    peak: '2025-02-04T10:15:00Z',
    busiestHour: 16,
  },
  {
    timezone: 'America/New_York',
    now: '2025-11-04T22:00:00Z',
    week: '2025-11-03T05:00:00Z',
    today: '2025-11-04T05:00:00Z',
    peak: '2025-11-04T21:15:00Z',
    busiestHour: 16,
  },
]) {
  test(`hub stats count only delivered orders at local boundaries in ${office.timezone ?? 'Asia/Dhaka'}`, async () => {
    const token = randomUUID() + randomUUID();
    const { backend, admin, item, payload } = await fixture({
      STATS_TOKEN: token,
      OFFICE_TIMEZONE: office.timezone,
    });
    const second = menuItemResponseSchema.parse(
      await (await request(backend, '/menu', 'POST', { ...menuData, name: 'রং চা' }, admin)).json(),
    ).item;
    const now = Date.parse(office.now);
    const monday = Date.parse(office.week);
    const midnight = Date.parse(office.today);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    async function seed(
      status: 'DELIVERED' | 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED',
      completedAt: number,
      quantity: number,
      extra = false,
    ) {
      const order = await place(backend, admin, {
        ...payload(),
        items: [
          { itemId: item.id, quantity },
          ...(extra ? [{ itemId: second.id, quantity: 2 }] : []),
        ],
      });
      backend.db
        .update(orders)
        .set({ status, completedAt, createdAt: monday - 86400000 })
        .where(eq(orders.id, order.id))
        .run();
    }
    await seed('DELIVERED', monday - 1, 90);
    await seed('DELIVERED', monday, 3);
    await seed('DELIVERED', midnight - 1, 1);
    await seed('DELIVERED', midnight, 4);
    await seed('DELIVERED', Date.parse(office.peak), 5, true);
    await seed('DELIVERED', Date.parse(office.peak) + 60000, 6);
    await seed('DELIVERED', Date.parse(office.peak) + 120000, 1);
    await seed('DELIVERED', now + 1, 90);
    for (const status of ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'] as const)
      await seed(status, now, 90);
    const response = await backend.app.request('/api/stats', {
      headers: { Authorization: 'Bearer ' + token },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      generatedAt: now,
      today: { orders: 4, items: 18 },
      week: {
        items: 22,
        topItems: [
          { name: item.name, quantity: 20 },
          { name: second.name, quantity: 2 },
        ],
        busiestHour: office.busiestHour,
      },
    });
  });
}

test('menu boundary is strict, admin-only, and archive preserves referenced items', async () => {
  const { backend, admin, item, payload } = await fixture();
  const employee = await person(backend, admin, 'employee');
  for (const [path, method] of [
    ['/menu', 'GET'],
    ['/menu', 'POST'],
    ['/menu/' + item.id, 'PATCH'],
    ['/orders', 'GET'],
    ['/orders', 'POST'],
    ['/orders/' + randomUUID(), 'GET'],
    ['/orders/' + randomUUID() + '/cancel', 'POST'],
  ]) {
    await failure(await request(backend, path, method), 401, 'UNAUTHORIZED');
  }
  for (const role of ['employee', 'staff'] as const) {
    const cookie =
      role === 'employee' ? employee.cookie : (await person(backend, admin, role)).cookie;
    await failure(await request(backend, '/menu', 'POST', menuData, cookie), 403, 'FORBIDDEN');
    await failure(
      await request(backend, '/menu/' + item.id, 'PATCH', menuData, cookie),
      403,
      'FORBIDDEN',
    );
  }
  for (const data of [
    { ...menuData, unit: 'cup' },
    { ...menuData, category: 'other' },
    { ...menuData, name: '' },
    { ...menuData, inventory: 10 },
  ]) {
    await failure(await request(backend, '/menu', 'POST', data, admin), 400, 'VALIDATION_ERROR');
  }
  const order = await place(backend, employee.cookie, payload());
  expect(
    (await request(backend, '/menu/' + item.id, 'PATCH', { ...menuData, archived: true }, admin))
      .status,
  ).toBe(200);
  const ids = async (cookie: string) =>
    menuResponseSchema
      .parse(await (await request(backend, '/menu', 'GET', undefined, cookie)).json())
      .items.map((entry) => entry.id);
  expect(await ids(employee.cookie)).not.toContain(item.id);
  expect(await ids(admin)).toContain(item.id);
  const seeded = menuResponseSchema
    .parse(await (await request(backend, '/menu', 'GET', undefined, employee.cookie)).json())
    .items.map((entry) => entry.name);
  expect(seeded).toEqual(expect.arrayContaining(['রং চা', 'হোয়াইট কফি', 'মুড়ি']));
  expect(
    orderResponseSchema.parse(
      await (
        await request(backend, '/orders/' + order.id, 'GET', undefined, employee.cookie)
      ).json(),
    ).order.items[0].name,
  ).toBe(menuData.name);
  await failure(
    await request(backend, '/orders', 'POST', payload(), employee.cookie),
    409,
    'ITEM_UNAVAILABLE',
  );
  expect((await request(backend, '/menu/' + item.id, 'DELETE', {}, admin)).status).toBe(404);
});

test('validates order input and unavailable selections atomically without partial orders', async () => {
  const { backend, admin, item, payload } = await fixture();
  const valid = payload();
  for (const data of [
    { ...valid, items: [] },
    { ...valid, items: [{ itemId: item.id, quantity: 0 }] },
    { ...valid, items: [{ itemId: item.id, quantity: -1 }] },
    { ...valid, items: [{ itemId: item.id, quantity: 1.5 }] },
    { ...valid, items: [{ itemId: item.id, quantity: '2' }] },
    { ...valid, items: [valid.items[0], valid.items[0]] },
    { ...valid, floor: '9' },
    { ...valid, desk: 'Z9' },
    { ...valid, note: 'x'.repeat(501) },
    { ...valid, userId: 'another-user' },
    { ...valid, idempotencyKey: 'not-a-uuid' },
  ])
    await failure(await request(backend, '/orders', 'POST', data, admin), 400, 'VALIDATION_ERROR');
  await failure(
    await request(
      backend,
      '/orders',
      'POST',
      { ...valid, items: [...valid.items, { itemId: randomUUID(), quantity: 1 }] },
      admin,
    ),
    409,
    'ITEM_UNAVAILABLE',
  );
  await request(backend, '/menu/' + item.id, 'PATCH', { ...menuData, available: false }, admin);
  await failure(await request(backend, '/orders', 'POST', valid, admin), 409, 'ITEM_UNAVAILABLE');
  expect(backend.db.select().from(orders).all()).toHaveLength(0);
  expect(backend.db.select().from(orderItem).all()).toHaveLength(0);
});

test('all roles can place multiple personal orders; ownership and pending-only cancellation are enforced', async () => {
  const { backend, admin, payload } = await fixture();
  const employee = await person(backend, admin, 'employee');
  const staff = await person(backend, admin, 'staff');
  for (const cookie of [admin, employee.cookie, staff.cookie]) {
    await place(backend, cookie, payload());
    await place(backend, cookie, payload());
    expect(
      ordersResponseSchema.parse(
        await (await request(backend, '/orders', 'GET', undefined, cookie)).json(),
      ).orders,
    ).toHaveLength(2);
  }
  const mine = await place(backend, employee.cookie, payload());
  const otherEmployee = await person(backend, admin, 'employee', 'other_employee');
  await failure(
    await request(backend, '/orders/' + mine.id, 'GET', undefined, otherEmployee.cookie),
    404,
    'NOT_FOUND',
  );
  expect(
    ordersResponseSchema.parse(
      await (await request(backend, '/orders', 'GET', undefined, otherEmployee.cookie)).json(),
    ).orders,
  ).toEqual([]);
  for (const privileged of [admin, staff.cookie]) {
    const response = await request(backend, '/orders/' + mine.id, 'GET', undefined, privileged);
    expect(response.status).toBe(200);
    expect(orderResponseSchema.parse(await response.json()).order).toEqual(mine);
    expect(
      ordersResponseSchema
        .parse(await (await request(backend, '/orders', 'GET', undefined, privileged)).json())
        .orders.map((order) => order.id),
    ).not.toContain(mine.id);
  }
  await failure(
    await request(backend, '/orders/' + mine.id + '/cancel', 'POST', { reason: '' }, admin),
    403,
    'FORBIDDEN',
  );
  for (const other of [staff.cookie, otherEmployee.cookie]) {
    await failure(
      await request(backend, '/orders/' + mine.id + '/cancel', 'POST', { reason: '' }, other),
      404,
      'NOT_FOUND',
    );
  }
  const cancelled = await request(
    backend,
    '/orders/' + mine.id + '/cancel',
    'POST',
    { reason: 'মিটিং শেষ' },
    employee.cookie,
  );
  expect(orderResponseSchema.parse(await cancelled.json()).order).toMatchObject({
    status: 'CANCELLED',
    reason: 'মিটিং শেষ',
  });
  for (const status of ['CANCELLED', 'ACCEPTED', 'DELIVERED', 'REJECTED'] as const) {
    backend.db.update(orders).set({ status }).where(eq(orders.id, mine.id)).run();
    await failure(
      await request(
        backend,
        '/orders/' + mine.id + '/cancel',
        'POST',
        { reason: '' },
        employee.cookie,
      ),
      409,
      'ORDER_NOT_PENDING',
    );
  }
});

test('retries return original after unavailable/archive, canonicalize items and reject payload/key mismatch', async () => {
  const { backend, config, admin, item, payload } = await fixture();
  const secondItem = menuItemResponseSchema.parse(
    await (
      await request(
        backend,
        '/menu',
        'POST',
        { ...menuData, name: 'বিস্কুট', category: 'snack', unit: 'প্যাকেট' },
        admin,
      )
    ).json(),
  ).item;
  const data = {
    ...payload(),
    items: [
      { itemId: item.id, quantity: 1 },
      { itemId: secondItem.id, quantity: 2 },
    ],
  };
  const other = createApp(config);
  resources.push(other.close);
  const responses = await Promise.all(
    [backend, other].map((app) => request(app, '/orders', 'POST', data, admin)),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
  const first = orderResponseSchema.parse(await responses[0].json()).order;
  expect(orderResponseSchema.parse(await responses[1].json()).order).toEqual(first);
  await request(
    other,
    '/menu/' + item.id,
    'PATCH',
    { ...menuData, available: false, archived: true },
    admin,
  );
  const retried = await request(
    other,
    '/orders',
    'POST',
    { ...data, items: [...data.items].reverse() },
    admin,
  );
  expect(retried.status).toBe(200);
  expect(orderResponseSchema.parse(await retried.json()).order).toEqual(first);
  for (const change of [{ note: 'different' }, { items: [{ itemId: item.id, quantity: 3 }] }]) {
    await failure(
      await request(other, '/orders', 'POST', { ...data, ...change }, admin),
      409,
      'IDEMPOTENCY_MISMATCH',
    );
  }
  expect(backend.db.select().from(orders).all()).toHaveLength(1);
});

test('orders snapshot the admin-assigned location and survive menu/location edits and a backend restart', async () => {
  const { backend, config, admin, item, payload } = await fixture();
  const employee = await person(backend, admin, 'employee');
  const data = payload();
  const mine = await place(backend, employee.cookie, data);
  await place(backend, admin, data);
  await request(
    backend,
    '/menu/' + item.id,
    'PATCH',
    { ...menuData, name: 'নতুন চা', unit: 'গ্লাস' },
    admin,
  );
  await failure(
    await request(backend, '/me', 'PATCH', { floor: '9', desk: 'Z9' }, employee.cookie),
    400,
    'VALIDATION_ERROR',
  );
  expect(
    (
      await request(
        backend,
        '/users/' + employee.user.id,
        'PATCH',
        { floor: '9', desk: 'Z9' },
        admin,
      )
    ).status,
  ).toBe(200);
  const moved = await place(backend, employee.cookie, payload());
  expect(moved).toMatchObject({ floor: '9', desk: 'Z9' });
  backend.close();
  resources.pop();
  const reopened = createApp(config);
  resources.push(reopened.close);
  const response = await request(reopened, '/orders/' + mine.id, 'GET', undefined, employee.cookie);
  expect(orderResponseSchema.parse(await response.json()).order).toEqual(mine);
  expect(mine).toMatchObject({
    floor: '৩',
    desk: 'D12',
    note: 'চিনি ছাড়া',
    items: [{ name: 'দুধ চা', unit: 'কাপ', quantity: 2 }],
  });
});

test('independent connections serialize order creation against competing availability writes', async () => {
  const { backend, config, admin, item, payload } = await fixture();
  const other = createApp(config);
  resources.push(other.close);
  for (const orderFirst of [true, false]) {
    expect((await request(other, '/menu/' + item.id, 'PATCH', menuData, admin)).status).toBe(200);
    const before = backend.db.select().from(orders).all().length;
    const create = () => request(backend, '/orders', 'POST', payload(), admin);
    const disable = () =>
      request(other, '/menu/' + item.id, 'PATCH', { ...menuData, available: false }, admin);
    const responses = await Promise.all(orderFirst ? [create(), disable()] : [disable(), create()]);
    const creation = responses[orderFirst ? 0 : 1];
    expect([201, 409]).toContain(creation.status);
    expect(responses[orderFirst ? 1 : 0].status).toBe(200);
    expect(
      backend.db.select().from(menuItem).where(eq(menuItem.id, item.id)).get()?.available,
    ).toBe(false);
    expect(backend.db.select().from(orders).all()).toHaveLength(
      before + (creation.status === 201 ? 1 : 0),
    );
    if (creation.status === 201)
      expect(orderResponseSchema.parse(await creation.json()).order.items).toMatchObject([
        { name: menuData.name, quantity: 2 },
      ]);
    else expect(apiErrorSchema.parse(await creation.json()).error.code).toBe('ITEM_UNAVAILABLE');
    await failure(await create(), 409, 'ITEM_UNAVAILABLE');
  }
});

test('order availability is read only after a competing connection releases its write lock', async () => {
  const { backend, config, admin, item, payload } = await fixture();
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const { Database } = require('bun:sqlite');
    const sqlite = new Database(workerData.path);
    sqlite.exec('PRAGMA busy_timeout = 5000');
    sqlite.exec('BEGIN IMMEDIATE');
    sqlite.prepare('UPDATE menu_item SET available = 0 WHERE id = ?').run(workerData.itemId);
    parentPort.postMessage('locked');
    setTimeout(() => { sqlite.exec('COMMIT'); sqlite.close(); }, 200);
  `,
    {
      eval: true,
      workerData: {
        path: config.DATABASE_PATH,
        itemId: item.id,
      },
    },
  );
  const finished = new Promise<void>((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Availability writer failed')),
    );
  });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('message', () => resolve());
      worker.once('error', reject);
    });
    await failure(
      await request(backend, '/orders', 'POST', payload(), admin),
      409,
      'ITEM_UNAVAILABLE',
    );
    expect(backend.db.select().from(orders).all()).toHaveLength(0);
    expect(backend.db.select().from(orderItem).all()).toHaveLength(0);
  } finally {
    await finished;
  }
});

test('active orders remain visible across days; terminal orders use updated day in Dhaka', async () => {
  const { backend, admin, payload } = await fixture();
  const offset = 6 * 60 * 60 * 1000;
  const midnight = (Math.floor((Date.now() + offset) / 86400000) + 1) * 86400000 - offset;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(midnight));
  const pending = await place(backend, admin, payload());
  const accepted = await place(backend, admin, payload());
  backend.db
    .update(orders)
    .set({ createdAt: midnight - 86400000, updatedAt: midnight - 86400000 })
    .where(eq(orders.id, pending.id))
    .run();
  backend.db
    .update(orders)
    .set({ status: 'ACCEPTED', updatedAt: midnight - 86400000 })
    .where(eq(orders.id, accepted.id))
    .run();
  const visible = [pending.id, accepted.id];
  for (const status of ['DELIVERED', 'REJECTED', 'CANCELLED'] as const) {
    const today = await place(backend, admin, payload());
    const yesterday = await place(backend, admin, payload());
    backend.db
      .update(orders)
      .set({ status, createdAt: midnight - 86400000, updatedAt: midnight, reason: 'কারণ' })
      .where(eq(orders.id, today.id))
      .run();
    backend.db
      .update(orders)
      .set({ status, updatedAt: midnight - 1 })
      .where(eq(orders.id, yesterday.id))
      .run();
    visible.push(today.id);
  }
  const list = ordersResponseSchema.parse(
    await (await request(backend, '/orders', 'GET', undefined, admin)).json(),
  ).orders;
  expect(list.map((entry) => entry.id).sort()).toEqual(visible.sort());
  expect(list.filter((entry) => entry.reason === 'কারণ')).toHaveLength(3);
});

test('temporary passwords, revocation and deactivation prevent ordering or menu writes', async () => {
  const { backend, admin, item, payload } = await fixture();
  const response = await request(
    backend,
    '/users',
    'POST',
    { ...profile, username: 'temporary', role: 'employee', password: pin },
    admin,
  );
  const target = userResponse.parse(await response.json()).user;
  const temporary = await login(backend, 'temporary', pin);
  await failure(
    await request(backend, '/orders', 'POST', payload(), temporary),
    403,
    'PASSWORD_CHANGE_REQUIRED',
  );
  await failure(
    await request(backend, '/menu', 'GET', undefined, temporary),
    403,
    'PASSWORD_CHANGE_REQUIRED',
  );
  await request(backend, '/users/' + target.id, 'PATCH', { isActive: false }, admin);
  await failure(
    await request(backend, '/orders', 'POST', payload(), temporary),
    401,
    'UNAUTHORIZED',
  );
  const pendingWrite = request(
    backend,
    '/menu/' + item.id,
    'PATCH',
    { ...menuData, available: false },
    admin,
  );
  backend.db.delete(session).run();
  await failure(await pendingWrite, 401, 'UNAUTHORIZED');
  expect(backend.db.select().from(menuItem).where(eq(menuItem.id, item.id)).get()?.available).toBe(
    true,
  );
});
