import { randomUUID } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { z } from 'zod';
import { menuItemResponseSchema, ordersResponseSchema, publicUserSchema, setupSchema } from '@office-service/shared';

const headers = { Origin: 'http://localhost:5183' };
const adminPassword = 'browser-admin-password-123';
const temporaryPassword = 'realtime-temporary-password-123';
const personalPassword = 'realtime-personal-password-456';
const personResponse = z.object({ user: publicUserSchema });

async function signIn(page: Page, username: string, password: string) {
  expect((await page.request.post('/api/auth/login', { headers, data: { username, password } })).ok()).toBe(true);
}

async function office(page: Page, browser: Browser) {
  const setup = z.object({ setupRequired: z.boolean() }).parse(await (await page.request.get('/api/setup')).json());
  if (setup.setupRequired) {
    expect((await page.request.post('/api/setup', { headers, data: setupSchema.parse({
      setupToken: 'browser-test-setup-token-32-characters', username: 'office_admin', password: adminPassword,
      name: 'Office administrator', language: 'en', floor: '', desk: '',
    }) })).status()).toBe(201);
  }
  await signIn(page, 'office_admin', adminPassword);
  expect((await page.request.patch('/api/me', { headers, data: { language: 'en' } })).ok()).toBe(true);
  const unique = randomUUID().replaceAll('-', '').slice(0, 12);
  const name = 'Realtime tea ' + unique;
  const item = menuItemResponseSchema.parse(await (await page.request.post('/api/menu', { headers, data: {
    name, category: 'tea', unit: 'কাপ', available: true, archived: false,
  } })).json()).item;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const employee = await contexts[0].newPage();
    const staff = await contexts[1].newPage();
    const people = [];
    for (const [role, client] of [['employee', employee], ['staff', staff]] as const) {
      const username = 'rt_' + role + '_' + unique;
      const response = await page.request.post('/api/users', { headers, data: {
        name: username, username, password: temporaryPassword, role, language: 'en', floor: '3', desk: unique,
      } });
      expect(response.status()).toBe(201);
      people.push(personResponse.parse(await response.json()).user);
      await signIn(client, username, temporaryPassword);
      expect((await client.request.post('/api/auth/change-password', { headers, data: { currentPassword: temporaryPassword, newPassword: personalPassword } })).ok()).toBe(true);
    }
    const employeeUser = people.find((person) => person.role === 'employee');
    const staffUser = people.find((person) => person.role === 'staff');
    if (!employeeUser || !staffUser) throw new Error('Missing realtime users');
    await Promise.all([employee.goto('/'), staff.goto('/work')]);
    await Promise.all([expect(employee.locator('[data-realtime="current"]')).toBeVisible(), expect(staff.locator('[data-realtime="current"]')).toBeVisible()]);
    return { employee, staff, employeeUser, staffUser, name, item, contexts, close: async () => { for (const context of contexts) await context.close(); } };
  } catch (error) {
    for (const context of contexts) await context.close();
    throw error;
  }
}

test('two contexts update automatically, reconcile missed events offline and on foreground, and stop revoked sessions', async ({ page, browser }) => {
  const f = await office(page, browser);
  try {
    await f.employee.getByRole('button', { name: 'Increase ' + f.name, exact: true }).click();
    await f.employee.getByRole('button', { name: 'Place order', exact: true }).click();
    const employeeCard = f.employee.getByRole('article').filter({ hasText: f.name });
    const staffCard = f.staff.getByRole('article').filter({ hasText: f.name });
    await expect(staffCard).toBeVisible({ timeout: 5000 });
    await staffCard.getByRole('button', { name: 'Accept order', exact: true }).click();
    await expect(employeeCard.getByRole('heading', { name: 'Accepted', exact: true })).toBeVisible({ timeout: 5000 });
    await f.contexts[0].setOffline(true);
    await f.employee.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(f.employee.locator('[data-realtime="offline"]')).toContainText('may be out of date');
    await expect(f.employee.getByRole('button', { name: 'Place order', exact: true })).toBeDisabled();
    await f.staff.getByRole('button', { name: 'My active work', exact: true }).click();
    await staffCard.getByRole('button', { name: 'Mark delivered', exact: true }).click();
    await f.contexts[0].setOffline(false);
    await f.employee.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(employeeCard.getByRole('heading', { name: 'Delivered', exact: true })).toBeVisible({ timeout: 5000 });
    await expect(f.employee.locator('[data-realtime="current"]')).toBeVisible();

    await f.staff.route('**/api/events', (route) => route.abort());
    await f.staff.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(f.staff.locator('[data-realtime="disconnected"]')).toBeVisible();
    const payload = { idempotencyKey: randomUUID(), items: [{ itemId: f.item.id, quantity: 1 }], note: 'missed foreground' };
    expect((await f.employee.request.post('/api/orders', { headers, data: payload })).status()).toBe(201);
    await f.staff.getByRole('button', { name: 'Pending', exact: true }).click();
    await f.staff.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(f.staff.getByRole('article').filter({ hasText: 'missed foreground' })).toBeVisible({ timeout: 5000 });
    await f.staff.unroute('**/api/events');
    await f.staff.locator('[data-realtime]').getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(f.staff.locator('[data-realtime="current"]')).toBeVisible();

    expect((await page.request.post('/api/users/' + f.staffUser.id + '/reset-password', { headers, data: { newPassword: temporaryPassword } })).ok()).toBe(true);
    await expect(f.staff.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({ timeout: 20000 });
    await expect(f.staff.getByRole('article')).toHaveCount(0);
    expect((await f.staff.request.get('/api/events')).status()).toBe(401);
  } finally { await f.close(); }
});

test('uncertain responses retain an isolated frozen draft and idempotency key; offline submissions are not queued', async ({ page, browser }) => {
  const f = await office(page, browser);
  try {
    const submissions: string[] = [];
    await f.employee.route('**/api/orders', async (route) => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      submissions.push(route.request().postData() ?? '');
      if (submissions.length === 1) {
        expect((await route.fetch()).status()).toBe(201);
        await route.abort();
      } else await route.continue();
    });
    await f.employee.getByRole('button', { name: 'Increase ' + f.name, exact: true }).click();
    await f.employee.getByLabel('Note (optional)', { exact: false }).fill('Keep this draft');
    await f.employee.getByRole('button', { name: 'Place order', exact: true }).click();
    await expect(f.employee.getByText('This order is locked until its outcome is known.', { exact: false })).toBeVisible();
    await f.contexts[0].setOffline(true);
    await f.employee.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(f.employee.getByRole('button', { name: 'Retry same order', exact: true })).toBeDisabled();
    await f.employee.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(f.employee.getByLabel('Note (optional)', { exact: false })).toHaveValue('Keep this draft');
    expect(submissions).toHaveLength(1);
    await f.contexts[0].setOffline(false);
    await f.employee.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(f.employee.getByRole('button', { name: 'Retry same order', exact: true })).toBeEnabled();
    expect(submissions).toHaveLength(1);
    await f.employee.getByRole('button', { name: 'Retry same order', exact: true }).click();
    await expect(f.employee.getByRole('status').filter({ hasText: 'Order placed.' })).toBeVisible();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]).toBe(submissions[0]);
    const orders = ordersResponseSchema.parse(await (await f.employee.request.get('/api/orders')).json()).orders;
    expect(orders).toHaveLength(1);
  } finally { await f.close(); }
});
