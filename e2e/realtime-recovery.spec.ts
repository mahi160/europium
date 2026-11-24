import { randomUUID } from 'node:crypto';
import { test, expect } from './test';
import { type Browser, type Page } from '@playwright/test';
import { z } from 'zod';
import { menuItemResponseSchema, orderResponseSchema, publicUserSchema, setupSchema } from '@office-service/shared';

const headers = { Origin: 'http://localhost:5183' };
const adminPassword = 'browser-admin-password-123';
const temporaryPassword = '0007';
const personalPassword = '0042';

async function fixture(page: Page, browser: Browser) {
  const setup = z.object({ setupRequired: z.boolean() }).parse(await (await page.request.get('/api/setup')).json());
  if (setup.setupRequired) {
    expect((await page.request.post('/api/setup', { headers, data: setupSchema.parse({
      setupToken: 'browser-test-setup-token-32-characters', username: 'office_admin', password: adminPassword,
      name: 'Office administrator', language: 'en', floor: '', desk: '',
    }) })).status()).toBe(201);
  }
  expect((await page.request.post('/api/auth/login', { headers, data: { username: 'office_admin', password: adminPassword } })).ok()).toBe(true);
  expect((await page.request.patch('/api/me', { headers, data: { language: 'en' } })).ok()).toBe(true);
  const unique = randomUUID().replaceAll('-', '').slice(0, 12);
  const name = 'Recovery tea ' + unique;
  const menu = await page.request.post('/api/menu', { headers, data: { name, category: 'tea', unit: 'কাপ', available: true, archived: false } });
  expect(menu.status()).toBe(201);
  const item = menuItemResponseSchema.parse(await menu.json()).item;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const employee = await contexts[0].newPage();
    const staff = await contexts[1].newPage();
    for (const [role, client] of [['employee', employee], ['staff', staff]] as const) {
      const username = 'recovery_' + role + '_' + unique;
      const created = await page.request.post('/api/users', { headers, data: {
        name: username, username, password: temporaryPassword, role, language: 'en', floor: '3', desk: unique,
      } });
      expect(created.status()).toBe(201);
      z.object({ user: publicUserSchema }).parse(await created.json());
      expect((await client.request.post('/api/auth/login', { headers, data: { username, password: temporaryPassword } })).ok()).toBe(true);
      expect((await client.request.post('/api/auth/change-password', { headers, data: { currentPassword: temporaryPassword, newPassword: personalPassword } })).ok()).toBe(true);
    }
    await Promise.all([employee.goto('/'), staff.goto('/work')]);
    await Promise.all([expect(employee.locator('[data-realtime="current"]')).toBeVisible(), expect(staff.locator('[data-realtime="current"]')).toBeVisible()]);
    return { employee, staff, name, item, contexts, close: async () => { for (const context of contexts) await context.close(); } };
  } catch (error) {
    for (const context of contexts) await context.close();
    throw error;
  }
}

test('healthy focus needs no requests and a burst of resume events reconciles once', async ({ page, browser }) => {
  const f = await fixture(page, browser);
  try {
    const paths: string[] = [];
    f.employee.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/api/')) paths.push(path);
    });
    await f.employee.evaluate(async () => {
      window.dispatchEvent(new Event('focus'));
      await new Promise(requestAnimationFrame);
    });
    await expect(f.employee.locator('[data-realtime="current"]')).toBeVisible();
    expect(paths).toEqual([]);
    await f.employee.evaluate(() => {
      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('pageshow'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(f.employee.locator('[data-realtime="current"]')).toBeVisible();
    await expect.poll(() => [...paths].sort()).toEqual(['/api/auth/get-session', '/api/events', '/api/menu', '/api/orders']);
    paths.length = 0;
    expect((await f.employee.request.post('/api/orders', { headers, data: {
      idempotencyKey: randomUUID(), items: [{ itemId: f.item.id, quantity: 1 }], note: 'Selective refresh',
    } })).status()).toBe(201);
    await expect(f.employee.getByRole('article').filter({ hasText: 'Selective refresh' })).toBeVisible();
    expect(paths).toEqual(['/api/orders']);
  } finally { await f.close(); }
});

test('a change racing the ready refetch is reconciled again; page return replaces suspended live status', async ({ page, browser }) => {
  const f = await fixture(page, browser);
  let release = () => {};
  try {
    const response = await f.employee.request.post('/api/orders', { headers, data: {
      idempotencyKey: randomUUID(), items: [{ itemId: f.item.id, quantity: 1 }], note: 'Race recovery',
    } });
    expect(response.status()).toBe(201);
    const order = orderResponseSchema.parse(await response.json()).order;
    const employeeCard = f.employee.getByRole('article').filter({ hasText: 'Race recovery' });
    await expect(employeeCard.getByText('Pending', { exact: true })).toBeVisible();
    const held = new Promise<void>((resolve) => { release = resolve; });
    let captured = () => {};
    const snapshot = new Promise<void>((resolve) => { captured = resolve; });
    let intercept = true;
    await f.employee.route('**/api/orders', async (route) => {
      if (route.request().method() !== 'GET' || !intercept) { await route.continue(); return; }
      intercept = false;
      const response = await route.fetch();
      captured();
      await held;
      await route.fulfill({ response });
    });
    await f.employee.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect(f.employee.locator('[data-realtime="suspended"]')).toContainText('may be out of date');
    await f.employee.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await snapshot;
    expect((await f.staff.request.post('/api/orders/' + order.id + '/accept', { headers, data: {} })).ok()).toBe(true);
    await expect(f.employee.locator('[data-realtime="current"]')).toHaveCount(0);
    release();
    await expect(employeeCard.getByText('Accepted', { exact: true })).toBeVisible();
    await expect(f.employee.locator('[data-realtime="current"]')).toBeVisible();
    await f.employee.unroute('**/api/orders');

    await f.employee.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await expect(f.employee.locator('[data-realtime="suspended"]')).toBeVisible();
    expect((await f.staff.request.post('/api/orders/' + order.id + '/deliver', { headers, data: {} })).ok()).toBe(true);
    await f.employee.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    await expect(employeeCard.getByText('Delivered', { exact: true })).toBeVisible();
    await expect(f.employee.locator('[data-realtime="current"]')).toBeVisible();
  } finally { release(); await f.close(); }
});

test('offline guards cover fulfillment, administration, profile and password commands without queued requests', async ({ page, browser }) => {
  const f = await fixture(page, browser);
  try {
    const response = await f.employee.request.post('/api/orders', { headers, data: {
      idempotencyKey: randomUUID(), items: [{ itemId: f.item.id, quantity: 1 }], note: 'Offline commands',
    } });
    expect(response.status()).toBe(201);
    const card = f.staff.getByRole('article').filter({ hasText: 'Offline commands' });
    await expect(card).toBeVisible();
    await f.contexts[1].setOffline(true);
    await f.staff.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(card.getByRole('button', { name: 'Accept order', exact: true })).toBeDisabled();
    await f.contexts[1].setOffline(false);
    await f.staff.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(card.getByText('Pending', { exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Accept order', exact: true })).toBeEnabled();

    await page.goto('/admin');
    await page.getByRole('button', { name: 'Add person', exact: true }).click();
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByRole('button', { name: 'Add person', exact: true }).last()).toBeDisabled();
    await expect(page.getByLabel('Language', { exact: true }).first()).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true, includeHidden: true })).toBeDisabled();
    await page.context().setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('banner').locator('.account-name').click();
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await page.context().setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(page.getByRole('dialog', { name: 'Change password' }).getByRole('button', { name: 'Change password', exact: true })).toBeDisabled();
  } finally {
    await page.context().setOffline(false);
    await f.close();
  }
});

test('native reconnect recovers missed orders without retry clicks and the heartbeat watchdog replaces a dead stream', async ({ page, browser }) => {
  const f = await fixture(page, browser);
  try {
    await f.staff.clock.install();
    let interrupt = true;
    await f.staff.route('**/api/events', async (route) => {
      if (interrupt) { interrupt = false; await route.abort(); }
      else await route.continue();
    });
    await f.staff.reload();
    await expect(f.staff.locator('[data-realtime="disconnected"]')).toBeVisible();
    expect((await f.employee.request.post('/api/orders', { headers, data: {
      idempotencyKey: randomUUID(), items: [{ itemId: f.item.id, quantity: 1 }], note: 'Native reconnect',
    } })).status()).toBe(201);
    await expect(f.staff.locator('[data-realtime="current"]')).toBeVisible({ timeout: 10000 });
    await expect(f.staff.getByRole('article').filter({ hasText: 'Native reconnect' })).toBeVisible();
    const reconnect = f.staff.waitForRequest('**/api/events');
    await f.staff.clock.fastForward(45001);
    await reconnect;
    await expect(f.staff.locator('[data-realtime="current"]')).toBeVisible();
    await expect(f.staff.getByRole('article').filter({ hasText: 'Native reconnect' })).toBeVisible();
  } finally { await f.close(); }
});
