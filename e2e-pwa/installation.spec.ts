import { createECDH, randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';
import { menuItemResponseSchema, orderResponseSchema, publicUserSchema } from '@office-service/shared';

const headers = { Origin: 'http://localhost:5184' };
const adminPassword = 'pwa-browser-admin-password-123';
const password = '0007';
const personalPassword = '0042';
const userResponse = z.object({ user: publicUserSchema });
async function login(page: Page, username: string, secret: string) {
  expect((await page.request.post('/api/auth/login', { headers, data: { username, password: secret } })).status()).toBe(200);
}
async function office(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('office-language', 'en'); });
  const setup = z.object({ setupRequired: z.boolean() }).parse(await (await page.request.get('/api/setup')).json());
  if (setup.setupRequired) expect((await page.request.post('/api/setup', { headers, data: {
    setupToken: 'pwa-browser-setup-token-32-characters', name: 'Administrator', username: 'office_admin',
    password: adminPassword, language: 'en', floor: '', desk: '',
  } })).status()).toBe(201);
  await login(page, 'office_admin', adminPassword);
  expect((await page.request.patch('/api/me', { headers, data: { language: 'en' } })).status()).toBe(200);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  async function person(role: 'employee' | 'staff') {
    const username = 'pwa_' + role + '_' + suffix;
    const created = await page.request.post('/api/users', { headers, data: {
      username, name: username, role, password, language: 'en', floor: '3', desk: 'D12',
    } });
    expect(created.status()).toBe(201);
    return userResponse.parse(await created.json()).user;
  }
  const employee = await person('employee'); const staff = await person('staff');
  const item = menuItemResponseSchema.parse(await (await page.request.post('/api/menu', { headers, data: {
    name: 'PWA tea ' + suffix, category: 'tea', unit: 'কাপ', available: true, archived: false,
  } })).json()).item;
  await login(page, employee.username, password);
  expect((await page.request.post('/api/auth/change-password', { headers, data: { currentPassword: password, newPassword: personalPassword } })).status()).toBe(200);
  const orderResponse = await page.request.post('/api/orders', { headers, data: {
    idempotencyKey: randomUUID(), items: [{ itemId: item.id, quantity: 1 }], note: 'Private ' + suffix,
  } });
  expect(orderResponse.status()).toBe(201);
  const order = orderResponseSchema.parse(await orderResponse.json()).order;
  return { employee, staff, order, item };
}

test('built manifest, real PNG icons, responsive shell and service-worker cache contain assets, not authenticated API responses', async ({ page }) => {
  await office(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Install and notifications', exact: true })).toBeVisible();
  const manifest = z.object({ start_url: z.string(), display: z.string(), icons: z.array(z.object({ src: z.string(), sizes: z.string(), purpose: z.string() })) })
    .parse(await (await page.request.get('/manifest.webmanifest')).json());
  expect(manifest.display).toBe('standalone'); expect(manifest.start_url).toBe('/');
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src);
    const bytes = await response.body();
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(icon.sizes).toBe(bytes.readUInt32BE(16) + 'x' + bytes.readUInt32BE(20));
  }
  expect(manifest.icons.some((icon) => icon.purpose === 'maskable' && icon.sizes === '512x512')).toBe(true);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.evaluate(async () => { await fetch('/api/orders', { credentials: 'same-origin' }); });
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    return urls;
  });
  expect(cached.some((url) => new URL(url).pathname === '/index.html')).toBe(true);
  expect(cached.some((url) => new URL(url).pathname.startsWith('/api/'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const instructions = page.getByText('On iPhone or iPad', { exact: false });
  await expect(instructions).toBeHidden();
  await page.getByRole('button', { name: 'Install Office Service', exact: true }).click();
  await expect(instructions).toBeVisible();
});

test('permission is requested only by the explicit button and denied permission leaves staff work usable', async ({ page }) => {
  const f = await office(page);
  await login(page, f.staff.username, password);
  expect((await page.request.post('/api/auth/change-password', { headers, data: { currentPassword: password, newPassword: personalPassword } })).status()).toBe(200);
  await page.addInitScript(() => {
    let permission: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => permission });
    Object.defineProperty(Notification, 'requestPermission', { configurable: true, value: async () => {
      document.documentElement.dataset.permissionRequests = String(Number(document.documentElement.dataset.permissionRequests ?? 0) + 1);
      permission = 'denied';
      return permission;
    } });
  });
  await page.goto('/');
  const enable = page.getByRole('button', { name: 'Enable notifications on this device', exact: true });
  await expect(enable).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.dataset.permissionRequests ?? '0')).toBe('0');
  await enable.click();
  await expect(page.getByText('Notifications are blocked.', { exact: false })).toBeVisible();
  await expect(enable).toBeHidden();
  expect(await page.evaluate(() => Notification.permission)).toBe('denied');
  expect(await page.evaluate(() => document.documentElement.dataset.permissionRequests)).toBe('1');
  await expect(page.getByRole('article').filter({ hasText: f.item.name })).toBeVisible();
});

test('already-denied notifications do not request permission and leave staff work usable', async ({ page }) => {
  const f = await office(page);
  await login(page, f.staff.username, password);
  expect((await page.request.post('/api/auth/change-password', { headers, data: { currentPassword: password, newPassword: personalPassword } })).status()).toBe(200);
  await page.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' });
    Object.defineProperty(Notification, 'requestPermission', { configurable: true, value: async () => {
      document.documentElement.dataset.permissionRequests = String(Number(document.documentElement.dataset.permissionRequests ?? 0) + 1);
      return 'denied';
    } });
  });
  await page.goto('/');
  await expect(page.getByText('Notifications are blocked.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable notifications on this device', exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.dataset.permissionRequests ?? '0')).toBe('0');
  const order = page.getByRole('article').filter({ hasText: f.item.name });
  await expect(order).toBeVisible();
  await order.getByRole('button', { name: 'Accept order', exact: true }).click();
  await expect(order.getByText('Accepted', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.permissionRequests ?? '0')).toBe('0');
});

test('login silently binds an existing subscription without asking for permission', async ({ page }) => {
  const f = await office(page);
  expect((await page.request.post('/api/auth/logout', { headers, data: {} })).status()).toBe(200);
  const key = createECDH('prime256v1');
  key.generateKeys();
  await page.addInitScript((subscription) => {
    Object.defineProperty(Notification, 'permission', { get: () => 'granted' });
    Object.defineProperty(Notification, 'requestPermission', { value: () => {
      document.documentElement.dataset.permissionRequested = 'true';
      return Promise.resolve('granted');
    } });
    Object.defineProperty(PushManager.prototype, 'getSubscription', {
      value: async () => ({ endpoint: subscription.endpoint, toJSON: () => subscription }),
    });
  }, {
    endpoint: 'https://fcm.googleapis.com/fcm/send/' + randomUUID(),
    keys: { p256dh: key.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 1).toString('base64url') },
  });
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByLabel('Username', { exact: false }).fill(f.employee.username);
  await page.getByLabel('PIN', { exact: false }).fill(personalPassword);
  const binding = page.waitForResponse('**/api/push/subscription');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await binding).status()).toBe(200);
  await expect(page.getByText('Notifications enabled for this account', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable notifications on this device' })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.dataset.permissionRequested)).toBeUndefined();
});

test('expired-session notification navigation preserves the internal order target through sign-in', async ({ page }) => {
  const f = await office(page);
  expect((await page.request.post('/api/auth/logout', { headers, data: {} })).status()).toBe(200);
  const target = '/orders?order=' + f.order.id;
  await page.goto(target);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await page.getByLabel('Username', { exact: false }).fill(f.employee.username);
  await page.getByLabel('PIN', { exact: false }).fill(personalPassword);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://localhost:5184' + target);
  await expect(page.getByRole('region', { name: 'Order from notification', exact: true }).getByRole('article')).toContainText(f.item.name);
});

test('focused work opens an accepted order outside the default queue; another account cannot reveal it', async ({ page }) => {
  const f = await office(page);
  await login(page, f.staff.username, password);
  expect((await page.request.post('/api/auth/change-password', { headers, data: { currentPassword: password, newPassword: personalPassword } })).status()).toBe(200);
  expect((await page.request.post('/api/orders/' + f.order.id + '/accept', { headers, data: {} })).status()).toBe(200);
  await page.goto('/work?order=' + f.order.id);
  await expect(page.getByRole('region', { name: 'Order from notification', exact: true }).getByRole('article')).toContainText('Accepted');
  expect((await page.request.post('/api/auth/logout', { headers, data: {} })).status()).toBe(200);
  await login(page, 'office_admin', adminPassword);
  const username = 'other_' + randomUUID().replaceAll('-', '').slice(0, 12);
  expect((await page.request.post('/api/users', { headers, data: { username, name: username, role: 'employee', language: 'en', password, floor: '', desk: '' } })).status()).toBe(201);
  await login(page, username, password);
  expect((await page.request.post('/api/auth/change-password', { headers, data: { currentPassword: password, newPassword: personalPassword } })).status()).toBe(200);
  await page.goto('/orders?order=' + f.order.id);
  const focus = page.getByRole('region', { name: 'Order from notification', exact: true });
  await expect(focus.getByRole('alert')).toContainText('could not be found');
  await expect(focus.getByRole('article')).toHaveCount(0);
  expect((await page.request.get('/api/orders/' + f.order.id)).status()).toBe(404);
});
