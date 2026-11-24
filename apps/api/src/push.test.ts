import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateVAPIDKeys } from 'web-push';
import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';
import { menuItemResponseSchema, notificationText, orderResponseSchema, publicUserSchema, type NotificationPayload } from '@office-service/shared';
import { createApp } from './app';
import type { PushTransport } from './push';

const origin = 'http://localhost:5173';
const password = 'push-initial-password-123';
const pin = '1234';
const personalPin = '5678';
const setupToken = 'push-setup-token-at-least-32-characters';
const personResponse = z.object({ user: publicUserSchema });
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function request(backend: ReturnType<typeof createApp>, path: string, method = 'GET', body?: unknown, cookie?: string) {
  return backend.app.request('/api' + path, { method, headers: {
    Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
  }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'office-push-'));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const vapid = generateVAPIDKeys();
  const config = { APP_ORIGIN: origin, AUTH_SECRET: 'push-auth-secret-at-least-32-characters', SETUP_TOKEN: setupToken,
    DATABASE_PATH: join(directory, 'push.sqlite'), VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:operator@example.com' };
  let now = Date.now() + 1000;
  const sent: Array<{ endpoint: string; payload: NotificationPayload }> = [];
  let external: PushTransport = async () => {};
  const options = { clock: () => now, transport: async (...args: Parameters<PushTransport>) => {
    const [subscription, payload] = args;
    sent.push({ endpoint: subscription.endpoint, payload });
    await external(...args);
  } };
  const backend = createApp(config, options); cleanup.push(backend.close);
  async function login(username: string, secret = password) {
    const response = await request(backend, '/auth/login', 'POST', { username, password: secret });
    expect(response.status).toBe(200);
    return response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  }
  expect((await request(backend, '/setup', 'POST', { name: 'Admin', username: 'admin', password, setupToken, language: 'en', floor: '', desk: '' })).status).toBe(201);
  const admin = await login('admin');
  async function person(role: 'staff' | 'employee', username: string, language: 'bn' | 'en') {
    const response = await request(backend, '/users', 'POST', { name: username, username, role, language, password: pin, floor: '3', desk: 'D12' }, admin);
    expect(response.status).toBe(201);
    const value = personResponse.parse(await response.json()).user;
    const cookie = await login(username, pin);
    expect((await request(backend, '/auth/change-password', 'POST', { currentPassword: pin, newPassword: personalPin }, cookie)).status).toBe(200);
    return { ...value, cookie };
  }
  const employee = await person('employee', 'employee', 'bn');
  const staff = await person('staff', 'staff_one', 'en');
  const second = await person('staff', 'staff_two', 'bn');
  const keys = { p256dh: generateVAPIDKeys().publicKey, auth: Buffer.alloc(16, 1).toString('base64url') };
  function subscription(id: string) { return { endpoint: 'https://fcm.googleapis.com/fcm/send/' + id, keys }; }
  async function subscribe(cookie: string, id: string) {
    const value = subscription(id);
    expect((await request(backend, '/push/subscription', 'POST', value, cookie)).status).toBe(200);
    return value;
  }
  const itemResponse = await request(backend, '/menu', 'POST', { name: 'চা', category: 'tea', unit: 'কাপ', available: true, archived: false }, admin);
  const item = menuItemResponseSchema.parse(await itemResponse.json()).item;
  async function place() {
    const response = await request(backend, '/orders', 'POST', { idempotencyKey: randomUUID(), items: [{ itemId: item.id, quantity: 2 }], note: 'PRIVATE NOTE credentials must never appear' }, employee.cookie);
    expect(response.status).toBe(201);
    now = Math.max(now, Date.now());
    return orderResponseSchema.parse(await response.json()).order;
  }
  async function command(id: string, action: string, cookie: string, reason?: string) {
    const response = await request(backend, '/orders/' + id + '/' + action, 'POST', reason === undefined ? {} : { reason }, cookie);
    expect(response.status).toBe(200);
    now = Math.max(now, Date.now());
    return orderResponseSchema.parse(await response.json()).order;
  }
  let current = backend;
  function reopen() {
    current.close();
    current = createApp(config, options); cleanup.push(current.close);
    return current;
  }
  return { backend, config, admin, employee, staff, second, sent, login, subscribe, subscription, place, command, reopen,
    advance: (ms: number) => { now += ms; }, boundary: (transport: PushTransport) => { external = transport; } };
}

test('initial and five-minute notifications reach active subscribed staff only, in saved languages, without notes or credentials', async () => {
  const f = await fixture();
  await f.subscribe(f.staff.cookie, 'a'); await f.subscribe(f.second.cookie, 'b');
  await f.subscribe(f.employee.cookie, 'employee'); await f.subscribe(f.admin, 'admin');
  const pending = await f.place();
  expect(f.sent).toEqual([]);
  expect(f.backend.sqlite.prepare('SELECT order_id, history_id, due_at, initial FROM push_schedule').all()).toEqual([
    { order_id: pending.id, history_id: pending.audit[0].id, due_at: pending.updatedAt, initial: 1 },
  ]);
  await f.backend.push.tick();
  expect(f.sent.map((value) => value.payload)).toEqual([
    { kind: 'create', language: 'en', target: '/work?order=' + pending.id, reason: null },
    { kind: 'create', language: 'bn', target: '/work?order=' + pending.id, reason: null },
  ]);
  expect(notificationText(f.sent[1].payload).title).toBe('নতুন অনুরোধ অপেক্ষমাণ');
  expect(JSON.stringify(f.sent)).not.toContain('PRIVATE NOTE');
  expect(JSON.stringify(f.sent)).not.toContain('keys');
  f.advance(299999); await f.backend.push.tick(); expect(f.sent).toHaveLength(2);
  f.advance(1); await f.backend.push.tick(); expect(f.sent).toHaveLength(4);
  expect(f.sent.slice(2).every((value) => value.payload.kind === 'reminder')).toBe(true);
  await f.command(pending.id, 'accept', f.staff.cookie);
  f.advance(300000); await f.backend.push.tick();
  expect(f.sent.filter((value) => value.payload.target.startsWith('/work?'))).toHaveLength(4);
  expect(f.sent.slice(4).map((value) => value.payload)).toEqual([
    { kind: 'claimed', language: 'bn', target: '/work', reason: null, id: expect.any(Number), requestedBy: 'employee', acceptedBy: 'staff_one' },
    { kind: 'accept', language: 'bn', target: '/orders?order=' + pending.id, reason: null },
  ]);
});

test('pending scheduling and the transition outbox survive a commit then restart, without missed reminder replay', async () => {
  const f = await fixture(); await f.subscribe(f.staff.cookie, 'staff');
  const order = await f.place();
  let restarted = f.reopen();
  await restarted.push.tick(); expect(f.sent).toHaveLength(1);
  restarted = f.reopen();
  f.advance(3600000); await restarted.push.tick(); expect(f.sent).toHaveLength(2);
  await restarted.push.tick(); expect(f.sent).toHaveLength(2);
  f.advance(299999); await restarted.push.tick(); expect(f.sent).toHaveLength(2);
  f.advance(1); await restarted.push.tick(); expect(f.sent).toHaveLength(3);
  expect(f.sent.every((value) => value.payload.target === '/work?order=' + order.id)).toBe(true);
});

test('each send rechecks pending state, including a claim while another external send is in flight', async () => {
  const f = await fixture(); await f.subscribe(f.staff.cookie, 'a'); await f.subscribe(f.second.cookie, 'b');
  const order = await f.place();
  f.boundary(async () => { await f.command(order.id, 'accept', f.staff.cookie); });
  await f.backend.push.tick();
  expect(f.sent).toHaveLength(1);
  expect(f.backend.sqlite.prepare('SELECT * FROM push_schedule').all()).toEqual([]);
  f.boundary(async () => {}); f.advance(300000); await f.backend.push.tick();
  expect(f.sent.slice(1).map((value) => value.payload.kind)).toEqual(['claimed']);
});

test('reject and owner cancellation stop even the initial alert; requeue resets the generation during an in-flight send', async () => {
  const f = await fixture(); await f.subscribe(f.staff.cookie, 'a'); await f.subscribe(f.second.cookie, 'b');
  const rejected = await f.place(); await f.command(rejected.id, 'reject', f.staff.cookie, 'শেষ');
  const cancelled = await f.place(); await f.command(cancelled.id, 'cancel', f.employee.cookie, '');
  await f.backend.push.tick(); expect(f.sent).toEqual([]);
  const order = await f.place();
  f.boundary(async () => {
    await f.command(order.id, 'accept', f.staff.cookie);
    await f.command(order.id, 'requeue', f.staff.cookie, 'অন্য কর্মী');
  });
  await f.backend.push.tick(); expect(f.sent).toHaveLength(1);
  f.boundary(async () => {});
  await f.backend.push.tick();
  expect(f.sent).toHaveLength(3);
  expect(f.sent.slice(1).every((value) => value.payload.kind === 'create')).toBe(true);
  f.advance(300000); await f.backend.push.tick();
  expect(f.sent.slice(3).every((value) => value.payload.kind === 'reminder')).toBe(true);
});

test('all employee transition pushes retain the event reason and recipient language; own cancellation has none', async () => {
  const f = await fixture(); await f.subscribe(f.employee.cookie, 'owner');
  const delivered = await f.place(); await f.command(delivered.id, 'accept', f.staff.cookie);
  await f.command(delivered.id, 'deliver', f.staff.cookie);
  const rejected = await f.place(); await f.command(rejected.id, 'reject', f.staff.cookie, 'চা শেষ');
  const requeued = await f.place(); await f.command(requeued.id, 'accept', f.staff.cookie);
  await f.command(requeued.id, 'requeue', f.staff.cookie, 'আবার দিন');
  const own = await f.place(); await f.command(own.id, 'cancel', f.employee.cookie, 'নিজের বাতিল');
  await f.backend.push.tick();
  expect(f.sent.map((value) => value.payload.kind)).toEqual(['accept', 'deliver', 'reject', 'accept', 'requeue']);
  expect(f.sent.every((value) => value.payload.language === 'bn' && value.payload.target.startsWith('/orders?order='))).toBe(true);
  expect(f.sent.find((value) => value.payload.kind === 'reject')?.payload.reason).toBe('চা শেষ');
  const last = f.sent.at(-1);
  if (!last) throw new Error('Missing requeue notification');
  expect(notificationText(last.payload).body).toBe('কারণ: আবার দিন');
  expect((await request(f.backend, '/me', 'PATCH', { language: 'en' }, f.employee.cookie)).status).toBe(200);
  await f.command(requeued.id, 'reject', f.second.cookie, 'Unavailable');
  await f.backend.push.tick(); expect(f.sent.at(-1)?.payload.language).toBe('en');
});

test('employee transition output survives restart and external failure cannot roll back successful orders', async () => {
  const f = await fixture(); await f.subscribe(f.employee.cookie, 'owner');
  const order = await f.place(); await f.command(order.id, 'accept', f.staff.cookie);
  const restarted = f.reopen();
  f.boundary(async () => { throw new Error('external transport unavailable'); });
  await restarted.push.tick(); expect(f.sent.at(-1)?.payload.kind).toBe('accept');
  const response = await request(restarted, '/orders/' + order.id, 'GET', undefined, f.employee.cookie);
  expect(orderResponseSchema.parse(await response.json()).order.status).toBe('ACCEPTED');
  await restarted.push.tick(); expect(f.sent).toHaveLength(1);
});

test('404 and 410 subscriptions are pruned; transient errors retain the device and pending reminders continue', async () => {
  const f = await fixture();
  await f.subscribe(f.staff.cookie, 'a404'); await f.subscribe(f.staff.cookie, 'b410'); await f.subscribe(f.staff.cookie, 'c503');
  await f.place();
  f.boundary(async (subscription) => { throw Object.assign(new Error('Push provider rejected'), { statusCode: Number(subscription.endpoint.slice(-3)) }); });
  await f.backend.push.tick();
  expect(f.backend.sqlite.prepare('SELECT endpoint FROM push_subscription').all()).toEqual([{ endpoint: f.subscription('c503').endpoint }]);
  f.advance(300000); await f.backend.push.tick();
  expect(f.sent).toHaveLength(4);
});

test('logout cascades devices, account switching rebinds endpoints, and the previous session cannot delete the new binding', async () => {
  const f = await fixture(); const subscription = await f.subscribe(f.staff.cookie, 'device');
  const otherCookie = await f.login('staff_one', personalPin);
  await f.subscribe(otherCookie, 'device');
  expect((await request(f.backend, '/push/subscription', 'DELETE', { endpoint: subscription.endpoint }, f.staff.cookie)).status).toBe(200);
  expect(f.backend.sqlite.prepare('SELECT * FROM push_subscription').all()).toHaveLength(1);
  await f.subscribe(f.second.cookie, 'device');
  expect((await request(f.backend, '/auth/logout', 'POST', {}, otherCookie)).status).toBe(200);
  await f.place(); await f.backend.push.tick();
  expect(f.sent).toHaveLength(1); expect(f.sent[0].payload.language).toBe('bn');
  expect((await request(f.backend, '/auth/logout', 'POST', {}, f.second.cookie)).status).toBe(200);
  expect(f.backend.sqlite.prepare('SELECT * FROM push_subscription').all()).toEqual([]);
  f.advance(300000); await f.backend.push.tick(); expect(f.sent).toHaveLength(1);
});

test('deactivation, reset and expiry stop device sends, including revocation between external sends', async () => {
  const f = await fixture(); await f.subscribe(f.staff.cookie, 'a'); await f.subscribe(f.second.cookie, 'b');
  const order = await f.place();
  f.boundary(async () => {
    expect((await request(f.backend, '/users/' + f.second.id, 'PATCH', { isActive: false }, f.admin)).status).toBe(200);
  });
  await f.backend.push.tick(); expect(f.sent).toHaveLength(1);
  expect((await request(f.backend, '/users/' + f.staff.id + '/reset-password', 'POST', { newPassword: pin }, f.admin)).status).toBe(200);
  expect(f.backend.sqlite.prepare('SELECT * FROM push_subscription').all()).toEqual([]);
  f.advance(300000); await f.backend.push.tick(); expect(f.sent).toHaveLength(1);
  await f.subscribe(f.employee.cookie, 'owner');
  const resetStaff = await f.login(f.staff.username, pin);
  expect((await request(f.backend, '/auth/change-password', 'POST', { currentPassword: pin, newPassword: personalPin }, resetStaff)).status).toBe(200);
  await f.command(order.id, 'accept', resetStaff);
  f.advance(31 * 24 * 3600000); await f.backend.push.tick(); expect(f.sent).toHaveLength(1);
});

test('logout during an external send removes the next recipient before its turn', async () => {
  const f = await fixture(); await f.subscribe(f.staff.cookie, 'a'); await f.subscribe(f.second.cookie, 'b');
  await f.place();
  f.boundary(async () => {
    expect((await request(f.backend, '/auth/logout', 'POST', {}, f.second.cookie)).status).toBe(200);
  });
  await f.backend.push.tick(); expect(f.sent).toHaveLength(1);
  f.boundary(async () => {}); f.advance(300000); await f.backend.push.tick();
  expect(f.sent).toHaveLength(2);
  expect(f.sent.every((value) => value.endpoint === f.subscription('a').endpoint)).toBe(true);
});

test('subscription trust boundary rejects private endpoints, malformed points, unknown fields and cross-origin writes', async () => {
  const f = await fixture();
  const subscription = f.subscription('device');
  for (const endpoint of ['http://fcm.googleapis.com/send/a', 'https://127.0.0.1/send', 'https://192.168.1.2/push',
    'https://fcm.googleapis.com.attacker.example/push', 'https://user:pass@fcm.googleapis.com/push', 'https://fcm.googleapis.com:8443/push', 'https://example.com/push']) {
    expect((await request(f.backend, '/push/subscription', 'POST', { ...subscription, endpoint }, f.staff.cookie)).status).toBe(400);
  }
  for (const keys of [{ ...subscription.keys, auth: 'a'.repeat(200) }, { ...subscription.keys, p256dh: 'B' + 'a'.repeat(86) }]) {
    expect((await request(f.backend, '/push/subscription', 'POST', { ...subscription, keys }, f.staff.cookie)).status).toBe(400);
  }
  expect((await request(f.backend, '/push/subscription', 'POST', { ...subscription, userId: f.second.id }, f.staff.cookie)).status).toBe(400);
  expect((await request(f.backend, '/push/subscription', 'POST', subscription)).status).toBe(401);
  const cross = await f.backend.app.request('/api/push/subscription', { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json', Cookie: f.staff.cookie }, body: JSON.stringify(subscription) });
  expect(cross.status).toBe(403);
  const config = await request(f.backend, '/push/config', 'GET', undefined, f.staff.cookie);
  expect(await config.json()).toEqual({ publicKey: f.config.VAPID_PUBLIC_KEY });
  expect(f.backend.sqlite.prepare('SELECT * FROM push_subscription').all()).toEqual([]);
});

test('missing or inconsistent optional VAPID disables push without disabling ordering or authentication', async () => {
  const f = await fixture();
  for (const VAPID_PRIVATE_KEY of [undefined, 'invalid']) {
    const backend = createApp({ ...f.config, VAPID_PRIVATE_KEY }); cleanup.push(backend.close);
    expect(await (await request(backend, '/push/config', 'GET', undefined, f.staff.cookie)).json()).toEqual({ publicKey: null });
    expect((await request(backend, '/push/subscription', 'POST', f.subscription('device'), f.staff.cookie)).status).toBe(403);
    await backend.push.tick();
  }
  await f.place(); expect(f.sent).toEqual([]);
});
