import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';
import { menuItemResponseSchema, orderResponseSchema, ordersResponseSchema, publicUserSchema } from '@office-service/shared';
import { createApp } from './app';
import { session, user } from './schema';

const origin = 'http://localhost:5173';
const password = 'realtime-initial-password-123';
const pin = '1234';
const personalPin = '5678';
const setupToken = 'realtime-setup-token-at-least-32-characters';
const profile = { name: 'Realtime person', language: 'en', floor: '3', desk: 'D12' } as const;
const userResponse = z.object({ user: publicUserSchema });
const resources: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const dispose of resources.splice(0).reverse()) await dispose(); });

function request(backend: ReturnType<typeof createApp>, path: string, method = 'GET', body?: unknown, cookie?: string) {
  return backend.app.request('/api' + path, { method, headers: {
    Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
  }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
}

async function subscribe(backend: ReturnType<typeof createApp>, cookie: string) {
  const response = await request(backend, '/events', 'GET', undefined, cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  if (!response.body) throw new Error('Missing SSE body');
  const reader = response.body.getReader();
  resources.push(() => reader.cancel());
  const decoder = new TextDecoder();
  const frames: string[] = [];
  let buffer = '';
  let ended = false;
  const waiters = new Set<() => void>();
  const pump = (async () => {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        frames.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
      for (const notify of waiters) notify();
    }
    ended = true;
    for (const notify of waiters) notify();
  })();
  async function until(predicate: () => boolean) {
    if (predicate()) return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { waiters.delete(notify); reject(new Error('SSE frame timeout')); }, 3000);
      const notify = () => {
        if (!predicate()) return;
        clearTimeout(timeout); waiters.delete(notify); resolve();
      };
      waiters.add(notify);
      notify();
    });
  }
  const count = (event: string) => frames.filter((frame) => frame.startsWith('event: ' + event + '\n')).length;
  await until(() => count('ready') === 1);
  return {
    frames, count,
    change: async (previous = count('change')) => until(() => count('change') > previous),
    quiet: async () => {
      const before = count('change');
      const beat = count('heartbeat');
      await until(() => count('heartbeat') > beat);
      expect(count('change')).toBe(before);
    },
    end: async () => { await until(() => ended); await pump; },
    cancel: () => reader.cancel(),
  };
}

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'office-events-'));
  resources.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = { APP_ORIGIN: origin, AUTH_SECRET: 'realtime-auth-secret-at-least-32-characters', SETUP_TOKEN: setupToken, DATABASE_PATH: join(directory, 'events.sqlite') };
  const backend = createApp(config, { heartbeatMs: 100 });
  resources.push(backend.close);
  expect((await request(backend, '/setup', 'POST', { ...profile, username: 'admin', password, setupToken })).status).toBe(201);
  async function login(username: string, secret = password) {
    const response = await request(backend, '/auth/login', 'POST', { username, password: secret });
    expect(response.status).toBe(200);
    return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  }
  const admin = await login('admin');
  async function person(role: 'employee' | 'staff', username: string) {
    const response = await request(backend, '/users', 'POST', { ...profile, username, role, password: pin }, admin);
    expect(response.status).toBe(201);
    const value = userResponse.parse(await response.json()).user;
    const cookie = await login(username, pin);
    expect((await request(backend, '/auth/change-password', 'POST', { currentPassword: pin, newPassword: personalPin }, cookie)).status).toBe(200);
    return { ...value, cookie };
  }
  const employee = await person('employee', 'employee');
  const stranger = await person('employee', 'stranger');
  const staff = await person('staff', 'staff');
  const second = await person('staff', 'second');
  const menu = { name: 'Private tea', category: 'tea', unit: 'কাপ', available: true, archived: false };
  const item = menuItemResponseSchema.parse(await (await request(backend, '/menu', 'POST', menu, admin)).json()).item;
  const payload = () => ({ idempotencyKey: randomUUID(), items: [{ itemId: item.id, quantity: 1 }], note: 'private note' });
  async function place(body = payload()) {
    const response = await request(backend, '/orders', 'POST', body, employee.cookie);
    expect(response.status).toBe(201);
    return orderResponseSchema.parse(await response.json()).order;
  }
  async function command(id: string, action: string, cookie = staff.cookie) {
    const response = await request(backend, '/orders/' + id + '/' + action, 'POST', ['cancel', 'reject', 'requeue'].includes(action) ? { reason: 'private reason' } : {}, cookie);
    expect(response.status).toBe(200);
  }
  return { backend, config, admin, employee, stranger, staff, second, menu, item, payload, place, command, login };
}

test('authorized streams invalidate only relevant clients after committed creates and transitions, without order content', async () => {
  const f = await fixture();
  const owner = await subscribe(f.backend, f.employee.cookie);
  const stranger = await subscribe(f.backend, f.stranger.cookie);
  const staff = await subscribe(f.backend, f.staff.cookie);
  const second = await subscribe(f.backend, f.second.cookie);
  const admin = await subscribe(f.backend, f.admin);
  const order = await f.place();
  await Promise.all([owner.change(0), staff.change(0), second.change(0), admin.change(0)]);
  expect(ordersResponseSchema.parse(await (await request(f.backend, '/orders', 'GET', undefined, f.employee.cookie)).json()).orders[0]?.id).toBe(order.id);
  await stranger.quiet();
  await f.command(order.id, 'accept');
  await Promise.all([owner.change(1), staff.change(1), second.change(1), admin.change(1)]);
  expect((await request(f.backend, '/orders/' + order.id, 'GET', undefined, f.second.cookie)).status).toBe(404);
  await f.command(order.id, 'deliver');
  await Promise.all([owner.change(2), staff.change(2), admin.change(2)]);
  await second.quiet();
  expect(second.count('change')).toBe(2);
  for (const stream of [owner, stranger, staff, second, admin]) {
    for (const frame of stream.frames) {
      expect(frame.split('\n').filter((line) => line.startsWith('data:'))).toEqual([frame.includes('event: change') ? 'data: {"kind":"order"}' : 'data: {}']);
      expect(frame).not.toContain(order.id);
      expect(frame).not.toContain('private');
    }
  }
});

test('replays, rejected commands, unavailable items and unchanged menu/profile updates do not publish', async () => {
  const f = await fixture();
  const body = f.payload();
  const order = await f.place(body);
  const stream = await subscribe(f.backend, f.employee.cookie);
  expect((await request(f.backend, '/orders', 'POST', body, f.employee.cookie)).status).toBe(200);
  expect((await request(f.backend, '/orders', 'POST', { ...body, note: 'changed' }, f.employee.cookie)).status).toBe(409);
  expect((await request(f.backend, '/orders', 'POST', { ...f.payload(), items: [{ itemId: randomUUID(), quantity: 1 }] }, f.employee.cookie)).status).toBe(409);
  expect((await request(f.backend, '/orders/' + order.id + '/accept', 'POST', {}, f.employee.cookie)).status).toBe(403);
  expect((await request(f.backend, '/menu/' + f.item.id, 'PATCH', f.menu, f.admin)).status).toBe(200);
  expect((await request(f.backend, '/me', 'PATCH', { name: profile.name }, f.employee.cookie)).status).toBe(200);
  await stream.quiet();
  expect(stream.count('change')).toBe(0);
  expect((await request(f.backend, '/menu/' + f.item.id, 'PATCH', { ...f.menu, available: false }, f.admin)).status).toBe(200);
  await stream.change(0);
});

test('ready registration closes the fetch/subscribe gap; missed events and server restart reconcile from the database', async () => {
  const f = await fixture();
  const before = ordersResponseSchema.parse(await (await request(f.backend, '/orders', 'GET', undefined, f.employee.cookie)).json());
  expect(before.orders).toEqual([]);
  const missed = await f.place();
  const stream = await subscribe(f.backend, f.employee.cookie);
  const racing = await f.place();
  await stream.change(0);
  const reconcile = async (backend: ReturnType<typeof createApp>) => ordersResponseSchema.parse(await (await request(backend, '/orders', 'GET', undefined, f.employee.cookie)).json()).orders.map((order) => order.id);
  expect(await reconcile(f.backend)).toEqual(expect.arrayContaining([missed.id, racing.id]));
  await stream.cancel();
  await stream.end();
  await f.command(missed.id, 'accept');
  const reconnect = await subscribe(f.backend, f.employee.cookie);
  expect(reconnect.count('change')).toBe(0);
  expect(await reconcile(f.backend)).toContain(missed.id);
  f.backend.close();
  await reconnect.end();
  const restarted = createApp(f.config, { heartbeatMs: 100 });
  resources.push(restarted.close);
  const fresh = await subscribe(restarted, f.employee.cookie);
  expect(fresh.count('ready')).toBe(1);
  expect(await reconcile(restarted)).toEqual(expect.arrayContaining([missed.id, racing.id]));
});

for (const invalidation of ['revoke', 'expire', 'deactivate', 'role', 'temporary'] as const) {
  test(invalidation + ' terminates registered streams on heartbeat and blocks late events', async () => {
    const f = await fixture();
    const stream = await subscribe(f.backend, f.staff.cookie);
    if (invalidation === 'revoke') f.backend.db.delete(session).where(eq(session.userId, f.staff.id)).run();
    if (invalidation === 'expire') f.backend.db.update(session).set({ expiresAt: new Date(0) }).where(eq(session.userId, f.staff.id)).run();
    if (invalidation === 'deactivate') f.backend.db.update(user).set({ banned: true }).where(eq(user.id, f.staff.id)).run();
    if (invalidation === 'role') f.backend.db.update(user).set({ role: 'employee' }).where(eq(user.id, f.staff.id)).run();
    if (invalidation === 'temporary') f.backend.db.update(user).set({ mustChangePassword: true }).where(eq(user.id, f.staff.id)).run();
    await stream.end();
    await f.place();
    expect(stream.count('change')).toBe(0);
    const response = await request(f.backend, '/events', 'GET', undefined, f.staff.cookie);
    if (invalidation === 'role') {
      expect(response.status).toBe(200);
      await response.body?.cancel();
      expect((await request(f.backend, '/work/orders', 'GET', undefined, f.staff.cookie)).status).toBe(403);
    } else expect(response.status).toBe(invalidation === 'temporary' ? 403 : 401);
  });
}

test('fresh authorization before publish closes revoked streams immediately; close cleans idle and unread streams', async () => {
  const f = await fixture();
  expect((await request(f.backend, '/events')).status).toBe(401);
  const stream = await subscribe(f.backend, f.staff.cookie);
  f.backend.db.delete(session).where(eq(session.userId, f.staff.id)).run();
  await f.place();
  await stream.end();
  expect(stream.count('change')).toBe(0);
  const idle = await subscribe(f.backend, f.employee.cookie);
  const unread = await request(f.backend, '/events', 'GET', undefined, f.admin);
  f.backend.close();
  f.backend.close();
  await idle.end();
  expect(await unread.text()).not.toContain('event: change');
  await new Promise((resolve) => setTimeout(resolve, 250));
});
