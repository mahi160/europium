import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { z } from 'zod';
import { apiErrorSchema, publicUserSchema, type Role } from '@office-service/shared';
import { createApp } from './app';
import { account, rateLimit, user } from './schema';

const origin = 'http://localhost:5173';
const adminPassword = 'administrator-password-123';
const secret = 'test-server-secret-at-least-32-characters';
const profile = { name: 'Person', language: 'en', floor: '', desk: '' } as const;
const userResponse = z.object({ user: publicUserSchema });
const disposals: Array<() => void> = [];
afterEach(() => { for (const dispose of disposals.splice(0).reverse()) dispose(); });

function request(backend: ReturnType<typeof createApp>, path: string, method = 'GET', body?: object, cookie?: string) {
  return backend.app.request(path, { method, headers: {
    Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}),
  }, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }) });
}
function cookies(response: Response) { return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); }
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe(code);
}
async function login(backend: ReturnType<typeof createApp>, username: string, password: string) {
  const response = await request(backend, '/api/auth/login', 'POST', { username, password });
  expect(response.status).toBe(200);
  return { cookie: cookies(response), user: userResponse.parse(await response.json()).user };
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'office-pin-'));
  disposals.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = { AUTH_SECRET: secret, SETUP_TOKEN: 'setup-token-at-least-32-characters-long', APP_ORIGIN: origin, DATABASE_PATH: join(directory, 'test.sqlite') };
  const backend = createApp(config);
  disposals.push(backend.close);
  const setup = await request(backend, '/api/setup', 'POST', { ...profile, username: 'admin', password: adminPassword, setupToken: config.SETUP_TOKEN });
  expect(setup.status).toBe(201);
  const admin = await login(backend, 'admin', adminPassword);
  const create = async (username: string, role: Role = 'employee', password = '0007') => {
    const response = await request(backend, '/api/users', 'POST', { ...profile, username, role, password }, admin.cookie);
    expect(response.status).toBe(201);
    return userResponse.parse(await response.json()).user;
  };
  return { backend, config, admin, create };
}

for (const role of ['employee', 'staff'] as const) {
  test(`${role} uses only a hashed, server-peppered four-digit PIN, including leading zeros`, async () => {
    const { backend, create } = await fixture();
    const person = await create(role, role);
    const stored = backend.db.select().from(account).where(eq(account.userId, person.id)).get();
    expect(stored?.password).toBeTruthy();
    if (!stored?.password) throw new Error('Missing credential hash');
    expect(await verifyPassword({ hash: stored.password, password: '0007' })).toBe(false);
    const encoded = createHmac('sha256', secret).update(JSON.stringify(['pin', role, '0007'])).digest('hex');
    expect(await verifyPassword({ hash: stored.password, password: encoded })).toBe(true);
    const first = await login(backend, role, '0007');
    const second = await login(backend, role, '0007');
    expect(first.user.mustChangePassword).toBe(true);
    await error(await request(backend, '/api/menu', 'GET', undefined, first.cookie), 403, 'PASSWORD_CHANGE_REQUIRED');
    await error(await request(backend, '/api/auth/change-password', 'POST', { currentPassword: '0007', newPassword: 'long-password-123' }, first.cookie), 400, 'VALIDATION_ERROR');
    await error(await request(backend, '/api/auth/change-password', 'POST', { currentPassword: '9999', newPassword: '0012' }, first.cookie), 400, 'INVALID_CURRENT_PASSWORD');
    const changed = await request(backend, '/api/auth/change-password', 'POST', { currentPassword: '0007', newPassword: '0012' }, first.cookie);
    expect(changed.status).toBe(200);
    expect(userResponse.parse(await changed.json()).user.mustChangePassword).toBe(false);
    expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, second.cookie)).json()).toEqual({ user: null });
    expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, first.cookie)).json()).toMatchObject({ user: { id: person.id } });
    await error(await request(backend, '/api/auth/login', 'POST', { username: role, password: '0007' }), 401, 'INVALID_CREDENTIALS');
    expect((await login(backend, role, '0012')).user.id).toBe(person.id);
    await error(await request(backend, '/api/users', 'GET', undefined, first.cookie), 403, 'FORBIDDEN');
  });
}

test('creation and resets enforce PINs for non-admins and long passwords for administrators', async () => {
  const { backend, create, admin } = await fixture();
  for (const password of ['123', '12345', '12a4', '１２３４', ' 1234', '1234 ', 'long-password-123', 1234]) {
    await error(await request(backend, '/api/users', 'POST', { ...profile, username: 'invalid', role: 'employee', password }, admin.cookie), 400, 'VALIDATION_ERROR');
  }
  await error(await request(backend, '/api/users', 'POST', { ...profile, username: 'invalid_admin', role: 'admin', password: '1234' }, admin.cookie), 400, 'VALIDATION_ERROR');
  const person = await create('employee');
  const employee = await login(backend, person.username, '0007');
  await error(await request(backend, `/api/users/${person.id}/reset-password`, 'POST', { newPassword: 'long-password-123' }, admin.cookie), 400, 'VALIDATION_ERROR');
  expect((await request(backend, `/api/users/${person.id}/reset-password`, 'POST', { newPassword: '0042' }, admin.cookie)).status).toBe(200);
  expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, employee.cookie)).json()).toEqual({ user: null });
  expect((await login(backend, person.username, '0042')).user.mustChangePassword).toBe(true);
  await error(await request(backend, `/api/users/${admin.user.id}/reset-password`, 'POST', { newPassword: '0042' }, admin.cookie), 400, 'VALIDATION_ERROR');
  await error(await request(backend, '/api/auth/change-password', 'POST', { currentPassword: adminPassword, newPassword: '0042' }, admin.cookie), 400, 'VALIDATION_ERROR');
  const nextPassword = 'administrator-next-password-456';
  expect((await request(backend, '/api/auth/change-password', 'POST', { currentPassword: adminPassword, newPassword: nextPassword }, admin.cookie)).status).toBe(200);
  expect((await login(backend, 'admin', nextPassword)).user.role).toBe('admin');
});

test('five account attempts are persistent across instances, normalized by username, and reset by an administrator PIN reset', async () => {
  const { backend, config, create, admin } = await fixture();
  const person = await create('employee');
  for (let index = 0; index < 5; index++) await error(await request(backend, '/api/auth/login', 'POST', { username: index % 2 ? ' EMPLOYEE ' : 'employee', password: '9999' }), 401, 'INVALID_CREDENTIALS');
  const another = createApp(config);
  disposals.push(another.close);
  await error(await request(another, '/api/auth/login', 'POST', { username: 'employee', password: '0007' }), 429, 'RATE_LIMITED');
  expect((await login(another, 'admin', adminPassword)).user.id).toBe(admin.user.id);
  expect((await request(backend, `/api/users/${person.id}/reset-password`, 'POST', { newPassword: '0042' }, admin.cookie)).status).toBe(200);
  expect((await login(another, 'employee', '0042')).user.id).toBe(person.id);
});

test('current-PIN guessing shares the persistent account throttle with login', async () => {
  const { backend, create } = await fixture();
  await create('employee');
  const employee = await login(backend, 'employee', '0007');
  for (let index = 0; index < 5; index++) await error(await request(backend, '/api/auth/change-password', 'POST', { currentPassword: '9999', newPassword: '0042' }, employee.cookie), 400, 'INVALID_CURRENT_PASSWORD');
  await error(await request(backend, '/api/auth/change-password', 'POST', { currentPassword: '0007', newPassword: '0042' }, employee.cookie), 429, 'RATE_LIMITED');
  await error(await request(backend, '/api/auth/login', 'POST', { username: 'employee', password: '0007' }), 429, 'RATE_LIMITED');
  backend.db.update(rateLimit).set({ window: 0 }).run();
  expect((await login(backend, 'employee', '0007')).user.username).toBe('employee');
});

test('crossing the administrator boundary clears the old credential and revokes sessions; staff/employee switches retain the PIN', async () => {
  const { backend, create, admin } = await fixture();
  const person = await create('worker', 'staff');
  const staff = await login(backend, person.username, '0007');
  expect((await request(backend, `/api/users/${person.id}`, 'PATCH', { role: 'admin' }, admin.cookie)).status).toBe(200);
  expect(backend.db.select().from(account).where(eq(account.userId, person.id)).get()?.password).toBeNull();
  expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, staff.cookie)).json()).toEqual({ user: null });
  await error(await request(backend, '/api/auth/login', 'POST', { username: person.username, password: '0007' }), 401, 'INVALID_CREDENTIALS');
  expect((await request(backend, `/api/users/${person.id}/reset-password`, 'POST', { newPassword: adminPassword }, admin.cookie)).status).toBe(200);
  const promoted = await login(backend, person.username, adminPassword);
  expect((await request(backend, `/api/users/${person.id}`, 'PATCH', { role: 'staff' }, admin.cookie)).status).toBe(200);
  expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, promoted.cookie)).json()).toEqual({ user: null });
  await error(await request(backend, '/api/auth/login', 'POST', { username: person.username, password: adminPassword }), 401, 'INVALID_CREDENTIALS');
  expect((await request(backend, `/api/users/${person.id}/reset-password`, 'POST', { newPassword: '0042' }, admin.cookie)).status).toBe(200);
  const demoted = await login(backend, person.username, '0042');
  expect((await request(backend, `/api/users/${person.id}`, 'PATCH', { role: 'employee' }, admin.cookie)).status).toBe(200);
  expect((await login(backend, person.username, '0042')).user.role).toBe('employee');
  expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, demoted.cookie)).json()).toMatchObject({ user: { id: person.id } });
  await error(await request(backend, `/api/users/${admin.user.id}`, 'PATCH', { role: 'employee' }, admin.cookie), 409, 'LAST_ACTIVE_ADMIN');
});

test('migration revokes legacy non-admin sessions, rejects old passwords, and retains administrator access and account data', async () => {
  const { backend, config, create, admin } = await fixture();
  const person = await create('legacy');
  const legacyPassword = 'legacy-password-123';
  backend.db.update(account).set({ password: await hashPassword(legacyPassword) }).where(eq(account.userId, person.id)).run();
  backend.db.update(user).set({ mustChangePassword: false }).where(eq(user.id, person.id)).run();
  const oldLogin = await backend.auth.api.signInUsername({ body: { username: person.username, password: legacyPassword }, asResponse: true });
  expect(oldLogin.status).toBe(200);
  const oldCookie = cookies(oldLogin);
  backend.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at = ?').run(1782086400000);
  backend.close();
  const migrated = createApp(config);
  disposals.push(migrated.close);
  expect(await (await request(migrated, '/api/auth/get-session', 'GET', undefined, oldCookie)).json()).toEqual({ user: null });
  expect(await (await request(migrated, '/api/auth/get-session', 'GET', undefined, admin.cookie)).json()).toMatchObject({ user: { id: admin.user.id } });
  expect(migrated.db.select().from(user).where(eq(user.id, person.id)).get()).toMatchObject({ username: 'legacy', mustChangePassword: true });
  await error(await request(migrated, '/api/auth/login', 'POST', { username: person.username, password: legacyPassword }), 401, 'INVALID_CREDENTIALS');
  expect((await request(migrated, `/api/users/${person.id}/reset-password`, 'POST', { newPassword: '0042' }, admin.cookie)).status).toBe(200);
  expect((await login(migrated, person.username, '0042')).user.mustChangePassword).toBe(true);
});
