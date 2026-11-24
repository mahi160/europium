import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';
import {
  menuItemResponseSchema,
  orderResponseSchema,
  ordersResponseSchema,
  publicUserSchema,
} from '@office-service/shared';
import { z } from 'zod';
import { createApp } from './app';

const origin = 'http://localhost:5173';
const password = 'recovery-initial-password-123';
const pin = '1234';
const personalPin = '5678';
const disposers: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'office-recovery-'));
  disposers.push(() => rmSync(directory, { recursive: true, force: true }));
  const backend = createApp(
    {
      APP_ORIGIN: origin,
      AUTH_SECRET: 'recovery-auth-secret-at-least-32-characters',
      SETUP_TOKEN: 'recovery-setup-token-at-least-32-characters',
      DATABASE_PATH: join(directory, 'recovery.sqlite'),
    },
    { heartbeatMs: 50 },
  );
  disposers.push(backend.close);
  const request = (path: string, method = 'GET', body?: unknown, cookie?: string) =>
    backend.app.request('/api' + path, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  const profile = { name: 'Recovery person', language: 'en', floor: '3', desk: 'D12' };
  expect(
    (
      await request('/setup', 'POST', {
        ...profile,
        username: 'admin',
        password,
        setupToken: 'recovery-setup-token-at-least-32-characters',
      })
    ).status,
  ).toBe(201);
  const login = async (username: string, secret = password) => {
    const response = await request('/auth/login', 'POST', { username, password: secret });
    expect(response.status).toBe(200);
    return response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
  };
  const admin = await login('admin');
  const created = await request(
    '/users',
    'POST',
    { ...profile, username: 'employee', role: 'employee', password: pin },
    admin,
  );
  expect(created.status).toBe(201);
  const employee = z.object({ user: publicUserSchema }).parse(await created.json()).user;
  const cookie = await login('employee', pin);
  expect(
    (
      await request(
        '/auth/change-password',
        'POST',
        { currentPassword: pin, newPassword: personalPin },
        cookie,
      )
    ).status,
  ).toBe(200);
  const menu = await request(
    '/menu',
    'POST',
    { name: 'Recovery tea', category: 'tea', unit: 'কাপ', available: true, archived: false },
    admin,
  );
  expect(menu.status).toBe(201);
  const item = menuItemResponseSchema.parse(await menu.json()).item;
  const payload = () => ({
    idempotencyKey: randomUUID(),
    items: [{ itemId: item.id, quantity: 1 }],
    note: '',
  });
  const stream = async (sessionCookie = cookie) => {
    const response = await request('/events', 'GET', undefined, sessionCookie);
    expect(response.status).toBe(200);
    if (!response.body) throw new Error('Missing SSE body');
    const reader = response.body.getReader();
    disposers.push(() => reader.cancel());
    const decoder = new TextDecoder();
    let received = '';
    const readUntil = async (event: string) => {
      while (!received.includes('event: ' + event + '\n')) {
        const part = await reader.read();
        if (part.done) throw new Error('Stream ended before ' + event);
        received += decoder.decode(part.value, { stream: true });
      }
      const result = received;
      received = '';
      return result;
    };
    await readUntil('ready');
    return { reader, readUntil };
  };
  return { backend, request, admin, employee, cookie, payload, stream };
}

test('SSE rejects other origins and cross-origin same-site requests with a valid cookie', async () => {
  const f = await fixture();
  const attempts: Array<Record<string, string>> = [
    { Origin: 'https://other.invalid' },
    { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
    { Origin: origin, 'Sec-Fetch-Site': 'same-site' },
  ];
  for (const headers of attempts) {
    const response = await f.backend.app.request('/api/events', {
      headers: { ...headers, Cookie: f.cookie },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: 'INVALID_ORIGIN' } });
  }
  const connection = await f.stream();
  expect(await connection.readUntil('heartbeat')).toContain('data: {}');
});

test('an audit insert rollback publishes nothing and the same order key can then commit', async () => {
  const f = await fixture();
  const connection = await f.stream();
  const body = f.payload();
  f.backend.sqlite.exec(
    "CREATE TRIGGER fail_order_audit BEFORE INSERT ON order_history BEGIN SELECT RAISE(ABORT, 'audit failure'); END",
  );
  expect((await f.request('/orders', 'POST', body, f.cookie)).status).toBe(500);
  expect(
    ordersResponseSchema.parse(
      await (await f.request('/orders', 'GET', undefined, f.cookie)).json(),
    ).orders,
  ).toEqual([]);
  expect(await connection.readUntil('heartbeat')).not.toContain('event: change');
  f.backend.sqlite.exec('DROP TRIGGER fail_order_audit');
  const response = await f.request('/orders', 'POST', body, f.cookie);
  expect(response.status).toBe(201);
  const order = orderResponseSchema.parse(await response.json()).order;
  expect(await connection.readUntil('change')).toContain('data: {"kind":"order"}');
  expect(
    ordersResponseSchema
      .parse(await (await f.request('/orders', 'GET', undefined, f.cookie)).json())
      .orders.map((value) => value.id),
  ).toEqual([order.id]);
});

for (const action of ['reset-password', 'deactivate', 'logout'] as const) {
  test(
    action + ' through HTTP immediately closes all affected subscriptions without a change payload',
    async () => {
      const f = await fixture();
      const connections = await Promise.all([f.stream(), f.stream()]);
      const response =
        action === 'logout'
          ? await f.request('/auth/logout', 'POST', {}, f.cookie)
          : action === 'reset-password'
            ? await f.request(
                '/users/' + f.employee.id + '/reset-password',
                'POST',
                { newPassword: pin },
                f.admin,
              )
            : await f.request('/users/' + f.employee.id, 'PATCH', { isActive: false }, f.admin);
      expect(response.status).toBe(200);
      for (const connection of connections) {
        let frames = '';
        while (true) {
          const part = await connection.reader.read();
          if (part.done) break;
          frames += new TextDecoder().decode(part.value);
        }
        expect(frames).not.toContain('event: change');
      }
      expect((await f.request('/events', 'GET', undefined, f.cookie)).status).toBe(401);
    },
  );
}
