import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  apiErrorSchema, publicUserSchema, type CreateUserInput, type PublicUser,
} from '@office-service/shared';
import { createApp } from './app';
import { session, user } from './schema';

const origin = 'http://localhost:5173';
const token = 'operator-bootstrap-token-32-characters-long';
const password = 'initial-password-123';
const newPassword = 'replacement-password-456';
const profile = { name: 'প্রশাসক', language: 'bn', floor: '৩', desk: 'A-12' } as const;
const createdUser = { ...profile, name: 'Employee', username: 'employee', password, role: 'employee' } as const;
const userResponseSchema = z.object({ user: publicUserSchema });
const sessionResponseSchema = z.object({ user: publicUserSchema.nullable() });
const resources: Array<() => void> = [];

afterEach(() => {
  for (const dispose of resources.splice(0).reverse()) dispose();
});

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'office-service-'));
  resources.push(() => rmSync(directory, { recursive: true, force: true }));
  const config = {
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters-long',
    SETUP_TOKEN: token,
    APP_ORIGIN: origin,
    DATABASE_PATH: join(directory, 'test.sqlite'),
  };
  const backend = createApp(config);
  resources.push(backend.close);
  return { ...backend, config };
}

function request(backend: ReturnType<typeof createApp>, path: string, method = 'GET', body?: unknown, cookie?: string, requestOrigin: string | null = origin) {
  const headers = new Headers();
  if (requestOrigin !== null) headers.set('Origin', requestOrigin);
  if (cookie) headers.set('Cookie', cookie);
  if (method !== 'GET') headers.set('Content-Type', 'application/json');
  return backend.app.request(path, {
    method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}

async function errorCode(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(apiErrorSchema.parse(await response.json())).toEqual({ error: { code } });
}

async function initialize(backend: ReturnType<typeof createApp>) {
  const response = await request(backend, '/api/setup', 'POST', {
    ...profile, username: 'admin', password, setupToken: token,
  });
  expect(response.status).toBe(201);
  return userResponseSchema.parse(await response.json()).user;
}

async function login(backend: ReturnType<typeof createApp>, username = 'admin', secret = password) {
  const response = await request(backend, '/api/auth/login', 'POST', { username, password: secret });
  expect(response.status).toBe(200);
  const value = userResponseSchema.parse(await response.json()).user;
  const cookies = response.headers.getSetCookie();
  expect(cookies.length).toBeGreaterThan(0);
  const cookie = cookies.map((entry) => entry.split(';')[0]).join('; ');
  return { cookie, user: value, cookies };
}

async function createUser(backend: ReturnType<typeof createApp>, cookie: string, fields: Partial<CreateUserInput> = {}): Promise<PublicUser> {
  const response = await request(backend, '/api/users', 'POST', { ...createdUser, ...fields }, cookie);
  expect(response.status).toBe(201);
  return userResponseSchema.parse(await response.json()).user;
}

describe('setup and authentication', () => {
  test('requires an operator token, initializes once, and returns only the public user', async () => {
    const backend = fixture();
    expect(await (await request(backend, '/api/setup')).json()).toEqual({ setupRequired: true });
    await errorCode(await request(backend, '/api/setup', 'POST', {
      ...profile, username: 'admin', password, setupToken: 'x'.repeat(40),
    }), 403, 'INVALID_SETUP_TOKEN');
    const initial = await initialize(backend);
    expect(initial).toMatchObject({ role: 'admin', isActive: true, mustChangePassword: false, ...profile });
    expect(Object.keys(initial).sort()).toEqual(['desk', 'floor', 'id', 'isActive', 'language', 'mustChangePassword', 'name', 'role', 'username'].sort());
    expect(await (await request(backend, '/api/setup')).json()).toEqual({ setupRequired: false });
    await errorCode(await request(backend, '/api/setup', 'POST', {
      ...profile, username: 'another_admin', password, setupToken: token,
    }), 409, 'SETUP_COMPLETE');
  });

  test('concurrent setup through independent SQLite connections creates exactly one complete administrator', async () => {
    const first = fixture();
    const second = createApp(first.config);
    resources.push(second.close);
    const responses = await Promise.all([first, second].map((backend, index) =>
      request(backend, '/api/setup', 'POST', {
        ...profile, username: 'admin_' + index, password, setupToken: token,
      })));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(first.db.select().from(user).all()).toHaveLength(1);
    const winner = first.db.select().from(user).get();
    expect(winner).toBeDefined();
    if (!winner) throw new Error('Missing setup administrator');
    await login(first, winner.username);
  });

  test('login is username-only, sessions are durable for 30 days, and logout revokes only the current device', async () => {
    const backend = fixture();
    await initialize(backend);
    await errorCode(await request(backend, '/api/auth/login', 'POST', { username: 'admin', password: 'wrong' }), 401, 'INVALID_CREDENTIALS');
    const first = await login(backend);
    const second = await login(backend);
    const sessions = backend.db.select().from(session).all();
    expect(sessions).toHaveLength(2);
    for (const value of sessions) {
      const duration = value.expiresAt.getTime() - value.createdAt.getTime();
      expect(duration).toBeGreaterThanOrEqual(30 * 86400000 - 1000);
      expect(duration).toBeLessThanOrEqual(30 * 86400000);
    }
    expect(first.cookies.join(';')).toMatch(/HttpOnly/i);
    expect(first.cookies.join(';')).toMatch(/SameSite=Lax/i);
    const reopened = createApp(backend.config);
    resources.push(reopened.close);
    expect(sessionResponseSchema.parse(await (await request(reopened, '/api/auth/get-session', 'GET', undefined, first.cookie)).json()).user?.username).toBe('admin');
    expect((await request(backend, '/api/auth/logout', 'POST', {}, first.cookie)).status).toBe(200);
    expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, first.cookie)).json()).toEqual({ user: null });
    expect(sessionResponseSchema.parse(await (await request(backend, '/api/auth/get-session', 'GET', undefined, second.cookie)).json()).user?.username).toBe('admin');
  });

  test('expired sessions cannot authorize access', async () => {
    const backend = fixture();
    await initialize(backend);
    const admin = await login(backend);
    backend.db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).run();
    await errorCode(await request(backend, '/api/users', 'GET', undefined, admin.cookie), 401, 'UNAUTHORIZED');
  });
});

describe('user administration and first-password gate', () => {
  test('all protected endpoints reject anonymous callers and raw Better Auth mutation routes are not mounted', async () => {
    const backend = fixture();
    await initialize(backend);
    for (const [path, method] of [
      ['/api/users', 'GET'], ['/api/users', 'POST'], ['/api/me', 'PATCH'],
      ['/api/users/id', 'PATCH'], ['/api/users/id/reset-password', 'POST'],
      ['/api/auth/change-password', 'POST'], ['/api/auth/logout', 'POST'],
    ]) {
      await errorCode(await request(backend, path, method), 401, 'UNAUTHORIZED');
    }
    for (const path of [
      '/api/auth/sign-up/email', '/api/auth/admin/create-user', '/api/auth/admin/set-role',
      '/api/auth/admin/set-user-password', '/api/auth/admin/ban-user',
      '/api/auth/update-user', '/api/auth/sign-in/email', '/api/auth/set-password',
    ]) {
      await errorCode(await request(backend, path, 'POST', {}), 404, 'NOT_FOUND');
    }
  });

  test('temporary users can inspect session, log out, or change password but cannot mutate profile or administer', async () => {
    const backend = fixture();
    await initialize(backend);
    const admin = await login(backend);
    const employee = await createUser(backend, admin.cookie);
    expect(employee.mustChangePassword).toBe(true);
    const first = await login(backend, 'employee');
    const other = await login(backend, 'employee');
    for (const [path, method, body] of [
      ['/api/users', 'GET', undefined],
      ['/api/users', 'POST', createdUser],
      ['/api/me', 'PATCH', { language: 'en' }],
      ['/api/users/' + employee.id, 'PATCH', { role: 'admin' }],
      ['/api/users/' + employee.id + '/reset-password', 'POST', { newPassword }],
    ] as const) {
      await errorCode(await request(backend, path, method, body, first.cookie), 403, 'PASSWORD_CHANGE_REQUIRED');
    }
    await errorCode(await request(backend, '/api/auth/change-password', 'POST', { currentPassword: 'wrong', newPassword }, first.cookie), 400, 'INVALID_CURRENT_PASSWORD');
    const changed = await request(backend, '/api/auth/change-password', 'POST', { currentPassword: password, newPassword }, first.cookie);
    expect(changed.status).toBe(200);
    expect(userResponseSchema.parse(await changed.json()).user.mustChangePassword).toBe(false);
    expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, other.cookie)).json()).toEqual({ user: null });
    await errorCode(await request(backend, '/api/users', 'GET', undefined, first.cookie), 403, 'FORBIDDEN');
    await errorCode(await request(backend, '/api/me', 'PATCH', { floor: '4', desk: 'C-8' }, first.cookie), 400, 'VALIDATION_ERROR');
    const profileResponse = await request(backend, '/api/me', 'PATCH', { language: 'en' }, first.cookie);
    expect(userResponseSchema.parse(await profileResponse.json()).user).toMatchObject({ language: 'en' });
    await errorCode(await request(backend, '/api/auth/login', 'POST', { username: 'employee', password }), 401, 'INVALID_CREDENTIALS');
    await login(backend, 'employee', newPassword);
  });

  test('reset revokes every device and requires another password change', async () => {
    const backend = fixture();
    await initialize(backend);
    const admin = await login(backend);
    const target = await createUser(backend, admin.cookie);
    const first = await login(backend, 'employee');
    const second = await login(backend, 'employee');
    expect((await request(backend, '/api/users/' + target.id + '/reset-password', 'POST', { newPassword }, admin.cookie)).status).toBe(200);
    for (const device of [first, second]) {
      expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, device.cookie)).json()).toEqual({ user: null });
      await errorCode(await request(backend, '/api/auth/change-password', 'POST', { currentPassword: password, newPassword }, device.cookie), 401, 'UNAUTHORIZED');
    }
    await errorCode(await request(backend, '/api/auth/login', 'POST', { username: 'employee', password }), 401, 'INVALID_CREDENTIALS');
    expect((await login(backend, 'employee', newPassword)).user.mustChangePassword).toBe(true);
  });

  test('deactivation revokes every session, prevents login, and keeps the user record', async () => {
    const backend = fixture();
    await initialize(backend);
    const admin = await login(backend);
    const target = await createUser(backend, admin.cookie);
    const first = await login(backend, 'employee');
    const second = await login(backend, 'employee');
    const response = await request(backend, '/api/users/' + target.id, 'PATCH', { isActive: false }, admin.cookie);
    expect(userResponseSchema.parse(await response.json()).user.isActive).toBe(false);
    for (const device of [first, second]) {
      expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, device.cookie)).json()).toEqual({ user: null });
    }
    await errorCode(await request(backend, '/api/auth/login', 'POST', { username: 'employee', password }), 401, 'INVALID_CREDENTIALS');
    expect(backend.db.select().from(user).where(eq(user.id, target.id)).get()).toBeDefined();
    expect((await request(backend, '/api/users/' + target.id, 'PATCH', { isActive: true }, admin.cookie)).status).toBe(200);
    expect((await login(backend, 'employee')).user.mustChangePassword).toBe(true);
    expect(await (await request(backend, '/api/auth/get-session', 'GET', undefined, first.cookie)).json()).toEqual({ user: null });
  });

  test('protects the last active administrator and applies role changes immediately', async () => {
    const backend = fixture();
    const initial = await initialize(backend);
    const admin = await login(backend);
    for (const body of [{ role: 'employee' }, { isActive: false }]) {
      await errorCode(await request(backend, '/api/users/' + initial.id, 'PATCH', body, admin.cookie), 409, 'LAST_ACTIVE_ADMIN');
    }
    const second = await createUser(backend, admin.cookie, { username: 'second_admin', role: 'admin' });
    const secondLogin = await login(backend, 'second_admin');
    expect((await request(backend, '/api/auth/change-password', 'POST', { currentPassword: password, newPassword }, secondLogin.cookie)).status).toBe(200);
    expect((await request(backend, '/api/users/' + initial.id, 'PATCH', { role: 'staff', name: 'Staff' }, secondLogin.cookie)).status).toBe(200);
    await errorCode(await request(backend, '/api/users', 'GET', undefined, admin.cookie), 403, 'FORBIDDEN');
    await errorCode(await request(backend, '/api/users/' + second.id, 'PATCH', { isActive: false }, secondLogin.cookie), 409, 'LAST_ACTIVE_ADMIN');
  });

  test('validates bounded strict input, username uniqueness, and disallows privilege changes through personal profile', async () => {
    const backend = fixture();
    await initialize(backend);
    const admin = await login(backend);
    await createUser(backend, admin.cookie);
    await errorCode(await request(backend, '/api/users', 'POST', createdUser, admin.cookie), 409, 'USERNAME_TAKEN');
    for (const body of [
      { ...createdUser, username: 'invalid username' },
      { ...createdUser, username: 'new_user', password: 'short' },
      { ...createdUser, username: 'new_user', role: 'owner' },
      { ...createdUser, username: 'new_user', name: 'n'.repeat(101) },
      { ...createdUser, username: 'new_user', email: 'external@example.com' },
    ]) await errorCode(await request(backend, '/api/users', 'POST', body, admin.cookie), 400, 'VALIDATION_ERROR');
    await errorCode(await request(backend, '/api/me', 'PATCH', { role: 'admin' }, admin.cookie), 400, 'VALIDATION_ERROR');
    await errorCode(await request(backend, '/api/me', 'PATCH', { name: 'x'.repeat(17000) }, admin.cookie), 413, 'BODY_TOO_LARGE');
    const malformed = await backend.app.request('/api/me', { method: 'PATCH', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: admin.cookie }, body: '{' });
    await errorCode(malformed, 400, 'VALIDATION_ERROR');
  });
});

describe('request boundary', () => {
  test('every mutation requires the configured Origin, including setup and login', async () => {
    const backend = fixture();
    for (const path of ['/api/setup', '/api/auth/login', '/api/auth/logout', '/api/auth/change-password', '/api/users', '/api/users/id/reset-password']) {
      for (const invalidOrigin of [null, 'http://attacker.invalid']) {
        await errorCode(await request(backend, path, 'POST', {}, undefined, invalidOrigin), 403, 'INVALID_ORIGIN');
      }
    }
    for (const path of ['/api/me', '/api/users/id']) {
      await errorCode(await request(backend, path, 'PATCH', {}, undefined, null), 403, 'INVALID_ORIGIN');
    }
  });

  test('setup and login are rate limited in SQLite across app instances', async () => {
    const backend = fixture();
    const other = createApp(backend.config);
    resources.push(other.close);
    for (let index = 0; index < 10; index++) {
      await errorCode(await request(index % 2 ? backend : other, '/api/setup', 'POST', {}), 400, 'VALIDATION_ERROR');
    }
    await errorCode(await request(other, '/api/setup', 'POST', {}), 429, 'RATE_LIMITED');
    for (let index = 0; index < 30; index++) {
      await errorCode(await request(index % 2 ? backend : other, '/api/auth/login', 'POST', {}), 400, 'VALIDATION_ERROR');
    }
    await errorCode(await request(other, '/api/auth/login', 'POST', {}), 429, 'RATE_LIMITED');
  });
});
